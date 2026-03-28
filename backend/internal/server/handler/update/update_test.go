// Package update tests the update check and apply HTTP handlers.
package update

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/updater"
)

// Duplicated test literals (S1192).
const (
	checkPath = "/api/update/check"
	applyPath = "/api/update/apply"
)

// testDeps implements the Deps interface for testing.
type testDeps struct {
	version           string
	configDir         string
	saveStateCalled   bool
	saveStateErr      error
	scheduleSaveCalled bool
	stopHotkeysCalled bool
}

func (d *testDeps) Version() string    { return d.version }
func (d *testDeps) ConfigDir() string  { return d.configDir }
func (d *testDeps) SaveState() error   { d.saveStateCalled = true; return d.saveStateErr }
func (d *testDeps) ScheduleSave()      { d.scheduleSaveCalled = true }
func (d *testDeps) StopHotkeys()       { d.stopHotkeysCalled = true }

// newTestMux creates a test HTTP mux with the update routes registered.
func newTestMux(t *testing.T) (*http.ServeMux, *testDeps) {
	t.Helper()
	dir := t.TempDir()
	deps := &testDeps{
		version:   "1.0.0",
		configDir: dir,
	}
	mux := http.NewServeMux()
	RegisterRoutes(mux, deps)
	return mux, deps
}

func TestCheckUpdateDevMode(t *testing.T) {
	mux, deps := newTestMux(t)
	deps.version = "dev"

	req := httptest.NewRequest(http.MethodGet, checkPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var info updater.UpdateInfo
	if err := json.NewDecoder(w.Body).Decode(&info); err != nil {
		t.Fatal(err)
	}
	if info.Available {
		t.Error("expected available = false in dev mode")
	}
	if info.CurrentVersion != "dev" {
		t.Errorf("current_version = %q, want dev", info.CurrentVersion)
	}
}

func TestCheckUpdateMethodNotAllowed(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, checkPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", w.Code)
	}
}

func TestApplyUpdateSuccess(t *testing.T) {
	mux, _ := newTestMux(t)
	body := `{"download_url":"https://example.com/binary"}`

	req := httptest.NewRequest(http.MethodPost, applyPath, strings.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", w.Code, w.Body.String())
	}

	var resp statusResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Status != "updating" {
		t.Errorf("status = %q, want 'updating'", resp.Status)
	}
}

func TestApplyUpdateMissingURL(t *testing.T) {
	mux, _ := newTestMux(t)
	body := `{"download_url":""}`

	req := httptest.NewRequest(http.MethodPost, applyPath, strings.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}

	var resp httputil.ErrResp
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Error != "missing download_url" {
		t.Errorf("error = %q, want 'missing download_url'", resp.Error)
	}
}

func TestApplyUpdateInvalidJSON(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, applyPath, strings.NewReader("{bad"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

func TestApplyUpdateMethodNotAllowed(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, applyPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", w.Code)
	}
}

func TestCheckUpdateElectronLinux(t *testing.T) {
	// When ENCOUNTY_ELECTRON=1 on non-windows, update check should return
	// available=false. We set the env var for this test only.
	t.Setenv("ENCOUNTY_ELECTRON", "1")

	mux, deps := newTestMux(t)
	deps.version = "1.0.0"

	req := httptest.NewRequest(http.MethodGet, checkPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var info updater.UpdateInfo
	if err := json.NewDecoder(w.Body).Decode(&info); err != nil {
		t.Fatal(err)
	}
	// On Linux (the CI/test environment), Electron updates are handled by
	// electron-updater, so the backend should report no update available.
	if info.Available {
		t.Error("expected available = false when running under Electron on Linux")
	}
}

// --- RegisterRoutes verification ---------------------------------------------

func TestRegisterRoutesUpdate(t *testing.T) {
	mux, _ := newTestMux(t)

	// Verify /api/update/check route is registered (GET returns 200 or error, not 404)
	req := httptest.NewRequest(http.MethodGet, checkPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code == http.StatusNotFound {
		t.Error("/api/update/check route not registered")
	}

	// Verify /api/update/apply route is registered
	req = httptest.NewRequest(http.MethodPost, applyPath, strings.NewReader(`{"download_url":"x"}`))
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code == http.StatusNotFound {
		t.Error("/api/update/apply route not registered")
	}
}

// --- handleUpdateCheck with non-dev, non-electron version --------------------

func TestCheckUpdateNonDevVersion(t *testing.T) {
	// Ensure ENCOUNTY_ELECTRON is not set
	t.Setenv("ENCOUNTY_ELECTRON", "")

	mux, deps := newTestMux(t)
	deps.version = "0.0.1-test"

	req := httptest.NewRequest(http.MethodGet, checkPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	// This calls the real GitHub API, so accept either 200 (success) or 500 (network error)
	if w.Code != http.StatusOK && w.Code != http.StatusInternalServerError {
		t.Errorf("unexpected status = %d", w.Code)
	}
}

// --- handleUpdateApply edge cases --------------------------------------------

func TestApplyUpdateEmptyBody(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, applyPath, strings.NewReader(""))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for empty body", w.Code)
	}
}
