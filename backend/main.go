// Encounty — Pokémon Shiny Encounter Counter
//
// main.go is the application entry point. It initialises the config
// directory, loads persisted state, starts the global hotkey manager,
// creates the HTTP server, and blocks until a signal triggers graceful shutdown.

// @title           Encounty API
// @version         1.0
// @description     Pokémon Shiny Encounter Counter — REST API
// @host            localhost:8192
// @BasePath        /api
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	_ "github.com/zsleyer/encounty/backend/docs"

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

// formatVersionDisplay builds the display string in the format "v0.3-abc1234".
func formatVersionDisplay(ver, cmt string) string {
	if ver == "dev" {
		return "dev-" + cmt
	}
	return ver + "-" + cmt
}

func main() {
	devMode := flag.Bool("dev", false, "Development mode (manual setup, no auto-sync)")
	frontendDir := flag.String("frontend-dir", "", "Path to frontend dist directory (enables overlay serving)")
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

	configDir := getConfigDir()
	slog.Info("Config directory", "path", configDir)

	stateMgr, db := initStateAndDB(configDir)

	port := 8192

	st := stateMgr.GetState()
	fileWriter := initFileWriter(st, configDir)
	if fileWriter != nil {
		stateMgr.OnChange(func(st state.AppState) {
			fileWriter.Write(st)
		})
	}
	hotkeyMgr := initHotkeys(stateMgr)

	// Detector manager — holds references for config/template management.
	detectorMgr := detector.NewManager(stateMgr, configDir)

	srv := server.New(server.Config{
		Port:        port,
		State:       stateMgr,
		HotkeyMgr:   hotkeyMgr,
		FileWriter:  fileWriter,
		Version:     version,
		Commit:      commit,
		BuildDate:   buildDate,
		ConfigDir:   configDir,
		DetectorMgr: detectorMgr,
		DB:          db,
		DevMode:     *devMode,
		FrontendDir: *frontendDir,
	})

	srv.InitAsync()

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
	if err := os.MkdirAll(effectiveDir, 0755); err != nil {
		slog.Warn("Could not create config directory", "error", err)
	}
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
		// Stop all running timers so elapsed time is folded into accumulated_ms
		// before the state is persisted. This ensures timers start paused on restart.
		stateMgr.StopAllTimers()
		// Save state before closing the DB — Save needs the DB connection.
		if err := stateMgr.Save(); err != nil {
			slog.Error("Failed to save state", "error", err)
		}
		if db != nil {
			_ = db.Close()
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

// migrateJSONToDB migrates state.json into the SQLite database on first run
// after the migration. Files are deleted after successful migration.
func migrateJSONToDB(configDir string, db *database.DB) {
	migrateStateJSON(configDir, db)
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
// required. The migration is idempotent: it checks whether the app_config row
// already exists (indicating data was previously migrated) and skips if so.
func migrateToNormalizedSchema(db *database.DB, stateMgr *state.Manager) {
	if db.HasState() {
		return
	}

	st := stateMgr.GetState()
	if len(st.Pokemon) == 0 && st.ActiveID == "" && !st.LicenseAccepted {
		return
	}

	loadTemplateImagesFromDisk(st.Pokemon, stateMgr.GetConfigDir())

	if err := db.SaveFullState(&st); err != nil {
		slog.Error("Failed to migrate to normalized schema", "error", err)
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

