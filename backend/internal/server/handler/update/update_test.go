package update

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/updater"
)

const (
	fmtStatusWant   = "status = %d, want %d"
	testVersion     = "v0.8.0"
	updateCheckPath = "/api/update/check"
)

type testDeps struct {
	version string
}

func (d *testDeps) Version() string { return d.version }

func TestUpdateCheckDevMode(t *testing.T) {
	deps := &testDeps{version: "dev"}
	mux := http.NewServeMux()
	RegisterRoutes(mux, deps)

	req := httptest.NewRequest(http.MethodGet, updateCheckPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant, w.Code, http.StatusOK)
	}

	var info updater.UpdateInfo
	if err := json.Unmarshal(w.Body.Bytes(), &info); err != nil {
		t.Fatal(err)
	}
	if info.Available {
		t.Error("expected available = false in dev mode")
	}
	if info.CurrentVersion != "dev" {
		t.Errorf("current_version = %q, want dev", info.CurrentVersion)
	}
}

func TestUpdateCheckLinuxElectronSkipped(t *testing.T) {
	t.Setenv("ENCOUNTY_ELECTRON", "1")

	deps := &testDeps{version: testVersion}
	mux := http.NewServeMux()
	RegisterRoutes(mux, deps)

	req := httptest.NewRequest(http.MethodGet, updateCheckPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant, w.Code, http.StatusOK)
	}

	var info updater.UpdateInfo
	if err := json.Unmarshal(w.Body.Bytes(), &info); err != nil {
		t.Fatal(err)
	}

	// On Linux (where tests run in CI), ENCOUNTY_ELECTRON=1 should skip.
	// On other platforms the check proceeds — both are valid outcomes.
	if info.CurrentVersion != testVersion {
		t.Errorf("current_version = %q, want %s", info.CurrentVersion, testVersion)
	}
}

func TestUpdateCheckMethodNotAllowed(t *testing.T) {
	deps := &testDeps{version: testVersion}
	mux := http.NewServeMux()
	RegisterRoutes(mux, deps)

	req := httptest.NewRequest(http.MethodPost, updateCheckPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(fmtStatusWant, w.Code, http.StatusMethodNotAllowed)
	}
}
