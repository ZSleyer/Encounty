package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/encounty/encounty/internal/fileoutput"
	"github.com/encounty/encounty/internal/hotkeys"
	"github.com/encounty/encounty/internal/server"
	"github.com/encounty/encounty/internal/state"
)

//go:embed all:frontend/dist
var frontendFS embed.FS

func main() {
	devMode := flag.Bool("dev", false, "Development mode (proxy to Vite dev server)")
	flag.Parse()

	configDir := getConfigDir()
	log.Printf("Config directory: %s", configDir)

	// State
	stateMgr := state.NewManager(configDir)
	if err := stateMgr.Load(); err != nil {
		log.Printf("Warning: could not load state: %v", err)
	}

	st := stateMgr.GetState()
	port := st.Settings.BrowserPort
	if port == 0 {
		port = 8080
	}

	// File output writer
	outputDir := st.Settings.OutputDir
	var fileWriter *fileoutput.Writer
	if outputDir != "" {
		fileWriter = fileoutput.New(outputDir)
	} else {
		fileWriter = fileoutput.New(filepath.Join(configDir, "output"))
	}

	// Hotkey manager
	hotkeyMgr := hotkeys.New(stateMgr)
	if err := hotkeyMgr.Start(); err != nil {
		log.Printf("Warning: could not register hotkeys: %v", err)
	}

	// Frontend FS
	var frontFS fs.FS
	if !*devMode {
		frontFS = frontendFS
	}

	// Server
	srv := server.New(server.Config{
		Port:       port,
		FrontendFS: frontFS,
		State:      stateMgr,
		HotkeyMgr:  hotkeyMgr,
		FileWriter: fileWriter,
	})

	// Open browser
	go func() {
		time.Sleep(500 * time.Millisecond)
		url := fmt.Sprintf("http://localhost:%d", port)
		log.Printf("Opening browser at %s", url)
		openBrowser(url)
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-quit
		log.Println("Shutting down...")
		hotkeyMgr.Stop()
		if err := stateMgr.Save(); err != nil {
			log.Printf("Save error: %v", err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("Server shutdown error: %v", err)
		}
		os.Exit(0)
	}()

	if err := srv.Start(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server error: %v", err)
	}
}

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
		log.Printf("Could not open browser: %v", err)
	}
}
