package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/fileoutput"
	"github.com/zsleyer/encounty/backend/internal/state"
)

const (
	fmtEncWant1  = "encounters = %d, want 1"
	fmtEncWant0  = "encounters = %d, want 0"
	fmtStatus    = "status = %d, want %d"
)

// makeWSMessage creates a WSMessage with the given type and JSON payload.
func makeWSMessage(t *testing.T, msgType string, payload any) WSMessage {
	t.Helper()
	p, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return WSMessage{Type: msgType, Payload: p}
}

// --- handleWSMessage: increment ---

func TestHandleWSMessageIncrement(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")

	msg := makeWSMessage(t, "increment", map[string]string{"pokemon_id": "p1"})
	srv.handleWSMessage(msg)

	st := srv.state.GetState()
	if st.Pokemon[0].Encounters != 1 {
		t.Errorf(fmtEncWant1, st.Pokemon[0].Encounters)
	}
}

func TestHandleWSMessageIncrementNotFound(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")

	msg := makeWSMessage(t, "increment", map[string]string{"pokemon_id": "nonexistent"})
	srv.handleWSMessage(msg)

	st := srv.state.GetState()
	if st.Pokemon[0].Encounters != 0 {
		t.Errorf("encounters = %d, want 0 (increment on wrong id)", st.Pokemon[0].Encounters)
	}
}

func TestHandleWSMessageIncrementEmptyID(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")

	msg := makeWSMessage(t, "increment", map[string]string{"pokemon_id": ""})
	srv.handleWSMessage(msg)

	st := srv.state.GetState()
	if st.Pokemon[0].Encounters != 0 {
		t.Errorf("encounters = %d, want 0 (empty id)", st.Pokemon[0].Encounters)
	}
}

func TestHandleWSMessageIncrementInvalidPayload(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")

	msg := WSMessage{Type: "increment", Payload: json.RawMessage(`{invalid`)}
	srv.handleWSMessage(msg)

	st := srv.state.GetState()
	if st.Pokemon[0].Encounters != 0 {
		t.Errorf(fmtEncWant0, st.Pokemon[0].Encounters)
	}
}

// --- handleWSMessage: decrement ---

func TestHandleWSMessageDecrement(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.Increment("p1")
	srv.state.Increment("p1")

	msg := makeWSMessage(t, "decrement", map[string]string{"pokemon_id": "p1"})
	srv.handleWSMessage(msg)

	st := srv.state.GetState()
	if st.Pokemon[0].Encounters != 1 {
		t.Errorf(fmtEncWant1, st.Pokemon[0].Encounters)
	}
}

func TestHandleWSMessageDecrementNotFound(t *testing.T) {
	srv := newTestServer(t)
	msg := makeWSMessage(t, "decrement", map[string]string{"pokemon_id": "nonexistent"})
	srv.handleWSMessage(msg)
}

func TestHandleWSMessageDecrementEmptyID(t *testing.T) {
	srv := newTestServer(t)
	msg := makeWSMessage(t, "decrement", map[string]string{"pokemon_id": ""})
	srv.handleWSMessage(msg)
}

// --- handleWSMessage: reset ---

func TestHandleWSMessageReset(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.Increment("p1")
	srv.state.Increment("p1")

	msg := makeWSMessage(t, "reset", map[string]string{"pokemon_id": "p1"})
	srv.handleWSMessage(msg)

	st := srv.state.GetState()
	if st.Pokemon[0].Encounters != 0 {
		t.Errorf("encounters = %d, want 0 after reset", st.Pokemon[0].Encounters)
	}
}

func TestHandleWSMessageResetNotFound(t *testing.T) {
	srv := newTestServer(t)
	msg := makeWSMessage(t, "reset", map[string]string{"pokemon_id": "nonexistent"})
	srv.handleWSMessage(msg)
}

func TestHandleWSMessageResetEmptyID(t *testing.T) {
	srv := newTestServer(t)
	msg := makeWSMessage(t, "reset", map[string]string{"pokemon_id": ""})
	srv.handleWSMessage(msg)
}

// --- handleWSMessage: set_active ---

func TestHandleWSMessageSetActive(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	addTestPokemon(t, srv, "p2", "Charmander")

	msg := makeWSMessage(t, "set_active", map[string]string{"pokemon_id": "p2"})
	srv.handleWSMessage(msg)

	st := srv.state.GetState()
	if st.ActiveID != "p2" {
		t.Errorf("ActiveID = %q, want %q", st.ActiveID, "p2")
	}
}

func TestHandleWSMessageSetActiveEmptyID(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")

	msg := makeWSMessage(t, "set_active", map[string]string{"pokemon_id": ""})
	srv.handleWSMessage(msg)

	st := srv.state.GetState()
	if st.ActiveID != "p1" {
		t.Errorf("ActiveID = %q, want %q (should not change)", st.ActiveID, "p1")
	}
}

// --- handleWSMessage: complete ---

func TestHandleWSMessageComplete(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")

	msg := makeWSMessage(t, "complete", map[string]string{"pokemon_id": "p1"})
	srv.handleWSMessage(msg)

	st := srv.state.GetState()
	if st.Pokemon[0].CompletedAt == nil {
		t.Error("CompletedAt should be set after complete")
	}
}

func TestHandleWSMessageCompleteNotFound(t *testing.T) {
	srv := newTestServer(t)
	msg := makeWSMessage(t, "complete", map[string]string{"pokemon_id": "nonexistent"})
	srv.handleWSMessage(msg)
}

func TestHandleWSMessageCompleteEmptyID(t *testing.T) {
	srv := newTestServer(t)
	msg := makeWSMessage(t, "complete", map[string]string{"pokemon_id": ""})
	srv.handleWSMessage(msg)
}

// --- handleWSMessage: uncomplete ---

func TestHandleWSMessageUncomplete(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.CompletePokemon("p1")

	msg := makeWSMessage(t, "uncomplete", map[string]string{"pokemon_id": "p1"})
	srv.handleWSMessage(msg)

	st := srv.state.GetState()
	if st.Pokemon[0].CompletedAt != nil {
		t.Error("CompletedAt should be nil after uncomplete")
	}
}

func TestHandleWSMessageUncompleteEmptyID(t *testing.T) {
	srv := newTestServer(t)
	msg := makeWSMessage(t, "uncomplete", map[string]string{"pokemon_id": ""})
	srv.handleWSMessage(msg)
}

// --- handleWSMessage: unknown type ---

func TestHandleWSMessageUnknownType(t *testing.T) {
	srv := newTestServer(t)
	msg := makeWSMessage(t, "unknown_action", map[string]string{"pokemon_id": "p1"})
	srv.handleWSMessage(msg)
}

// --- handleWSMessage with fileWriter (covers fileWriter != nil branches) ---

func TestHandleWSMessageIncrementWithFileWriter(t *testing.T) {
	srv := newTestServer(t)
	dir := t.TempDir()
	srv.fileWriter = fileoutput.New(dir, true)
	addTestPokemon(t, srv, "p1", "Pikachu")

	msg := makeWSMessage(t, "increment", map[string]string{"pokemon_id": "p1"})
	srv.handleWSMessage(msg)

	st := srv.state.GetState()
	if st.Pokemon[0].Encounters != 1 {
		t.Errorf(fmtEncWant1, st.Pokemon[0].Encounters)
	}
}

func TestHandleWSMessageDecrementWithFileWriter(t *testing.T) {
	srv := newTestServer(t)
	dir := t.TempDir()
	srv.fileWriter = fileoutput.New(dir, true)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.Increment("p1")

	msg := makeWSMessage(t, "decrement", map[string]string{"pokemon_id": "p1"})
	srv.handleWSMessage(msg)

	st := srv.state.GetState()
	if st.Pokemon[0].Encounters != 0 {
		t.Errorf(fmtEncWant0, st.Pokemon[0].Encounters)
	}
}

func TestHandleWSMessageResetWithFileWriter(t *testing.T) {
	srv := newTestServer(t)
	dir := t.TempDir()
	srv.fileWriter = fileoutput.New(dir, true)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.Increment("p1")

	msg := makeWSMessage(t, "reset", map[string]string{"pokemon_id": "p1"})
	srv.handleWSMessage(msg)

	st := srv.state.GetState()
	if st.Pokemon[0].Encounters != 0 {
		t.Errorf(fmtEncWant0, st.Pokemon[0].Encounters)
	}
}

// --- REST handlers with fileWriter (covers the fileWriter != nil branches) ---

func TestHandleIncrementWithFileWriter(t *testing.T) {
	srv := newTestServer(t)
	dir := t.TempDir()
	srv.fileWriter = fileoutput.New(dir, true)
	srv.state.AddPokemon(state.Pokemon{ID: "p1", Name: "Pikachu", CreatedAt: time.Now()})

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/increment", nil)
	w := httptest.NewRecorder()
	mux := newTestMux(srv)
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(fmtStatus, w.Code, http.StatusOK)
	}
}

func TestHandleDecrementWithFileWriter(t *testing.T) {
	srv := newTestServer(t)
	dir := t.TempDir()
	srv.fileWriter = fileoutput.New(dir, true)
	srv.state.AddPokemon(state.Pokemon{ID: "p1", Name: "Pikachu", CreatedAt: time.Now()})
	srv.state.Increment("p1")

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/decrement", nil)
	w := httptest.NewRecorder()
	mux := newTestMux(srv)
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(fmtStatus, w.Code, http.StatusOK)
	}
}

func TestHandleResetWithFileWriter(t *testing.T) {
	srv := newTestServer(t)
	dir := t.TempDir()
	srv.fileWriter = fileoutput.New(dir, true)
	srv.state.AddPokemon(state.Pokemon{ID: "p1", Name: "Pikachu", CreatedAt: time.Now()})
	srv.state.Increment("p1")

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/reset", nil)
	w := httptest.NewRecorder()
	mux := newTestMux(srv)
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf(fmtStatus, w.Code, http.StatusNoContent)
	}
}

// --- handleUpdateSettings with fileWriter ---

func TestHandleUpdateSettingsWithFileWriter(t *testing.T) {
	srv := newTestServer(t)
	dir := t.TempDir()
	srv.fileWriter = fileoutput.New(dir, true)
	mux := newTestMux(srv)

	body := `{"output_enabled":false,"output_dir":"/tmp/new","overlay":{}}`
	req := httptest.NewRequest(http.MethodPost, "/api/settings", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(fmtStatus, w.Code, http.StatusOK)
	}
}

// --- handleUpdateSingleHotkey invalid JSON ---

func TestHandleUpdateSingleHotkeyInvalidJSON(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodPut, "/api/hotkeys/increment", bytes.NewBufferString("{bad"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(fmtStatus, w.Code, http.StatusBadRequest)
	}
}

// --- handleUpdatePokemon invalid JSON ---

func TestHandleUpdatePokemonInvalidJSON(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodPut, "/api/pokemon/p1", bytes.NewBufferString("{bad"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(fmtStatus, w.Code, http.StatusBadRequest)
	}
}
