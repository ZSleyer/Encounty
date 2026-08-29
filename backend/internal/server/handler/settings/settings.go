// Package settings provides HTTP handlers for application settings and hotkey
// management endpoints.
package settings

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/gamesync"
	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/state"
)

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
	// ConfigDir returns the static configuration directory. It holds the record
	// of where the database lives, and never moves with it.
	ConfigDir() string

	// FileWriterSetConfig reconfigures the file output writer.
	FileWriterSetConfig(outputDir string, enabled bool)

	// BroadcastState sends the current state snapshot to all WebSocket clients.
	BroadcastState()
}

// --- Request/Response DTOs ---------------------------------------------------

// setDBPathRequest is the body for POST /api/settings/db-path.
type setDBPathRequest struct {
	Path string `json:"path"`
}

// captureResolutionRequest is the body for PUT /api/capture/resolution.
type captureResolutionRequest struct {
	DeviceKey  string `json:"device_key"`
	Resolution string `json:"resolution"`
}

// validCaptureResolutions are the accepted resolution presets. An empty value
// is also accepted and removes the per-device entry.
var validCaptureResolutions = map[string]bool{
	"auto": true, "720": true, "1080": true, "1440": true,
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
	mux.HandleFunc("/api/settings/db-path", h.handleSetDBPath)
	mux.HandleFunc("/api/capture/resolution", h.handleUpdateCaptureResolution)
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

// handleUpdateCaptureResolution stores the preferred capture resolution for a
// single camera deviceId and broadcasts the change. PUT /api/capture/resolution
//
// @Summary      Update capture resolution
// @Description  Sets the preferred resolution for one camera device
// @Tags         settings
// @Accept       json
// @Produce      json
// @Param        body body captureResolutionRequest true "Device key and resolution"
// @Success      200 {object} captureResolutionRequest
// @Failure      400 {object} httputil.ErrResp
// @Router       /capture/resolution [put]
func (h *handler) handleUpdateCaptureResolution(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req captureResolutionRequest
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	if req.DeviceKey == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "device_key is required"})
		return
	}
	if req.Resolution != "" && !validCaptureResolutions[req.Resolution] {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "invalid resolution"})
		return
	}
	sm := h.deps.StateManager()
	sm.SetCaptureResolution(req.DeviceKey, req.Resolution)
	sm.ScheduleSave()
	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusOK, req)
}

// handleSetDBPath moves the SQLite database to a new directory. Only the
// database moves: caches, backgrounds and legacy template files stay in the
// configuration directory, which never changes.
// POST /api/settings/db-path
//
// @Summary      Set database directory
// @Description  Moves the SQLite database to a new directory
// @Tags         settings
// @Accept       json
// @Produce      json
// @Param        body body setDBPathRequest true "New database directory"
// @Success      200 {object} pathResponse
// @Failure      400 {object} httputil.ErrResp
// @Router       /settings/db-path [post]
func (h *handler) handleSetDBPath(w http.ResponseWriter, r *http.Request) {
	var body setDBPathRequest
	if err := httputil.ReadJSON(r, &body); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	if body.Path == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "path is required"})
		return
	}

	sm := h.deps.StateManager()
	oldDir := sm.GetDBDir()
	newDir := filepath.Clean(body.Path)
	oldPath := filepath.Join(oldDir, state.DBFilename)
	newPath := filepath.Join(newDir, state.DBFilename)

	fail := func(err error) {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
	}

	// A relative path would be resolved against whatever directory the backend
	// happens to be started from, so the recorded location would stop making
	// sense the moment that differs.
	if !filepath.IsAbs(newDir) {
		fail(errors.New("path must be absolute"))
		return
	}
	if newDir == filepath.Clean(oldDir) {
		httputil.WriteJSON(w, http.StatusOK, pathResponse{Path: oldDir})
		return
	}
	if err := ensureWritableDir(newDir); err != nil {
		fail(err)
		return
	}
	// A different spelling of the same directory (Windows casing, a symlink) is
	// a no-op, not a conflict.
	if same, err := sameFile(oldPath, newPath); err != nil {
		fail(err)
		return
	} else if same {
		httputil.WriteJSON(w, http.StatusOK, pathResponse{Path: oldDir})
		return
	}
	if _, err := os.Stat(newPath); err == nil {
		fail(fmt.Errorf("%s already exists, move or delete it first", newPath))
		return
	}

	old := h.deps.DB()
	if old == nil {
		fail(errors.New("no database is open"))
		return
	}

	// VACUUM INTO copies the live database transactionally, so the write-ahead
	// log is included and the original file is never touched. A plain file copy
	// could not promise either.
	h.deps.SetDB(nil)
	if err := old.Snapshot(newPath); err != nil {
		h.deps.SetDB(old)
		_ = os.Remove(newPath)
		fail(err)
		return
	}
	_ = old.Close()

	// Everything from here rolls back to the old location, which is still on
	// disk: nothing is deleted before the new database is open and recorded.
	rollback := func(err error) {
		_ = os.Remove(newPath)
		database.RemoveSidecars(newPath)
		sm.SetDBDir(oldDir)
		if reopenErr := h.attach(oldDir); reopenErr != nil {
			slog.Error("Could not reopen the database at its previous location", "dir", oldDir, "error", reopenErr)
		}
		fail(err)
	}

	if err := h.attach(newDir); err != nil {
		rollback(fmt.Errorf("cannot open the database at the new location: %w", err))
		return
	}
	sm.SetDBDir(newDir)
	if err := sm.Save(); err != nil {
		rollback(fmt.Errorf("cannot save to the new location: %w", err))
		return
	}
	if err := recordDBDir(h.deps.ConfigDir(), newDir); err != nil {
		rollback(fmt.Errorf("cannot record the new location: %w", err))
		return
	}

	// Last, and only now: the copy is open, saved and recorded, so the original
	// is a leftover rather than the authoritative database.
	if err := os.Remove(oldPath); err != nil {
		slog.Warn("Could not remove the database at its previous location", "path", oldPath, "error", err)
	}
	database.RemoveSidecars(oldPath)

	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusOK, pathResponse{Path: newDir})
}

// attach opens the database in dir and hands the handle to the state manager.
func (h *handler) attach(dir string) error {
	db, err := database.Open(filepath.Join(dir, state.DBFilename))
	if err != nil {
		return err
	}
	h.deps.SetDB(db)
	gamesync.InvalidateCache()
	return nil
}

// recordDBDir persists the database directory next to the configuration, or
// removes the record when the database is back at the configuration directory.
func recordDBDir(configDir, dbDir string) error {
	if filepath.Clean(dbDir) == filepath.Clean(configDir) {
		return state.ClearDBDir(configDir)
	}
	return state.WriteDBDir(configDir, dbDir)
}

// ensureWritableDir creates dir and verifies that the process may write in it.
// Picking a folder the app cannot write to is the common mistake, and finding
// out mid-move would be far more expensive than probing first.
func ensureWritableDir(dir string) error {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("cannot create directory: %w", err)
	}
	probe := filepath.Join(dir, ".encounty_test")
	if err := os.WriteFile(probe, []byte("test"), 0644); err != nil {
		return fmt.Errorf("directory not writable: %w", err)
	}
	return os.Remove(probe)
}

// sameFile reports whether two paths resolve to the same file on disk. It
// answers false when either path is missing, which is the ordinary case for a
// genuine move.
func sameFile(a, b string) (bool, error) {
	infoA, err := os.Stat(a)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		return false, err
	}
	infoB, err := os.Stat(b)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		return false, err
	}
	return os.SameFile(infoA, infoB), nil
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
