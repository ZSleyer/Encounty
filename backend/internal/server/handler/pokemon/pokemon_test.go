// Package pokemon tests the HTTP handlers for Pokemon CRUD operations and
// encounter mutations (increment, decrement, reset, set, timers, completion).
package pokemon

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// --- Mock types --------------------------------------------------------------

// mockDetectorStopper records calls to Stop for verification.
type mockDetectorStopper struct {
	stopped []string
}

// Stop records the pokemon ID that was requested to stop.
func (m *mockDetectorStopper) Stop(pokemonID string) {
	m.stopped = append(m.stopped, pokemonID)
}

// mockEncounterLogger records encounter log calls for verification.
type mockEncounterLogger struct {
	logged []encounterLogEntry
}

// encounterLogEntry captures the arguments passed to LogEncounter.
type encounterLogEntry struct {
	PokemonID   string
	PokemonName string
	Delta       int
	CountAfter  int
	Source      string
}

// LogEncounter records the encounter event for later assertion.
func (m *mockEncounterLogger) LogEncounter(pokemonID, pokemonName string, delta, countAfter int, source string) error {
	m.logged = append(m.logged, encounterLogEntry{
		PokemonID:   pokemonID,
		PokemonName: pokemonName,
		Delta:       delta,
		CountAfter:  countAfter,
		Source:      source,
	})
	return nil
}

// DeleteEncounterEvents is a no-op mock for clearing encounter events on reset.
func (m *mockEncounterLogger) DeleteEncounterEvents(_ string) error {
	return nil
}

// mockBroadcaster records broadcast calls for verification.
type mockBroadcaster struct {
	messages []broadcastMsg
}

// broadcastMsg captures the arguments passed to BroadcastRaw.
type broadcastMsg struct {
	MsgType string
	Payload any
}

// BroadcastRaw records the broadcast event.
func (m *mockBroadcaster) BroadcastRaw(msgType string, payload any) {
	m.messages = append(m.messages, broadcastMsg{MsgType: msgType, Payload: payload})
}

// --- testDeps ----------------------------------------------------------------

// testDeps implements the Deps interface using a real state.Manager and mock
// infrastructure components for isolated handler testing.
type testDeps struct {
	stateMgr    *state.Manager
	configDir   string
	detector    *mockDetectorStopper
	logger      *mockEncounterLogger
	broadcaster *mockBroadcaster
	saveCount   int
	broadcastN  int
}

// StateAddPokemon delegates to the real state manager.
func (d *testDeps) StateAddPokemon(p state.Pokemon) { d.stateMgr.AddPokemon(p) }

// StateUpdatePokemon delegates to the real state manager.
func (d *testDeps) StateUpdatePokemon(id string, update state.Pokemon) bool {
	return d.stateMgr.UpdatePokemon(id, update)
}

// StateDeletePokemon delegates to the real state manager.
func (d *testDeps) StateDeletePokemon(id string) bool { return d.stateMgr.DeletePokemon(id) }

// StateIncrement delegates to the real state manager.
func (d *testDeps) StateIncrement(id string) (int, bool) { return d.stateMgr.Increment(id) }

// StateDecrement delegates to the real state manager.
func (d *testDeps) StateDecrement(id string) (int, bool) { return d.stateMgr.Decrement(id) }

// StateReset delegates to the real state manager.
func (d *testDeps) StateReset(id string) bool { return d.stateMgr.Reset(id) }

// StateSetEncounters delegates to the real state manager.
func (d *testDeps) StateSetEncounters(id string, count int) (int, bool) {
	return d.stateMgr.SetEncounters(id, count)
}

// StateSetActive delegates to the real state manager.
func (d *testDeps) StateSetActive(id string) bool { return d.stateMgr.SetActive(id) }

// StateCompletePokemon delegates to the real state manager.
func (d *testDeps) StateCompletePokemon(id string) bool { return d.stateMgr.CompletePokemon(id) }

// StateUncompletePokemon delegates to the real state manager.
func (d *testDeps) StateUncompletePokemon(id string) bool {
	return d.stateMgr.UncompletePokemon(id)
}

// StateUnlinkOverlay delegates to the real state manager.
func (d *testDeps) StateUnlinkOverlay(pokemonID string) bool {
	return d.stateMgr.UnlinkOverlay(pokemonID)
}

// StateStartTimer delegates to the real state manager.
func (d *testDeps) StateStartTimer(id string) bool { return d.stateMgr.StartTimer(id) }

// StateStopTimer delegates to the real state manager.
func (d *testDeps) StateStopTimer(id string) bool { return d.stateMgr.StopTimer(id) }

// StateResetTimer delegates to the real state manager.
func (d *testDeps) StateResetTimer(id string) bool { return d.stateMgr.ResetTimer(id) }

// StateGetState delegates to the real state manager.
func (d *testDeps) StateGetState() state.AppState { return d.stateMgr.GetState() }

// StateScheduleSave increments the save counter for verification.
func (d *testDeps) StateScheduleSave() { d.saveCount++ }

// ConfigDir returns the temporary config directory.
func (d *testDeps) ConfigDir() string { return d.configDir }

// DetectorStopper returns the mock detector stopper.
func (d *testDeps) DetectorStopper() DetectorStopper { return d.detector }

// EncounterLogger returns the mock encounter logger.
func (d *testDeps) EncounterLogger() EncounterLogger { return d.logger }

// Broadcaster returns the mock broadcaster.
func (d *testDeps) Broadcaster() Broadcaster { return d.broadcaster }

// BroadcastState increments the broadcast counter for verification.
func (d *testDeps) BroadcastState() { d.broadcastN++ }

// --- Helpers -----------------------------------------------------------------

// newTestMux creates a test HTTP mux with all pokemon routes registered,
// backed by a real state.Manager and mock infrastructure.
func newTestMux(t *testing.T) (*http.ServeMux, *testDeps) {
	t.Helper()
	dir := t.TempDir()
	stateMgr := state.NewManager(dir)

	deps := &testDeps{
		stateMgr:    stateMgr,
		configDir:   dir,
		detector:    &mockDetectorStopper{},
		logger:      &mockEncounterLogger{},
		broadcaster: &mockBroadcaster{},
	}
	mux := http.NewServeMux()
	RegisterRoutes(mux, deps)
	return mux, deps
}

// addPokemon adds a Pokemon directly to the state manager for test setup.
func addPokemon(t *testing.T, deps *testDeps, id, name string) {
	t.Helper()
	deps.stateMgr.AddPokemon(state.Pokemon{
		ID:        id,
		Name:      name,
		CreatedAt: time.Now(),
	})
}

// jsonBody marshals v into a bytes.Buffer for use as a request body.
func jsonBody(t *testing.T, v any) *bytes.Buffer {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return bytes.NewBuffer(data)
}

// decodeJSON unmarshals the response body into v.
func decodeJSON(t *testing.T, rec *httptest.ResponseRecorder, v any) {
	t.Helper()
	if err := json.NewDecoder(rec.Body).Decode(v); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
}

const (
	fmtWantStatus   = "status = %d, want %d"
	fmtWantName     = "name = %q, want %q"
	fmtWantSaveCall = "expected StateScheduleSave to be called"
	pathPokemon     = "/api/pokemon"
	pathPokemonByP1 = "/api/pokemon/p1"
)

// --- GET /api/pokemon --------------------------------------------------------

// TestGetPokemonList verifies that GET /api/pokemon returns the current list.
func TestGetPokemonList(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodGet, pathPokemon, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusOK)
	}

	var list []state.Pokemon
	decodeJSON(t, w, &list)
	if len(list) != 1 {
		t.Fatalf("len = %d, want 1", len(list))
	}
	if list[0].Name != "Pikachu" {
		t.Errorf(fmtWantName, list[0].Name, "Pikachu")
	}
}

// TestGetPokemonListEmpty verifies that GET /api/pokemon returns an empty list
// when no Pokemon exist.
func TestGetPokemonListEmpty(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, pathPokemon, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusOK)
	}
}

// --- POST /api/pokemon (AddPokemon) ------------------------------------------

// TestAddPokemonSuccess verifies that a valid JSON body creates a new Pokemon.
func TestAddPokemonSuccess(t *testing.T) {
	mux, deps := newTestMux(t)

	body := jsonBody(t, map[string]any{"name": "Bulbasaur", "sprite_url": "http://example.com/bulbasaur.png"})
	req := httptest.NewRequest(http.MethodPost, pathPokemon, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusCreated)
	}

	var p state.Pokemon
	decodeJSON(t, w, &p)
	if p.Name != "Bulbasaur" {
		t.Errorf(fmtWantName, p.Name, "Bulbasaur")
	}
	if p.ID == "" {
		t.Error("expected generated UUID, got empty string")
	}
	if p.CreatedAt.IsZero() {
		t.Error("expected non-zero CreatedAt")
	}

	// Verify side effects
	if deps.saveCount == 0 {
		t.Error(fmtWantSaveCall)
	}
	if deps.broadcastN == 0 {
		t.Error("expected BroadcastState to be called")
	}

	// Verify state was updated
	st := deps.stateMgr.GetState()
	if len(st.Pokemon) != 1 {
		t.Fatalf("state has %d pokemon, want 1", len(st.Pokemon))
	}
}

// TestAddPokemonInvalidBody verifies that a malformed JSON body returns 400.
func TestAddPokemonInvalidBody(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, pathPokemon, bytes.NewBufferString("{invalid"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusBadRequest)
	}
}

// TestAddPokemonMethodNotAllowed verifies that unsupported methods return 405.
func TestAddPokemonMethodNotAllowed(t *testing.T) {
	mux, _ := newTestMux(t)

	for _, method := range []string{http.MethodPut, http.MethodDelete, http.MethodPatch} {
		req := httptest.NewRequest(method, pathPokemon, nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)

		if w.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s: status = %d, want 405", method, w.Code)
		}
	}
}

// --- PUT /api/pokemon/{id} (UpdatePokemon) -----------------------------------

// TestUpdatePokemonSuccess verifies that a valid update modifies the Pokemon.
func TestUpdatePokemonSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	body := jsonBody(t, map[string]any{"name": "Raichu"})
	req := httptest.NewRequest(http.MethodPut, pathPokemonByP1, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusOK)
	}

	var st state.AppState
	decodeJSON(t, w, &st)
	if len(st.Pokemon) != 1 {
		t.Fatalf("pokemon count = %d, want 1", len(st.Pokemon))
	}
	if st.Pokemon[0].Name != "Raichu" {
		t.Errorf(fmtWantName, st.Pokemon[0].Name, "Raichu")
	}

	if deps.saveCount == 0 {
		t.Error(fmtWantSaveCall)
	}
}

// TestUpdatePokemonNotFound verifies that updating a non-existent Pokemon returns 404.
func TestUpdatePokemonNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	body := jsonBody(t, map[string]any{"name": "Raichu"})
	req := httptest.NewRequest(http.MethodPut, "/api/pokemon/nonexistent", body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
}

// TestUpdatePokemonInvalidBody verifies that a malformed JSON body returns 400.
func TestUpdatePokemonInvalidBody(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodPut, pathPokemonByP1, bytes.NewBufferString("not-json"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusBadRequest)
	}
}

// --- DELETE /api/pokemon/{id} (DeletePokemon) --------------------------------

// TestDeletePokemonSuccess verifies that an existing Pokemon is deleted.
func TestDeletePokemonSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodDelete, pathPokemonByP1, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNoContent)
	}

	// Verify state is empty
	st := deps.stateMgr.GetState()
	if len(st.Pokemon) != 0 {
		t.Errorf("pokemon count = %d, want 0", len(st.Pokemon))
	}

	// Verify detector was stopped
	if len(deps.detector.stopped) != 1 || deps.detector.stopped[0] != "p1" {
		t.Errorf("detector.stopped = %v, want [p1]", deps.detector.stopped)
	}

	// Verify pokemon_deleted broadcast
	found := false
	for _, msg := range deps.broadcaster.messages {
		if msg.MsgType == "pokemon_deleted" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected pokemon_deleted broadcast")
	}
}

// TestDeletePokemonNotFound verifies that deleting a non-existent Pokemon returns 404.
func TestDeletePokemonNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodDelete, "/api/pokemon/nonexistent", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
}

// --- POST /api/pokemon/{id}/increment ----------------------------------------

// TestIncrementSuccess verifies that incrementing returns the new count.
func TestIncrementSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/increment", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusOK)
	}

	var resp countResponse
	decodeJSON(t, w, &resp)
	if resp.Count != 1 {
		t.Errorf("count = %d, want 1", resp.Count)
	}

	// Verify encounter was logged
	if len(deps.logger.logged) != 1 {
		t.Fatalf("logged %d encounters, want 1", len(deps.logger.logged))
	}
	if deps.logger.logged[0].Source != "api" {
		t.Errorf("source = %q, want %q", deps.logger.logged[0].Source, "api")
	}

	// Verify encounter_added broadcast
	found := false
	for _, msg := range deps.broadcaster.messages {
		if msg.MsgType == "encounter_added" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected encounter_added broadcast")
	}
}

// TestIncrementNotFound verifies that incrementing a non-existent Pokemon returns 404.
func TestIncrementNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/nonexistent/increment", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
}

// TestIncrementMultiple verifies that multiple increments accumulate correctly.
func TestIncrementMultiple(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	for i := range 3 {
		req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/increment", nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("increment %d: "+fmtWantStatus, i+1, w.Code, http.StatusOK)
		}
	}

	st := deps.stateMgr.GetState()
	if st.Pokemon[0].Encounters != 3 {
		t.Errorf("encounters = %d, want 3", st.Pokemon[0].Encounters)
	}
}

// --- POST /api/pokemon/{id}/decrement ----------------------------------------

// TestDecrementSuccess verifies that decrementing returns the new count.
func TestDecrementSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")
	deps.stateMgr.Increment("p1")
	deps.stateMgr.Increment("p1")

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/decrement", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusOK)
	}

	var resp countResponse
	decodeJSON(t, w, &resp)
	if resp.Count != 1 {
		t.Errorf("count = %d, want 1", resp.Count)
	}

	// Verify encounter_removed broadcast
	found := false
	for _, msg := range deps.broadcaster.messages {
		if msg.MsgType == "encounter_removed" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected encounter_removed broadcast")
	}
}

// TestDecrementNotFound verifies that decrementing a non-existent Pokemon returns 404.
func TestDecrementNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/nonexistent/decrement", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
}

// TestDecrementFloorsAtZero verifies that decrementing at zero stays at zero.
func TestDecrementFloorsAtZero(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/decrement", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusOK)
	}

	var resp countResponse
	decodeJSON(t, w, &resp)
	if resp.Count != 0 {
		t.Errorf("count = %d, want 0", resp.Count)
	}
}

// --- POST /api/pokemon/{id}/reset --------------------------------------------

// TestResetSuccess verifies that resetting zeros out the encounter count.
func TestResetSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")
	deps.stateMgr.Increment("p1")
	deps.stateMgr.Increment("p1")

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/reset", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNoContent)
	}

	st := deps.stateMgr.GetState()
	if st.Pokemon[0].Encounters != 0 {
		t.Errorf("encounters = %d, want 0", st.Pokemon[0].Encounters)
	}

	// Verify encounter_reset broadcast
	found := false
	for _, msg := range deps.broadcaster.messages {
		if msg.MsgType == "encounter_reset" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected encounter_reset broadcast")
	}
}

// TestResetNotFound verifies that resetting a non-existent Pokemon returns 404.
func TestResetNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/nonexistent/reset", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
}

// --- POST /api/pokemon/{id}/set_encounters -----------------------------------

// TestSetEncountersSuccess verifies that setting encounters to an exact value works.
func TestSetEncountersSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	body := jsonBody(t, setEncountersRequest{Count: 42})
	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/set_encounters", body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusOK)
	}

	var resp countResponse
	decodeJSON(t, w, &resp)
	if resp.Count != 42 {
		t.Errorf("count = %d, want 42", resp.Count)
	}

	// Verify encounter_set broadcast
	found := false
	for _, msg := range deps.broadcaster.messages {
		if msg.MsgType == "encounter_set" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected encounter_set broadcast")
	}
}

// TestSetEncountersInvalidBody verifies that a malformed body returns 400.
func TestSetEncountersInvalidBody(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/set_encounters", bytes.NewBufferString("{bad"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusBadRequest)
	}
}

// TestSetEncountersNotFound verifies that setting encounters on a non-existent
// Pokemon returns 404.
func TestSetEncountersNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	body := jsonBody(t, setEncountersRequest{Count: 10})
	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/nonexistent/set_encounters", body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
}

// --- POST /api/pokemon/{id}/activate -----------------------------------------

// TestActivateSuccess verifies that activating a Pokemon sets it as active.
func TestActivateSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")
	addPokemon(t, deps, "p2", "Charmander")

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p2/activate", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNoContent)
	}

	st := deps.stateMgr.GetState()
	if st.ActiveID != "p2" {
		t.Errorf("ActiveID = %q, want %q", st.ActiveID, "p2")
	}
}

// TestActivateNotFound verifies that activating a non-existent Pokemon returns 404.
func TestActivateNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/nonexistent/activate", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
}

// --- POST /api/pokemon/{id}/complete -----------------------------------------

// TestCompletePokemonSuccess verifies that completing a Pokemon stamps CompletedAt.
func TestCompletePokemonSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/complete", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNoContent)
	}

	st := deps.stateMgr.GetState()
	if st.Pokemon[0].CompletedAt == nil {
		t.Error("expected CompletedAt to be set")
	}

	// Verify pokemon_completed broadcast
	found := false
	for _, msg := range deps.broadcaster.messages {
		if msg.MsgType == "pokemon_completed" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected pokemon_completed broadcast")
	}
}

// TestCompletePokemonNotFound verifies that completing a non-existent Pokemon
// returns 404.
func TestCompletePokemonNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/nonexistent/complete", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
}

// --- POST /api/pokemon/{id}/uncomplete ---------------------------------------

// TestUncompletePokemonSuccess verifies that uncompleting clears CompletedAt.
func TestUncompletePokemonSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")
	deps.stateMgr.CompletePokemon("p1")

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/uncomplete", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNoContent)
	}

	st := deps.stateMgr.GetState()
	if st.Pokemon[0].CompletedAt != nil {
		t.Error("expected CompletedAt to be nil after uncomplete")
	}
}

// TestUncompletePokemonNotFound verifies that uncompleting a non-existent
// Pokemon returns 404.
func TestUncompletePokemonNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/nonexistent/uncomplete", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
}

// --- POST /api/pokemon/{id}/timer/* ------------------------------------------

// TestTimerStartSuccess verifies that starting a timer succeeds.
func TestTimerStartSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/timer/start", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNoContent)
	}

	st := deps.stateMgr.GetState()
	if st.Pokemon[0].TimerStartedAt == nil {
		t.Error("expected TimerStartedAt to be set")
	}
}

// TestTimerStartNotFound verifies that starting a timer for a non-existent
// Pokemon returns 404.
func TestTimerStartNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/nonexistent/timer/start", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
}

// TestTimerStopSuccess verifies that stopping a running timer succeeds.
func TestTimerStopSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")
	deps.stateMgr.StartTimer("p1")

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/timer/stop", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNoContent)
	}

	st := deps.stateMgr.GetState()
	if st.Pokemon[0].TimerStartedAt != nil {
		t.Error("expected TimerStartedAt to be nil after stop")
	}
}

// TestTimerStopNotFound verifies that stopping a timer for a non-existent
// Pokemon returns 404.
func TestTimerStopNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/nonexistent/timer/stop", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
}

// TestTimerResetSuccess verifies that resetting a timer clears it entirely.
func TestTimerResetSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")
	deps.stateMgr.StartTimer("p1")
	deps.stateMgr.StopTimer("p1")

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/timer/reset", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNoContent)
	}

	st := deps.stateMgr.GetState()
	if st.Pokemon[0].TimerAccumulatedMs != 0 {
		t.Errorf("TimerAccumulatedMs = %d, want 0", st.Pokemon[0].TimerAccumulatedMs)
	}
}

// TestTimerResetNotFound verifies that resetting a timer for a non-existent
// Pokemon returns 404.
func TestTimerResetNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/nonexistent/timer/reset", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
}

// --- POST /api/pokemon/{id}/overlay/unlink -----------------------------------

// TestUnlinkOverlaySuccess verifies that unlinking an overlay returns 204.
func TestUnlinkOverlaySuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/overlay/unlink", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNoContent)
	}

	if deps.saveCount == 0 {
		t.Error(fmtWantSaveCall)
	}
	if deps.broadcastN == 0 {
		t.Error("expected BroadcastState to be called")
	}
}

// TestUnlinkOverlayNotFound verifies that unlinking for a non-existent Pokemon
// returns 404.
func TestUnlinkOverlayNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/nonexistent/overlay/unlink", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
}

// TestUnlinkOverlayMethodNotAllowed verifies that GET on the unlink endpoint
// returns 405.
func TestUnlinkOverlayMethodNotAllowed(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodGet, "/api/pokemon/p1/overlay/unlink", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusMethodNotAllowed)
	}
}

// --- Dispatch: method not allowed on bare /api/pokemon/{id} ------------------

// TestPokemonIDMethodNotAllowed verifies that unsupported methods on
// /api/pokemon/{id} return 405.
func TestPokemonIDMethodNotAllowed(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPatch} {
		req := httptest.NewRequest(method, pathPokemonByP1, nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)

		if w.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s /api/pokemon/p1: status = %d, want 405", method, w.Code)
		}
	}
}

// --- Side effects: save and broadcast counts ---------------------------------

// TestSideEffectsOnMutation verifies that pokemonMutate-based handlers call
// both StateScheduleSave and BroadcastState exactly once.
func TestSideEffectsOnMutation(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/activate", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNoContent)
	}
	if deps.saveCount != 1 {
		t.Errorf("saveCount = %d, want 1", deps.saveCount)
	}
	if deps.broadcastN != 1 {
		t.Errorf("broadcastN = %d, want 1", deps.broadcastN)
	}
}
