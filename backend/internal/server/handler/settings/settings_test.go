// Package settings tests the HTTP handlers for application settings and hotkey
// management endpoints.
package settings

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// String constants extracted to satisfy S1192 (no duplicated literals).
const (
	testDBName = "encounty.db"

	pathSettings      = "/api/settings"
	pathDBPath        = "/api/settings/db-path"
	pathHotkeysIncr   = "/api/hotkeys/increment"
	pathHotkeysPause  = "/api/hotkeys/pause"
	pathHotkeysResume = "/api/hotkeys/resume"
	pathHotkeysStatus = "/api/hotkeys/status"

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

func (d *testDeps) StateManager() *state.Manager { return d.stateMgr }
func (d *testDeps) ConfigDir() string            { return d.stateMgr.GetConfigDir() }
func (d *testDeps) DB() *database.DB             { return d.db }
func (d *testDeps) SetDB(db *database.DB) {
	d.db = db
	// Mirrors Server.SetDB: a typed nil pointer must not reach the manager as a
	// non-nil StateStore.
	if db == nil {
		d.stateMgr.SetDB(nil)
		return
	}
	d.stateMgr.SetDB(db)
}
func (d *testDeps) BroadcastState() { d.broadcastCalled = true }
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
func (d *testDeps) DispatchHotkeyAction(_, _ string) { /* no-op: satisfies interface */ }

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

// --- SetDBPath ---------------------------------------------------------------

// postDBPath sends a database relocation request for dir.
func postDBPath(t *testing.T, mux *http.ServeMux, dir string) *httptest.ResponseRecorder {
	t.Helper()
	body := `{"path":"` + strings.ReplaceAll(dir, `\`, `\\`) + `"}`
	req := httptest.NewRequest(http.MethodPost, pathDBPath, jsonBody(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	return w
}

// TestSetDBPathMovesDatabase verifies the whole move: the database ends up at
// the target, the old file and its sidecars are gone, the location is recorded,
// and the config directory stays where it was.
func TestSetDBPathMovesDatabase(t *testing.T) {
	mux, deps := newTestMux(t)
	configDir := deps.stateMgr.GetConfigDir()
	deps.stateMgr.AddPokemon(state.Pokemon{ID: "p1", Name: "Pikachu"})

	newDir := t.TempDir()
	w := postDBPath(t, mux, newDir)
	if w.Code != http.StatusOK {
		t.Fatalf(wantStatus200Body, w.Code, w.Body.String())
	}
	if deps.db == nil {
		t.Fatal("no database handle after the move")
	}
	t.Cleanup(func() { _ = deps.db.Close() })

	var got pathResponse
	decodeJSON(t, w, &got)
	if got.Path != newDir {
		t.Errorf("path = %q, want %q", got.Path, newDir)
	}
	if _, err := os.Stat(filepath.Join(newDir, testDBName)); err != nil {
		t.Errorf("database missing at the new location: %v", err)
	}
	// A real move: nothing of the database is left behind.
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if _, err := os.Stat(filepath.Join(configDir, testDBName+suffix)); !os.IsNotExist(err) {
			t.Errorf("%s%s still present at the old location (err = %v)", testDBName, suffix, err)
		}
	}
	if recorded, err := state.ReadDBDir(configDir); err != nil || recorded != newDir {
		t.Errorf("recorded location = %q, %v; want %q", recorded, err, newDir)
	}
	if got := deps.stateMgr.GetConfigDir(); got != configDir {
		t.Errorf("GetConfigDir = %q, want it unchanged at %q", got, configDir)
	}
	if got := deps.stateMgr.GetDBDir(); got != newDir {
		t.Errorf("GetDBDir = %q, want %q", got, newDir)
	}
	if got := deps.stateMgr.GetState().DataPath; got != newDir {
		t.Errorf("data_path = %q, want %q", got, newDir)
	}
	// The manager must still hold a live handle (regression guard for #84).
	if err := deps.stateMgr.Save(); err != nil {
		t.Errorf("Save after the move failed: %v", err)
	}
	if !deps.broadcastCalled {
		t.Error(msgBroadcastNot)
	}
}

// TestSetDBPathMovesDefaultOutputDir verifies that the OBS text output follows
// the database when it sits at its default place, and that the stale directory
// is cleaned up.
func TestSetDBPathMovesDefaultOutputDir(t *testing.T) {
	mux, deps := newTestMux(t)
	configDir := deps.stateMgr.GetConfigDir()

	oldOutput := filepath.Join(configDir, "output")
	if err := os.MkdirAll(oldOutput, 0755); err != nil {
		t.Fatal(err)
	}
	deps.stateMgr.UpdateSettings(state.Settings{OutputDir: oldOutput, OutputEnabled: true})

	newDir := t.TempDir()
	if w := postDBPath(t, mux, newDir); w.Code != http.StatusOK {
		t.Fatalf(wantStatus200Body, w.Code, w.Body.String())
	}
	t.Cleanup(func() { _ = deps.db.Close() })

	wantOutput := filepath.Join(newDir, "output")
	if got := deps.stateMgr.GetState().Settings.OutputDir; got != wantOutput {
		t.Errorf("OutputDir = %q, want %q", got, wantOutput)
	}
	if deps.fileWriterDir != wantOutput || !deps.fileWriterEnabled {
		t.Errorf("writer reconfigured to %q (enabled=%v), want %q (enabled=true)",
			deps.fileWriterDir, deps.fileWriterEnabled, wantOutput)
	}
	if _, err := os.Stat(oldOutput); !os.IsNotExist(err) {
		t.Errorf("previous output directory still present (err = %v)", err)
	}
}

// TestSetDBPathKeepsCustomOutputDir verifies that a directory the user picked
// themselves is left alone by a database move.
func TestSetDBPathKeepsCustomOutputDir(t *testing.T) {
	mux, deps := newTestMux(t)

	custom := filepath.Join(t.TempDir(), "obs")
	if err := os.MkdirAll(custom, 0755); err != nil {
		t.Fatal(err)
	}
	deps.stateMgr.UpdateSettings(state.Settings{OutputDir: custom, OutputEnabled: true})

	newDir := t.TempDir()
	if w := postDBPath(t, mux, newDir); w.Code != http.StatusOK {
		t.Fatalf(wantStatus200Body, w.Code, w.Body.String())
	}
	t.Cleanup(func() { _ = deps.db.Close() })

	if got := deps.stateMgr.GetState().Settings.OutputDir; got != custom {
		t.Errorf("OutputDir = %q, want the untouched %q", got, custom)
	}
	if _, err := os.Stat(custom); err != nil {
		t.Errorf("custom output directory was removed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(newDir, "output")); !os.IsNotExist(err) {
		t.Errorf("an output directory was created at the new location (err = %v)", err)
	}
}

// TestSetDBPathLeavesConfigDirAlone verifies that caches and template files are
// not dragged along: only the database moves.
func TestSetDBPathLeavesConfigDirAlone(t *testing.T) {
	mux, deps := newTestMux(t)
	configDir := deps.stateMgr.GetConfigDir()

	cache := filepath.Join(configDir, "sprite-cache")
	if err := os.MkdirAll(cache, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cache, "sprite"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	newDir := t.TempDir()
	if w := postDBPath(t, mux, newDir); w.Code != http.StatusOK {
		t.Fatalf(wantStatus200Body, w.Code, w.Body.String())
	}
	t.Cleanup(func() { _ = deps.db.Close() })

	if _, err := os.Stat(filepath.Join(cache, "sprite")); err != nil {
		t.Errorf("cache file left the config dir: %v", err)
	}
	if _, err := os.Stat(filepath.Join(newDir, "sprite-cache")); !os.IsNotExist(err) {
		t.Errorf("cache was copied to the new location (err = %v)", err)
	}
}

// TestSetDBPathBackToConfigDir verifies that moving back removes the record
// rather than recording the default location.
func TestSetDBPathBackToConfigDir(t *testing.T) {
	mux, deps := newTestMux(t)
	configDir := deps.stateMgr.GetConfigDir()

	newDir := t.TempDir()
	if w := postDBPath(t, mux, newDir); w.Code != http.StatusOK {
		t.Fatalf(wantStatus200Body, w.Code, w.Body.String())
	}
	if w := postDBPath(t, mux, configDir); w.Code != http.StatusOK {
		t.Fatalf(wantStatus200Body, w.Code, w.Body.String())
	}
	t.Cleanup(func() { _ = deps.db.Close() })

	if recorded, err := state.ReadDBDir(configDir); err != nil || recorded != "" {
		t.Errorf("record = %q, %v; want it removed", recorded, err)
	}
	if _, err := os.Stat(filepath.Join(configDir, testDBName)); err != nil {
		t.Errorf("database missing back at the config dir: %v", err)
	}
	if _, err := os.Stat(filepath.Join(newDir, testDBName)); !os.IsNotExist(err) {
		t.Errorf("database still present at the intermediate location (err = %v)", err)
	}
}

// TestSetDBPathSameDirIsNoOp verifies that re-selecting the current directory
// changes nothing.
func TestSetDBPathSameDirIsNoOp(t *testing.T) {
	mux, deps := newTestMux(t)
	configDir := deps.stateMgr.GetConfigDir()

	if w := postDBPath(t, mux, configDir); w.Code != http.StatusOK {
		t.Fatalf(wantStatus200Body, w.Code, w.Body.String())
	}
	if _, err := os.Stat(filepath.Join(configDir, testDBName)); err != nil {
		t.Errorf("database disappeared: %v", err)
	}
	if recorded, _ := state.ReadDBDir(configDir); recorded != "" {
		t.Errorf("record = %q, want none for a no-op", recorded)
	}
	if err := deps.stateMgr.Save(); err != nil {
		t.Errorf("Save after a no-op failed: %v", err)
	}
}

// TestSetDBPathRejectsExistingDatabase verifies that a foreign database at the
// target is never overwritten.
func TestSetDBPathRejectsExistingDatabase(t *testing.T) {
	mux, deps := newTestMux(t)
	newDir := t.TempDir()
	foreign := filepath.Join(newDir, testDBName)
	if err := os.WriteFile(foreign, []byte("not ours"), 0644); err != nil {
		t.Fatal(err)
	}

	if w := postDBPath(t, mux, newDir); w.Code != http.StatusBadRequest {
		t.Fatalf(wantStatus400, w.Code)
	}
	data, err := os.ReadFile(foreign)
	if err != nil || string(data) != "not ours" {
		t.Errorf("foreign database was touched: %q, %v", string(data), err)
	}
	if got := deps.stateMgr.GetDBDir(); got != deps.stateMgr.GetConfigDir() {
		t.Errorf("GetDBDir = %q, want the unchanged config dir", got)
	}
	if err := deps.stateMgr.Save(); err != nil {
		t.Errorf("Save after a rejected move failed: %v", err)
	}
}

// TestSetDBPathRollsBackOnFailure verifies that an unusable target leaves the
// app working at the previous location, with nothing deleted.
func TestSetDBPathRollsBackOnFailure(t *testing.T) {
	mux, deps := newTestMux(t)
	configDir := deps.stateMgr.GetConfigDir()

	// A regular file cannot host a directory, on any platform.
	blocker := filepath.Join(t.TempDir(), "blocker")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	if w := postDBPath(t, mux, filepath.Join(blocker, "encounty")); w.Code != http.StatusBadRequest {
		t.Fatalf(wantStatus400, w.Code)
	}
	if got := deps.stateMgr.GetDBDir(); got != configDir {
		t.Errorf("GetDBDir = %q, want the unchanged %q", got, configDir)
	}
	if _, err := os.Stat(filepath.Join(configDir, testDBName)); err != nil {
		t.Errorf("database was removed on a failed move: %v", err)
	}
	if recorded, _ := state.ReadDBDir(configDir); recorded != "" {
		t.Errorf("record = %q, want none after a failed move", recorded)
	}
	if deps.db == nil {
		t.Fatal("database was not left attached")
	}
	t.Cleanup(func() { _ = deps.db.Close() })
	if err := deps.stateMgr.Save(); err != nil {
		t.Errorf("Save after a failed move failed: %v", err)
	}
}

// TestSetDBPathRejectsRelativePath verifies that a path resolved against the
// working directory is refused: the recorded location has to survive a start
// from anywhere.
func TestSetDBPathRejectsRelativePath(t *testing.T) {
	mux, deps := newTestMux(t)
	configDir := deps.stateMgr.GetConfigDir()

	if w := postDBPath(t, mux, "encounty-data"); w.Code != http.StatusBadRequest {
		t.Fatalf(wantStatus400, w.Code)
	}
	if got := deps.stateMgr.GetDBDir(); got != configDir {
		t.Errorf("GetDBDir = %q, want the unchanged %q", got, configDir)
	}
	if _, err := os.Stat(filepath.Join(configDir, testDBName)); err != nil {
		t.Errorf("database was touched: %v", err)
	}
}

// TestSetDBPathEmptyPath verifies that an empty path returns 400.
func TestSetDBPathEmptyPath(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, pathDBPath, jsonBody(`{"path":""}`))
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

// TestSetDBPathInvalidJSON verifies that invalid JSON returns 400.
func TestSetDBPathInvalidJSON(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, pathDBPath, jsonBody("{bad"))
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

// TestUpdateSingleHotkeyHuntToggle verifies that updating the hunt_toggle
// action succeeds and the state reflects the new binding.
func TestUpdateSingleHotkeyHuntToggle(t *testing.T) {
	mux, deps := newTestMux(t)

	req := httptest.NewRequest(http.MethodPut, "/api/hotkeys/hunt_toggle", jsonBody(`{"key":"F10"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(wantStatus200Body, w.Code, w.Body.String())
	}

	var got hotkeyUpdateResponse
	decodeJSON(t, w, &got)
	if got.Action != "hunt_toggle" {
		t.Errorf("action = %q, want hunt_toggle", got.Action)
	}
	if got.Key != "F10" {
		t.Errorf("key = %q, want F10", got.Key)
	}

	st := deps.stateMgr.GetState()
	if st.Hotkeys.HuntToggle != "F10" {
		t.Errorf("state hotkeys.HuntToggle = %q, want F10", st.Hotkeys.HuntToggle)
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

// --- UpdateCaptureResolution -------------------------------------------------

const pathCaptureRes = "/api/capture/resolution"

// TestUpdateCaptureResolutionValid verifies a valid payload is stored on the
// state manager and broadcast.
func TestUpdateCaptureResolutionValid(t *testing.T) {
	mux, deps := newTestMux(t)

	req := httptest.NewRequest(http.MethodPut, pathCaptureRes, jsonBody(`{"device_key":"cam-1","resolution":"1080"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(wantStatus200Body, w.Code, w.Body.String())
	}
	if !deps.broadcastCalled {
		t.Error(msgBroadcastNot)
	}
	if got := deps.stateMgr.GetState().Settings.CaptureResolutions["cam-1"]; got != "1080" {
		t.Errorf("CaptureResolutions[cam-1] = %q, want 1080", got)
	}
}

// TestUpdateCaptureResolutionEmptyRemoves verifies an empty resolution removes
// a previously stored entry.
func TestUpdateCaptureResolutionEmptyRemoves(t *testing.T) {
	mux, deps := newTestMux(t)
	deps.stateMgr.SetCaptureResolution("cam-1", "1080")

	req := httptest.NewRequest(http.MethodPut, pathCaptureRes, jsonBody(`{"device_key":"cam-1","resolution":""}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(wantStatus200Body, w.Code, w.Body.String())
	}
	if _, ok := deps.stateMgr.GetState().Settings.CaptureResolutions["cam-1"]; ok {
		t.Error("entry should have been removed for empty resolution")
	}
}

// TestUpdateCaptureResolutionErrors covers the rejected inputs.
func TestUpdateCaptureResolutionErrors(t *testing.T) {
	mux, _ := newTestMux(t)

	cases := []struct {
		name   string
		method string
		body   string
		want   int
	}{
		{"invalid resolution", http.MethodPut, `{"device_key":"cam-1","resolution":"4k"}`, http.StatusBadRequest},
		{"missing device_key", http.MethodPut, `{"resolution":"1080"}`, http.StatusBadRequest},
		{"malformed json", http.MethodPut, "{bad", http.StatusBadRequest},
		{"wrong method", http.MethodGet, "", http.StatusMethodNotAllowed},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, pathCaptureRes, jsonBody(tc.body))
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Errorf("status = %d, want %d; body = %s", w.Code, tc.want, w.Body.String())
			}
		})
	}
}

// errBindingFailed is a sentinel error for testing hotkey binding failures.
var errBindingFailed = &bindingError{"binding failed"}

// bindingError is a simple error type for tests.
type bindingError struct{ msg string }

func (e *bindingError) Error() string { return e.msg }
