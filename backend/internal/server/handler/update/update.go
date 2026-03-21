// Package update provides HTTP handlers for the auto-update system.
// The actual update logic (GitHub API calls, file download, binary
// replacement) lives in the updater package.
package update

import (
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime"

	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/updater"
)

// Deps declares the capabilities the update handlers need from the
// application layer, keeping this package decoupled from the server package.
type Deps interface {
	// Version returns the current binary version string.
	Version() string
	// SaveState persists the current state to disk.
	SaveState() error
	// ScheduleSave enqueues a deferred state save.
	ScheduleSave()
	// StopHotkeys shuts down the global hotkey listener.
	StopHotkeys()
	// ConfigDir returns the active configuration directory path.
	ConfigDir() string
}

// updateApplyRequest is the body for POST /api/update/apply.
type updateApplyRequest struct {
	DownloadURL string `json:"download_url"`
}

// statusResponse carries a single status string.
type statusResponse struct {
	Status string `json:"status"`
}

// handler groups the update HTTP handlers together with their dependencies.
type handler struct {
	deps Deps
}

// RegisterRoutes attaches the update endpoints to mux.
func RegisterRoutes(mux *http.ServeMux, d Deps) {
	h := &handler{deps: d}
	mux.HandleFunc("/api/update/check", h.handleUpdateCheck)
	mux.HandleFunc("/api/update/apply", h.handleUpdateApply)
}

// handleUpdateCheck queries the GitHub Releases API for the latest release
// and returns an UpdateInfo payload indicating whether an update is available.
// In dev mode (version == "dev") it always returns available=false.
//
// @Summary      Check for available updates
// @Tags         system
// @Produce      json
// @Success      200 {object} updater.UpdateInfo
// @Failure      500 {object} httputil.ErrResp
// @Router       /update/check [get]
func (h *handler) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	version := h.deps.Version()
	if version == "dev" {
		httputil.WriteJSON(w, http.StatusOK, updater.UpdateInfo{
			Available:      false,
			CurrentVersion: version,
		})
		return
	}
	// When running inside Electron on Linux, the wrapper handles updates
	// via electron-updater (AppImage). On Windows the Electron build is
	// portable, so electron-updater cannot apply updates — the Go backend
	// still provides the check so the frontend can show a notification.
	if os.Getenv("ENCOUNTY_ELECTRON") == "1" && runtime.GOOS != "windows" {
		httputil.WriteJSON(w, http.StatusOK, updater.UpdateInfo{
			Available:      false,
			CurrentVersion: version,
		})
		return
	}
	info, err := updater.CheckForUpdate(version)
	if err != nil {
		slog.Error("Update check error", "error", err)
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, info)
}

// handleUpdateApply begins the update download and replacement in a
// background goroutine, responding immediately so the UI can show a spinner.
//
// @Summary      Apply a downloaded update
// @Tags         system
// @Accept       json
// @Produce      json
// @Param        body body updateApplyRequest true "Download URL"
// @Success      200 {object} statusResponse
// @Failure      400 {object} httputil.ErrResp
// @Router       /update/apply [post]
func (h *handler) handleUpdateApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req updateApplyRequest
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	if req.DownloadURL == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "missing download_url"})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, statusResponse{Status: "updating"})
	go h.performUpdate(req.DownloadURL)
}

// performUpdate downloads the binary at downloadURL to a temporary path,
// sets executable permissions on Unix, saves state, stops hotkeys, and then
// calls updater.ReplaceAndRestart to swap the binary and relaunch.
func (h *handler) performUpdate(downloadURL string) {
	exe, err := os.Executable()
	if err != nil {
		slog.Error("Update: get executable failed", "error", err)
		return
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		slog.Error("Update: eval symlinks failed", "error", err)
		return
	}

	dir := filepath.Dir(exe)
	tmpPath := filepath.Join(dir, ".encounty-update-tmp")
	if runtime.GOOS == "windows" {
		tmpPath += ".exe"
	}

	slog.Info("Update: downloading", "path", tmpPath)
	if err := updater.DownloadFile(downloadURL, tmpPath); err != nil {
		slog.Error("Update: download failed", "error", err)
		return
	}

	if runtime.GOOS != "windows" {
		if err := os.Chmod(tmpPath, 0755); err != nil {
			slog.Error("Update: chmod failed", "error", err)
			_ = os.Remove(tmpPath)
			return
		}
	}

	slog.Info("Update: saving state and stopping hotkeys")
	if err := h.deps.SaveState(); err != nil {
		slog.Warn("Update: save state failed", "error", err)
	}
	h.deps.StopHotkeys()

	// Write marker so the restarted process knows a client was connected
	// and should not open a new browser tab.
	markerPath := filepath.Join(h.deps.ConfigDir(), ".update-restart")
	_ = os.WriteFile(markerPath, []byte("1"), 0644)

	slog.Info("Update: replacing binary and restarting")
	if err := updater.ReplaceAndRestart(tmpPath, exe); err != nil {
		slog.Error("Update: replace and restart failed", "error", err)
		_ = os.Remove(tmpPath)
	}
}
