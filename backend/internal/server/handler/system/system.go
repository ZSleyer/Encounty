// Package system provides HTTP handlers for system lifecycle, version info,
// license management, readiness checks, and overlay state.
package system

import (
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/licenses"
	"github.com/zsleyer/encounty/backend/internal/state"
	"github.com/zsleyer/encounty/backend/internal/reexec"
)

// Deps declares the capabilities that system handlers require from the
// application layer, keeping this package decoupled from the server package.
type Deps interface {
	// StateManager returns the in-memory state manager.
	StateManager() *state.Manager
	// VersionInfo returns the version, commit hash, and build date.
	VersionInfo() (version, commit, buildDate string)
	// IsReady reports whether the server has finished initial setup.
	IsReady() bool
	// IsDevMode reports whether the server was started in development mode.
	IsDevMode() bool
	// IsSetupPending reports whether initial setup is waiting for user action.
	IsSetupPending() bool
	// RunSetupOnline triggers an online sync from PokeAPI.
	RunSetupOnline()
	// RunSetupOffline seeds the database from embedded fallback data.
	RunSetupOffline() error
	// BroadcastState sends the current state to all connected WebSocket clients.
	BroadcastState()
	// StopHotkeys stops the global hotkey listener.
	StopHotkeys()
	// SaveState persists the current state to disk.
	SaveState() error
}

// --- Response types ----------------------------------------------------------

// versionResponse contains build information.
type versionResponse struct {
	Version   string `json:"version"`
	Commit    string `json:"commit"`
	BuildDate string `json:"build_date"`
	Display   string `json:"display"`
}

// readyStatusResponse reports server readiness for initial data loading.
type readyStatusResponse struct {
	Ready        bool `json:"ready"`
	DevMode      bool `json:"dev_mode"`
	SetupPending bool `json:"setup_pending"`
}

// statusResponse carries a single status string.
type statusResponse struct {
	Status string `json:"status"`
}

// licenseAcceptResponse confirms license acceptance.
type licenseAcceptResponse struct {
	LicenseAccepted bool `json:"license_accepted"`
}

// overlayStateResponse carries the active Pokemon for the OBS overlay.
type overlayStateResponse struct {
	ActivePokemon *state.Pokemon `json:"active_pokemon"`
	ActiveID      string         `json:"active_id"`
}

// handler groups the system HTTP handlers together with their dependencies.
type handler struct {
	deps Deps
}

// RegisterRoutes attaches all system-level endpoints to mux.
func RegisterRoutes(mux *http.ServeMux, d Deps) {
	h := &handler{deps: d}
	mux.HandleFunc("/api/state", h.handleGetState)
	mux.HandleFunc("/api/sessions", h.handleGetSessions)
	mux.HandleFunc("/api/version", h.handleVersion)
	mux.HandleFunc("/api/licenses", h.handleLicenses)
	mux.HandleFunc("/api/license/accept", h.handleAcceptLicense)
	mux.HandleFunc("GET /api/status/ready", h.handleReadyStatus)
	mux.HandleFunc("POST /api/setup/online", h.handleSetupOnline)
	mux.HandleFunc("POST /api/setup/offline", h.handleSetupOffline)
	mux.HandleFunc("/api/quit", h.handleQuit)
	mux.HandleFunc("/api/restart", h.handleRestart)
	mux.HandleFunc("/api/overlay/state", h.handleOverlayState)
}

// handleGetState returns the full AppState snapshot as JSON.
// GET /api/state
//
// @Summary      Get full application state
// @Description  Returns the complete AppState snapshot including all Pokemon, settings, and sessions
// @Tags         state
// @Produce      json
// @Success      200 {object} state.AppState
// @Router       /state [get]
func (h *handler) handleGetState(w http.ResponseWriter, _ *http.Request) {
	httputil.WriteJSON(w, http.StatusOK, h.deps.StateManager().GetState())
}

// handleGetSessions returns the session history as JSON.
// GET /api/sessions
//
// @Summary      Get session history
// @Description  Returns the session history as JSON
// @Tags         state
// @Produce      json
// @Success      200 {array} state.Session
// @Router       /sessions [get]
func (h *handler) handleGetSessions(w http.ResponseWriter, _ *http.Request) {
	st := h.deps.StateManager().GetState()
	httputil.WriteJSON(w, http.StatusOK, st.Sessions)
}

// handleVersion returns build version information injected at compile time.
// GET /api/version
//
// @Summary      Get version info
// @Description  Returns build version information injected at compile time
// @Tags         system
// @Produce      json
// @Success      200 {object} versionResponse
// @Router       /version [get]
func (h *handler) handleVersion(w http.ResponseWriter, _ *http.Request) {
	version, commit, buildDate := h.deps.VersionInfo()
	var display string
	if version == "dev" {
		display = "dev-" + commit
	} else {
		display = version + "-" + commit
	}
	httputil.WriteJSON(w, http.StatusOK, versionResponse{
		Version:   version,
		Commit:    commit,
		BuildDate: buildDate,
		Display:   display,
	})
}

// handleLicenses returns all collected third-party license entries.
// GET /api/licenses
//
// @Summary      Get third-party licenses
// @Description  Returns all collected third-party license entries
// @Tags         system
// @Produce      json
// @Success      200 {array} licenses.Entry
// @Router       /licenses [get]
func (h *handler) handleLicenses(w http.ResponseWriter, _ *http.Request) {
	httputil.WriteJSON(w, http.StatusOK, licenses.All())
}

// handleAcceptLicense records that the user has accepted the AGPLv3 license.
// POST /api/license/accept
//
// @Summary      Accept license
// @Description  Records that the user has accepted the AGPLv3 license
// @Tags         system
// @Produce      json
// @Success      200 {object} licenseAcceptResponse
// @Router       /license/accept [post]
func (h *handler) handleAcceptLicense(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	sm := h.deps.StateManager()
	sm.AcceptLicense()
	sm.ScheduleSave()
	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusOK, licenseAcceptResponse{LicenseAccepted: true})
}

// handleReadyStatus reports whether the server has finished initial setup
// (games sync, etc.) so the frontend can show a loading screen until ready.
//
// @Summary      Check server readiness
// @Tags         system
// @Produce      json
// @Success      200 {object} readyStatusResponse
// @Router       /status/ready [get]
func (h *handler) handleReadyStatus(w http.ResponseWriter, _ *http.Request) {
	httputil.WriteJSON(w, http.StatusOK, readyStatusResponse{
		Ready:        h.deps.IsReady(),
		DevMode:      h.deps.IsDevMode(),
		SetupPending: h.deps.IsSetupPending(),
	})
}

// handleSetupOnline triggers an online sync from PokeAPI.
// POST /api/setup/online
func (h *handler) handleSetupOnline(w http.ResponseWriter, _ *http.Request) {
	h.deps.RunSetupOnline()
	httputil.WriteJSON(w, http.StatusOK, statusResponse{Status: "sync started"})
}

// handleSetupOffline seeds the database from embedded fallback data.
// POST /api/setup/offline
func (h *handler) handleSetupOffline(w http.ResponseWriter, _ *http.Request) {
	if err := h.deps.RunSetupOffline(); err != nil {
		slog.Error("Offline setup failed", "error", err)
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, statusResponse{Status: "offline setup complete"})
}

// handleQuit performs a graceful shutdown: saves state, stops hotkeys, and
// calls os.Exit after a short delay so the HTTP response can be sent first.
// POST /api/quit
//
// @Summary      Quit application
// @Description  Performs a graceful shutdown: saves state, stops hotkeys, and exits
// @Tags         system
// @Produce      json
// @Success      200 {object} statusResponse
// @Router       /quit [post]
func (h *handler) handleQuit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, statusResponse{Status: "shutting down"})

	go func() {
		time.Sleep(100 * time.Millisecond)
		if err := h.deps.SaveState(); err != nil {
			slog.Error("Failed to save state on quit", "error", err)
		}
		h.deps.StopHotkeys()
		os.Exit(0)
	}()
}

// handleRestart saves state, stops hotkeys, and replaces the running process
// with a fresh instance via reexec (platform-specific). POST /api/restart
//
// @Summary      Restart application
// @Description  Saves state, stops hotkeys, and replaces the process with a fresh instance
// @Tags         system
// @Produce      json
// @Success      200 {object} statusResponse
// @Router       /restart [post]
func (h *handler) handleRestart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, statusResponse{Status: "restarting"})

	go func() {
		time.Sleep(100 * time.Millisecond)
		if err := h.deps.SaveState(); err != nil {
			slog.Error("Failed to save state on restart", "error", err)
		}
		h.deps.StopHotkeys()

		exe, err := os.Executable()
		if err != nil {
			slog.Error("Restart: could not get executable path", "error", err)
			os.Exit(1)
		}
		if err := reexec.Reexec(exe, os.Args[1:]); err != nil {
			slog.Error("Restart failed", "error", err)
			os.Exit(1)
		}
	}()
}

// handleOverlayState returns only the data needed by the OBS overlay page:
// the active Pokemon and its id. GET /api/overlay/state
//
// @Summary      Get overlay state
// @Description  Returns the active Pokemon and its ID for the OBS overlay page
// @Tags         overlay
// @Produce      json
// @Success      200 {object} overlayStateResponse
// @Router       /overlay/state [get]
func (h *handler) handleOverlayState(w http.ResponseWriter, _ *http.Request) {
	st := h.deps.StateManager().GetState()
	var active *state.Pokemon
	for i := range st.Pokemon {
		if st.Pokemon[i].ID == st.ActiveID {
			active = &st.Pokemon[i]
			break
		}
	}
	httputil.WriteJSON(w, http.StatusOK, overlayStateResponse{
		ActivePokemon: active,
		ActiveID:      st.ActiveID,
	})
}
