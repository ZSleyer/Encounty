package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/hotkeys"
	"github.com/zsleyer/encounty/backend/internal/state"
)

const (
	fmtUnmarshalErr   = "unmarshal: %v"
	pathAPIPokemon    = "/api/pokemon/"
	testPokemonIDPath = "abc-123"
)

// mockHotkeyMgr implements hotkeys.Manager for testing.
type mockHotkeyMgr struct {
	actions chan hotkeys.Action
	paused  bool
}

func newMockHotkeyMgr() *mockHotkeyMgr {
	return &mockHotkeyMgr{actions: make(chan hotkeys.Action)}
}

func (m *mockHotkeyMgr) Start() error { return nil }
func (m *mockHotkeyMgr) Stop() { // no-op for test
}
func (m *mockHotkeyMgr) SetPaused(paused bool)                       { m.paused = paused }
func (m *mockHotkeyMgr) UpdateBinding(action, keyCombo string) error { return nil }
func (m *mockHotkeyMgr) UpdateAllBindings(hm state.HotkeyMap) error  { return nil }
func (m *mockHotkeyMgr) IsAvailable() bool                           { return true }
func (m *mockHotkeyMgr) Actions() <-chan hotkeys.Action              { return m.actions }

// newTestMux creates an http.ServeMux with all routes registered for srv.
func newTestMux(srv *Server) *http.ServeMux {
	mux := http.NewServeMux()
	srv.registerRoutes(mux)
	return mux
}

// newTestServer creates a Server wired up for testing with no frontend FS,
// no file writer, and a mock hotkey manager.
func newTestServer(t *testing.T) *Server {
	t.Helper()
	stateMgr := state.NewManager(t.TempDir())
	hkMgr := newMockHotkeyMgr()
	srv := &Server{
		state:     stateMgr,
		hub:       NewHub(),
		hotkeyMgr: hkMgr,
		version:   "1.0.0",
		commit:    "abc1234",
		buildDate: "032026",
	}
	return srv
}

func addTestPokemon(t *testing.T, srv *Server, id, name string) {
	t.Helper()
	srv.state.AddPokemon(state.Pokemon{
		ID:        id,
		Name:      name,
		CreatedAt: time.Now(),
	})
}

func TestHandleGetState(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")

	mux := newTestMux(srv)
	req := httptest.NewRequest(http.MethodGet, "/api/state", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(fmtStatusWant, w.Code, http.StatusOK)
	}

	var st state.AppState
	if err := json.Unmarshal(w.Body.Bytes(), &st); err != nil {
		t.Fatalf(fmtUnmarshalErr, err)
	}
	if len(st.Pokemon) != 1 {
		t.Errorf("Pokemon length = %d, want 1", len(st.Pokemon))
	}
}

func TestHandleAddPokemonValid(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	body := `{"name":"Charmander","canonical_name":"charmander"}`
	req := httptest.NewRequest(http.MethodPost, "/api/pokemon", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf(fmtStatusWant, w.Code, http.StatusCreated)
	}

	st := srv.state.GetState()
	if len(st.Pokemon) != 1 {
		t.Fatalf("Pokemon length = %d, want 1", len(st.Pokemon))
	}
	if st.Pokemon[0].Name != "Charmander" {
		t.Errorf("Name = %q, want %q", st.Pokemon[0].Name, "Charmander")
	}
	// ID should have been assigned
	if st.Pokemon[0].ID == "" {
		t.Error("ID should have been assigned")
	}
}

func TestHandleAddPokemonInvalidJSON(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon", bytes.NewBufferString("{invalid"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(fmtStatusWant, w.Code, http.StatusBadRequest)
	}
}

func TestHandleIncrementValid(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/increment", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(fmtStatusWant, w.Code, http.StatusOK)
	}

	var resp map[string]int
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf(fmtUnmarshalErr, err)
	}
	if resp["count"] != 1 {
		t.Errorf("count = %d, want 1", resp["count"])
	}
}

func TestHandleIncrementNotFound(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/nonexistent/increment", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(fmtStatusWant, w.Code, http.StatusNotFound)
	}
}

func TestHandleDecrementValid(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.Increment("p1")
	srv.state.Increment("p1")
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/decrement", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(fmtStatusWant, w.Code, http.StatusOK)
	}

	var resp map[string]int
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf(fmtUnmarshalErr, err)
	}
	if resp["count"] != 1 {
		t.Errorf("count = %d, want 1", resp["count"])
	}
}

func TestHandleDecrementNotFound(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/nonexistent/decrement", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(fmtStatusWant, w.Code, http.StatusNotFound)
	}
}

func TestHandleResetValid(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.Increment("p1")
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/reset", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf(fmtStatusWant, w.Code, http.StatusNoContent)
	}

	st := srv.state.GetState()
	if st.Pokemon[0].Encounters != 0 {
		t.Errorf("Encounters = %d, want 0", st.Pokemon[0].Encounters)
	}
}

func TestHandleResetNotFound(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/nonexistent/reset", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(fmtStatusWant, w.Code, http.StatusNotFound)
	}
}

func TestHandleActivateValid(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	addTestPokemon(t, srv, "p2", "Charmander")
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p2/activate", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf(fmtStatusWant, w.Code, http.StatusNoContent)
	}

	st := srv.state.GetState()
	if st.ActiveID != "p2" {
		t.Errorf("ActiveID = %q, want %q", st.ActiveID, "p2")
	}
}

func TestHandleActivateNotFound(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/nonexistent/activate", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(fmtStatusWant, w.Code, http.StatusNotFound)
	}
}

func TestHandleVersion(t *testing.T) {
	srv := newTestServer(t)

	mux := newTestMux(srv)
	req := httptest.NewRequest(http.MethodGet, "/api/version", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(fmtStatusWant, w.Code, http.StatusOK)
	}

	var resp map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf(fmtUnmarshalErr, err)
	}
	if resp["version"] != "1.0.0" {
		t.Errorf("version = %q, want %q", resp["version"], "1.0.0")
	}
	if resp["commit"] != "abc1234" {
		t.Errorf("commit = %q, want %q", resp["commit"], "abc1234")
	}
	if resp["display"] != "1.0.0-abc1234" {
		t.Errorf("display = %q, want %q", resp["display"], "1.0.0-abc1234")
	}
}

func TestHandleVersionDev(t *testing.T) {
	srv := newTestServer(t)
	srv.version = "dev"

	mux := newTestMux(srv)
	req := httptest.NewRequest(http.MethodGet, "/api/version", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	var resp map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf(fmtUnmarshalErr, err)
	}
	if resp["display"] != "dev-abc1234" {
		t.Errorf("display = %q, want %q", resp["display"], "dev-abc1234")
	}
}

func TestHandleUpdateSettings(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	body := `{"output_enabled":true,"output_dir":"/tmp/test","overlay":{}}`
	req := httptest.NewRequest(http.MethodPost, "/api/settings", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(fmtStatusWant, w.Code, http.StatusOK)
	}

	st := srv.state.GetState()
	if !st.Settings.OutputEnabled {
		t.Error("OutputEnabled should be true")
	}
}

func TestHandleUpdateSettingsInvalidJSON(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodPost, "/api/settings", bytes.NewBufferString("{bad"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(fmtStatusWant, w.Code, http.StatusBadRequest)
	}
}

func TestPokemonIDFromPath(t *testing.T) {
	tests := []struct {
		path   string
		prefix string
		suffix string
		want   string
	}{
		{"/api/pokemon/abc-123/increment", pathAPIPokemon, "/increment", testPokemonIDPath},
		{"/api/pokemon/abc-123", pathAPIPokemon, "", testPokemonIDPath},
		{"/api/pokemon/abc-123/", pathAPIPokemon, "", testPokemonIDPath},
	}
	for _, tt := range tests {
		got := PokemonIDFromPath(tt.path, tt.prefix, tt.suffix)
		if got != tt.want {
			t.Errorf("PokemonIDFromPath(%q, %q, %q) = %q, want %q",
				tt.path, tt.prefix, tt.suffix, got, tt.want)
		}
	}
}
