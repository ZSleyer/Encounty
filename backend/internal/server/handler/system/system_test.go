// Package system tests the system-level HTTP handlers (state, sessions,
// version, licenses, overlay state, ready status, setup, quit, restart).
package system

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// Duplicated test format strings and paths (S1192).
const (
	fmtStatusWant200 = "status = %d, want 200"
	fmtStatusWant405 = "status = %d, want 405"

	versionPath      = "/api/version"
	setupOfflinePath = "/api/setup/offline"
	quitPath         = "/api/quit"
	restartPath      = "/api/restart"
	overlayStatePath = "/api/overlay/state"
)

// testDeps implements the Deps interface for testing.
type testDeps struct {
	stateMgr     *state.Manager
	version      string
	commit       string
	buildDate    string
	ready        bool
	devMode      bool
	setupPending bool

	broadcastCalled   bool
	stopHotkeysCalled bool
	saveStateCalled   bool
	setupOnlineCalled bool
	setupOfflineErr   error

	saveStateErr error
}

func (d *testDeps) StateManager() *state.Manager          { return d.stateMgr }
func (d *testDeps) VersionInfo() (string, string, string) { return d.version, d.commit, d.buildDate }
func (d *testDeps) IsReady() bool                         { return d.ready }
func (d *testDeps) IsDevMode() bool                       { return d.devMode }
func (d *testDeps) IsSetupPending() bool                  { return d.setupPending }
func (d *testDeps) RunSetupOnline()                       { d.setupOnlineCalled = true }
func (d *testDeps) RunSetupOffline() error                { return d.setupOfflineErr }
func (d *testDeps) BroadcastState()                       { d.broadcastCalled = true }
func (d *testDeps) StopHotkeys()                          { d.stopHotkeysCalled = true }
func (d *testDeps) SaveState() error                      { d.saveStateCalled = true; return d.saveStateErr }

// newTestMux creates a test HTTP mux with the system routes registered.
func newTestMux(t *testing.T) (*http.ServeMux, *testDeps) {
	t.Helper()
	dir := t.TempDir()
	sm := state.NewManager(dir)
	deps := &testDeps{
		stateMgr:  sm,
		version:   "1.2.3",
		commit:    "abc1234",
		buildDate: "2025-01-01",
		ready:     true,
	}
	mux := http.NewServeMux()
	RegisterRoutes(mux, deps)
	return mux, deps
}

func TestGetState(t *testing.T) {
	mux, deps := newTestMux(t)

	deps.stateMgr.AddPokemon(state.Pokemon{
		ID:         "p1",
		Name:       "Pikachu",
		Encounters: 10,
		CreatedAt:  time.Now(),
	})

	req := httptest.NewRequest(http.MethodGet, "/api/state", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code)
	}

	var st state.AppState
	if err := json.NewDecoder(w.Body).Decode(&st); err != nil {
		t.Fatal(err)
	}
	if len(st.Pokemon) != 1 {
		t.Fatalf("got %d pokemon, want 1", len(st.Pokemon))
	}
	if st.Pokemon[0].Name != "Pikachu" {
		t.Errorf("name = %q, want Pikachu", st.Pokemon[0].Name)
	}
}

func TestGetSessions(t *testing.T) {
	mux, deps := newTestMux(t)

	now := time.Now()
	deps.stateMgr.AddSession(state.Session{
		ID:         "s1",
		PokemonID:  "p1",
		StartedAt:  now,
		Encounters: 5,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/sessions", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code)
	}

	var sessions []state.Session
	if err := json.NewDecoder(w.Body).Decode(&sessions); err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 {
		t.Fatalf("got %d sessions, want 1", len(sessions))
	}
}

func TestGetVersion(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, versionPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code)
	}

	var resp versionResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Version != "1.2.3" {
		t.Errorf("version = %q, want 1.2.3", resp.Version)
	}
	if resp.Commit != "abc1234" {
		t.Errorf("commit = %q, want abc1234", resp.Commit)
	}
	if resp.BuildDate != "2025-01-01" {
		t.Errorf("build_date = %q, want 2025-01-01", resp.BuildDate)
	}
	if resp.Display != "1.2.3-abc1234" {
		t.Errorf("display = %q, want 1.2.3-abc1234", resp.Display)
	}
}

func TestGetVersionDevMode(t *testing.T) {
	mux, deps := newTestMux(t)
	deps.version = "dev"
	deps.commit = "deadbeef"

	req := httptest.NewRequest(http.MethodGet, versionPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code)
	}

	var resp versionResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Display != "dev-deadbeef" {
		t.Errorf("display = %q, want dev-deadbeef", resp.Display)
	}
}

func TestGetLicenses(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, "/api/licenses", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code)
	}

	// The response should be valid JSON (array of license entries)
	ct := w.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
}

func TestAcceptLicense(t *testing.T) {
	mux, deps := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, "/api/license/accept", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code)
	}

	var resp licenseAcceptResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if !resp.LicenseAccepted {
		t.Error("expected license_accepted = true")
	}
	if !deps.broadcastCalled {
		t.Error("expected BroadcastState to be called")
	}

	// Verify state was updated
	st := deps.stateMgr.GetState()
	if !st.LicenseAccepted {
		t.Error("expected state.LicenseAccepted = true")
	}
}

func TestAcceptLicenseMethodNotAllowed(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, "/api/license/accept", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(fmtStatusWant405, w.Code)
	}
}

func TestReadyStatus(t *testing.T) {
	mux, deps := newTestMux(t)
	deps.ready = true
	deps.devMode = true
	deps.setupPending = false

	req := httptest.NewRequest(http.MethodGet, "/api/status/ready", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code)
	}

	var resp readyStatusResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if !resp.Ready {
		t.Error("expected ready = true")
	}
	if !resp.DevMode {
		t.Error("expected dev_mode = true")
	}
	if resp.SetupPending {
		t.Error("expected setup_pending = false")
	}
}

func TestReadyStatusNotReady(t *testing.T) {
	mux, deps := newTestMux(t)
	deps.ready = false
	deps.setupPending = true

	req := httptest.NewRequest(http.MethodGet, "/api/status/ready", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code)
	}

	var resp readyStatusResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Ready {
		t.Error("expected ready = false")
	}
	if !resp.SetupPending {
		t.Error("expected setup_pending = true")
	}
}

func TestSetupOnline(t *testing.T) {
	mux, deps := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, "/api/setup/online", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code)
	}
	if !deps.setupOnlineCalled {
		t.Error("expected RunSetupOnline to be called")
	}

	var resp statusResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Status != "sync started" {
		t.Errorf("status = %q, want 'sync started'", resp.Status)
	}
}

func TestSetupOfflineSuccess(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, setupOfflinePath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code)
	}

	var resp statusResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Status != "offline setup complete" {
		t.Errorf("status = %q, want 'offline setup complete'", resp.Status)
	}
}

func TestSetupOfflineError(t *testing.T) {
	mux, deps := newTestMux(t)
	deps.setupOfflineErr = errors.New("seed failed")

	req := httptest.NewRequest(http.MethodPost, setupOfflinePath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", w.Code)
	}
}

func TestQuit(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, quitPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code)
	}

	var resp statusResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Status != "shutting down" {
		t.Errorf("status = %q, want 'shutting down'", resp.Status)
	}
}

func TestQuitMethodNotAllowed(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, quitPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(fmtStatusWant405, w.Code)
	}
}

func TestRestart(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, restartPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code)
	}

	var resp statusResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Status != "restarting" {
		t.Errorf("status = %q, want 'restarting'", resp.Status)
	}
}

func TestRestartMethodNotAllowed(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, restartPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(fmtStatusWant405, w.Code)
	}
}

func TestOverlayStateNoActive(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, overlayStatePath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code)
	}

	var resp overlayStateResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.ActivePokemon != nil {
		t.Error("expected nil active_pokemon when none is active")
	}
	if resp.ActiveID != "" {
		t.Errorf("active_id = %q, want empty", resp.ActiveID)
	}
}

func TestOverlayStateWithMultiplePokemon(t *testing.T) {
	mux, deps := newTestMux(t)

	deps.stateMgr.AddPokemon(state.Pokemon{
		ID:         "p1",
		Name:       "Charmander",
		Encounters: 99,
		CreatedAt:  time.Now(),
	})
	deps.stateMgr.AddPokemon(state.Pokemon{
		ID:         "p2",
		Name:       "Squirtle",
		Encounters: 50,
		CreatedAt:  time.Now(),
	})
	// Set active to p2
	deps.stateMgr.SetActive("p2")

	req := httptest.NewRequest(http.MethodGet, overlayStatePath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code)
	}

	var resp overlayStateResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.ActiveID != "p2" {
		t.Errorf("active_id = %q, want p2", resp.ActiveID)
	}
	if resp.ActivePokemon == nil || resp.ActivePokemon.Name != "Squirtle" {
		t.Error("expected Squirtle as active pokemon")
	}
}

// --- RegisterRoutes verification ---------------------------------------------

func TestRegisterRoutesSystem(t *testing.T) {
	mux, _ := newTestMux(t)

	routes := []string{
		"/api/state",
		"/api/sessions",
		versionPath,
		"/api/licenses",
		overlayStatePath,
	}
	for _, route := range routes {
		req := httptest.NewRequest(http.MethodGet, route, nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code == http.StatusNotFound {
			t.Errorf("route %s not registered (got 404)", route)
		}
	}
}

// --- Quit and Restart method checks ------------------------------------------

func TestQuitMethodPut(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPut, quitPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(fmtStatusWant405, w.Code)
	}
}

func TestRestartMethodPut(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPut, restartPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(fmtStatusWant405, w.Code)
	}
}

// --- SetupOffline with specific error ----------------------------------------

func TestSetupOfflineSpecificError(t *testing.T) {
	mux, deps := newTestMux(t)
	deps.setupOfflineErr = errors.New("disk full")

	req := httptest.NewRequest(http.MethodPost, setupOfflinePath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", w.Code)
	}

	// Verify error message is in response
	body := w.Body.String()
	if !contains(body, "disk full") {
		t.Errorf("response body %q should contain 'disk full'", body)
	}
}

// contains checks if substr is in s (helper to avoid importing strings).
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsHelper(s, substr))
}

func containsHelper(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

func TestOverlayStateWithActive(t *testing.T) {
	mux, deps := newTestMux(t)

	deps.stateMgr.AddPokemon(state.Pokemon{
		ID:         "p1",
		Name:       "Charmander",
		Encounters: 99,
		CreatedAt:  time.Now(),
	})
	deps.stateMgr.SetActive("p1")

	req := httptest.NewRequest(http.MethodGet, overlayStatePath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code)
	}

	var resp overlayStateResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.ActiveID != "p1" {
		t.Errorf("active_id = %q, want p1", resp.ActiveID)
	}
	if resp.ActivePokemon == nil {
		t.Fatal("expected non-nil active_pokemon")
	}
	if resp.ActivePokemon.Name != "Charmander" {
		t.Errorf("name = %q, want Charmander", resp.ActivePokemon.Name)
	}
}
