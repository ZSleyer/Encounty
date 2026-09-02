// Encounty, Pokémon Shiny Encounter Counter
//
// main.go is the application entry point. It initialises the config
// directory, loads persisted state, starts the global hotkey manager,
// creates the HTTP server, and blocks until a signal triggers graceful shutdown.

// @title           Encounty API
// @version         1.0
// @description     Pokémon Shiny Encounter Counter, REST API
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
	"strings"
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
	stateMgr.StartNotifier()

	port := server.DefaultPort

	st := stateMgr.GetState()
	fileWriter := initFileWriter(st, stateMgr.GetDBDir())
	if fileWriter != nil {
		stateMgr.OnChange(func(st state.AppState) {
			fileWriter.Write(st)
		})
	}

	// Persist on every state change via the single notifier chokepoint, so no
	// individual handler can cause data loss by forgetting to schedule a save.
	stateMgr.OnChange(func(state.AppState) {
		stateMgr.ScheduleSave()
	})
	hotkeyMgr := initHotkeys(stateMgr)

	// Detector manager, holds references for config/template management.
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

	startGracefulShutdown(srv, hotkeyMgr, stateMgr)

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
		if info, err := os.Stat(customPath); err != nil || !info.IsDir() {
			slog.Warn("Custom config path missing or invalid, falling back to default", "path", customPath, "err", err)
		} else {
			slog.Info("Redirecting to custom config path", "path", customPath)
			stateMgr = state.NewManager(customPath)
		}
	}

	effectiveDir := stateMgr.GetConfigDir()
	if err := os.MkdirAll(effectiveDir, 0755); err != nil {
		slog.Warn("Could not create config directory", "error", err)
	}

	// The database may live outside the config directory. Everything else
	// (caches, backgrounds, legacy template files) stays behind.
	dbDir := state.ResolveDBDir(effectiveDir)
	if dbDir != effectiveDir {
		if err := os.MkdirAll(dbDir, 0755); err != nil {
			slog.Warn("Could not create database directory", "dir", dbDir, "error", err)
		}
		slog.Info("Opening the database from its recorded location", "path", dbDir)
	}
	// Before Load: applyMigrations derives AppState.DataPath from it.
	stateMgr.SetDBDir(dbDir)

	db, err := database.Open(filepath.Join(dbDir, state.DBFilename))
	if err != nil {
		slog.Warn("Could not open database", "error", err)
	}

	if db != nil {
		stateMgr.SetDB(db)
	}
	if err := stateMgr.Load(); err != nil {
		slog.Warn("Could not load state", "error", err)
	}
	if db != nil {
		importBackgrounds(effectiveDir, db)
		sweepOrphanBackgrounds(db)
	}
	if db != nil && db.HasState() {
		cleanupLegacyArtefacts(effectiveDir)
	}
	return stateMgr, db
}

// importBackgrounds moves overlay background images from the filesystem into
// the database, where the rest of what a user uploads already lives. A file is
// deleted only after it is stored, so a read that fails leaves the image alone
// and the next start tries again.
//
// This deliberately does not run through cleanupLegacyArtefacts: that list is
// removed unconditionally, and a background image is user data, not a leftover.
func importBackgrounds(configDir string, db *database.DB) {
	dir := filepath.Join(configDir, "backgrounds")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return // no directory, nothing to import
	}

	imported := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		path := filepath.Join(dir, e.Name())
		if db.HasBackground(e.Name()) {
			_ = os.Remove(path)
			continue
		}
		data, err := os.ReadFile(path)
		if err != nil {
			slog.Warn("Could not read a background image, leaving it in place", "path", path, "error", err)
			continue
		}
		if err := db.SaveBackground(e.Name(), data, mimeByExtension(e.Name())); err != nil {
			slog.Warn("Could not import a background image, leaving it in place", "path", path, "error", err)
			continue
		}
		if err := os.Remove(path); err != nil {
			slog.Warn("Imported a background image but could not remove the file", "path", path, "error", err)
		}
		imported++
	}

	if imported > 0 {
		slog.Info("Imported overlay background images into the database", "count", imported)
	}
	// Only succeeds once every file made it in, which is the condition we want.
	_ = os.Remove(dir)
}

// sweepOrphanBackgrounds removes images no overlay references any more.
//
// It runs only once the database carries state. Without that guard a fresh
// installation, whose overlay settings have not been written yet, would look
// like nothing references anything and the sweep would delete the images it
// had just imported.
func sweepOrphanBackgrounds(db *database.DB) {
	if !db.HasState() {
		return
	}
	n, err := db.DeleteOrphanBackgrounds()
	if err != nil {
		slog.Warn("Could not clean up unreferenced background images", "error", err)
		return
	}
	if n > 0 {
		slog.Info("Removed background images no overlay references", "count", n)
	}
}

// mimeByExtension maps a stored background name to its media type. The upload
// only ever wrote png and jpeg, so anything else is treated as png rather than
// refusing an image that has been working until now.
func mimeByExtension(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	default:
		return "image/png"
	}
}

// legacyArtefacts are the files and directories that predate the normalized
// database. Template images live in the database as BLOBs, the state lives in
// its tables, and pokemon.json has had no reader for several releases.
var legacyArtefacts = []string{"state.json", "templates", "pokemon.json"}

// cleanupLegacyArtefacts removes what the pre-database layout left in the
// configuration directory. It runs only once the database carries normalized
// state, so the files it deletes are copies of what is already stored.
//
// It deliberately works on the effective configuration directory. An install
// that relocated its whole directory keeps a pointer state.json in the platform
// default directory, and that pointer is how it finds its data at all.
func cleanupLegacyArtefacts(configDir string) {
	var removed []string
	for _, name := range legacyArtefacts {
		path := filepath.Join(configDir, name)
		if _, err := os.Stat(path); err != nil {
			continue
		}
		if err := os.RemoveAll(path); err != nil {
			slog.Warn("Could not remove a legacy artefact", "path", path, "error", err)
			continue
		}
		removed = append(removed, name)
	}
	if len(removed) > 0 {
		slog.Info("Removed legacy files superseded by the database", "files", removed)
	}
}

// initFileWriter creates the file-output writer used for OBS text sources.
// dbDir, not the config directory: the default output folder lives next to the
// database and follows it when the user relocates it.
func initFileWriter(st state.AppState, dbDir string) *fileoutput.Writer {
	outputDir := st.Settings.OutputDir
	if outputDir == "" {
		outputDir = filepath.Join(dbDir, "output")
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

const (
	// httpShutdownTimeout bounds how long in-flight requests may finish.
	httpShutdownTimeout = 2 * time.Second
	// shutdownWatchdog is the hard ceiling for the whole shutdown. It must stay
	// under the 5s the Electron wrapper allows before it sends SIGKILL, so the
	// database is closed by us rather than torn away mid-write.
	shutdownWatchdog = 4 * time.Second
)

// startGracefulShutdown installs signal handlers that perform an orderly
// shutdown of the server, hotkeys, database, and state persistence.
// The database handle is read from srv rather than captured here: a restore or
// a config-directory move swaps it, and closing the handle from startup would
// leave the live database open and its write-ahead log uncheckpointed.
func startGracefulShutdown(srv *server.Server, hotkeyMgr hotkeys.Manager, stateMgr *state.Manager) {
	quit := make(chan os.Signal, 2)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-quit
		slog.Info("Shutting down...")

		// Stays below the 5s the Electron wrapper waits before SIGKILL, so a
		// stuck shutdown still ends on our terms.
		go func() {
			time.Sleep(shutdownWatchdog)
			slog.Warn("Shutdown timed out, forcing exit")
			os.Exit(1)
		}()
		go func() {
			<-quit
			slog.Warn("Second signal, forcing exit")
			os.Exit(1)
		}()

		srv.Hub().CloseAll()
		stateMgr.StopNotifier()
		hotkeyMgr.Stop()
		// Stop all running timers so elapsed time is folded into accumulated_ms
		// before the state is persisted. This ensures timers start paused on restart.
		stateMgr.StopAllTimers()

		// Drain in-flight requests before the database goes away, otherwise a
		// handler still running can find its connection closed underneath it.
		ctx, cancel := context.WithTimeout(context.Background(), httpShutdownTimeout)
		if err := srv.Shutdown(ctx); err != nil {
			slog.Error("Server shutdown error", "error", err)
		}
		cancel()

		// Save state before closing the DB, Save needs the DB connection.
		if err := stateMgr.Save(); err != nil {
			slog.Error("Failed to save state", "error", err)
		}
		if db := srv.DB(); db != nil {
			_ = db.Close()
		}
		os.Exit(0)
	}()
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
	case "darwin":
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "Library", "Application Support", "Encounty")
	default:
		home, _ := os.UserHomeDir()
		return filepath.Join(home, ".config", "encounty")
	}
}
