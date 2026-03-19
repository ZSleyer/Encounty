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

	server.SetDefaultGamesJSON(embeddedGamesJSON)

	configDir := getConfigDir()
	slog.Info("Config directory", "path", configDir)

	stateMgr, db := initStateAndDB(configDir)

	st := stateMgr.GetState()
	port := st.Settings.BrowserPort
	if port == 0 {
		port = 8080
	}

	fileWriter := initFileWriter(st, configDir)
	hotkeyMgr := initHotkeys(stateMgr)

	// Detector manager — broadcast function is wired after server creation.
	var broadcastFn detector.BroadcastFunc = func(msgType string, payload any) { /* replaced after server init */ }
	detectorMgr := detector.NewManager(stateMgr, func(msgType string, payload any) {
		broadcastFn(msgType, payload)
	}, configDir)

	var frontFS fs.FS
	if !*devMode {
		frontFS = frontendFS
	}

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

	broadcastFn = srv.Broadcast

	startGracefulShutdown(srv, hotkeyMgr, db, stateMgr)

	if err := srv.Start(); err != nil && err != http.ErrServerClosed {
		slog.Error("Server error", "error", err)
		os.Exit(1)
	}
}

// initStateAndDB creates the state manager, opens the database, runs
// migrations, and loads the authoritative state. It returns the fully
// initialised manager and the database handle (which may be nil).
func initStateAndDB(configDir string) (*state.Manager, *database.DB) {
	stateMgr := state.NewManager(configDir)
	if err := stateMgr.LoadFromJSON(); err != nil {
		slog.Warn("Could not load state from JSON", "error", err)
	}
	if customPath := stateMgr.GetState().Settings.ConfigPath; customPath != "" && customPath != configDir {
		slog.Info("Redirecting to custom config path", "path", customPath)
		stateMgr = state.NewManager(customPath)
	}

	effectiveDir := stateMgr.GetConfigDir()
	dbPath := filepath.Join(effectiveDir, "encounty.db")
	db, err := database.Open(dbPath)
	if err != nil {
		slog.Warn("Could not open database", "error", err)
	}

	if db != nil {
		migrateJSONToDB(effectiveDir, db)
		stateMgr.SetDB(db)
	}
	if err := stateMgr.Load(); err != nil {
		slog.Warn("Could not load state", "error", err)
	}
	if db != nil {
		migrateToNormalizedSchema(db, stateMgr)
		// Remove legacy state.json when DB is active to prevent stale
		// JSON from being loaded on subsequent startups.
		jsonPath := filepath.Join(effectiveDir, "state.json")
		if _, err := os.Stat(jsonPath); err == nil {
			_ = os.Remove(jsonPath)
			slog.Info("Removed legacy state.json (DB is active)")
		}
	}
	return stateMgr, db
}

// initFileWriter creates the file-output writer used for OBS text sources.
func initFileWriter(st state.AppState, configDir string) *fileoutput.Writer {
	outputDir := st.Settings.OutputDir
	if outputDir == "" {
		outputDir = filepath.Join(configDir, "output")
	}
	return fileoutput.New(outputDir, st.Settings.OutputEnabled)
}

// initHotkeys creates and starts the global hotkey manager.
func initHotkeys(stateMgr *state.Manager) hotkeys.Manager {
	hotkeyMgr := hotkeys.New(stateMgr)
	if err := hotkeyMgr.Start(); err != nil {
		slog.Warn("Global hotkeys unavailable", "error", err)
	}
	return hotkeyMgr
}

// startGracefulShutdown installs signal handlers that perform an orderly
// shutdown of the server, hotkeys, database, and state persistence.
func startGracefulShutdown(srv *server.Server, hotkeyMgr hotkeys.Manager, db *database.DB, stateMgr *state.Manager) {
	quit := make(chan os.Signal, 2)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-quit
		slog.Info("Shutting down...")

		go func() {
			time.Sleep(3 * time.Second)
			slog.Warn("Shutdown timed out, forcing exit")
			os.Exit(1)
		}()
		go func() {
			<-quit
			slog.Warn("Second signal, forcing exit")
			os.Exit(1)
		}()

		srv.Hub().CloseAll()
		hotkeyMgr.Stop()
		if db != nil {
			_ = db.Close()
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
}

// migrateStateJSON migrates state.json into the SQLite database.
// The JSON file is deleted after successful migration.
func migrateStateJSON(configDir string, db *database.DB) {
	if db.HasAppState() {
		return
	}
	stateJSON := filepath.Join(configDir, "state.json")
	data, err := os.ReadFile(stateJSON)
	if err != nil {
		return
	}
	if err := db.SaveAppState(data); err != nil {
		slog.Warn("Failed to migrate state.json to DB", "error", err)
		return
	}
	if db.HasAppState() {
		_ = os.Remove(stateJSON)
		slog.Info("Migrated state.json into database")
	}
}

// migrateGamesJSON migrates games.json into the SQLite database, falling back
// to the embedded default when no file exists on disk. The JSON file is deleted
// after successful migration.
func migrateGamesJSON(configDir string, db *database.DB) {
	if db.HasGames() {
		return
	}
	gamesJSON := filepath.Join(configDir, "games.json")
	data, err := os.ReadFile(gamesJSON)
	if err == nil {
		rows, parseErr := parseGamesJSONToRows(data)
		if parseErr == nil && len(rows) > 0 {
			if err := db.SaveGames(rows); err != nil {
				slog.Warn("Failed to migrate games.json to DB", "error", err)
			} else if db.HasGames() {
				_ = os.Remove(gamesJSON)
				slog.Info("Migrated games.json into database")
			}
		}
		return
	}

	// No games.json on disk — seed from embedded default.
	if len(embeddedGamesJSON) == 0 {
		return
	}
	rows, parseErr := parseGamesJSONToRows(embeddedGamesJSON)
	if parseErr == nil && len(rows) > 0 {
		if err := db.SaveGames(rows); err != nil {
			slog.Warn("Failed to seed games from embedded default", "error", err)
		} else {
			slog.Info("Seeded games database from embedded default")
		}
	}
}

// migrateJSONToDB migrates state.json and games.json into the SQLite database
// on first run after the migration. Files are deleted after successful migration.
func migrateJSONToDB(configDir string, db *database.DB) {
	migrateStateJSON(configDir, db)
	migrateGamesJSON(configDir, db)
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

// loadTemplateImagesFromDisk reads template images from the filesystem into
// their ImageData fields so they can be persisted as BLOBs during migration.
func loadTemplateImagesFromDisk(pokemon []state.Pokemon, configDir string) {
	for i := range pokemon {
		p := &pokemon[i]
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

	st := stateMgr.GetState()
	if len(st.Pokemon) == 0 && st.ActiveID == "" && !st.LicenseAccepted {
		if err := db.SetSchemaVersion(2); err != nil {
			slog.Error("Failed to set schema version on fresh install", "error", err)
		}
		return
	}

	loadTemplateImagesFromDisk(st.Pokemon, stateMgr.GetConfigDir())

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

