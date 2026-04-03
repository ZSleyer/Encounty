// Package updater queries the GitHub Releases API to detect newer versions.
package updater

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

const (
	githubOwner = "ZSleyer"
	githubRepo  = "Encounty"
)

// apiBaseURL is the GitHub API base URL. Tests override this to point at
// an httptest.Server.
var apiBaseURL = "https://api.github.com"

type githubRelease struct {
	TagName string `json:"tag_name"`
}

// UpdateInfo is returned to the frontend by /api/update/check.
type UpdateInfo struct {
	Available      bool   `json:"available"`
	LatestVersion  string `json:"latest_version"`
	CurrentVersion string `json:"current_version"`
}

// CheckForUpdate calls the GitHub API to get the latest release tag.
func CheckForUpdate(currentVersion string) (*UpdateInfo, error) {
	url := fmt.Sprintf("%s/repos/%s/%s/releases/latest", apiBaseURL, githubOwner, githubRepo)
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

	return &UpdateInfo{
		Available:      available,
		LatestVersion:  release.TagName,
		CurrentVersion: currentVersion,
	}, nil
}
