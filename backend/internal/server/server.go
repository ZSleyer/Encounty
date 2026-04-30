// Package server provides the HTTP server that exposes a REST API and
// maintains the WebSocket hub for real-time state synchronisation with
// the browser.
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/detector"
	"github.com/zsleyer/encounty/backend/internal/fileoutput"
	"github.com/zsleyer/encounty/backend/internal/gamesync"
	"github.com/zsleyer/encounty/backend/internal/hotkeys"
	"github.com/zsleyer/encounty/backend/internal/pokedex"
	"github.com/zsleyer/encounty/backend/internal/server/handler/backgrounds"
	"github.com/zsleyer/encounty/backend/internal/server/handler/backup"
	detectorhandler "github.com/zsleyer/encounty/backend/internal/server/handler/detector"
	"github.com/zsleyer/encounty/backend/internal/server/handler/games"
	groupshandler "github.com/zsleyer/encounty/backend/internal/server/handler/groups"
	permissionshandler "github.com/zsleyer/encounty/backend/internal/server/handler/permissions"
	pokemonhandler "github.com/zsleyer/encounty/backend/internal/server/handler/pokemon"
	"github.com/zsleyer/encounty/backend/internal/server/handler/settings"
	"github.com/zsleyer/encounty/backend/internal/server/handler/stats"
	"github.com/zsleyer/encounty/backend/internal/server/handler/system"
	updatehandler "github.com/zsleyer/encounty/backend/internal/server/handler/update"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// headerContentType is the canonical HTTP header name for content type.
const headerContentType = "Content-Type"

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

	// Tracks the last time each hotkey action was dispatched. Guards against
	// double-fire when a dev setup (Go debugger + Electron running in
	// parallel) ends up with both the native CGEventTap and Electron's
	// globalShortcut relaying the same key press.
	hotkeyDedupMu sync.Mutex
	hotkeyLastAt  map[string]time.Time

	// Tracks Pokémon IDs that currently have a live browser capture stream
	// attached. Populated by the frontend via POST /api/capture/state so
	// the hotkey hunt gate can reject a start when no source is connected
	// without first flipping the timer. The backend itself has no view
	// into MediaStream objects.
	capturingMu sync.RWMutex
	capturing   map[string]bool

	// Tracks Pokémon IDs whose in-browser detection loop is currently
	// running. Populated by the frontend via POST /api/detector/loop-state
	// so the hunt-toggle hotkey can stop detector-only hunts where no
	// backend timer is active.
	detectingMu sync.RWMutex
	detecting   map[string]bool
}

// hotkeyDedupWindow is the minimum interval between two dispatches of the
// same hotkey action. Anything closer is treated as a duplicate and
// silently dropped.
const hotkeyDedupWindow = 150 * time.Millisecond

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
		state:        cfg.State,
		hub:          NewHub(),
		hotkeyMgr:    cfg.HotkeyMgr,
		fileWriter:   cfg.FileWriter,
		version:      cfg.Version,
		commit:       cfg.Commit,
		buildDate:    cfg.BuildDate,
		detectorMgr:  cfg.DetectorMgr,
		db:           cfg.DB,
		devMode:      cfg.DevMode,
		frontendDir:  cfg.FrontendDir,
		hotkeyLastAt: make(map[string]time.Time),
		capturing:    make(map[string]bool),
		detecting:    make(map[string]bool),
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
	mux.HandleFunc("/api/capture/state", s.handleCaptureState)
	mux.HandleFunc("/api/detection/state", s.handleDetectionState)
	pokemonhandler.RegisterRoutes(mux, s)
	groupshandler.RegisterRoutes(mux, s)
	backup.RegisterRoutes(mux, s)
	backgrounds.RegisterRoutes(mux, s)
	settings.RegisterRoutes(mux, s)
	games.RegisterRoutes(mux, s)
	stats.RegisterRoutes(mux, s)
	system.RegisterRoutes(mux, s)
	detectorhandler.RegisterRoutes(mux, s)
	permissionshandler.RegisterRoutes(mux, s)
	updatehandler.RegisterRoutes(mux, s)
	mux.Handle("/swagger/", swaggerHandler())

	if s.frontendDir != "" {
		mux.HandleFunc("/", s.serveFrontend)
	}
}

// serveFrontend serves frontend assets from the configured directory.
// Non-file paths fall back to index.html for SPA client-side routing.
// The fallback injects a <base href="/"> tag so that relative asset paths
// (produced by Vite's base: "./") resolve correctly for nested routes like
// /overlay/{id} when loaded in OBS.
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

	// SPA fallback: read index.html once and inject <base href="/"> so that
	// relative asset URLs (./assets/...) resolve from the root, not from
	// the current path (which breaks for /overlay/{id} in OBS).
	s.serveIndexWithBase(w, r)
}

// indexHTML caches the patched index.html content to avoid re-reading on
// every SPA fallback request. Populated lazily by serveIndexWithBase.
var indexHTML atomic.Value

// serveIndexWithBase reads index.html from the frontend directory, injects a
// <base href="/"> tag after <head>, and serves it with the correct content type.
func (s *Server) serveIndexWithBase(w http.ResponseWriter, _ *http.Request) {
	if cached, ok := indexHTML.Load().([]byte); ok && len(cached) > 0 {
		w.Header().Set(headerContentType, "text/html; charset=utf-8")
		_, _ = w.Write(cached)
		return
	}

	indexPath := filepath.Join(s.frontendDir, "index.html")
	raw, err := os.ReadFile(indexPath)
	if err != nil {
		http.Error(w, "index.html not found", http.StatusNotFound)
		return
	}

	// Inject <base href="/"> right after the opening <head> tag so all
	// relative URLs resolve from the root.
	patched := strings.Replace(string(raw), "<head>", `<head><base href="/">`, 1)
	data := []byte(patched)
	indexHTML.Store(data)

	w.Header().Set(headerContentType, "text/html; charset=utf-8")
	_, _ = w.Write(data)
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

// StateSetTimer delegates to the state manager's SetTimer.
func (s *Server) StateSetTimer(id string, ms int64) bool { return s.state.SetTimer(id, ms) }

// StateGetState returns a snapshot of the current application state.
func (s *Server) StateGetState() state.AppState { return s.state.GetState() }

// StateScheduleSave enqueues a deferred state save.
func (s *Server) StateScheduleSave() { s.state.ScheduleSave() }

// StateListGroups returns a copy of all organisational groups.
func (s *Server) StateListGroups() []state.Group { return s.state.ListGroups() }

// StateCreateGroup appends a new group with the given name and color.
func (s *Server) StateCreateGroup(name, color string) (state.Group, error) {
	return s.state.CreateGroup(name, color)
}

// StateUpdateGroup applies a partial update to the given group.
func (s *Server) StateUpdateGroup(id string, patch state.GroupPatch) (state.Group, error) {
	return s.state.UpdateGroup(id, patch)
}

// StateDeleteGroup removes the given group and clears GroupID on members.
func (s *Server) StateDeleteGroup(id string) bool { return s.state.DeleteGroup(id) }

// StateToggleHunt flips the timer state for a Pokémon and reports the
// post-toggle running flag plus the Pokémon's configured hunt_mode.
func (s *Server) StateToggleHunt(id string) (bool, string, bool) {
	return s.state.ToggleHunt(id)
}

// DetectorStopper returns nil — native detection has been removed. The
// interface is retained so the pokemon handler can still check and no-op
// when deleting a Pokemon.
func (s *Server) DetectorStopper() pokemonhandler.DetectorStopper {
	return nil
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

// DetectorEncounterLogger returns the database as a detectorhandler.EncounterLogger
// so the detector match handler can persist encounter events. Returns nil when
// no database is configured.
func (s *Server) DetectorEncounterLogger() detectorhandler.EncounterLogger {
	return dbAs[detectorhandler.EncounterLogger](s.db)
}

// Start begins accepting HTTP connections. Blocks until the server is shut
// down; returns http.ErrServerClosed on a clean shutdown.
func (s *Server) Start() error {
	slog.Info("Server listening", "addr", s.httpServer.Addr)
	return s.httpServer.ListenAndServe()
}

// Shutdown gracefully stops the HTTP server, waiting up to ctx's deadline
// for in-flight requests to complete.
func (s *Server) Shutdown(ctx context.Context) error {
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
	s.logEncounter(id, count, 1, "hotkey")
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
	s.logEncounter(id, count, -1, "hotkey")
	if count == 0 && s.db != nil {
		_ = s.db.DeleteEncounterEvents(id)
	}
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

// SetCaptureState records whether the given Pokémon currently has a live
// browser capture stream. Called by the frontend after each start/stop so
// the hotkey hunt gate can decide without guessing.
func (s *Server) SetCaptureState(pokemonID string, capturing bool) {
	s.capturingMu.Lock()
	defer s.capturingMu.Unlock()
	if capturing {
		s.capturing[pokemonID] = true
	} else {
		delete(s.capturing, pokemonID)
	}
}

// isCapturing reports whether the given Pokémon currently has a live
// capture stream according to the last frontend heartbeat.
func (s *Server) isCapturing(pokemonID string) bool {
	s.capturingMu.RLock()
	defer s.capturingMu.RUnlock()
	return s.capturing[pokemonID]
}

// SetDetectionState records whether the given Pokémon currently has an
// active in-browser detection loop. The backend uses this to decide
// whether a hunt-toggle hotkey should start or stop when the timer is
// not itself the source of "hunt running" (detector-only mode).
func (s *Server) SetDetectionState(pokemonID string, detecting bool) {
	s.detectingMu.Lock()
	defer s.detectingMu.Unlock()
	if detecting {
		s.detecting[pokemonID] = true
	} else {
		delete(s.detecting, pokemonID)
	}
}

// isDetecting reports whether the given Pokémon has an active detection
// loop according to the last frontend heartbeat.
func (s *Server) isDetecting(pokemonID string) bool {
	s.detectingMu.RLock()
	defer s.detectingMu.RUnlock()
	return s.detecting[pokemonID]
}

// handleCaptureState accepts POST {pokemon_id, capturing} heartbeats from
// the frontend CaptureServiceProvider. The state is memory-only and scoped
// to the current backend run — after a restart every stream has to be
// re-attached on the frontend side, which will re-post here.
func (s *Server) handleCaptureState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		PokemonID string `json:"pokemon_id"`
		Capturing bool   `json:"capturing"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.PokemonID == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	s.SetCaptureState(body.PokemonID, body.Capturing)
	w.WriteHeader(http.StatusNoContent)
}

// handleDetectionState accepts POST {pokemon_id, detecting} heartbeats
// from the frontend DetectionLoop registry so the backend knows which
// Pokémon currently have a live in-browser detection loop attached.
func (s *Server) handleDetectionState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		PokemonID string `json:"pokemon_id"`
		Detecting bool   `json:"detecting"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.PokemonID == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	s.SetDetectionState(body.PokemonID, body.Detecting)
	w.WriteHeader(http.StatusNoContent)
}

// acceptHotkey returns true when the given hotkey action has not fired
// within the deduplication window. Used to coalesce near-simultaneous
// duplicate dispatches from layered key-capture sources.
func (s *Server) acceptHotkey(action string) bool {
	s.hotkeyDedupMu.Lock()
	defer s.hotkeyDedupMu.Unlock()
	now := time.Now()
	if last, ok := s.hotkeyLastAt[action]; ok && now.Sub(last) < hotkeyDedupWindow {
		return false
	}
	s.hotkeyLastAt[action] = now
	return true
}

// dispatchHotkeyAction routes a single hotkey action to the appropriate handler.
func (s *Server) dispatchHotkeyAction(action hotkeys.Action) {
	// Drop rapid duplicate dispatches so two parallel sources (native
	// CGEventTap + Electron globalShortcut in some dev configurations)
	// cannot double-fire a single keystroke.
	if !s.acceptHotkey(action.Type) {
		return
	}
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
	case "hunt_toggle":
		if id != "" {
			s.handleHotkeyHuntToggle(id)
		}
	}
}

// handleHotkeyHuntToggle toggles the hunt state (timer + detector) for the
// given Pokémon. Before starting, the backend gates on detector readiness
// (templates configured). The source check stays in the frontend because
// the backend has no visibility into browser capture streams — if the
// source is missing the frontend will still roll back, but the common
// no-templates case is blocked here before any timer flips.
func (s *Server) handleHotkeyHuntToggle(id string) {
	snapshot := s.state.GetState()
	var pokemon *state.Pokemon
	for i := range snapshot.Pokemon {
		if snapshot.Pokemon[i].ID == id {
			pokemon = &snapshot.Pokemon[i]
			break
		}
	}
	if pokemon == nil {
		return
	}
	timerRunning := pokemon.TimerStartedAt != nil
	detectorRunning := s.isDetecting(id)
	huntRunning := timerRunning || detectorRunning

	if huntRunning {
		// Stop path: fold the timer if it is running (no-op otherwise) and
		// broadcast a stop event so the frontend tears down its detection
		// loop even when the timer was never the active half of the hunt.
		if timerRunning {
			s.state.ToggleHunt(id)
			s.state.ScheduleSave()
			s.broadcastState()
		}
		s.hub.BroadcastRaw("hunt_stop_requested", map[string]any{
			"pokemon_id": id,
		})
		return
	}

	// Start path — enforce detector readiness when required.
	if huntModeNeedsDetector(pokemon.HuntMode, pokemon.DetectorConfig) {
		if !detectorHasEnabledTemplate(pokemon.DetectorConfig) {
			s.hub.BroadcastRaw("hunt_start_rejected", map[string]any{
				"pokemon_id": id,
				"reason":     "no_templates",
			})
			return
		}
		if !s.isCapturing(id) {
			s.hub.BroadcastRaw("hunt_start_rejected", map[string]any{
				"pokemon_id": id,
				"reason":     "no_source",
			})
			return
		}
	}

	running, huntMode, ok := s.state.ToggleHunt(id)
	if !ok {
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	if running {
		s.hub.BroadcastRaw("hunt_start_requested", map[string]any{
			"pokemon_id": id,
			"hunt_mode":  huntMode,
		})
	} else {
		// Defensive: state reported "not running" after a toggle, mirror as
		// a stop so the frontend stays in sync.
		s.hub.BroadcastRaw("hunt_stop_requested", map[string]any{
			"pokemon_id": id,
		})
	}
}

// huntModeNeedsDetector reports whether the configured hunt mode requires
// auto-detection to run. "detector" always does; "both" does when a
// DetectorConfig exists (opt-in), otherwise it collapses to timer-only.
func huntModeNeedsDetector(mode string, cfg *state.DetectorConfig) bool {
	if mode == "detector" {
		return true
	}
	if mode == "both" || mode == "" {
		return cfg != nil
	}
	return false
}

// detectorHasEnabledTemplate reports whether at least one template on the
// config is marked enabled. A nil config or empty template list returns
// false. Template.Enabled == nil is treated as enabled for backward
// compatibility with older snapshots.
func detectorHasEnabledTemplate(cfg *state.DetectorConfig) bool {
	if cfg == nil {
		return false
	}
	for _, tmpl := range cfg.Templates {
		if tmpl.Enabled == nil || *tmpl.Enabled {
			return true
		}
	}
	return false
}

// DispatchHotkeyAction injects a hotkey action from an external source.
func (s *Server) DispatchHotkeyAction(actionType, pokemonID string) {
	s.dispatchHotkeyAction(hotkeys.Action{Type: actionType, PokemonID: pokemonID})
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

		s.runInitialSync(false)
	}()
}

// runInitialSync performs the games and Pokédex synchronisation. It
// broadcasts progress via WebSocket and marks the server as ready on
// completion. When the API is unreachable it sends a sync_error event
// so the frontend can offer the offline fallback. When force is true the
// Pokédex sync runs unconditionally, bypassing the NeedsSync check.
func (s *Server) runInitialSync(force bool) {
	// Phase 1: Games
	slog.Info("InitAsync: starting games sync")
	s.hub.BroadcastRaw("sync_progress", syncProgress{
		Phase: "games", Step: "syncing", Message: "Syncing game database...",
	})
	_ = games.LoadGames(s)
	slog.Info("InitAsync: games sync complete")

	// Phase 2: Pokédex
	store := s.PokedexDB()
	var syncResult *pokedex.SyncResult
	if force || pokedex.NeedsSync(store) {
		slog.Info("InitAsync: starting Pokédex sync")
		s.hub.BroadcastRaw("sync_progress", syncProgress{
			Phase: "pokedex", Step: "syncing", Message: "Syncing Pokédex...",
		})
		syncResult = s.syncPokedex(store)
	} else {
		slog.Info("InitAsync: Pokédex already up to date")
		_ = pokedex.LoadPokedex(store)
	}

	s.setupPending.Store(false)
	s.ready.Store(true)
	readyPayload := map[string]any{"ready": true}
	if syncResult != nil {
		readyPayload["sync_result"] = syncResult
	}
	s.hub.BroadcastRaw("system_ready", readyPayload)
	slog.Info("Server initialization complete")
}

// RunSetupOnline triggers a forced online sync from the settings endpoint.
// It always re-syncs the Pokédex regardless of the NeedsSync check.
func (s *Server) RunSetupOnline() {
	s.setupPending.Store(false)
	s.ready.Store(false)
	go s.runInitialSync(true)
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
// hub so the frontend can display a loading indicator. Returns the sync
// result on success, or nil on failure.
func (s *Server) syncPokedex(store pokedex.PokedexStore) *pokedex.SyncResult {
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
		return nil
	}

	species, forms := pokedex.EntriesToRows(updated)
	if err := store.SavePokedex(species, forms); err != nil {
		slog.Error("Failed to save Pokédex", "error", err)
		return nil
	}
	pokedex.InvalidateCache()

	// Backfill base_name/form_name on existing pokemon from the freshly
	// synced pokedex data so the sidebar can display them immediately.
	if n, err := s.db.BackfillPokemonFormNames(); err != nil {
		slog.Warn("Failed to backfill pokemon form names", "error", err)
	} else if n > 0 {
		slog.Info("Backfilled pokemon form names", "updated", n)
	}

	slog.Info("Pokédex sync complete", "total", result.Total, "added", result.Added, "names_updated", result.NamesUpdated)
	return &result
}

// corsMiddleware adds permissive CORS headers so the Vite dev server (port
// 5173) can call the Go API (port 8192) in development mode.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
