// update.go implements the auto-update system. It polls the GitHub Releases
// API to detect newer versions and downloads the platform-specific binary.
// The actual binary replacement and restart is handled by platform-specific
// helpers in update_unix.go and update_windows.go.
package server

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

const (
	githubOwner = "ZSleyer"
	githubRepo  = "Encounty"
)

type githubRelease struct {
	TagName string        `json:"tag_name"`
	Assets  []githubAsset `json:"assets"`
}

type githubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

// UpdateInfo is returned to the frontend by /api/update/check.
type UpdateInfo struct {
	Available      bool   `json:"available"`
	LatestVersion  string `json:"latest_version"`
	CurrentVersion string `json:"current_version"`
	DownloadURL    string `json:"download_url"`
}

// handleUpdateCheck queries the GitHub Releases API for the latest release
// and returns an UpdateInfo payload indicating whether an update is available.
// In dev mode (version == "dev") it always returns available=false.
// GET /api/update/check
func (s *Server) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if s.version == "dev" {
		writeJSON(w, http.StatusOK, UpdateInfo{
			Available:      false,
			CurrentVersion: s.version,
		})
		return
	}
	info, err := fetchUpdateInfo(s.version)
	if err != nil {
		slog.Error("Update check error", "error", err)
		writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, info)
}

// handleUpdateApply begins the update download and replacement in a
// background goroutine, responding immediately so the UI can show a spinner.
// POST /api/update/apply
func (s *Server) handleUpdateApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		DownloadURL string `json:"download_url"`
	}
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	if req.DownloadURL == "" {
		writeJSON(w, http.StatusBadRequest, errResp{"missing download_url"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updating"})
	go s.performUpdate(req.DownloadURL)
}

// fetchUpdateInfo calls the GitHub API to get the latest release tag and
// download URL for the current platform's binary.
func fetchUpdateInfo(currentVersion string) (*UpdateInfo, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", githubOwner, githubRepo)
	client := &http.Client{Timeout: 10 * time.Second}

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub API returned %d", resp.StatusCode)
	}

	var release githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, err
	}

	available := release.TagName != "" && release.TagName != currentVersion
	downloadURL := assetDownloadURL(release.Assets)

	return &UpdateInfo{
		Available:      available,
		LatestVersion:  release.TagName,
		CurrentVersion: currentVersion,
		DownloadURL:    downloadURL,
	}, nil
}

// assetDownloadURL finds the download URL for the current platform's binary
// in the release assets list, or returns "" if not found.
func assetDownloadURL(assets []githubAsset) string {
	name := platformAssetName()
	for _, a := range assets {
		if a.Name == name {
			return a.BrowserDownloadURL
		}
	}
	return ""
}

// platformAssetName returns the filename of the release asset for the
// current operating system.
func platformAssetName() string {
	switch runtime.GOOS {
	case "windows":
		return "encounty-windows.exe"
	default:
		return "encounty-linux"
	}
}

// performUpdate downloads the binary at downloadURL to a temporary path,
// sets executable permissions on Unix, saves state, stops hotkeys, and then
// calls replaceAndRestart to swap the binary and relaunch.
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
	if err := downloadFile(downloadURL, tmpPath); err != nil {
		slog.Error("Update: download failed", "error", err)
		return
	}

	if runtime.GOOS != "windows" {
		if err := os.Chmod(tmpPath, 0755); err != nil {
			slog.Error("Update: chmod failed", "error", err)
			os.Remove(tmpPath)
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
	if err := replaceAndRestart(tmpPath, exe); err != nil {
		slog.Error("Update: replace and restart failed", "error", err)
		os.Remove(tmpPath)
	}
}

// downloadFile downloads the resource at url and writes it to dest,
// truncating any existing file. Uses a 5-minute timeout for large binaries.
func downloadFile(url, dest string) error {
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	f, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, resp.Body)
	return err
}
