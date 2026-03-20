// updater.go implements the auto-update system. It polls the GitHub Releases
// API to detect newer versions and downloads the platform-specific binary.
// Platform-specific binary replacement lives in replace_unix.go and
// replace_windows.go; process re-execution lives in reexec_unix.go and
// reexec_windows.go.
package updater

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
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

// CheckForUpdate calls the GitHub API to get the latest release tag and
// download URL for the current platform's binary.
func CheckForUpdate(currentVersion string) (*UpdateInfo, error) {
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
	defer func() { _ = resp.Body.Close() }()

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
	name := PlatformAssetName()
	for _, a := range assets {
		if a.Name == name {
			return a.BrowserDownloadURL
		}
	}
	return ""
}

// PlatformAssetName returns the filename of the release asset for the
// current operating system.
func PlatformAssetName() string {
	switch runtime.GOOS {
	case "windows":
		return "encounty-windows.exe"
	default:
		return "encounty-linux"
	}
}

// DownloadFile downloads the resource at url and writes it to dest,
// truncating any existing file. Uses a 5-minute timeout for large binaries.
func DownloadFile(url, dest string) error {
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	f, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	_, err = io.Copy(f, resp.Body)
	return err
}
