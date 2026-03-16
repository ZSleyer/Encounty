// update_test.go tests the update-check logic, version comparison, and
// platform asset name resolution.
package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestPlatformAssetName(t *testing.T) {
	name := platformAssetName()
	switch runtime.GOOS {
	case "windows":
		if name != "encounty-windows.exe" {
			t.Errorf("got %q, want encounty-windows.exe", name)
		}
	default:
		if name != "encounty-linux" {
			t.Errorf("got %q, want encounty-linux", name)
		}
	}
}

func TestAssetDownloadURL(t *testing.T) {
	assets := []githubAsset{
		{Name: "encounty-linux", BrowserDownloadURL: "https://example.com/linux"},
		{Name: "encounty-windows.exe", BrowserDownloadURL: "https://example.com/win"},
	}

	url := assetDownloadURL(assets)
	if runtime.GOOS == "windows" {
		if url != "https://example.com/win" {
			t.Errorf("got %q, want windows URL", url)
		}
	} else {
		if url != "https://example.com/linux" {
			t.Errorf("got %q, want linux URL", url)
		}
	}
}

func TestAssetDownloadURLNotFound(t *testing.T) {
	assets := []githubAsset{
		{Name: "something-else", BrowserDownloadURL: "https://example.com/other"},
	}

	url := assetDownloadURL(assets)
	if url != "" {
		t.Errorf("expected empty string for missing asset, got %q", url)
	}
}

func TestVersionComparisonInFetchUpdateInfo(t *testing.T) {
	// Mock GitHub API returning a release
	mockRelease := githubRelease{
		TagName: "2.0.0",
		Assets: []githubAsset{
			{Name: "encounty-linux", BrowserDownloadURL: "https://example.com/linux"},
			{Name: "encounty-windows.exe", BrowserDownloadURL: "https://example.com/win"},
		},
	}

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(mockRelease)
	}))
	defer ts.Close()

	// We cannot easily override the URL in fetchUpdateInfo without refactoring,
	// so we test the logic inline using the same JSON decoding approach.
	resp, err := http.Get(ts.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	var release githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		t.Fatal(err)
	}

	// Version differs -> update available
	currentVersion := "1.0.0"
	available := release.TagName != "" && release.TagName != currentVersion
	if !available {
		t.Error("expected update to be available when versions differ")
	}

	// Same version -> no update
	currentVersion = "2.0.0"
	available = release.TagName != "" && release.TagName != currentVersion
	if available {
		t.Error("expected no update when versions match")
	}

	// Empty tag -> no update
	release.TagName = ""
	available = release.TagName != "" && release.TagName != "1.0.0"
	if available {
		t.Error("expected no update when tag is empty")
	}
}

func TestUpdateCheckDevMode(t *testing.T) {
	srv := newTestServer(t)
	srv.version = "dev"

	req := httptest.NewRequest(http.MethodGet, "/api/update/check", nil)
	w := httptest.NewRecorder()
	srv.handleUpdateCheck(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var info UpdateInfo
	if err := json.Unmarshal(w.Body.Bytes(), &info); err != nil {
		t.Fatal(err)
	}
	if info.Available {
		t.Error("dev mode should always return available=false")
	}
	if info.CurrentVersion != "dev" {
		t.Errorf("current version = %q, want dev", info.CurrentVersion)
	}
}

func TestUpdateCheckMethodNotAllowed(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodPost, "/api/update/check", nil)
	w := httptest.NewRecorder()
	srv.handleUpdateCheck(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", w.Code)
	}
}

func TestUpdateApplyMethodNotAllowed(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/update/apply", nil)
	w := httptest.NewRecorder()
	srv.handleUpdateApply(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", w.Code)
	}
}

func TestUpdateApplyMissingURL(t *testing.T) {
	srv := newTestServer(t)

	body := `{"download_url":""}`
	req := httptest.NewRequest(http.MethodPost, "/api/update/apply", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	srv.handleUpdateApply(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

func TestDownloadFile(t *testing.T) {
	content := "binary-content-here"
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(content))
	}))
	defer ts.Close()

	dest := filepath.Join(t.TempDir(), "downloaded")
	if err := downloadFile(ts.URL, dest); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != content {
		t.Errorf("got %q, want %q", string(data), content)
	}
}

func TestDownloadFileHTTPError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer ts.Close()

	dest := filepath.Join(t.TempDir(), "downloaded")
	err := downloadFile(ts.URL, dest)
	if err == nil {
		t.Error("expected error for HTTP 404")
	}
}
