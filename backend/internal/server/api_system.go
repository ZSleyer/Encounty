// api_system.go — HTTP handlers for system lifecycle, version info, and license management.
package server

import (
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/zsleyer/encounty/backend/internal/licenses"
	"github.com/zsleyer/encounty/backend/internal/state"
	"github.com/zsleyer/encounty/backend/internal/updater"
)

// handleGetState returns the full AppState snapshot as JSON.
// GET /api/state
//
// @Summary      Get full application state
// @Description  Returns the complete AppState snapshot including all Pokemon, settings, and sessions
// @Tags         state
// @Produce      json
// @Success      200 {object} state.AppState
// @Router       /state [get]
func (s *Server) handleGetState(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.state.GetState())
}

// handleReadyStatus reports whether the server has finished initial setup
// (games sync, etc.) so the frontend can show a loading screen until ready.
//
// @Summary      Check server readiness
// @Tags         system
// @Produce      json
// @Success      200 {object} ReadyStatusResponse
// @Router       /status/ready [get]
func (s *Server) handleReadyStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, ReadyStatusResponse{
		Ready: s.ready.Load(),
	})
}

// handleGetSessions returns the session history as JSON. GET /api/sessions
//
// @Summary      Get session history
// @Description  Returns the session history as JSON
// @Tags         state
// @Produce      json
// @Success      200 {array} state.Session
// @Router       /sessions [get]
func (s *Server) handleGetSessions(w http.ResponseWriter, r *http.Request) {
	st := s.state.GetState()
	writeJSON(w, http.StatusOK, st.Sessions)
}

// handleVersion returns build version information injected at compile time.
// GET /api/version
//
// @Summary      Get version info
// @Description  Returns build version information injected at compile time
// @Tags         system
// @Produce      json
// @Success      200 {object} VersionResponse
// @Router       /version [get]
func (s *Server) handleVersion(w http.ResponseWriter, _ *http.Request) {
	var display string
	if s.version == "dev" {
		display = "dev-" + s.commit
	} else {
		display = s.version + "-" + s.commit
	}
	writeJSON(w, http.StatusOK, VersionResponse{
		Version:   s.version,
		Commit:    s.commit,
		BuildDate: s.buildDate,
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
func (s *Server) handleLicenses(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, licenses.All())
}

// handleAcceptLicense records that the user has accepted the AGPLv3 license.
// POST /api/license/accept
//
// @Summary      Accept license
// @Description  Records that the user has accepted the AGPLv3 license
// @Tags         system
// @Produce      json
// @Success      200 {object} LicenseAcceptResponse
// @Router       /license/accept [post]
func (s *Server) handleAcceptLicense(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	s.state.AcceptLicense()
	s.state.ScheduleSave()
	s.broadcastState()
	writeJSON(w, http.StatusOK, LicenseAcceptResponse{LicenseAccepted: true})
}

// handleQuit performs a graceful shutdown: saves state, stops hotkeys, and
// calls os.Exit after a short delay so the HTTP response can be sent first.
// POST /api/quit
//
// @Summary      Quit application
// @Description  Performs a graceful shutdown: saves state, stops hotkeys, and exits
// @Tags         system
// @Produce      json
// @Success      200 {object} StatusResponse
// @Router       /quit [post]
func (s *Server) handleQuit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, StatusResponse{Status: "shutting down"})

	go func() {
		time.Sleep(100 * time.Millisecond)
		if err := s.state.Save(); err != nil {
			slog.Error("Failed to save state on quit", "error", err)
		}
		s.hotkeyMgr.Stop()
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
// @Success      200 {object} StatusResponse
// @Router       /restart [post]
func (s *Server) handleRestart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, StatusResponse{Status: "restarting"})

	go func() {
		time.Sleep(100 * time.Millisecond)
		if err := s.state.Save(); err != nil {
			slog.Error("Failed to save state on restart", "error", err)
		}
		s.hotkeyMgr.Stop()

		exe, err := os.Executable()
		if err != nil {
			slog.Error("Restart: could not get executable path", "error", err)
			os.Exit(1)
		}
		if err := updater.Reexec(exe, os.Args[1:]); err != nil {
			slog.Error("Restart failed", "error", err)
			os.Exit(1)
		}
	}()
}

// handleOverlayState returns only the data needed by the OBS overlay page:
// the active Pokémon and its id. GET /api/overlay/state
//
// @Summary      Get overlay state
// @Description  Returns the active Pokemon and its ID for the OBS overlay page
// @Tags         overlay
// @Produce      json
// @Success      200 {object} OverlayStateResponse
// @Router       /overlay/state [get]
func (s *Server) handleOverlayState(w http.ResponseWriter, r *http.Request) {
	st := s.state.GetState()
	var active *state.Pokemon
	for i := range st.Pokemon {
		if st.Pokemon[i].ID == st.ActiveID {
			active = &st.Pokemon[i]
			break
		}
	}
	writeJSON(w, http.StatusOK, OverlayStateResponse{
		ActivePokemon: active,
		ActiveID:      st.ActiveID,
	})
}
