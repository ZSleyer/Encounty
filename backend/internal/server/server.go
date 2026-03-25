// Package server provides the HTTP server that exposes a REST API and
// maintains the WebSocket hub for real-time state synchronisation with
// the browser.
package server

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/detector"
	"github.com/zsleyer/encounty/backend/internal/fileoutput"
	"github.com/zsleyer/encounty/backend/internal/hotkeys"
	"github.com/zsleyer/encounty/backend/internal/gamesync"
	"github.com/zsleyer/encounty/backend/internal/pokedex"
	"github.com/zsleyer/encounty/backend/internal/server/handler/backgrounds"
	"github.com/zsleyer/encounty/backend/internal/server/handler/backup"
	detectorhandler "github.com/zsleyer/encounty/backend/internal/server/handler/detector"
	"github.com/zsleyer/encounty/backend/internal/server/handler/games"
	pokemonhandler "github.com/zsleyer/encounty/backend/internal/server/handler/pokemon"
	"github.com/zsleyer/encounty/backend/internal/server/handler/settings"
	"github.com/zsleyer/encounty/backend/internal/server/handler/stats"
	"github.com/zsleyer/encounty/backend/internal/server/handler/system"
	"github.com/zsleyer/encounty/backend/internal/server/handler/update"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// Server wires together the HTTP multiplexer, WebSocket hub, hotkey manager,
// file-output writer, and state manager into a single runnable unit.
type Server struct {
	state        *state.Manager
	hub          *Hub
	hotkeyMgr    hotkeys.Manager
	fileWriter   *fileoutput.Writer
	httpServer   *http.Server
	version      string
	commit       string
	buildDate    string
	detectorMgr  *detector.Manager
	db           *database.DB
	ready        atomic.Bool
	devMode      bool
	frontendDir  string
	setupPending atomic.Bool
}

// Config carries all dependencies needed to construct a Server.
type Config struct {
	Port        int
	State       *state.Manager
	HotkeyMgr   hotkeys.Manager
	FileWriter  *fileoutput.Writer
	Version     string
	Commit      string
	BuildDate   string
	ConfigDir   string
	DetectorMgr *detector.Manager
	DB          *database.DB
	DevMode     bool
	FrontendDir string
}

// New creates a Server from cfg, registers all HTTP routes, and starts the
// goroutine that converts hotkey actions into state mutations.
func New(cfg Config) *Server {
	s := &Server{
		state:       cfg.State,
		hub:         NewHub(),
		hotkeyMgr:   cfg.HotkeyMgr,
		fileWriter:  cfg.FileWriter,
		version:     cfg.Version,
		commit:      cfg.Commit,
		buildDate:   cfg.BuildDate,
		detectorMgr: cfg.DetectorMgr,
		db:          cfg.DB,
		devMode:     cfg.DevMode,
		frontendDir: cfg.FrontendDir,
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
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		s.hub.ServeWS(s, w, r)
	})
	pokemonhandler.RegisterRoutes(mux, s)
	backup.RegisterRoutes(mux, s)
	backgrounds.RegisterRoutes(mux, s)
	settings.RegisterRoutes(mux, s)
	games.RegisterRoutes(mux, s)
	stats.RegisterRoutes(mux, s)
	system.RegisterRoutes(mux, s)
	update.RegisterRoutes(mux, s)
	detectorhandler.RegisterRoutes(mux, s)
	mux.Handle("/swagger/", swaggerHandler())

	if s.frontendDir != "" {
		mux.HandleFunc("/", s.serveFrontend)
	}
}

// serveFrontend serves frontend assets from the configured directory.
// Non-file paths fall back to index.html for SPA client-side routing.
func (s *Server) serveFrontend(w http.ResponseWriter, r *http.Request) {
	// Skip API, WebSocket, and Swagger routes (they have their own handlers,
	// but guard here as well for safety).
	if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/ws" || strings.HasPrefix(r.URL.Path, "/swagger/") {
		http.NotFound(w, r)
		return
	}

	// Try to serve the exact file from the frontend directory.
	filePath := filepath.Join(s.frontendDir, filepath.Clean(r.URL.Path))
	if info, err := os.Stat(filePath); err == nil && !info.IsDir() {
		http.ServeFile(w, r, filePath)
		return
	}

	// SPA fallback: serve index.html for client-side routing.
	indexPath := filepath.Join(s.frontendDir, "index.html")
	http.ServeFile(w, r, indexPath)
}

// StateManager returns the in-memory state manager.
func (s *Server) StateManager() *state.Manager {
	return s.state
}

// VersionInfo returns the version, commit hash, and build date.
func (s *Server) VersionInfo() (version, commit, buildDate string) {
	return s.version, s.commit, s.buildDate
}

// IsReady reports whether the server has finished initial setup.
func (s *Server) IsReady() bool {
	return s.ready.Load()
}

// IsDevMode reports whether the server was started in development mode.
func (s *Server) IsDevMode() bool {
	return s.devMode
}

// IsSetupPending reports whether initial setup is waiting for user action.
func (s *Server) IsSetupPending() bool {
	return s.setupPending.Load()
}

// ConfigDir returns the active configuration directory path.
func (s *Server) ConfigDir() string {
	return s.state.GetConfigDir()
}

// Version returns the current binary version string.
func (s *Server) Version() string {
	return s.version
}

// SaveState persists the current in-memory state to disk.
func (s *Server) SaveState() error {
	return s.state.Save()
}

// ScheduleSave enqueues a deferred state save.
func (s *Server) ScheduleSave() {
	s.state.ScheduleSave()
}

// StopHotkeys shuts down the global hotkey listener.
func (s *Server) StopHotkeys() {
	s.hotkeyMgr.Stop()
}

// SetDB replaces the active database handle and updates the state manager's
// reference. Used after backup restore or settings changes.
func (s *Server) SetDB(db *database.DB) {
	s.db = db
	s.state.SetDB(db)
}

// ReloadState reloads the in-memory state from the database.
func (s *Server) ReloadState() error {
	return s.state.Reload()
}

// BroadcastState sends the current state snapshot to all WebSocket clients.
func (s *Server) BroadcastState() {
	s.broadcastState()
}

// dbAs returns the database handle cast to T, or the zero value of T when db is nil.
func dbAs[T any](db *database.DB) T {
	if db == nil {
		var zero T
		return zero
	}
	return any(db).(T)
}

// GamesDB returns the database handle as a gamesync.GamesStore so the games
// handler sub-package can load and sync game metadata without depending on
// the concrete *database.DB type. Returns nil when no database is configured.
func (s *Server) GamesDB() gamesync.GamesStore { return dbAs[gamesync.GamesStore](s.db) }

// PokedexDB returns the database handle as a pokedex.PokedexStore so the
// games handler sub-package can load and sync Pokédex data without depending
// on the concrete *database.DB type. Returns nil when no database is configured.
func (s *Server) PokedexDB() pokedex.PokedexStore { return dbAs[pokedex.PokedexStore](s.db) }

// StatsDB returns the database handle as a stats.StatsQuerier so the stats
// handler sub-package can query encounter statistics without depending on
// the concrete *database.DB type. Returns nil when no database is configured.
func (s *Server) StatsDB() stats.StatsQuerier { return dbAs[stats.StatsQuerier](s.db) }

// HotkeyUpdateAllBindings replaces all hotkey bindings atomically.
func (s *Server) HotkeyUpdateAllBindings(hm state.HotkeyMap) error {
	return s.hotkeyMgr.UpdateAllBindings(hm)
}

// HotkeyUpdateBinding replaces a single action's key binding at runtime.
func (s *Server) HotkeyUpdateBinding(action, keyCombo string) error {
	return s.hotkeyMgr.UpdateBinding(action, keyCombo)
}

// HotkeySetPaused pauses or resumes hotkey dispatch.
func (s *Server) HotkeySetPaused(paused bool) {
	s.hotkeyMgr.SetPaused(paused)
}

// HotkeyIsAvailable reports whether the hotkey backend is available.
func (s *Server) HotkeyIsAvailable() bool {
	return s.hotkeyMgr.IsAvailable()
}

// DB returns the current database handle.
func (s *Server) DB() *database.DB {
	return s.db
}

// FileWriterSetConfig reconfigures the file output writer with a new output
// directory and enabled state. No-op when no file writer is configured.
func (s *Server) FileWriterSetConfig(outputDir string, enabled bool) {
	if s.fileWriter != nil {
		s.fileWriter.SetConfig(outputDir, enabled)
	}
}

// --- pokemonhandler.Deps implementation --------------------------------------

// StateAddPokemon appends a new Pokemon to the in-memory state.
func (s *Server) StateAddPokemon(p state.Pokemon) { s.state.AddPokemon(p) }

// StateUpdatePokemon applies field updates to the Pokemon with the given id.
func (s *Server) StateUpdatePokemon(id string, update state.Pokemon) bool {
	return s.state.UpdatePokemon(id, update)
}

// StateDeletePokemon removes the Pokemon with the given id.
func (s *Server) StateDeletePokemon(id string) bool { return s.state.DeletePokemon(id) }

// StateIncrement adds one encounter step to the Pokemon.
func (s *Server) StateIncrement(id string) (int, bool) { return s.state.Increment(id) }

// StateDecrement subtracts one encounter step from the Pokemon.
func (s *Server) StateDecrement(id string) (int, bool) { return s.state.Decrement(id) }

// StateReset zeroes the encounter counter for the Pokemon.
func (s *Server) StateReset(id string) bool { return s.state.Reset(id) }

// StateSetEncounters sets the encounter count to an exact value.
func (s *Server) StateSetEncounters(id string, count int) (int, bool) {
	return s.state.SetEncounters(id, count)
}

// StateSetActive marks the given Pokemon as active.
func (s *Server) StateSetActive(id string) bool { return s.state.SetActive(id) }

// StateCompletePokemon stamps CompletedAt on the Pokemon.
func (s *Server) StateCompletePokemon(id string) bool { return s.state.CompletePokemon(id) }

// StateUncompletePokemon clears CompletedAt on the Pokemon.
func (s *Server) StateUncompletePokemon(id string) bool { return s.state.UncompletePokemon(id) }

// StateUnlinkOverlay copies the resolved overlay and sets mode to custom.
func (s *Server) StateUnlinkOverlay(pokemonID string) bool {
	return s.state.UnlinkOverlay(pokemonID)
}

// StateStartTimer begins the per-Pokemon timer.
func (s *Server) StateStartTimer(id string) bool { return s.state.StartTimer(id) }

// StateStopTimer stops the per-Pokemon timer.
func (s *Server) StateStopTimer(id string) bool { return s.state.StopTimer(id) }

// StateResetTimer clears the per-Pokemon timer.
func (s *Server) StateResetTimer(id string) bool { return s.state.ResetTimer(id) }

// StateGetState returns a snapshot of the current application state.
func (s *Server) StateGetState() state.AppState { return s.state.GetState() }

// StateScheduleSave enqueues a deferred state save.
func (s *Server) StateScheduleSave() { s.state.ScheduleSave() }

// DetectorStopper returns the detector manager as a DetectorStopper, or nil.
func (s *Server) DetectorStopper() pokemonhandler.DetectorStopper {
	if s.detectorMgr == nil {
		return nil
	}
	return s.detectorMgr
}

// EncounterLogger returns the database as an EncounterLogger, or nil.
func (s *Server) EncounterLogger() pokemonhandler.EncounterLogger {
	return dbAs[pokemonhandler.EncounterLogger](s.db)
}

// Broadcaster returns the WebSocket hub as a Broadcaster.
func (s *Server) Broadcaster() pokemonhandler.Broadcaster { return s.hub }

// DetectorMgr returns the detector manager instance. Returns nil when no
// detector manager is configured.
func (s *Server) DetectorMgr() *detector.Manager {
	return s.detectorMgr
}

// DetectorDB returns the database handle as a detectorhandler.DetectorStore so
// the detector handler sub-package can load, save and delete template images
// without depending on the concrete *database.DB type. Returns nil when no
// database is configured.
func (s *Server) DetectorDB() detectorhandler.DetectorStore {
	return dbAs[detectorhandler.DetectorStore](s.db)
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

// handleHotkeyIncrement processes the "increment" hotkey action for the given Pokémon.
func (s *Server) handleHotkeyIncrement(id string) {
	count, ok := s.state.Increment(id)
	if !ok {
		return
	}
	s.logEncounter(id, count, "hotkey")
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("encounter_added", map[string]any{"pokemon_id": id, "count": count})
	s.broadcastState()
}

// handleHotkeyDecrement processes the "decrement" hotkey action for the given Pokémon.
func (s *Server) handleHotkeyDecrement(id string) {
	count, ok := s.state.Decrement(id)
	if !ok {
		return
	}
	s.logEncounter(id, count, "hotkey")
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("encounter_removed", map[string]any{"pokemon_id": id, "count": count})
	s.broadcastState()
}

// processHotkeyActions consumes the hotkey action channel and translates each
// action into the appropriate state mutation + broadcast. For "reset" the
// frontend is asked to confirm instead of acting immediately, to avoid
// accidental data loss when the reset hotkey is pressed unintentionally.
func (s *Server) processHotkeyActions(ch <-chan hotkeys.Action) {
	for action := range ch {
		s.dispatchHotkeyAction(action)
	}
}

// dispatchHotkeyAction routes a single hotkey action to the appropriate handler.
func (s *Server) dispatchHotkeyAction(action hotkeys.Action) {
	id := action.PokemonID
	if id == "" {
		if active := s.state.GetActivePokemon(); active != nil {
			id = active.ID
		}
	}
	switch action.Type {
	case "increment":
		if id != "" {
			s.handleHotkeyIncrement(id)
		}
	case "decrement":
		if id != "" {
			s.handleHotkeyDecrement(id)
		}
	case "reset":
		if id != "" {
			s.hub.BroadcastRaw("request_reset_confirm", map[string]any{"pokemon_id": id})
		}
	case "next":
		s.handleHotkeyNext()
	}
}

// handleHotkeyNext advances to the next Pokémon in the list.
func (s *Server) handleHotkeyNext() {
	s.state.NextPokemon()
	s.state.ScheduleSave()
	s.broadcastState()
}

// syncProgress is the WebSocket payload for "sync_progress" events sent
// during InitAsync to inform connected clients about data-loading phases.
type syncProgress struct {
	Phase   string `json:"phase"`
	Step    string `json:"step"`
	Message string `json:"message"`
	Error   string `json:"error,omitempty"`
}

// InitAsync runs initial setup tasks (games and Pokédex loading) in the
// background and marks the server as ready when complete. In dev mode it
// skips auto-sync and waits for the user to choose online or offline
// setup via the /api/setup/* endpoints. Progress is reported via
// "sync_progress" WebSocket events; a final "system_ready" event is
// broadcast once all phases have finished.
func (s *Server) InitAsync() {
	go func() {
		// In dev mode, skip auto-sync and let the user choose.
		if s.devMode {
			s.setupPending.Store(true)
			s.ready.Store(true)
			s.hub.BroadcastRaw("system_ready", map[string]any{
				"ready": true, "setup_pending": true, "dev_mode": true,
			})
			slog.Info("Dev mode: waiting for manual setup")
			return
		}

		s.runInitialSync()
	}()
}

// runInitialSync performs the games and Pokédex synchronisation. It
// broadcasts progress via WebSocket and marks the server as ready on
// completion. When the API is unreachable it sends a sync_error event
// so the frontend can offer the offline fallback.
func (s *Server) runInitialSync() {
	// Phase 1: Games
	slog.Info("InitAsync: starting games sync")
	s.hub.BroadcastRaw("sync_progress", syncProgress{
		Phase: "games", Step: "syncing", Message: "Syncing game database...",
	})
	_ = games.LoadGames(s)
	slog.Info("InitAsync: games sync complete")

	// Phase 2: Pokédex
	store := s.PokedexDB()
	if pokedex.NeedsSync(store) {
		slog.Info("InitAsync: starting Pokédex sync")
		s.hub.BroadcastRaw("sync_progress", syncProgress{
			Phase: "pokedex", Step: "syncing", Message: "Syncing Pokédex...",
		})
		s.syncPokedex(store)
	} else {
		slog.Info("InitAsync: Pokédex already up to date")
		_ = pokedex.LoadPokedex(store)
	}

	s.setupPending.Store(false)
	s.ready.Store(true)
	s.hub.BroadcastRaw("system_ready", map[string]bool{"ready": true})
	slog.Info("Server initialization complete")
}

// RunSetupOnline triggers an online sync from the setup endpoint.
func (s *Server) RunSetupOnline() {
	s.setupPending.Store(false)
	s.ready.Store(false)
	go s.runInitialSync()
}

// RunSetupOffline seeds games and Pokédex from embedded fallback data.
func (s *Server) RunSetupOffline() error {
	slog.Info("Setup: seeding from embedded fallback data")
	if err := gamesync.SeedFromFallback(s.GamesDB()); err != nil {
		return fmt.Errorf("seed games: %w", err)
	}
	if err := pokedex.SeedFromFallback(s.PokedexDB()); err != nil {
		return fmt.Errorf("seed pokédex: %w", err)
	}
	s.setupPending.Store(false)
	s.ready.Store(true)
	s.hub.BroadcastRaw("system_ready", map[string]bool{"ready": true})
	slog.Info("Setup: offline seeding complete")
	return nil
}

// syncPokedex performs a full Pokédex sync from PokéAPI and persists the
// result to the database. Progress updates are broadcast via the WebSocket
// hub so the frontend can display a loading indicator.
func (s *Server) syncPokedex(store pokedex.PokedexStore) {
	var current []pokedex.Entry

	progress := func(step, detail string) {
		slog.Info("Pokédex sync progress", "step", step)
		s.hub.BroadcastRaw("sync_progress", syncProgress{
			Phase:   "pokedex",
			Step:    step,
			Message: "Syncing Pokédex – " + step + "...",
		})
	}

	result, updated, err := pokedex.SyncFromPokeAPI(current, progress)
	if err != nil {
		slog.Error("Pokédex sync failed", "error", err)
		s.hub.BroadcastRaw("sync_progress", syncProgress{
			Phase: "pokedex",
			Step:  "error",
			Error: err.Error(),
		})
		return
	}

	species, forms := pokedex.EntriesToRows(updated)
	if err := store.SavePokedex(species, forms); err != nil {
		slog.Error("Failed to save Pokédex", "error", err)
		return
	}
	pokedex.InvalidateCache()
	slog.Info("Pokédex sync complete", "total", result.Total, "added", result.Added, "names_updated", result.NamesUpdated)
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
