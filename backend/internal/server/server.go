// Package server provides the HTTP server that exposes a REST API and
// maintains the WebSocket hub for real-time state synchronization with
// the browser.
package server

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
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
	"github.com/zsleyer/encounty/backend/internal/server/handler/dexconfig"
	"github.com/zsleyer/encounty/backend/internal/server/handler/dexoverride"
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
	mux          *http.ServeMux
	port         int
	version      string
	commit       string
	buildDate    string
	detectorMgr  *detector.Manager
	db           *database.DB
	ready        atomic.Bool
	devMode      bool
	frontendDir  string
	origins      originPolicy
	setupPending atomic.Bool

	// The TLS listener is optional: it is set up by StartTLS and stays nil
	// when the certificate or the port is unavailable. tlsPort and
	// tlsFingerprint are what /api/version advertises, and both stay at their
	// zero value until the listener is actually bound.
	tlsServer      *http.Server
	tlsListener    net.Listener
	tlsPort        int
	tlsFingerprint string

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
		port:         cfg.Port,
		origins:      originPolicy{port: cfg.Port, devMode: cfg.DevMode},
		hotkeyLastAt: make(map[string]time.Time),
		capturing:    make(map[string]bool),
		detecting:    make(map[string]bool),
	}

	// Wire hotkey actions to state changes
	go s.processHotkeyActions(cfg.HotkeyMgr.Actions())

	mux := http.NewServeMux()
	s.registerRoutes(mux)
	// Kept so StartTLS can serve the same routes and rebuild the HTTP
	// handler once the origin policy knows the TLS port.
	s.mux = mux

	s.httpServer = &http.Server{
		Addr:    fmt.Sprintf("127.0.0.1:%d", cfg.Port),
		Handler: corsMiddleware(mux, s.origins),
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
	dexoverride.RegisterRoutes(mux, s)
	dexconfig.RegisterRoutes(mux, s)
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
	// dbAs keeps a nil handle out of the interface: assigning a typed nil
	// pointer would leave the manager with a non-nil StateStore that panics on
	// the first save.
	s.state.SetDB(dbAs[state.StateStore](db))
}

// DBDir returns the directory holding the SQLite database. It differs from
// ConfigDir when the user relocated the database.
func (s *Server) DBDir() string {
	return s.state.GetDBDir()
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

// PokedexOverrideDB returns the database handle as a pokedex.OverrideStore so
// the dexoverride handler sub-package can list and upsert manual Pokédex
// caught/seen overrides without depending on the concrete *database.DB type.
// Returns nil when no database is configured.
func (s *Server) PokedexOverrideDB() pokedex.OverrideStore { return dbAs[pokedex.OverrideStore](s.db) }

// UserPokedexDB returns the persisted user Pokédex definitions.
func (s *Server) UserPokedexDB() dexconfig.Store { return dbAs[dexconfig.Store](s.db) }

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

// Start begins accepting HTTP connections, plus TLS connections when StartTLS
// prepared a listener. Blocks until the server is shut down; returns
// http.ErrServerClosed on a clean shutdown.
func (s *Server) Start() error {
	if s.tlsServer != nil {
		go s.serveTLS()
	}
	slog.Info("Server listening", "addr", s.httpServer.Addr)
	return s.httpServer.ListenAndServe()
}

// Shutdown gracefully stops both listeners, waiting up to ctx's deadline for
// in-flight requests to complete.
func (s *Server) Shutdown(ctx context.Context) error {
	s.shutdownTLS(ctx)
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
