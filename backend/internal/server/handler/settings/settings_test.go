// Package settings tests the HTTP handlers for application settings and hotkey
// management endpoints.
package settings

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// String constants extracted to satisfy S1192 (no duplicated literals).
const (
	testDBName = "encounty.db"

	pathSettings       = "/api/settings"
	pathConfigPath     = "/api/settings/config-path"
	pathHotkeysIncr    = "/api/hotkeys/increment"
	pathHotkeysPause   = "/api/hotkeys/pause"
	pathHotkeysResume  = "/api/hotkeys/resume"
	pathHotkeysStatus  = "/api/hotkeys/status"

	wantStatus200     = "status = %d, want 200"
	wantStatus200Body = "status = %d, want 200; body = %s"
	wantStatus400     = "status = %d, want 400"
	wantStatus405     = "status = %d, want 405"
	msgBroadcastNot   = "BroadcastState was not called"
)

// --- Mock dependencies -------------------------------------------------------

// mockHotkeyMgr records calls to hotkey-related methods and can be configured
// to return errors or specific availability status.
type mockHotkeyMgr struct {
	updateAllCalled bool
	updateAllHM     state.HotkeyMap
	updateAllErr    error

	updateBindingCalled bool
	updateBindingAction string
	updateBindingKey    string
	updateBindingErr    error

	setPausedCalled bool
	setPausedValue  bool

	available bool
}

// testDeps implements the Deps interface using a real state.Manager, a real
// SQLite database, and a mock hotkey manager.
type testDeps struct {
	stateMgr *state.Manager
	db       *database.DB
	hk       *mockHotkeyMgr

	broadcastCalled    bool
	fileWriterDir      string
	fileWriterEnabled  bool
	fileWriterSetCalls int
}

func (d *testDeps) StateManager() *state.Manager          { return d.stateMgr }
func (d *testDeps) DB() *database.DB                      { return d.db }
func (d *testDeps) SetDB(db *database.DB)                 { d.db = db; d.stateMgr.SetDB(db) }
func (d *testDeps) BroadcastState()                       { d.broadcastCalled = true }
func (d *testDeps) FileWriterSetConfig(dir string, on bool) {
	d.fileWriterDir = dir
	d.fileWriterEnabled = on
	d.fileWriterSetCalls++
}

func (d *testDeps) HotkeyUpdateAllBindings(hm state.HotkeyMap) error {
	d.hk.updateAllCalled = true
	d.hk.updateAllHM = hm
	return d.hk.updateAllErr
}
func (d *testDeps) HotkeyUpdateBinding(action, key string) error {
	d.hk.updateBindingCalled = true
	d.hk.updateBindingAction = action
	d.hk.updateBindingKey = key
	return d.hk.updateBindingErr
}
func (d *testDeps) HotkeySetPaused(paused bool) {
	d.hk.setPausedCalled = true
	d.hk.setPausedValue = paused
}
func (d *testDeps) HotkeyIsAvailable() bool {
	return d.hk.available
}
func (d *testDeps) DispatchHotkeyAction(_, _ string) {}

// --- Helpers -----------------------------------------------------------------

// newTestMux creates a ServeMux with the settings routes registered, backed by
// a real SQLite database and an in-memory state manager.
func newTestMux(t *testing.T) (*http.ServeMux, *testDeps) {
	t.Helper()
	dir := t.TempDir()
	sm := state.NewManager(dir)
	db, err := database.Open(filepath.Join(dir, testDBName))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	sm.SetDB(db)

	deps := &testDeps{
		stateMgr: sm,
		db:       db,
		hk:       &mockHotkeyMgr{available: true},
	}
	mux := http.NewServeMux()
	RegisterRoutes(mux, deps)
	return mux, deps
}

// jsonBody returns a request body reader for the given JSON string.
func jsonBody(s string) *strings.Reader {
	return strings.NewReader(s)
}

// decodeJSON unmarshals the recorder body into v.
func decodeJSON(t *testing.T, w *httptest.ResponseRecorder, v any) {
	t.Helper()
	if err := json.NewDecoder(w.Body).Decode(v); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
}

// --- UpdateSettings ----------------------------------------------------------

// TestUpdateSettingsValidJSON verifies that a valid settings payload is
// accepted, the state manager is updated, file writer is reconfigured, and
// state is broadcast.
func TestUpdateSettingsValidJSON(t *testing.T) {
	mux, deps := newTestMux(t)

	body := `{"output_enabled":true,"output_dir":"/tmp/out"}`
	req := httptest.NewRequest(http.MethodPost, pathSettings, jsonBody(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(wantStatus200Body, w.Code, w.Body.String())
	}

	var got state.Settings
	decodeJSON(t, w, &got)
	if !got.OutputEnabled {
		t.Error("OutputEnabled = false, want true")
	}
	if got.OutputDir != "/tmp/out" {
		t.Errorf("OutputDir = %q, want /tmp/out", got.OutputDir)
	}
	// Verify side effects
	if !deps.broadcastCalled {
		t.Error(msgBroadcastNot)
	}
	if deps.fileWriterSetCalls != 1 {
		t.Errorf("FileWriterSetConfig called %d times, want 1", deps.fileWriterSetCalls)
	}
	if deps.fileWriterDir != "/tmp/out" {
		t.Errorf("FileWriterSetConfig dir = %q, want /tmp/out", deps.fileWriterDir)
	}
	if !deps.fileWriterEnabled {
		t.Error("FileWriterSetConfig enabled = false, want true")
	}

	// Verify state manager received the update
	st := deps.stateMgr.GetState()
	if !st.Settings.OutputEnabled {
		t.Error("state manager settings not updated")
	}
}

// TestUpdateSettingsInvalidJSON verifies that malformed JSON returns 400.
func TestUpdateSettingsInvalidJSON(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, pathSettings, jsonBody("{bad"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(wantStatus400, w.Code)
	}

	var errResp struct{ Error string }
	decodeJSON(t, w, &errResp)
	if errResp.Error == "" {
		t.Error("expected non-empty error message")
	}
}

// TestUpdateSettingsEmptyBody verifies that an empty body returns 400.
func TestUpdateSettingsEmptyBody(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, pathSettings, strings.NewReader(""))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(wantStatus400, w.Code)
	}
}

// --- SetConfigPath -----------------------------------------------------------

// TestSetConfigPathValidPath verifies that setting a valid config path
// succeeds and returns the new path. Uses a no-DB setup because the handler
// closes the current DB before calling SetConfigDir, which internally calls
// Save -- a real DB would fail on the closed handle.
func TestSetConfigPathValidPath(t *testing.T) {
	dir := t.TempDir()
	sm := state.NewManager(dir)
	deps := &testDeps{
		stateMgr: sm,
		hk:       &mockHotkeyMgr{available: true},
	}
	mux := http.NewServeMux()
	RegisterRoutes(mux, deps)

	newDir := t.TempDir()
	body := `{"path":"` + strings.ReplaceAll(newDir, `\`, `\\`) + `"}`
	req := httptest.NewRequest(http.MethodPost, pathConfigPath, jsonBody(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(wantStatus200Body, w.Code, w.Body.String())
	}

	var got pathResponse
	decodeJSON(t, w, &got)
	if got.Path != newDir {
		t.Errorf("path = %q, want %q", got.Path, newDir)
	}

	if !deps.broadcastCalled {
		t.Error(msgBroadcastNot)
	}
}

// TestSetConfigPathValidPathWithDB verifies the full flow including DB close
// and reopen at the new path.
func TestSetConfigPathValidPathWithDB(t *testing.T) {
	mux, deps := newTestMux(t)

	// Clear the state manager's DB reference so Save() falls back to JSON,
	// simulating what happens when the handler closes the old DB.
	deps.stateMgr.SetDB(nil)

	newDir := t.TempDir()
	body := `{"path":"` + strings.ReplaceAll(newDir, `\`, `\\`) + `"}`
	req := httptest.NewRequest(http.MethodPost, pathConfigPath, jsonBody(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(wantStatus200Body, w.Code, w.Body.String())
	}

	// A new DB should have been opened at the new path
	if deps.db == nil {
		t.Error("DB was not set after config path change")
	} else {
		t.Cleanup(func() { _ = deps.db.Close() })
	}
}

// TestSetConfigPathEmptyPath verifies that an empty path returns 400.
func TestSetConfigPathEmptyPath(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, pathConfigPath, jsonBody(`{"path":""}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(wantStatus400, w.Code)
	}

	var errResp struct{ Error string }
	decodeJSON(t, w, &errResp)
	if errResp.Error != "path is required" {
		t.Errorf("error = %q, want %q", errResp.Error, "path is required")
	}
}

// TestSetConfigPathInvalidJSON verifies that invalid JSON returns 400.
func TestSetConfigPathInvalidJSON(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, pathConfigPath, jsonBody("{bad"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(wantStatus400, w.Code)
	}
}

// --- UpdateHotkeys -----------------------------------------------------------

// TestUpdateHotkeysValidMap verifies that a valid hotkey map is accepted,
// the state is updated, and bindings are re-registered.
func TestUpdateHotkeysValidMap(t *testing.T) {
	mux, deps := newTestMux(t)

	body := `{"increment":"F5","decrement":"F6","reset":"F7","next_pokemon":"F8"}`
	req := httptest.NewRequest(http.MethodPost, "/api/hotkeys", jsonBody(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(wantStatus200Body, w.Code, w.Body.String())
	}

	var got state.HotkeyMap
	decodeJSON(t, w, &got)
	if got.Increment != "F5" {
		t.Errorf("Increment = %q, want F5", got.Increment)
	}
	if got.Decrement != "F6" {
		t.Errorf("Decrement = %q, want F6", got.Decrement)
	}
	if got.Reset != "F7" {
		t.Errorf("Reset = %q, want F7", got.Reset)
	}
	if got.NextPokemon != "F8" {
		t.Errorf("NextPokemon = %q, want F8", got.NextPokemon)
	}

	// Verify side effects
	if !deps.hk.updateAllCalled {
		t.Error("HotkeyUpdateAllBindings was not called")
	}
	if deps.hk.updateAllHM.Increment != "F5" {
		t.Errorf("passed hotkey map Increment = %q, want F5", deps.hk.updateAllHM.Increment)
	}
	if !deps.broadcastCalled {
		t.Error(msgBroadcastNot)
	}

	// Verify state manager received the update
	st := deps.stateMgr.GetState()
	if st.Hotkeys.Increment != "F5" {
		t.Errorf("state hotkeys.Increment = %q, want F5", st.Hotkeys.Increment)
	}
}

// TestUpdateHotkeysInvalidBody verifies that malformed JSON returns 400.
func TestUpdateHotkeysInvalidBody(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, "/api/hotkeys", jsonBody("not json"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(wantStatus400, w.Code)
	}
}

// --- UpdateSingleHotkey ------------------------------------------------------

// TestUpdateSingleHotkeyValid verifies that updating a single known hotkey
// action succeeds.
func TestUpdateSingleHotkeyValid(t *testing.T) {
	mux, deps := newTestMux(t)

	req := httptest.NewRequest(http.MethodPut, pathHotkeysIncr, jsonBody(`{"key":"F9"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(wantStatus200Body, w.Code, w.Body.String())
	}

	var got hotkeyUpdateResponse
	decodeJSON(t, w, &got)
	if got.Action != "increment" {
		t.Errorf("action = %q, want increment", got.Action)
	}
	if got.Key != "F9" {
		t.Errorf("key = %q, want F9", got.Key)
	}

	if !deps.hk.updateBindingCalled {
		t.Error("HotkeyUpdateBinding was not called")
	}
	if deps.hk.updateBindingAction != "increment" {
		t.Errorf("binding action = %q, want increment", deps.hk.updateBindingAction)
	}
	if deps.hk.updateBindingKey != "F9" {
		t.Errorf("binding key = %q, want F9", deps.hk.updateBindingKey)
	}

	st := deps.stateMgr.GetState()
	if st.Hotkeys.Increment != "F9" {
		t.Errorf("state hotkeys.Increment = %q, want F9", st.Hotkeys.Increment)
	}
}

// TestUpdateSingleHotkeyUnknownAction verifies that an unknown action
// returns 404.
func TestUpdateSingleHotkeyUnknownAction(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPut, "/api/hotkeys/nonexistent", jsonBody(`{"key":"F9"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", w.Code)
	}

	var errResp struct{ Error string }
	decodeJSON(t, w, &errResp)
	if errResp.Error != "unknown hotkey action" {
		t.Errorf("error = %q, want %q", errResp.Error, "unknown hotkey action")
	}
}

// TestUpdateSingleHotkeyInvalidJSON verifies that malformed JSON returns 400.
func TestUpdateSingleHotkeyInvalidJSON(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPut, pathHotkeysIncr, jsonBody("{bad"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(wantStatus400, w.Code)
	}
}

// TestUpdateSingleHotkeyBindingError verifies that a hotkey binding error
// returns 400.
func TestUpdateSingleHotkeyBindingError(t *testing.T) {
	mux, deps := newTestMux(t)
	deps.hk.updateBindingErr = errBindingFailed

	req := httptest.NewRequest(http.MethodPut, pathHotkeysIncr, jsonBody(`{"key":"F9"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(wantStatus400, w.Code)
	}
}

// TestUpdateSingleHotkeyMethodNotAllowed verifies that non-PUT methods
// return 405 for single hotkey endpoints.
func TestUpdateSingleHotkeyMethodNotAllowed(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, pathHotkeysIncr, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(wantStatus405, w.Code)
	}
}

// --- HotkeysPause ------------------------------------------------------------

// TestHotkeysPauseSuccess verifies that pausing hotkeys sets the paused flag.
func TestHotkeysPauseSuccess(t *testing.T) {
	mux, deps := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, pathHotkeysPause, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(wantStatus200, w.Code)
	}

	var got statusResponse
	decodeJSON(t, w, &got)
	if got.Status != "paused" {
		t.Errorf("status = %q, want paused", got.Status)
	}

	if !deps.hk.setPausedCalled {
		t.Error("HotkeySetPaused was not called")
	}
	if !deps.hk.setPausedValue {
		t.Error("HotkeySetPaused called with false, want true")
	}
}

// TestHotkeysPauseMethodNotAllowed verifies that GET returns 405.
func TestHotkeysPauseMethodNotAllowed(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, pathHotkeysPause, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(wantStatus405, w.Code)
	}
}

// --- HotkeysResume -----------------------------------------------------------

// TestHotkeysResumeSuccess verifies that resuming hotkeys clears the paused
// flag.
func TestHotkeysResumeSuccess(t *testing.T) {
	mux, deps := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, pathHotkeysResume, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(wantStatus200, w.Code)
	}

	var got statusResponse
	decodeJSON(t, w, &got)
	if got.Status != "active" {
		t.Errorf("status = %q, want active", got.Status)
	}

	if !deps.hk.setPausedCalled {
		t.Error("HotkeySetPaused was not called")
	}
	if deps.hk.setPausedValue {
		t.Error("HotkeySetPaused called with true, want false")
	}
}

// TestHotkeysResumeMethodNotAllowed verifies that GET returns 405.
func TestHotkeysResumeMethodNotAllowed(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, pathHotkeysResume, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(wantStatus405, w.Code)
	}
}

// --- HotkeysStatus -----------------------------------------------------------

// TestHotkeysStatusAvailable verifies that when the backend is available, the
// response reflects it.
func TestHotkeysStatusAvailable(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, pathHotkeysStatus, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(wantStatus200, w.Code)
	}

	var got hotkeysStatusResponse
	decodeJSON(t, w, &got)
	if !got.Available {
		t.Error("available = false, want true")
	}
}

// TestHotkeysStatusUnavailable verifies that when the backend is unavailable,
// the response reflects it.
func TestHotkeysStatusUnavailable(t *testing.T) {
	mux, deps := newTestMux(t)
	deps.hk.available = false

	req := httptest.NewRequest(http.MethodGet, pathHotkeysStatus, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(wantStatus200, w.Code)
	}

	var got hotkeysStatusResponse
	decodeJSON(t, w, &got)
	if got.Available {
		t.Error("available = true, want false")
	}
}

// errBindingFailed is a sentinel error for testing hotkey binding failures.
var errBindingFailed = &bindingError{"binding failed"}

// bindingError is a simple error type for tests.
type bindingError struct{ msg string }

func (e *bindingError) Error() string { return e.msg }
