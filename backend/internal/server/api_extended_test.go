package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/gamesync"
	"github.com/zsleyer/encounty/backend/internal/state"
)

const (
	fmtStatusWant = "status = %d, want %d"
	fmtUnmarshal  = "unmarshal: %v"
)

// --- handleUpdatePokemon ---

func TestHandleUpdatePokemonValid(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	mux := newTestMux(srv)

	body := `{"name":"Raichu","canonical_name":"raichu"}`
	req := httptest.NewRequest(http.MethodPut, "/api/pokemon/p1", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(fmtStatusWant, w.Code, http.StatusOK)
	}

	st := srv.state.GetState()
	if st.Pokemon[0].Name != "Raichu" {
		t.Errorf("Name = %q, want %q", st.Pokemon[0].Name, "Raichu")
	}
	if st.Pokemon[0].CanonicalName != "raichu" {
		t.Errorf("CanonicalName = %q, want %q", st.Pokemon[0].CanonicalName, "raichu")
	}
}

func TestHandleUpdatePokemonNotFound(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	body := `{"name":"Raichu"}`
	req := httptest.NewRequest(http.MethodPut, "/api/pokemon/nonexistent", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(fmtStatusWant, w.Code, http.StatusNotFound)
	}
}

// --- handleDeletePokemon ---

func TestHandleDeletePokemonValid(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodDelete, "/api/pokemon/p1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf(fmtStatusWant, w.Code, http.StatusNoContent)
	}

	st := srv.state.GetState()
	if len(st.Pokemon) != 0 {
		t.Errorf("Pokemon length = %d, want 0", len(st.Pokemon))
	}
}

func TestHandleDeletePokemonNotFound(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodDelete, "/api/pokemon/nonexistent", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(fmtStatusWant, w.Code, http.StatusNotFound)
	}
}

// --- handleCompletePokemon ---

func TestHandleCompletePokemonValid(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/complete", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf(fmtStatusWant, w.Code, http.StatusNoContent)
	}

	st := srv.state.GetState()
	if st.Pokemon[0].CompletedAt == nil {
		t.Error("CompletedAt should be set after completing")
	}
}

func TestHandleCompletePokemonNotFound(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/nonexistent/complete", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(fmtStatusWant, w.Code, http.StatusNotFound)
	}
}

// --- handleUncompletePokemon ---

func TestHandleUncompletePokemonValid(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")

	// Complete first, then uncomplete
	srv.state.CompletePokemon("p1")
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/uncomplete", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf(fmtStatusWant, w.Code, http.StatusNoContent)
	}

	st := srv.state.GetState()
	if st.Pokemon[0].CompletedAt != nil {
		t.Error("CompletedAt should be nil after uncompleting")
	}
}

func TestHandleUncompletePokemonNotFound(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/nonexistent/uncomplete", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(fmtStatusWant, w.Code, http.StatusNotFound)
	}
}

// --- handleGetSessions ---

func TestHandleGetSessionsEmpty(t *testing.T) {
	srv := newTestServer(t)

	mux := newTestMux(srv)
	req := httptest.NewRequest(http.MethodGet, "/api/sessions", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(fmtStatusWant, w.Code, http.StatusOK)
	}

	var sessions []state.Session
	if err := json.Unmarshal(w.Body.Bytes(), &sessions); err != nil {
		t.Fatalf(fmtUnmarshal, err)
	}
	if len(sessions) != 0 {
		t.Errorf("sessions length = %d, want 0", len(sessions))
	}
}

func TestHandleGetSessionsWithData(t *testing.T) {
	srv := newTestServer(t)
	srv.state.AddSession(state.Session{ID: "s1", PokemonID: "p1", Encounters: 10})

	mux := newTestMux(srv)
	req := httptest.NewRequest(http.MethodGet, "/api/sessions", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(fmtStatusWant, w.Code, http.StatusOK)
	}

	var sessions []state.Session
	if err := json.Unmarshal(w.Body.Bytes(), &sessions); err != nil {
		t.Fatalf(fmtUnmarshal, err)
	}
	if len(sessions) != 1 {
		t.Fatalf("sessions length = %d, want 1", len(sessions))
	}
	if sessions[0].ID != "s1" {
		t.Errorf("session ID = %q, want %q", sessions[0].ID, "s1")
	}
}

// --- handleUpdateHotkeys ---

func TestHandleUpdateHotkeysValid(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	body := `{"increment":"F5","decrement":"F6","reset":"F7","next_pokemon":"F8"}`
	req := httptest.NewRequest(http.MethodPost, "/api/hotkeys", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(fmtStatusWant, w.Code, http.StatusOK)
	}

	st := srv.state.GetState()
	if st.Hotkeys.Increment != "F5" {
		t.Errorf("Increment = %q, want %q", st.Hotkeys.Increment, "F5")
	}
	if st.Hotkeys.Decrement != "F6" {
		t.Errorf("Decrement = %q, want %q", st.Hotkeys.Decrement, "F6")
	}
}

func TestHandleUpdateHotkeysInvalidJSON(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodPost, "/api/hotkeys", bytes.NewBufferString("{bad"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(fmtStatusWant, w.Code, http.StatusBadRequest)
	}
}

// --- handleUpdateSingleHotkey ---

func TestHandleUpdateSingleHotkeyValid(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	body := `{"key":"F9"}`
	req := httptest.NewRequest(http.MethodPut, "/api/hotkeys/increment", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(fmtStatusWant, w.Code, http.StatusOK)
	}

	var resp map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf(fmtUnmarshal, err)
	}
	if resp["action"] != "increment" {
		t.Errorf("action = %q, want %q", resp["action"], "increment")
	}
	if resp["key"] != "F9" {
		t.Errorf("key = %q, want %q", resp["key"], "F9")
	}

	st := srv.state.GetState()
	if st.Hotkeys.Increment != "F9" {
		t.Errorf("Hotkeys.Increment = %q, want %q", st.Hotkeys.Increment, "F9")
	}
}

func TestHandleUpdateSingleHotkeyUnknownAction(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	body := `{"key":"F9"}`
	req := httptest.NewRequest(http.MethodPut, "/api/hotkeys/nonexistent", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(fmtStatusWant, w.Code, http.StatusNotFound)
	}
}

// --- handleOverlayState ---

func TestHandleOverlayStateWithActivePokemon(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.SetActive("p1")

	mux := newTestMux(srv)
	req := httptest.NewRequest(http.MethodGet, "/api/overlay/state", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(fmtStatusWant, w.Code, http.StatusOK)
	}

	var resp map[string]json.RawMessage
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf(fmtUnmarshal, err)
	}

	// active_id should be "p1"
	var activeID string
	if err := json.Unmarshal(resp["active_id"], &activeID); err != nil {
		t.Fatalf("unmarshal active_id: %v", err)
	}
	if activeID != "p1" {
		t.Errorf("active_id = %q, want %q", activeID, "p1")
	}

	// active_pokemon should not be null
	if string(resp["active_pokemon"]) == "null" {
		t.Error("active_pokemon should not be null when a pokemon is active")
	}
}

func TestHandleOverlayStateNoActivePokemon(t *testing.T) {
	srv := newTestServer(t)

	mux := newTestMux(srv)
	req := httptest.NewRequest(http.MethodGet, "/api/overlay/state", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(fmtStatusWant, w.Code, http.StatusOK)
	}

	var resp map[string]json.RawMessage
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf(fmtUnmarshal, err)
	}

	if string(resp["active_pokemon"]) != "null" {
		t.Errorf("active_pokemon should be null, got %s", resp["active_pokemon"])
	}
}

// --- handleUnlinkOverlay ---

func TestHandleUnlinkOverlayValid(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	mux := newTestMux(srv)

	// The pokemon starts with default overlay mode; unlinking copies the
	// resolved overlay and sets mode to "custom".
	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/overlay/unlink", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf(fmtStatusWant, w.Code, http.StatusNoContent)
	}

	st := srv.state.GetState()
	if st.Pokemon[0].OverlayMode != "custom" {
		t.Errorf("OverlayMode = %q, want %q", st.Pokemon[0].OverlayMode, "custom")
	}
	if st.Pokemon[0].Overlay == nil {
		t.Error("Overlay should not be nil after unlinking")
	}
}

func TestHandleUnlinkOverlayNotFound(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/nonexistent/overlay/unlink", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(fmtStatusWant, w.Code, http.StatusNotFound)
	}
}

// --- handleGetGames (via mux) ---

func TestHandleGetGames(t *testing.T) {
	// Reset the cached games so this test gets a clean state.
	gamesync.InvalidateCache()

	srv := newTestServer(t)
	mux := http.NewServeMux()
	srv.registerRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/games", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(fmtStatusWant, w.Code, http.StatusOK)
	}

	// The response should be valid JSON (either a list or null)
	var raw json.RawMessage
	if err := json.Unmarshal(w.Body.Bytes(), &raw); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
}

// --- handleGetHuntTypes (via mux) ---

func TestHandleGetHuntTypes(t *testing.T) {
	srv := newTestServer(t)
	mux := http.NewServeMux()
	srv.registerRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/hunt-types", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(fmtStatusWant, w.Code, http.StatusOK)
	}

	var presets []state.HuntTypePreset
	if err := json.Unmarshal(w.Body.Bytes(), &presets); err != nil {
		t.Fatalf(fmtUnmarshal, err)
	}
	if len(presets) == 0 {
		t.Error("expected at least one hunt type preset")
	}
	// Verify the first known preset key
	if presets[0].Key != "encounter" {
		t.Errorf("first preset key = %q, want %q", presets[0].Key, "encounter")
	}
}

// --- handleHotkeysPause / Resume / Status ---

func TestHandlePauseResumeLifecycle(t *testing.T) {
	srv := newTestServer(t)
	hkMock := srv.hotkeyMgr.(*mockHotkeyMgr)
	mux := newTestMux(srv)

	// Pause
	req := httptest.NewRequest(http.MethodPost, "/api/hotkeys/pause", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("pause status = %d, want %d", w.Code, http.StatusOK)
	}
	if !hkMock.paused {
		t.Error("hotkey manager should be paused after pause call")
	}

	var pauseResp map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &pauseResp); err != nil {
		t.Fatalf("unmarshal pause: %v", err)
	}
	if pauseResp["status"] != "paused" {
		t.Errorf("pause status = %q, want %q", pauseResp["status"], "paused")
	}

	// Resume
	req = httptest.NewRequest(http.MethodPost, "/api/hotkeys/resume", nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("resume status = %d, want %d", w.Code, http.StatusOK)
	}
	if hkMock.paused {
		t.Error("hotkey manager should not be paused after resume call")
	}

	var resumeResp map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &resumeResp); err != nil {
		t.Fatalf("unmarshal resume: %v", err)
	}
	if resumeResp["status"] != "active" {
		t.Errorf("resume status = %q, want %q", resumeResp["status"], "active")
	}
}

func TestHandlePauseWrongMethod(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodGet, "/api/hotkeys/pause", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(fmtStatusWant, w.Code, http.StatusMethodNotAllowed)
	}
}

func TestHandleResumeWrongMethod(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodGet, "/api/hotkeys/resume", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(fmtStatusWant, w.Code, http.StatusMethodNotAllowed)
	}
}

func TestHandleStatusAvailable(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodGet, "/api/hotkeys/status", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(fmtStatusWant, w.Code, http.StatusOK)
	}

	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf(fmtUnmarshal, err)
	}
	available, ok := resp["available"].(bool)
	if !ok {
		t.Fatal("available should be a boolean")
	}
	if !available {
		t.Error("mock hotkey manager should report available=true")
	}
}

// --- handleLicenses ---

func TestHandleLicenses(t *testing.T) {
	srv := newTestServer(t)

	mux := newTestMux(srv)
	req := httptest.NewRequest(http.MethodGet, "/api/licenses", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(fmtStatusWant, w.Code, http.StatusOK)
	}

	// The response should be valid JSON (a list of license entries)
	var raw json.RawMessage
	if err := json.Unmarshal(w.Body.Bytes(), &raw); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
}
