// Encounty — Pokémon Shiny Encounter Counter
//
// main.go is the application entry point. It initialises the config
// directory, loads persisted state, starts the global hotkey manager,
// creates the HTTP server, and blocks until a signal triggers graceful shutdown.
package main

import (
	"context"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/detector"
	"github.com/zsleyer/encounty/backend/internal/fileoutput"
	"github.com/zsleyer/encounty/backend/internal/hotkeys"
	"github.com/zsleyer/encounty/backend/internal/logger"
	"github.com/zsleyer/encounty/backend/internal/server"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// Injected at build time via -ldflags "-X main.version=v1.0.0 -X main.commit=abc1234"
// Falls back to "dev" / "unknown" when running via `go run`.
var (
	version   = "dev"
	commit    = "unknown"
	buildDate = "000000"
)

//go:embed games.json
var embeddedGamesJSON []byte

//go:embed all:frontend/dist
var frontendFS embed.FS

// formatVersionDisplay builds the display string in the format "v0.3-abc1234".
func formatVersionDisplay(ver, cmt string) string {
	if ver == "dev" {
		return "dev-" + cmt
	}
	return ver + "-" + cmt
}

func main() {
	devMode := flag.Bool("dev", false, "Development mode (proxy to Vite dev server)")
	logLevel := flag.String("log-level", "info", "Log level: debug, info, warn, error")
	showVersion := flag.Bool("version", false, "Show version information")
	flag.BoolVar(showVersion, "v", false, "Show version information")
	flag.Parse()

	logger.Init(*logLevel)

	if *showVersion {
		fmt.Printf("Encounty %s (built %s)\n", formatVersionDisplay(version, commit), buildDate)
		fmt.Printf("Runtime: %s (%s/%s)\n", runtime.Version(), runtime.GOOS, runtime.GOARCH)
		os.Exit(0)
	}

	// Inject embedded games.json as fallback for the server package
	server.SetDefaultGamesJSON(embeddedGamesJSON)

	configDir := getConfigDir()
	slog.Info("Config directory", "path", configDir)

	// State — lightweight JSON-only load to resolve custom config path redirect
	stateMgr := state.NewManager(configDir)
	if err := stateMgr.LoadFromJSON(); err != nil {
		slog.Warn("Could not load state from JSON", "error", err)
	}
	if customPath := stateMgr.GetState().Settings.ConfigPath; customPath != "" && customPath != configDir {
		slog.Info("Redirecting to custom config path", "path", customPath)
		stateMgr = state.NewManager(customPath)
	}

	// SQLite database — opened at the effective config directory
	effectiveDir := stateMgr.GetConfigDir()
	dbPath := filepath.Join(effectiveDir, "encounty.db")
	db, err := database.Open(dbPath)
	if err != nil {
		slog.Warn("Could not open database", "error", err)
	}

	// Migrate JSON files into the database (one-time)
	if db != nil {
		migrateJSONToDB(effectiveDir, db)
	}

	// Wire DB to state manager and perform authoritative load
	if db != nil {
		stateMgr.SetDB(db)
	}
	if err := stateMgr.Load(); err != nil {
		slog.Warn("Could not load state", "error", err)
	}

	// Migrate from JSON blob to normalized schema (one-time)
	if db != nil {
		migrateToNormalizedSchema(db, stateMgr)
	}

	st := stateMgr.GetState()
	port := st.Settings.BrowserPort
	if port == 0 {
		port = 8080
	}

	// File output writer
	outputDir := st.Settings.OutputDir
	outputEnabled := st.Settings.OutputEnabled
	var fileWriter *fileoutput.Writer
	if outputDir != "" {
		fileWriter = fileoutput.New(outputDir, outputEnabled)
	} else {
		fileWriter = fileoutput.New(filepath.Join(configDir, "output"), outputEnabled)
	}

	// Hotkey manager
	hotkeyMgr := hotkeys.New(stateMgr)
	if err := hotkeyMgr.Start(); err != nil {
		slog.Warn("Global hotkeys unavailable", "error", err)
	}

	// Detector manager — broadcast function is wired after server creation.
	var broadcastFn detector.BroadcastFunc = func(msgType string, payload any) {}
	detectorMgr := detector.NewManager(stateMgr, func(msgType string, payload any) {
		broadcastFn(msgType, payload)
	}, configDir)

	// Frontend FS
	var frontFS fs.FS
	if !*devMode {
		frontFS = frontendFS
	}

	// Server
	srv := server.New(server.Config{
		Port:        port,
		FrontendFS:  frontFS,
		State:       stateMgr,
		HotkeyMgr:   hotkeyMgr,
		FileWriter:  fileWriter,
		Version:     version,
		Commit:      commit,
		BuildDate:   buildDate,
		ConfigDir:   configDir,
		DetectorMgr: detectorMgr,
		DB:          db,
	})

	// Wire the real broadcast function now that the server (and hub) exist.
	broadcastFn = srv.Broadcast


	// Graceful shutdown — buffer 2 so a second signal is never dropped.
	quit := make(chan os.Signal, 2)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-quit // first signal → start graceful shutdown
		slog.Info("Shutting down...")

		// Hard-kill safety net: if shutdown takes > 3 s, force-exit.
		go func() {
			time.Sleep(3 * time.Second)
			slog.Warn("Shutdown timed out, forcing exit")
			os.Exit(1)
		}()

		// Also force-exit immediately on a second signal.
		go func() {
			<-quit
			slog.Warn("Second signal, forcing exit")
			os.Exit(1)
		}()

		// Close all WebSocket connections first so http.Shutdown() returns
		// immediately instead of waiting for persistent connections to time out.
		srv.Hub().CloseAll()

		hotkeyMgr.Stop()
		if db != nil {
			db.Close()
		}
		if err := stateMgr.Save(); err != nil {
			slog.Error("Failed to save state", "error", err)
		}

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			slog.Error("Server shutdown error", "error", err)
		}
		os.Exit(0)
	}()

	if err := srv.Start(); err != nil && err != http.ErrServerClosed {
		slog.Error("Server error", "error", err)
		os.Exit(1)
	}
}

// migrateJSONToDB migrates state.json and games.json into the SQLite database
// on first run after the migration. Files are deleted after successful migration.
func migrateJSONToDB(configDir string, db *database.DB) {
	// Migrate state.json
	if !db.HasAppState() {
		stateJSON := filepath.Join(configDir, "state.json")
		if data, err := os.ReadFile(stateJSON); err == nil {
			if err := db.SaveAppState(data); err != nil {
				slog.Warn("Failed to migrate state.json to DB", "error", err)
			} else if db.HasAppState() {
				os.Remove(stateJSON)
				slog.Info("Migrated state.json into database")
			}
		}
	}

	// Migrate games.json
	if !db.HasGames() {
		gamesJSON := filepath.Join(configDir, "games.json")
		if data, err := os.ReadFile(gamesJSON); err == nil {
			rows, parseErr := parseGamesJSONToRows(data)
			if parseErr == nil && len(rows) > 0 {
				if err := db.SaveGames(rows); err != nil {
					slog.Warn("Failed to migrate games.json to DB", "error", err)
				} else if db.HasGames() {
					os.Remove(gamesJSON)
					slog.Info("Migrated games.json into database")
				}
			}
		} else if len(embeddedGamesJSON) > 0 {
			// No games.json on disk and no DB games — seed from embedded default
			rows, parseErr := parseGamesJSONToRows(embeddedGamesJSON)
			if parseErr == nil && len(rows) > 0 {
				if err := db.SaveGames(rows); err != nil {
					slog.Warn("Failed to seed games from embedded default", "error", err)
				} else {
					slog.Info("Seeded games database from embedded default")
				}
			}
		}
	}
}

// parseGamesJSONToRows parses the raw games JSON map into database rows.
func parseGamesJSONToRows(data []byte) ([]database.GameRow, error) {
	var raw map[string]struct {
		Names      map[string]string `json:"names"`
		Generation int               `json:"generation"`
		Platform   string            `json:"platform"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	rows := make([]database.GameRow, 0, len(raw))
	for key, v := range raw {
		namesJSON, err := json.Marshal(v.Names)
		if err != nil {
			continue
		}
		rows = append(rows, database.GameRow{
			Key:        key,
			NamesJSON:  namesJSON,
			Generation: v.Generation,
			Platform:   v.Platform,
		})
	}
	return rows, nil
}

// migrateToNormalizedSchema writes the in-memory state (loaded from the legacy
// JSON blob) into the normalized v2 database tables. Template images are read
// from disk and embedded as BLOBs so that the filesystem copies are no longer
// required. The migration is idempotent: it checks SchemaVersion and skips if
// the database has already been upgraded.
func migrateToNormalizedSchema(db *database.DB, stateMgr *state.Manager) {
	if db.SchemaVersion() >= 2 {
		return
	}

	// Get the state that was already loaded from the JSON blob by stateMgr.Load().
	st := stateMgr.GetState()
	if len(st.Pokemon) == 0 && st.ActiveID == "" && !st.LicenseAccepted {
		// Empty/fresh state — nothing to migrate, just mark as v2.
		if err := db.SetSchemaVersion(2); err != nil {
			slog.Error("Failed to set schema version on fresh install", "error", err)
		}
		return
	}

	configDir := stateMgr.GetConfigDir()

	// Load template images from disk into ImageData so SaveFullState persists them as BLOBs.
	for i := range st.Pokemon {
		p := &st.Pokemon[i]
		if p.DetectorConfig == nil {
			continue
		}
		for j := range p.DetectorConfig.Templates {
			t := &p.DetectorConfig.Templates[j]
			if t.ImagePath == "" {
				continue
			}
			absPath := filepath.Join(configDir, "templates", p.ID, t.ImagePath)
			imgData, err := os.ReadFile(absPath)
			if err != nil {
				slog.Warn("Could not read template image for migration", "path", absPath, "error", err)
				continue
			}
			t.ImageData = imgData
		}
	}

	if err := db.SaveFullState(&st); err != nil {
		slog.Error("Failed to migrate to normalized schema", "error", err)
		return
	}

	if err := db.SetSchemaVersion(2); err != nil {
		slog.Error("Failed to set schema version after migration", "error", err)
		return
	}

	slog.Info("Migrated state to normalized database schema (v2)")
}

// getConfigDir returns the platform-appropriate configuration directory:
// %APPDATA%\Encounty on Windows, ~/.config/encounty on all other platforms.
func getConfigDir() string {
	switch runtime.GOOS {
	case "windows":
		appdata := os.Getenv("APPDATA")
		if appdata == "" {
			appdata, _ = os.UserHomeDir()
		}
		return filepath.Join(appdata, "Encounty")
	default:
		home, _ := os.UserHomeDir()
		return filepath.Join(home, ".config", "encounty")
	}
}

