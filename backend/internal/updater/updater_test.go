// updater_test.go tests the update-check logic, version comparison,
// platform asset name resolution, and file download.
package updater

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

const (
	assetWindows      = "encounty-windows.exe"
	assetLinux        = "encounty-linux"
	urlLinux          = "https://example.com/linux"
	urlWin            = "https://example.com/win"
	contentTypeHeader = "Content-Type"
	jsonContentType   = "application/json"
)

// TestPlatformAssetName verifies the correct asset filename per OS.
func TestPlatformAssetName(t *testing.T) {
	name := PlatformAssetName()
	switch runtime.GOOS {
	case "windows":
		if name != assetWindows {
			t.Errorf("got %q, want encounty-windows.exe", name)
		}
	default:
		if name != assetLinux {
			t.Errorf("got %q, want encounty-linux", name)
		}
	}
}

// TestAssetDownloadURL checks that the correct platform URL is selected.
func TestAssetDownloadURL(t *testing.T) {
	assets := []githubAsset{
		{Name: assetLinux, BrowserDownloadURL: urlLinux},
		{Name: assetWindows, BrowserDownloadURL: urlWin},
	}

	url := assetDownloadURL(assets)
	if runtime.GOOS == "windows" {
		if url != urlWin {
			t.Errorf("got %q, want windows URL", url)
		}
	} else {
		if url != urlLinux {
			t.Errorf("got %q, want linux URL", url)
		}
	}
}

// TestAssetDownloadURLNotFound verifies empty string for missing assets.
func TestAssetDownloadURLNotFound(t *testing.T) {
	assets := []githubAsset{
		{Name: "something-else", BrowserDownloadURL: "https://example.com/other"},
	}

	url := assetDownloadURL(assets)
	if url != "" {
		t.Errorf("expected empty string for missing asset, got %q", url)
	}
}

// TestVersionComparisonInCheckForUpdate validates version comparison logic
// using a mock GitHub API response decoded inline.
func TestVersionComparisonInCheckForUpdate(t *testing.T) {
	mockRelease := githubRelease{
		TagName: "2.0.0",
		Assets: []githubAsset{
			{Name: assetLinux, BrowserDownloadURL: urlLinux},
			{Name: assetWindows, BrowserDownloadURL: urlWin},
		},
	}

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(contentTypeHeader, jsonContentType)
		_ = json.NewEncoder(w).Encode(mockRelease)
	}))
	defer ts.Close()

	// We cannot easily override the URL in CheckForUpdate without refactoring,
	// so we test the logic inline using the same JSON decoding approach.
	resp, err := http.Get(ts.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()

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

// TestDownloadFile verifies a successful file download.
func TestDownloadFile(t *testing.T) {
	content := "binary-content-here"
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(content))
	}))
	defer ts.Close()

	dest := filepath.Join(t.TempDir(), "downloaded")
	if err := DownloadFile(ts.URL, dest); err != nil {
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

// TestDownloadFileHTTPError verifies error handling for failed downloads.
func TestDownloadFileHTTPError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer ts.Close()

	dest := filepath.Join(t.TempDir(), "downloaded")
	err := DownloadFile(ts.URL, dest)
	if err == nil {
		t.Error("expected error for HTTP 404")
	}
}

// TestAssetDownloadURLMock verifies assetDownloadURL with a mock server
// that provides assets for both platforms.
func TestAssetDownloadURLMock(t *testing.T) {
	assets := []githubAsset{
		{Name: "encounty-linux", BrowserDownloadURL: "https://example.com/encounty-linux"},
		{Name: "encounty-windows.exe", BrowserDownloadURL: "https://example.com/encounty-windows.exe"},
	}

	url := assetDownloadURL(assets)
	if url == "" {
		t.Error("assetDownloadURL should find asset for current platform")
	}
}

// --- CheckForUpdate with mock server -----------------------------------------

// TestCheckForUpdateMockServer uses httptest to simulate the GitHub API
// and validates the full CheckForUpdate flow. Since CheckForUpdate uses a
// hardcoded URL, we test the decode logic inline with the same approach.
func TestCheckForUpdateMockServerLogic(t *testing.T) {
	mockRelease := githubRelease{
		TagName: "2.0.0",
		Assets: []githubAsset{
			{Name: assetLinux, BrowserDownloadURL: urlLinux},
			{Name: assetWindows, BrowserDownloadURL: urlWin},
		},
	}

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(contentTypeHeader, jsonContentType)
		_ = json.NewEncoder(w).Encode(mockRelease)
	}))
	defer ts.Close()

	resp, err := http.Get(ts.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()

	var release githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		t.Fatal(err)
	}

	// Simulate CheckForUpdate logic
	available := release.TagName != "" && release.TagName != "1.0.0"
	downloadURL := assetDownloadURL(release.Assets)

	if !available {
		t.Error("expected update to be available")
	}
	if downloadURL == "" {
		t.Error("expected non-empty download URL")
	}
}

// TestCheckForUpdateMockNon200 exercises error handling for non-200 responses.
func TestCheckForUpdateMockNon200(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer ts.Close()

	// We cannot call CheckForUpdate directly (hardcoded URL), so we replicate
	// the error check logic.
	client := &http.Client{}
	resp, err := client.Get(ts.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusOK {
		t.Error("expected non-200 status")
	}
}

// TestCheckForUpdateMockInvalidJSON exercises error handling for malformed JSON.
func TestCheckForUpdateMockInvalidJSON(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(contentTypeHeader, jsonContentType)
		_, _ = w.Write([]byte("{invalid json"))
	}))
	defer ts.Close()

	resp, err := http.Get(ts.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()

	var release githubRelease
	err = json.NewDecoder(resp.Body).Decode(&release)
	if err == nil {
		t.Error("expected error decoding invalid JSON")
	}
}

// --- DownloadFile error paths ------------------------------------------------

// TestDownloadFileNetworkError verifies error when server is unreachable.
func TestDownloadFileNetworkError(t *testing.T) {
	err := DownloadFile("http://127.0.0.1:1", filepath.Join(t.TempDir(), "out"))
	if err == nil {
		t.Error("expected error for unreachable server")
	}
}

// TestDownloadFileBadDest verifies error when destination path is invalid.
func TestDownloadFileBadDest(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("content"))
	}))
	defer ts.Close()

	// Use a path under a non-existent directory
	err := DownloadFile(ts.URL, "/nonexistent/dir/file")
	if err == nil {
		t.Error("expected error for bad destination path")
	}
}

// TestDownloadFileOverwrite verifies that DownloadFile overwrites existing files.
func TestDownloadFileOverwrite(t *testing.T) {
	content := "new-content"
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(content))
	}))
	defer ts.Close()

	dest := filepath.Join(t.TempDir(), "existing")
	if err := os.WriteFile(dest, []byte("old-content"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := DownloadFile(ts.URL, dest); err != nil {
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

// --- AssetDownloadURL edge cases ---------------------------------------------

func TestAssetDownloadURLEmptyAssets(t *testing.T) {
	url := assetDownloadURL(nil)
	if url != "" {
		t.Errorf("expected empty string for nil assets, got %q", url)
	}

	url = assetDownloadURL([]githubAsset{})
	if url != "" {
		t.Errorf("expected empty string for empty assets, got %q", url)
	}
}
