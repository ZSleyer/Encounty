// Package settings provides HTTP handlers for application settings and hotkey
// management endpoints.
package settings

import (
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/gamesync"
	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/state"
)

const dbFilename = "encounty.db"

// Deps declares the capabilities the settings handlers need from the
// application layer, keeping this package decoupled from the server package.
type Deps interface {
	// StateManager returns the in-memory state manager.
	StateManager() *state.Manager

	// HotkeyUpdateAllBindings replaces all hotkey bindings atomically.
	HotkeyUpdateAllBindings(hm state.HotkeyMap) error
	// HotkeyUpdateBinding replaces a single action's key binding at runtime.
	HotkeyUpdateBinding(action, keyCombo string) error
	// HotkeySetPaused pauses or resumes hotkey dispatch.
	HotkeySetPaused(paused bool)
	// HotkeyIsAvailable reports whether the hotkey backend is available.
	HotkeyIsAvailable() bool
	// DispatchHotkeyAction injects a hotkey action from an external source (e.g. Electron IPC).
	DispatchHotkeyAction(action, pokemonID string)

	// DB returns the current database handle.
	DB() *database.DB
	// SetDB replaces the active database handle.
	SetDB(db *database.DB)

	// FileWriterSetConfig reconfigures the file output writer.
	FileWriterSetConfig(outputDir string, enabled bool)

	// BroadcastState sends the current state snapshot to all WebSocket clients.
	BroadcastState()
}

// --- Request/Response DTOs ---------------------------------------------------

// setConfigPathRequest is the body for POST /api/settings/config-path.
type setConfigPathRequest struct {
	Path string `json:"path"`
}

// updateHotkeyRequest is the body for PUT /api/hotkeys/{action}.
type updateHotkeyRequest struct {
	Key string `json:"key"`
}

// pathResponse returns a filesystem path.
type pathResponse struct {
	Path string `json:"path"`
}

// statusResponse carries a single status string.
type statusResponse struct {
	Status string `json:"status"`
}

// hotkeyUpdateResponse echoes the updated action and key.
type hotkeyUpdateResponse struct {
	Action string `json:"action"`
	Key    string `json:"key"`
}

// hotkeysStatusResponse reports hotkey backend availability.
type hotkeysStatusResponse struct {
	Available bool `json:"available"`
}

// --- Handler -----------------------------------------------------------------

// handler groups the settings and hotkey HTTP handlers together with their
// dependencies.
type handler struct {
	deps Deps
}

// RegisterRoutes attaches the settings and hotkey endpoints to mux.
func RegisterRoutes(mux *http.ServeMux, d Deps) {
	h := &handler{deps: d}
	mux.HandleFunc("/api/settings", h.handleUpdateSettings)
	mux.HandleFunc("/api/settings/config-path", h.handleSetConfigPath)
	mux.HandleFunc("/api/hotkeys", h.handleUpdateHotkeys)
	mux.HandleFunc("/api/hotkeys/pause", h.handleHotkeysPause)
	mux.HandleFunc("/api/hotkeys/resume", h.handleHotkeysResume)
	mux.HandleFunc("/api/hotkeys/status", h.handleHotkeysStatus)
	mux.HandleFunc("/api/hotkeys/trigger/", func(w http.ResponseWriter, r *http.Request) {
		action := strings.TrimPrefix(r.URL.Path, "/api/hotkeys/trigger/")
		h.handleHotkeyTrigger(w, r, action)
	})
	mux.HandleFunc("/api/hotkeys/", func(w http.ResponseWriter, r *http.Request) {
		action := strings.TrimPrefix(r.URL.Path, "/api/hotkeys/")
		if r.Method == http.MethodPut {
			h.handleUpdateSingleHotkey(w, r, action)
		} else {
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})
}

// handleUpdateSettings replaces the settings block, reconfigures the file
// output writer with the new directory/enabled state, and broadcasts the
// change. POST /api/settings
//
// @Summary      Update settings
// @Description  Replaces the settings block and reconfigures file output
// @Tags         settings
// @Accept       json
// @Produce      json
// @Param        settings body state.Settings true "Updated settings"
// @Success      200 {object} state.Settings
// @Failure      400 {object} httputil.ErrResp
// @Router       /settings [post]
func (h *handler) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var settings state.Settings
	if err := httputil.ReadJSON(r, &settings); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	sm := h.deps.StateManager()
	sm.UpdateSettings(settings)
	sm.ScheduleSave()
	h.deps.FileWriterSetConfig(settings.OutputDir, settings.OutputEnabled)
	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusOK, settings)
}

// handleSetConfigPath moves all data to a new directory.
// POST /api/settings/config-path
//
// @Summary      Set config directory path
// @Description  Moves all data to a new directory
// @Tags         settings
// @Accept       json
// @Produce      json
// @Param        body body setConfigPathRequest true "New config path"
// @Success      200 {object} pathResponse
// @Failure      400 {object} httputil.ErrResp
// @Router       /settings/config-path [post]
func (h *handler) handleSetConfigPath(w http.ResponseWriter, r *http.Request) {
	var body setConfigPathRequest
	if err := httputil.ReadJSON(r, &body); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	if body.Path == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "path is required"})
		return
	}

	sm := h.deps.StateManager()

	// Close the current database before copying files
	if db := h.deps.DB(); db != nil {
		_ = db.Close()
	}

	if err := sm.SetConfigDir(body.Path); err != nil {
		// Reopen old DB on failure
		if h.deps.DB() != nil {
			oldDB, _ := database.Open(filepath.Join(sm.GetConfigDir(), dbFilename))
			h.deps.SetDB(oldDB)
			gamesync.InvalidateCache()
		}
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}

	// Open the database at the new location
	newDB, err := database.Open(filepath.Join(body.Path, dbFilename))
	if err != nil {
		slog.Warn("Could not open database at new path", "error", err)
	}
	h.deps.SetDB(newDB)
	gamesync.InvalidateCache()

	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusOK, pathResponse(body))
}

// handleUpdateHotkeys replaces the full hotkey map and re-registers all
// bindings with the OS hotkey manager. POST /api/hotkeys
//
// @Summary      Update all hotkeys
// @Description  Replaces the full hotkey map and re-registers all bindings
// @Tags         hotkeys
// @Accept       json
// @Produce      json
// @Param        hotkeys body state.HotkeyMap true "Complete hotkey map"
// @Success      200 {object} state.HotkeyMap
// @Failure      400 {object} httputil.ErrResp
// @Router       /hotkeys [post]
func (h *handler) handleUpdateHotkeys(w http.ResponseWriter, r *http.Request) {
	var hk state.HotkeyMap
	if err := httputil.ReadJSON(r, &hk); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	sm := h.deps.StateManager()
	sm.UpdateHotkeys(hk)
	sm.ScheduleSave()
	if err := h.deps.HotkeyUpdateAllBindings(hk); err != nil {
		slog.Error("Failed to update hotkey bindings", "error", err)
	}
	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusOK, hk)
}

// handleUpdateSingleHotkey updates one action's key binding without
// touching the others. PUT /api/hotkeys/{action}
//
// @Summary      Update a single hotkey
// @Description  Updates one action's key binding without touching the others
// @Tags         hotkeys
// @Accept       json
// @Produce      json
// @Param        action path string true "Hotkey action name"
// @Param        body body updateHotkeyRequest true "New key binding"
// @Success      200 {object} hotkeyUpdateResponse
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Router       /hotkeys/{action} [put]
func (h *handler) handleUpdateSingleHotkey(w http.ResponseWriter, r *http.Request, action string) {
	var body updateHotkeyRequest
	if err := httputil.ReadJSON(r, &body); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	sm := h.deps.StateManager()
	if !sm.UpdateSingleHotkey(action, body.Key) {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: "unknown hotkey action"})
		return
	}
	sm.ScheduleSave()
	if err := h.deps.HotkeyUpdateBinding(action, body.Key); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusOK, hotkeyUpdateResponse{Action: action, Key: body.Key})
}

// handleHotkeysPause suspends global hotkey dispatch without unregistering
// the bindings (useful while the settings UI captures key input).
// POST /api/hotkeys/pause
//
// @Summary      Pause hotkeys
// @Description  Suspends global hotkey dispatch without unregistering bindings
// @Tags         hotkeys
// @Produce      json
// @Success      200 {object} statusResponse
// @Router       /hotkeys/pause [post]
func (h *handler) handleHotkeysPause(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	h.deps.HotkeySetPaused(true)
	httputil.WriteJSON(w, http.StatusOK, statusResponse{Status: "paused"})
}

// handleHotkeysResume re-enables hotkey dispatch after a pause.
// POST /api/hotkeys/resume
//
// @Summary      Resume hotkeys
// @Description  Re-enables hotkey dispatch after a pause
// @Tags         hotkeys
// @Produce      json
// @Success      200 {object} statusResponse
// @Router       /hotkeys/resume [post]
func (h *handler) handleHotkeysResume(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	h.deps.HotkeySetPaused(false)
	httputil.WriteJSON(w, http.StatusOK, statusResponse{Status: "active"})
}

// handleHotkeysStatus reports whether the hotkey backend is available
// (false on Linux when the user lacks /dev/input read permission).
// GET /api/hotkeys/status
//
// @Summary      Get hotkey status
// @Description  Reports whether the hotkey backend is available
// @Tags         hotkeys
// @Produce      json
// @Success      200 {object} hotkeysStatusResponse
// @Router       /hotkeys/status [get]
func (h *handler) handleHotkeysStatus(w http.ResponseWriter, _ *http.Request) {
	httputil.WriteJSON(w, http.StatusOK, hotkeysStatusResponse{
		Available: h.deps.HotkeyIsAvailable(),
	})
}

// handleHotkeyTrigger processes externally triggered hotkey actions (e.g. from Electron).
// POST /api/hotkeys/trigger/{action}
func (h *handler) handleHotkeyTrigger(w http.ResponseWriter, r *http.Request, action string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	validActions := map[string]bool{"increment": true, "decrement": true, "reset": true, "next": true}
	if !validActions[action] {
		httputil.WriteJSON(w, http.StatusBadRequest, statusResponse{Status: "unknown action"})
		return
	}
	h.deps.DispatchHotkeyAction(action, "")
	httputil.WriteJSON(w, http.StatusOK, statusResponse{Status: "ok"})
}
