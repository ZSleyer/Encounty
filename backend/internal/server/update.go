// update.go provides HTTP handler wrappers for the auto-update system.
// The actual update logic (GitHub API calls, file download, binary
// replacement) lives in the updater package.
package server

import (
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime"

	"github.com/zsleyer/encounty/backend/internal/updater"
)

// handleUpdateCheck queries the GitHub Releases API for the latest release
// and returns an UpdateInfo payload indicating whether an update is available.
// In dev mode (version == "dev") it always returns available=false.
//
// @Summary      Check for available updates
// @Tags         system
// @Produce      json
// @Success      200 {object} updater.UpdateInfo
// @Failure      500 {object} errResp
// @Router       /update/check [get]
func (s *Server) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if s.version == "dev" {
		writeJSON(w, http.StatusOK, updater.UpdateInfo{
			Available:      false,
			CurrentVersion: s.version,
		})
		return
	}
	// When running inside Electron on Linux, the wrapper handles updates
	// via electron-updater (AppImage). On Windows the Electron build is
	// portable, so electron-updater cannot apply updates — the Go backend
	// still provides the check so the frontend can show a notification.
	if os.Getenv("ENCOUNTY_ELECTRON") == "1" && runtime.GOOS != "windows" {
		writeJSON(w, http.StatusOK, updater.UpdateInfo{
			Available:      false,
			CurrentVersion: s.version,
		})
		return
	}
	info, err := updater.CheckForUpdate(s.version)
	if err != nil {
		slog.Error("Update check error", "error", err)
		writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, info)
}

// handleUpdateApply begins the update download and replacement in a
// background goroutine, responding immediately so the UI can show a spinner.
//
// @Summary      Apply a downloaded update
// @Tags         system
// @Accept       json
// @Produce      json
// @Param        body body UpdateApplyRequest true "Download URL"
// @Success      200 {object} StatusResponse
// @Failure      400 {object} errResp
// @Router       /update/apply [post]
func (s *Server) handleUpdateApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req UpdateApplyRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	if req.DownloadURL == "" {
		writeJSON(w, http.StatusBadRequest, errResp{"missing download_url"})
		return
	}
	writeJSON(w, http.StatusOK, StatusResponse{Status: "updating"})
	go s.performUpdate(req.DownloadURL)
}

// performUpdate downloads the binary at downloadURL to a temporary path,
// sets executable permissions on Unix, saves state, stops hotkeys, and then
// calls updater.ReplaceAndRestart to swap the binary and relaunch.
func (s *Server) performUpdate(downloadURL string) {
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
	if err := s.state.Save(); err != nil {
		slog.Warn("Update: save state failed", "error", err)
	}
	s.hotkeyMgr.Stop()

	// Write marker so the restarted process knows a client was connected
	// and should not open a new browser tab.
	markerPath := filepath.Join(s.state.GetConfigDir(), ".update-restart")
	_ = os.WriteFile(markerPath, []byte("1"), 0644)

	slog.Info("Update: replacing binary and restarting")
	if err := updater.ReplaceAndRestart(tmpPath, exe); err != nil {
		slog.Error("Update: replace and restart failed", "error", err)
		_ = os.Remove(tmpPath)
	}
}
