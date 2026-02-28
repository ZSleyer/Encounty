package server

import (
	"context"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"strings"

	"github.com/encounty/encounty/internal/fileoutput"
	"github.com/encounty/encounty/internal/hotkeys"
	"github.com/encounty/encounty/internal/state"
)

type Server struct {
	state      *state.Manager
	hub        *Hub
	hotkeyMgr  *hotkeys.Manager
	fileWriter *fileoutput.Writer
	httpServer *http.Server
	frontendFS fs.FS
}

type Config struct {
	Port       int
	FrontendFS fs.FS
	State      *state.Manager
	HotkeyMgr  *hotkeys.Manager
	FileWriter *fileoutput.Writer
}

func New(cfg Config) *Server {
	s := &Server{
		state:      cfg.State,
		hub:        NewHub(),
		hotkeyMgr:  cfg.HotkeyMgr,
		fileWriter: cfg.FileWriter,
		frontendFS: cfg.FrontendFS,
	}

	// Wire hotkey actions to state changes
	if cfg.HotkeyMgr != nil {
		go s.processHotkeyActions(cfg.HotkeyMgr.Actions())
	}

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
	mux.HandleFunc("/api/overlay/state", s.handleOverlayState)
	mux.HandleFunc("/api/games", s.handleGetGames)
	mux.HandleFunc("/api/pokedex", s.handleGetPokedex)
	mux.HandleFunc("/api/sync/pokemon", s.handleSyncPokemon)

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

	// Frontend static files / overlay
	if s.frontendFS != nil {
		subFS, err := fs.Sub(s.frontendFS, "frontend/dist")
		if err != nil {
			log.Printf("frontend embed error: %v", err)
		} else {
			fileServer := http.FileServer(http.FS(subFS))
			mux.HandleFunc("/overlay", func(w http.ResponseWriter, r *http.Request) {
				// Rewrite to overlay page
				r.URL.Path = "/index.html"
				fileServer.ServeHTTP(w, r)
			})
			mux.Handle("/", fileServer)
		}
	}
}

func (s *Server) Start() error {
	log.Printf("Server listening on %s", s.httpServer.Addr)
	return s.httpServer.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpServer.Shutdown(ctx)
}

func (s *Server) Hub() *Hub {
	return s.hub
}

func (s *Server) processHotkeyActions(ch <-chan hotkeys.Action) {
	for action := range ch {
		active := s.state.GetActivePokemon()
		id := action.PokemonID
		if id == "" && active != nil {
			id = active.ID
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
				s.state.Decrement(id)
				s.state.ScheduleSave()
				s.broadcastState()
				if s.fileWriter != nil {
					s.fileWriter.Write(s.state.GetState())
				}
			}
		case "reset":
			if id != "" {
				s.state.Reset(id)
				s.state.ScheduleSave()
				s.broadcastState()
				if s.fileWriter != nil {
					s.fileWriter.Write(s.state.GetState())
				}
			}
		case "next":
			s.state.NextPokemon()
			s.state.ScheduleSave()
			s.broadcastState()
		}
	}
}

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
