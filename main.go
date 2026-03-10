// Encounty — Pokémon Shiny Encounter Counter
//
// main.go is the application entry point. It initialises the config
// directory, loads persisted state, starts the global hotkey manager,
// creates the HTTP server, opens the browser, and blocks until a signal
// triggers graceful shutdown.
package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/zsleyer/encounty/internal/detector"
	"github.com/zsleyer/encounty/internal/fileoutput"
	"github.com/zsleyer/encounty/internal/hotkeys"
	"github.com/zsleyer/encounty/internal/logger"
	"github.com/zsleyer/encounty/internal/server"
	"github.com/zsleyer/encounty/internal/state"
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

	// State
	stateMgr := state.NewManager(configDir)
	if err := stateMgr.Load(); err != nil {
		slog.Warn("Could not load state", "error", err)
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
	})

	// Wire the real broadcast function now that the server (and hub) exist.
	broadcastFn = srv.Broadcast

	// Open browser — skip if restarting after an update (client is still open)
	markerPath := filepath.Join(configDir, ".update-restart")
	if _, err := os.Stat(markerPath); err == nil {
		slog.Info("Skipping browser open (update restart)")
		os.Remove(markerPath)
	} else {
		go func() {
			time.Sleep(500 * time.Millisecond)
			url := fmt.Sprintf("http://localhost:%d", port)
			slog.Info("Opening browser", "url", url)
			openBrowser(url)
		}()
	}

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

// openBrowser launches the system default browser at url using the
// platform's native open command (xdg-open on Linux, open on macOS,
// start on Windows). Errors are logged but non-fatal.
func openBrowser(url string) {
	var cmd string
	var args []string
	switch runtime.GOOS {
	case "windows":
		cmd = "cmd"
		args = []string{"/c", "start", url}
	case "darwin":
		cmd = "open"
		args = []string{url}
	default:
		cmd = "xdg-open"
		args = []string{url}
	}
	if err := exec.Command(cmd, args...).Start(); err != nil {
		slog.Warn("Could not open browser", "error", err)
	}
}
