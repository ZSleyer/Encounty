// update_test.go tests the HTTP handler wrappers for the auto-update system.
// Pure update logic tests live in internal/updater/updater_test.go.
package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/updater"
)

// TestUpdateCheckDevMode verifies that dev builds always report no update.
func TestUpdateCheckDevMode(t *testing.T) {
	srv := newTestServer(t)
	srv.version = "dev"

	req := httptest.NewRequest(http.MethodGet, "/api/update/check", nil)
	w := httptest.NewRecorder()
	srv.handleUpdateCheck(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var info updater.UpdateInfo
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

// TestUpdateCheckMethodNotAllowed verifies that non-GET requests are rejected.
func TestUpdateCheckMethodNotAllowed(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodPost, "/api/update/check", nil)
	w := httptest.NewRecorder()
	srv.handleUpdateCheck(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", w.Code)
	}
}

// TestUpdateApplyMethodNotAllowed verifies that non-POST requests are rejected.
func TestUpdateApplyMethodNotAllowed(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/update/apply", nil)
	w := httptest.NewRecorder()
	srv.handleUpdateApply(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", w.Code)
	}
}

// TestUpdateApplyMissingURL verifies that an empty download_url is rejected.
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
