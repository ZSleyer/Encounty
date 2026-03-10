// Package server provides the HTTP server that serves the embedded React
// frontend, exposes a REST API, and maintains the WebSocket hub for real-time
// state synchronisation with the browser.
package server

import (
	"context"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"

	"github.com/zsleyer/encounty/internal/detector"
	"github.com/zsleyer/encounty/internal/fileoutput"
	"github.com/zsleyer/encounty/internal/hotkeys"
	"github.com/zsleyer/encounty/internal/state"
)

// Server wires together the HTTP multiplexer, WebSocket hub, hotkey manager,
// file-output writer, and state manager into a single runnable unit.
type Server struct {
	state       *state.Manager
	hub         *Hub
	hotkeyMgr   hotkeys.Manager
	fileWriter  *fileoutput.Writer
	httpServer  *http.Server
	frontendFS  fs.FS
	version     string
	commit      string
	buildDate   string
	detectorMgr *detector.Manager
}

// Config carries all dependencies needed to construct a Server.
type Config struct {
	Port        int
	FrontendFS  fs.FS
	State       *state.Manager
	HotkeyMgr   hotkeys.Manager
	FileWriter  *fileoutput.Writer
	Version     string
	Commit      string
	BuildDate   string
	ConfigDir   string
	DetectorMgr *detector.Manager
}

// New creates a Server from cfg, registers all HTTP routes, and starts the
// goroutine that converts hotkey actions into state mutations.
func New(cfg Config) *Server {
	// Make games.json use the config directory
	if cfg.ConfigDir != "" {
		gamesConfigDir = cfg.ConfigDir
	}

	s := &Server{
		state:       cfg.State,
		hub:         NewHub(),
		hotkeyMgr:   cfg.HotkeyMgr,
		fileWriter:  cfg.FileWriter,
		frontendFS:  cfg.FrontendFS,
		version:     cfg.Version,
		commit:      cfg.Commit,
		buildDate:   cfg.BuildDate,
		detectorMgr: cfg.DetectorMgr,
	}

	// Wire hotkey actions to state changes
	go s.processHotkeyActions(cfg.HotkeyMgr.Actions())

	mux := http.NewServeMux()
	s.registerRoutes(mux)

	s.httpServer = &http.Server{
		Addr:    fmt.Sprintf(":%d", cfg.Port),
		Handler: corsMiddleware(mux),
	}

	return s
}

func (s *Server) registerRoutes(mux *http.ServeMux) {
	// WebSocket
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		s.hub.ServeWS(s, w, r)
	})

	// REST API
	mux.HandleFunc("/api/state", s.handleGetState)
	mux.HandleFunc("/api/sessions", s.handleGetSessions)
	mux.HandleFunc("/api/settings", s.handleUpdateSettings)
	mux.HandleFunc("/api/hotkeys", s.handleUpdateHotkeys)
	mux.HandleFunc("/api/hotkeys/pause", s.handleHotkeysPause)
	mux.HandleFunc("/api/hotkeys/resume", s.handleHotkeysResume)
	mux.HandleFunc("/api/hotkeys/status", s.handleHotkeysStatus)
	mux.HandleFunc("/api/hotkeys/", func(w http.ResponseWriter, r *http.Request) {
		action := strings.TrimPrefix(r.URL.Path, "/api/hotkeys/")
		if r.Method == http.MethodPut {
			s.handleUpdateSingleHotkey(w, r, action)
		} else {
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})
	mux.HandleFunc("/api/overlay/state", s.handleOverlayState)
	mux.HandleFunc("/api/games", s.handleGetGames)
	mux.HandleFunc("/api/hunt-types", s.handleGetHuntTypes)
	mux.HandleFunc("/api/games/sync", s.handleSyncGames)
	mux.HandleFunc("/api/pokedex", s.handleGetPokedex)
	mux.HandleFunc("/api/sync/pokemon", s.handleSyncPokemon)
	mux.HandleFunc("/api/backup", s.handleBackup)
	mux.HandleFunc("/api/restore", s.handleRestore)
	mux.HandleFunc("/api/quit", s.handleQuit)
	mux.HandleFunc("/api/restart", s.handleRestart)
	mux.HandleFunc("/api/version", s.handleVersion)
	mux.HandleFunc("/api/update/check", s.handleUpdateCheck)
	mux.HandleFunc("/api/update/apply", s.handleUpdateApply)

	mux.HandleFunc("/api/pokemon", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			st := s.state.GetState()
			writeJSON(w, http.StatusOK, st.Pokemon)
		case http.MethodPost:
			s.handleAddPokemon(w, r)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/pokemon/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		switch {
		case strings.HasSuffix(path, "/increment"):
			id := pokemonIDFromPath(path, "/api/pokemon/", "/increment")
			s.handleIncrement(w, r, id)
		case strings.HasSuffix(path, "/decrement"):
			id := pokemonIDFromPath(path, "/api/pokemon/", "/decrement")
			s.handleDecrement(w, r, id)
		case strings.HasSuffix(path, "/reset"):
			id := pokemonIDFromPath(path, "/api/pokemon/", "/reset")
			s.handleReset(w, r, id)
		case strings.HasSuffix(path, "/activate"):
			id := pokemonIDFromPath(path, "/api/pokemon/", "/activate")
			s.handleActivate(w, r, id)
		case strings.HasSuffix(path, "/complete"):
			id := pokemonIDFromPath(path, "/api/pokemon/", "/complete")
			s.handleCompletePokemon(w, r, id)
		case strings.HasSuffix(path, "/uncomplete"):
			id := pokemonIDFromPath(path, "/api/pokemon/", "/uncomplete")
			s.handleUncompletePokemon(w, r, id)
		default:
			id := pokemonIDFromPath(path, "/api/pokemon/", "")
			switch r.Method {
			case http.MethodPut:
				s.handleUpdatePokemon(w, r, id)
			case http.MethodDelete:
				s.handleDeletePokemon(w, r, id)
			default:
				w.WriteHeader(http.StatusMethodNotAllowed)
			}
		}
	})

	// Detector API
	mux.HandleFunc("/api/detector/screenshot", s.handleDetectorScreenshot)
	mux.HandleFunc("/api/detector/windows", s.handleDetectorWindows)
	mux.HandleFunc("/api/detector/status", s.handleDetectorStatus)
	mux.HandleFunc("/api/detector/", s.handleDetectorDispatch)

	// Frontend static files / SPA fallback
	if s.frontendFS != nil {
		subFS, err := fs.Sub(s.frontendFS, "frontend/dist")
		if err != nil {
			slog.Error("Frontend embed error", "error", err)
		} else {
			mux.Handle("/", spaHandler(subFS))
		}
	}
}

// spaHandler serves static assets from the embedded FS for requests that
// match a real file (JS, CSS, fonts, images, …). All other paths – including
// React-Router paths like /overlay and /settings – receive index.html so the
// client-side router can handle them.
//
// IMPORTANT: we must NOT rewrite r.URL.Path to "/index.html" and forward to
// http.FileServer, because FileServer redirects explicit index.html URLs back
// to the directory (e.g. /index.html → /), causing an infinite redirect loop.
// Instead we read and write index.html content directly.
func spaHandler(fsys fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(fsys))

	indexHTML, err := fs.ReadFile(fsys, "index.html")
	if err != nil {
		slog.Error("spaHandler: could not read index.html", "error", err)
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Strip leading slash; root "/" becomes "" which maps to the FS root dir.
		p := strings.TrimPrefix(r.URL.Path, "/")

		// Check whether the path maps to a real file in the embedded FS.
		f, err := fsys.Open(p)
		if err == nil {
			info, statErr := f.Stat()
			f.Close()
			// Only forward to the file server if it's a regular file (not a dir).
			// Directories would trigger FileServer's index-redirect logic.
			if statErr == nil && !info.IsDir() {
				fileServer.ServeHTTP(w, r)
				return
			}
		}

		// Not a real file (or it's a directory) → serve index.html directly.
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(indexHTML)
	})
}

// Start begins accepting HTTP connections. Blocks until the server is shut
// down; returns http.ErrServerClosed on a clean shutdown.
func (s *Server) Start() error {
	slog.Info("Server listening", "addr", s.httpServer.Addr)
	return s.httpServer.ListenAndServe()
}

// Shutdown gracefully stops the HTTP server, waiting up to ctx's deadline
// for in-flight requests to complete. If a detector manager is wired, all
// running detectors are stopped before the HTTP server shuts down.
func (s *Server) Shutdown(ctx context.Context) error {
	if s.detectorMgr != nil {
		s.detectorMgr.StopAll()
	}
	return s.httpServer.Shutdown(ctx)
}

// Broadcast sends a WebSocket event to all connected clients.
// This is the same as calling hub.Broadcast directly and is exposed
// so that external packages (e.g. detector) can emit events.
func (s *Server) Broadcast(msgType string, payload any) {
	s.hub.BroadcastRaw(msgType, payload)
}

// Hub returns the WebSocket hub so main can call CloseAll during shutdown.
func (s *Server) Hub() *Hub {
	return s.hub
}

// processHotkeyActions consumes the hotkey action channel and translates each
// action into the appropriate state mutation + broadcast. For "reset" the
// frontend is asked to confirm instead of acting immediately, to avoid
// accidental data loss when the reset hotkey is pressed unintentionally.
func (s *Server) processHotkeyActions(ch <-chan hotkeys.Action) {
	for action := range ch {
		id := action.PokemonID
		if id == "" {
			if active := s.state.GetActivePokemon(); active != nil {
				id = active.ID
			}
		}
		switch action.Type {
		case "increment":
			if id != "" {
				count, ok := s.state.Increment(id)
				if ok {
					s.state.ScheduleSave()
					s.hub.BroadcastRaw("encounter_added", map[string]any{"pokemon_id": id, "count": count})
					s.broadcastState()
					if s.fileWriter != nil {
						s.fileWriter.Write(s.state.GetState())
					}
				}
			}
		case "decrement":
			if id != "" {
				count, ok := s.state.Decrement(id)
				if ok {
					s.state.ScheduleSave()
					s.hub.BroadcastRaw("encounter_removed", map[string]any{"pokemon_id": id, "count": count})
					s.broadcastState()
					if s.fileWriter != nil {
						s.fileWriter.Write(s.state.GetState())
					}
				}
			}
		case "reset":
			if id != "" {
				// Don't reset directly — ask the frontend to confirm first.
				s.hub.BroadcastRaw("request_reset_confirm", map[string]any{"pokemon_id": id})
			}
		case "next":
			s.state.NextPokemon()
			s.state.ScheduleSave()
			s.broadcastState()
		}
	}
}

// corsMiddleware adds permissive CORS headers so the Vite dev server (port
// 5173) can call the Go API (port 8080) in development mode.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
