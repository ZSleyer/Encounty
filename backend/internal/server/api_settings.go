// api_settings.go — HTTP handlers for application settings and hotkey management.
package server

import (
	"log/slog"
	"net/http"
	"path/filepath"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/state"
)

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
// @Failure      400 {object} errResp
// @Router       /settings [post]
func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var settings state.Settings
	if err := readJSON(r, &settings); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	s.state.UpdateSettings(settings)
	s.state.ScheduleSave()
	if s.fileWriter != nil {
		s.fileWriter.SetConfig(settings.OutputDir, settings.OutputEnabled)
	}
	s.broadcastState()
	writeJSON(w, http.StatusOK, settings)
}

// handleSetConfigPath moves all data to a new directory.
// POST /api/settings/config-path
//
// @Summary      Set config directory path
// @Description  Moves all data to a new directory
// @Tags         settings
// @Accept       json
// @Produce      json
// @Param        body body SetConfigPathRequest true "New config path"
// @Success      200 {object} PathResponse
// @Failure      400 {object} errResp
// @Router       /settings/config-path [post]
func (s *Server) handleSetConfigPath(w http.ResponseWriter, r *http.Request) {
	var body SetConfigPathRequest
	if err := readJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	if body.Path == "" {
		writeJSON(w, http.StatusBadRequest, errResp{"path is required"})
		return
	}

	// Close the current database before copying files
	if s.db != nil {
		_ = s.db.Close()
	}

	if err := s.state.SetConfigDir(body.Path); err != nil {
		// Reopen old DB on failure
		if s.db != nil {
			oldDB, _ := database.Open(filepath.Join(s.state.GetConfigDir(), dbFilename))
			s.db = oldDB
			s.state.SetDB(oldDB)
			gamesDB = oldDB
		}
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}

	// Open the database at the new location
	newDB, err := database.Open(filepath.Join(body.Path, dbFilename))
	if err != nil {
		slog.Warn("Could not open database at new path", "error", err)
	}
	s.db = newDB
	s.state.SetDB(newDB)
	if newDB != nil {
		gamesDB = newDB
	}

	s.broadcastState()
	writeJSON(w, http.StatusOK, PathResponse{Path: body.Path})
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
// @Failure      400 {object} errResp
// @Router       /hotkeys [post]
func (s *Server) handleUpdateHotkeys(w http.ResponseWriter, r *http.Request) {
	var hk state.HotkeyMap
	if err := readJSON(r, &hk); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	s.state.UpdateHotkeys(hk)
	s.state.ScheduleSave()
	if err := s.hotkeyMgr.UpdateAllBindings(hk); err != nil {
		slog.Error("Failed to update hotkey bindings", "error", err)
	}
	s.broadcastState()
	writeJSON(w, http.StatusOK, hk)
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
// @Param        body body UpdateHotkeyRequest true "New key binding"
// @Success      200 {object} HotkeyUpdateResponse
// @Failure      400 {object} errResp
// @Failure      404 {object} errResp
// @Router       /hotkeys/{action} [put]
func (s *Server) handleUpdateSingleHotkey(w http.ResponseWriter, r *http.Request, action string) {
	var body UpdateHotkeyRequest
	if err := readJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	if !s.state.UpdateSingleHotkey(action, body.Key) {
		writeJSON(w, http.StatusNotFound, errResp{"unknown hotkey action"})
		return
	}
	s.state.ScheduleSave()
	if err := s.hotkeyMgr.UpdateBinding(action, body.Key); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	s.broadcastState()
	writeJSON(w, http.StatusOK, HotkeyUpdateResponse{Action: action, Key: body.Key})
}

// handleHotkeysPause suspends global hotkey dispatch without unregistering
// the bindings (useful while the settings UI captures key input).
// POST /api/hotkeys/pause
//
// @Summary      Pause hotkeys
// @Description  Suspends global hotkey dispatch without unregistering bindings
// @Tags         hotkeys
// @Produce      json
// @Success      200 {object} StatusResponse
// @Router       /hotkeys/pause [post]
func (s *Server) handleHotkeysPause(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	s.hotkeyMgr.SetPaused(true)
	writeJSON(w, http.StatusOK, StatusResponse{Status: "paused"})
}

// handleHotkeysResume re-enables hotkey dispatch after a pause.
// POST /api/hotkeys/resume
//
// @Summary      Resume hotkeys
// @Description  Re-enables hotkey dispatch after a pause
// @Tags         hotkeys
// @Produce      json
// @Success      200 {object} StatusResponse
// @Router       /hotkeys/resume [post]
func (s *Server) handleHotkeysResume(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	s.hotkeyMgr.SetPaused(false)
	writeJSON(w, http.StatusOK, StatusResponse{Status: "active"})
}

// handleHotkeysStatus reports whether the hotkey backend is available
// (false on Linux when the user lacks /dev/input read permission).
// GET /api/hotkeys/status
//
// @Summary      Get hotkey status
// @Description  Reports whether the hotkey backend is available
// @Tags         hotkeys
// @Produce      json
// @Success      200 {object} HotkeysStatusResponse
// @Router       /hotkeys/status [get]
func (s *Server) handleHotkeysStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, HotkeysStatusResponse{
		Available: s.hotkeyMgr.IsAvailable(),
	})
}
