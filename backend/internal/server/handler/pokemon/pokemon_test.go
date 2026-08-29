// Package pokemon tests the HTTP handlers for Pokemon CRUD operations and
// encounter mutations (increment, decrement, reset, set, timers, completion).
package pokemon

import (
	"bytes"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// errMockSprite is returned by the mock sprite store on simulated failures and
// for missing sprites.
var errMockSprite = errors.New("mock sprite error")

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
	logged  []encounterLogEntry
	deleted []string
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

// DeleteEncounterEvents records the id whose encounter events were cleared, so
// tests can assert that a phased hunt keeps its history.
func (m *mockEncounterLogger) DeleteEncounterEvents(pokemonID string) error {
	m.deleted = append(m.deleted, pokemonID)
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

// storedSprite captures a sprite BLOB and its mime type for mock assertions.
type storedSprite struct {
	data []byte
	mime string
}

// mockSpriteStore implements SpriteStore with in-memory storage.
type mockSpriteStore struct {
	sprites map[string]storedSprite
	failOn  string // "save", "load", "delete" to simulate errors
}

// newMockSpriteStore returns an empty in-memory sprite store.
func newMockSpriteStore() *mockSpriteStore {
	return &mockSpriteStore{sprites: make(map[string]storedSprite)}
}

// SaveSprite stores the sprite bytes and mime for the pokemon.
func (m *mockSpriteStore) SaveSprite(pokemonID string, data []byte, mime string) error {
	if m.failOn == "save" {
		return errMockSprite
	}
	cp := make([]byte, len(data))
	copy(cp, data)
	m.sprites[pokemonID] = storedSprite{data: cp, mime: mime}
	return nil
}

// LoadSprite returns the stored sprite bytes and mime, or an error if absent.
func (m *mockSpriteStore) LoadSprite(pokemonID string) ([]byte, string, error) {
	if m.failOn == "load" {
		return nil, "", errMockSprite
	}
	s, ok := m.sprites[pokemonID]
	if !ok {
		return nil, "", errMockSprite
	}
	return s.data, s.mime, nil
}

// DeleteSprite removes the stored sprite for the pokemon.
func (m *mockSpriteStore) DeleteSprite(pokemonID string) error {
	if m.failOn == "delete" {
		return errMockSprite
	}
	delete(m.sprites, pokemonID)
	return nil
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
	spriteStore *mockSpriteStore
	saveCount   int
	broadcastN  int
}

// StateAddPokemon delegates to the real state manager.
func (d *testDeps) StateAddPokemon(p state.Pokemon) { d.stateMgr.AddPokemon(p) }

// StateUpdatePokemon delegates to the real state manager.
func (d *testDeps) StateUpdatePokemon(id string, update state.Pokemon) bool {
	return d.stateMgr.UpdatePokemon(id, update)
}

// StateClearPokemonSprite delegates to the real state manager.
func (d *testDeps) StateClearPokemonSprite(id string) bool {
	return d.stateMgr.ClearPokemonSprite(id)
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

// StateReorderPokemon delegates to the real state manager.
func (d *testDeps) StateReorderPokemon(orderedIDs []string) error {
	return d.stateMgr.ReorderPokemon(orderedIDs)
}

// StateSetActive delegates to the real state manager.
func (d *testDeps) StateSetActive(id string) bool { return d.stateMgr.SetActive(id) }

// StateCompletePokemon delegates to the real state manager.
func (d *testDeps) StateCompletePokemon(id string) bool { return d.stateMgr.CompletePokemon(id) }

// StateSetCompletedAt delegates to the real state manager.
func (d *testDeps) StateSetCompletedAt(id string, at time.Time) bool {
	return d.stateMgr.SetCompletedAt(id, at)
}

// StateUncompletePokemon delegates to the real state manager.
func (d *testDeps) StateUncompletePokemon(id string) bool {
	return d.stateMgr.UncompletePokemon(id)
}

// StateFailPokemon delegates to the real state manager.
func (d *testDeps) StateFailPokemon(id string) bool { return d.stateMgr.FailPokemon(id) }

// StateSetCatchMeta delegates to the real state manager.
func (d *testDeps) StateSetCatchMeta(id string, meta *state.CatchMeta, nickname, gender string, spriteURL *string) bool {
	return d.stateMgr.SetCatchMeta(id, meta, nickname, gender, spriteURL)
}

// StateEndPhase delegates to the real state manager.
func (d *testDeps) StateEndPhase(parentID string, catch state.PhaseCatch, failed bool) (state.Pokemon, error) {
	return d.stateMgr.EndPhase(parentID, catch, failed)
}

// StateUndoPhase delegates to the real state manager.
func (d *testDeps) StateUndoPhase(childID string) (state.Pokemon, error) {
	return d.stateMgr.UndoPhase(childID)
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

// StateSetTimer delegates to the real state manager.
func (d *testDeps) StateSetTimer(id string, ms int64) bool { return d.stateMgr.SetTimer(id, ms) }

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

// PokemonDB returns the mock sprite store. Returns nil when none is configured
// so handlers exercise the no-database branch.
func (d *testDeps) PokemonDB() SpriteStore {
	if d.spriteStore == nil {
		return nil
	}
	return d.spriteStore
}

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
		spriteStore: newMockSpriteStore(),
	}
	mux := http.NewServeMux()
	RegisterRoutes(mux, deps)
	return mux, deps
}

// smallPNG returns the bytes of a valid 1x1 PNG image for upload tests.
func smallPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buf.Bytes()
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

// TestUpdatePokemonPartialBodyKeepsAlwaysAppliedFields verifies that a patch
// touching a single field leaves the fields alone whose zero value is a
// meaningful state, so a group move no longer clears the Shiny Charm or the
// Sparkling Power level.
func TestUpdatePokemonPartialBodyKeepsAlwaysAppliedFields(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")
	deps.stateMgr.UpdatePokemon("p1", state.Pokemon{
		ShinyCharm:     true,
		SparklingPower: 3,
		ShinyVariant:   "square",
		HuntMode:       "timer",
		GroupID:        "g1",
	})

	body := jsonBody(t, map[string]any{"group_id": "g2"})
	req := httptest.NewRequest(http.MethodPut, pathPokemonByP1, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusOK)
	}
	got := deps.stateMgr.GetState().Pokemon[0]
	if !got.ShinyCharm || got.SparklingPower != 3 || got.ShinyVariant != "square" || got.HuntMode != "timer" {
		t.Errorf("partial update lost fields: charm=%v sparkling=%d variant=%q mode=%q",
			got.ShinyCharm, got.SparklingPower, got.ShinyVariant, got.HuntMode)
	}
	if got.GroupID != "g2" {
		t.Errorf("GroupID = %q, want %q", got.GroupID, "g2")
	}
}

// TestUpdatePokemonExplicitZeroStillClears verifies that sending a field with
// its zero value keeps clearing it, which is how the hunt form unchecks the
// Shiny Charm and drops the Sparkling Power level.
func TestUpdatePokemonExplicitZeroStillClears(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")
	deps.stateMgr.UpdatePokemon("p1", state.Pokemon{ShinyCharm: true, SparklingPower: 3})

	body := jsonBody(t, map[string]any{"shiny_charm": false, "sparkling_power": 0})
	req := httptest.NewRequest(http.MethodPut, pathPokemonByP1, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusOK)
	}
	got := deps.stateMgr.GetState().Pokemon[0]
	if got.ShinyCharm || got.SparklingPower != 0 {
		t.Errorf("explicit zero did not clear: charm=%v sparkling=%d", got.ShinyCharm, got.SparklingPower)
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

// --- POST /api/pokemon/{id}/fail ---------------------------------------------

// TestFailPokemonSuccess verifies that failing a Pokemon stamps CompletedAt
// and sets Failed.
func TestFailPokemonSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/fail", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNoContent)
	}

	st := deps.stateMgr.GetState()
	p := st.Pokemon[0]
	if p.CompletedAt == nil {
		t.Error("expected CompletedAt to be set")
	}
	if !p.Failed {
		t.Error("expected Failed to be set")
	}

	// Verify pokemon_failed broadcast
	found := false
	for _, msg := range deps.broadcaster.messages {
		if msg.MsgType == "pokemon_failed" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected pokemon_failed broadcast")
	}
}

// TestFailPokemonNotFound verifies that failing a non-existent Pokemon
// returns 404.
func TestFailPokemonNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/nonexistent/fail", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
}

// --- POST /api/pokemon/{id}/phase --------------------------------------------

// TestEndPhaseCreated verifies that ending a phase returns 201 with the new
// phase entry and restarts the hunt's counter at zero.
func TestEndPhaseCreated(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Rattata")
	deps.stateMgr.SetEncounters("p1", 420)

	body := jsonBody(t, map[string]string{
		"canonical_name": "hoothoot",
		"name":           "Hoothoot",
		"sprite_url":     "https://example.test/hoothoot.png",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/phase", body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusCreated)
	}

	var child state.Pokemon
	decodeJSON(t, w, &child)
	if child.Name != "Hoothoot" {
		t.Errorf(fmtWantName, child.Name, "Hoothoot")
	}
	if child.PhaseOf != "p1" || child.PhaseNumber != 1 {
		t.Errorf("phase link = %q/%d, want p1/1", child.PhaseOf, child.PhaseNumber)
	}
	if child.Encounters != 420 {
		t.Errorf("child Encounters = %d, want the frozen 420", child.Encounters)
	}
	if deps.saveCount == 0 {
		t.Error(fmtWantSaveCall)
	}

	st := deps.stateMgr.GetState()
	if st.Pokemon[0].Encounters != 0 {
		t.Errorf("hunt Encounters = %d, want 0 after the phase change", st.Pokemon[0].Encounters)
	}
}

// TestEndPhaseFailedCreated verifies that ending a phase with failed: true in
// the request body archives the resulting phase entry as failed.
func TestEndPhaseFailedCreated(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Rattata")

	body := jsonBody(t, map[string]any{
		"canonical_name": "hoothoot",
		"name":           "Hoothoot",
		"sprite_url":     "https://example.test/hoothoot.png",
		"failed":         true,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/phase", body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusCreated)
	}

	var child state.Pokemon
	decodeJSON(t, w, &child)
	if !child.Failed {
		t.Error("expected the phase entry to be marked Failed")
	}
	if child.CompletedAt == nil {
		t.Error("expected CompletedAt to still be set on a failed phase entry")
	}
}

// TestEndPhaseMissingName verifies that a body without a name returns 400,
// since the name is the only required field of the request.
func TestEndPhaseMissingName(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Rattata")

	body := jsonBody(t, map[string]string{"name": "   "})
	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/phase", body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusBadRequest)
	}
	if len(deps.stateMgr.GetState().Pokemon) != 1 {
		t.Error("no phase entry should have been created")
	}
}

// TestEndPhaseNotFound verifies that ending a phase of an unknown hunt
// returns 404.
func TestEndPhaseNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	body := jsonBody(t, map[string]string{"name": "Hoothoot"})
	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/nonexistent/phase", body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
}

// TestEndPhaseConflict verifies that a completed hunt cannot end a phase and
// answers with 409.
func TestEndPhaseConflict(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Rattata")
	deps.stateMgr.CompletePokemon("p1")

	body := jsonBody(t, map[string]string{"name": "Hoothoot"})
	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/phase", body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusConflict)
	}
}

// --- DELETE /api/pokemon/{id}/phase ------------------------------------------

// phasePath builds the /api/pokemon/{id}/phase route for the given entry id.
func phasePath(id string) string { return pathPokemon + "/" + id + "/phase" }

// endPhaseOn ends one phase of the hunt with parentID and returns the created
// phase entry, so the undo tests start from a real phase history.
func endPhaseOn(t *testing.T, deps *testDeps, parentID, name string) state.Pokemon {
	t.Helper()
	child, err := deps.stateMgr.EndPhase(parentID, state.PhaseCatch{Name: name}, false)
	if err != nil {
		t.Fatalf("EndPhase(%s): %v", parentID, err)
	}
	return child
}

// TestUndoPhaseSuccess verifies that deleting the newest phase answers 200 with
// the parent hunt, hands the frozen encounters and timer back to it and drops
// the phase entry.
func TestUndoPhaseSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Rattata")
	deps.stateMgr.SetEncounters("p1", 420)
	deps.stateMgr.SetTimer("p1", 90_000)
	child := endPhaseOn(t, deps, "p1", "Hoothoot")
	deps.stateMgr.SetEncounters("p1", 7)

	req := httptest.NewRequest(http.MethodDelete, phasePath(child.ID), nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusOK)
	}

	var parent state.Pokemon
	decodeJSON(t, w, &parent)
	if parent.ID != "p1" {
		t.Fatalf("parent id = %q, want p1", parent.ID)
	}
	if parent.Encounters != 427 {
		t.Errorf("parent Encounters = %d, want 427 (7 + the 420 of the phase)", parent.Encounters)
	}
	if parent.TimerAccumulatedMs != 90_000 {
		t.Errorf("parent TimerAccumulatedMs = %d, want 90000", parent.TimerAccumulatedMs)
	}
	if len(deps.stateMgr.GetState().Pokemon) != 1 {
		t.Error("the phase entry should have been removed")
	}
	if deps.saveCount == 0 {
		t.Error(fmtWantSaveCall)
	}
	if deps.broadcastN == 0 {
		t.Error("expected BroadcastState to be called")
	}
}

// TestUndoPhaseNotFound verifies that undoing a phase of an unknown entry
// answers 404.
func TestUndoPhaseNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodDelete, phasePath("nonexistent"), nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
}

// TestUndoPhaseConflict verifies that an entry which is not a phase cannot be
// undone and answers 409.
func TestUndoPhaseConflict(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Rattata")

	req := httptest.NewRequest(http.MethodDelete, phasePath("p1"), nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusConflict)
	}
	if len(deps.stateMgr.GetState().Pokemon) != 1 {
		t.Error("the hunt should still exist")
	}
}

// TestUndoPhaseMethodNotAllowed verifies that a verb other than POST or DELETE
// on the phase route is rejected.
func TestUndoPhaseMethodNotAllowed(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Rattata")

	req := httptest.NewRequest(http.MethodPut, phasePath("p1"), nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusMethodNotAllowed)
	}
}

// --- Encounter history of phased hunts ---------------------------------------

// TestResetKeepsHistoryOfPhasedHunt verifies that resetting a hunt with phases
// leaves the encounter events alone: the reset only zeroes the counter of the
// running phase, while the events of every earlier phase stay on the hunt.
func TestResetKeepsHistoryOfPhasedHunt(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Rattata")
	endPhaseOn(t, deps, "p1", "Hoothoot")

	req := httptest.NewRequest(http.MethodPost, pathPokemonByP1+"/reset", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNoContent)
	}
	if len(deps.logger.deleted) != 0 {
		t.Errorf("DeleteEncounterEvents called for %v, want no call on a phased hunt", deps.logger.deleted)
	}
}

// TestResetClearsHistoryWithoutPhases verifies that the guard is limited to
// phased hunts: an ordinary hunt still drops its events on reset.
func TestResetClearsHistoryWithoutPhases(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Rattata")

	req := httptest.NewRequest(http.MethodPost, pathPokemonByP1+"/reset", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNoContent)
	}
	if len(deps.logger.deleted) != 1 || deps.logger.deleted[0] != "p1" {
		t.Errorf("deleted = %v, want [p1]", deps.logger.deleted)
	}
}

// TestDecrementToZeroKeepsHistoryOfPhasedHunt verifies that counting a phased
// hunt back down to zero keeps the events of the earlier phases.
func TestDecrementToZeroKeepsHistoryOfPhasedHunt(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Rattata")
	endPhaseOn(t, deps, "p1", "Hoothoot")
	deps.stateMgr.SetEncounters("p1", 1)

	req := httptest.NewRequest(http.MethodPost, pathPokemonByP1+"/decrement", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusOK)
	}
	if len(deps.logger.deleted) != 0 {
		t.Errorf("DeleteEncounterEvents called for %v, want no call on a phased hunt", deps.logger.deleted)
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

// --- POST /api/pokemon/{id}/timer/set ----------------------------------------

// TestTimerSetSuccess verifies that setting a timer to an exact value succeeds.
func TestTimerSetSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	body := strings.NewReader(`{"ms":90000000}`)
	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/p1/timer/set", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNoContent)
	}

	st := deps.stateMgr.GetState()
	if st.Pokemon[0].TimerAccumulatedMs != 90000000 {
		t.Errorf("TimerAccumulatedMs = %d, want 90000000", st.Pokemon[0].TimerAccumulatedMs)
	}
}

// TestTimerSetNotFound verifies that setting a timer for a non-existent
// Pokemon returns 404.
func TestTimerSetNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	body := strings.NewReader(`{"ms":5000}`)
	req := httptest.NewRequest(http.MethodPost, "/api/pokemon/nonexistent/timer/set", body)
	req.Header.Set("Content-Type", "application/json")
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

// --- PUT /api/pokemon/reorder (ReorderPokemon) -------------------------------

// TestReorderPokemonSuccess verifies that a valid ordering assigns SortOrder by
// position and triggers a save and broadcast.
func TestReorderPokemonSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "a", "Alpha")
	addPokemon(t, deps, "b", "Beta")
	addPokemon(t, deps, "c", "Gamma")

	body := jsonBody(t, map[string]any{"order": []string{"c", "a", "b"}})
	req := httptest.NewRequest(http.MethodPut, pathPokemon+"/reorder", body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusOK)
	}

	want := map[string]int{"c": 0, "a": 1, "b": 2}
	for _, p := range deps.stateMgr.GetState().Pokemon {
		if p.SortOrder != want[p.ID] {
			t.Errorf("pokemon %s SortOrder = %d, want %d", p.ID, p.SortOrder, want[p.ID])
		}
	}
	if deps.saveCount == 0 {
		t.Error(fmtWantSaveCall)
	}
	if deps.broadcastN == 0 {
		t.Error("expected BroadcastState to be called")
	}
}

// TestReorderPokemonUnknownID verifies that an ordering referencing an unknown
// id returns 404 and does not persist.
func TestReorderPokemonUnknownID(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "a", "Alpha")

	body := jsonBody(t, map[string]any{"order": []string{"a", "ghost"}})
	req := httptest.NewRequest(http.MethodPut, pathPokemon+"/reorder", body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
	if deps.saveCount != 0 {
		t.Errorf("saveCount = %d, want 0 on rejected reorder", deps.saveCount)
	}
}

// TestReorderPokemonInvalidBody verifies that a malformed JSON body returns 400.
func TestReorderPokemonInvalidBody(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPut, pathPokemon+"/reorder", bytes.NewBufferString("{invalid"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusBadRequest)
	}
}

// --- Hand-entered catches ----------------------------------------------------

// manualCatchBody returns the JSON body of a minimal hand-entered catch.
func manualCatchBody(t *testing.T, completedAt string) *bytes.Buffer {
	t.Helper()
	body := map[string]any{
		"name":         "Bisasam",
		"sprite_url":   "http://example.com/bulbasaur.png",
		"entry_source": "manual",
	}
	if completedAt != "" {
		body["completed_at"] = completedAt
	}
	return jsonBody(t, body)
}

// postPokemon posts body to /api/pokemon and returns the recorder.
func postPokemon(t *testing.T, mux *http.ServeMux, body *bytes.Buffer) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, pathPokemon, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	return w
}

// TestAddManualPokemonSkipsDetectorConfig verifies that a hand-entered catch is
// stored as history: no detector config, no live-hunt state.
func TestAddManualPokemonSkipsDetectorConfig(t *testing.T) {
	mux, deps := newTestMux(t)

	w := postPokemon(t, mux, manualCatchBody(t, "2024-05-01T12:00:00Z"))
	if w.Code != http.StatusCreated {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusCreated)
	}

	st := deps.stateMgr.GetState()
	if len(st.Pokemon) != 1 {
		t.Fatalf("state has %d pokemon, want 1", len(st.Pokemon))
	}
	got := st.Pokemon[0]
	if got.DetectorConfig != nil {
		t.Error("manual entry must not carry a detector config")
	}
	if got.EntrySource != "manual" {
		t.Errorf("EntrySource = %q, want %q", got.EntrySource, "manual")
	}
	if got.IsActive {
		t.Error("manual entry must not be active")
	}
	if got.TimerStartedAt != nil {
		t.Error("manual entry must not carry a running timer")
	}
	if got.Overlay != nil || got.OverlayMode != "default" {
		t.Errorf("overlay = %v / mode = %q, want nil / default", got.Overlay, got.OverlayMode)
	}
	if got.PhaseTargets == nil {
		t.Error("PhaseTargets must be a non-nil empty slice")
	}
}

// TestAddTrackedPokemonKeepsDetectorConfig pins that the normal path is
// untouched by the manual branch.
func TestAddTrackedPokemonKeepsDetectorConfig(t *testing.T) {
	mux, deps := newTestMux(t)

	w := postPokemon(t, mux, jsonBody(t, map[string]any{"name": "Bisasam"}))
	if w.Code != http.StatusCreated {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusCreated)
	}
	if deps.stateMgr.GetState().Pokemon[0].DetectorConfig == nil {
		t.Error("a tracked hunt must keep the default detector config")
	}
}

// TestAddManualPokemonRequiresCompletedAt verifies that a hand-entered catch
// without a completion date is rejected: it would be indistinguishable from a
// running hunt.
func TestAddManualPokemonRequiresCompletedAt(t *testing.T) {
	mux, deps := newTestMux(t)

	w := postPokemon(t, mux, manualCatchBody(t, ""))
	if w.Code != http.StatusBadRequest {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusBadRequest)
	}
	if len(deps.stateMgr.GetState().Pokemon) != 0 {
		t.Error("rejected entry must not reach the state")
	}
}

// TestAddPokemonInvalidEntrySource verifies that an unknown marker is rejected.
func TestAddPokemonInvalidEntrySource(t *testing.T) {
	mux, _ := newTestMux(t)

	w := postPokemon(t, mux, jsonBody(t, map[string]any{"name": "Bisasam", "entry_source": "imported"}))
	if w.Code != http.StatusBadRequest {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusBadRequest)
	}
}

// TestUpdatePokemonInvalidEntrySource verifies that the update path validates
// the marker too.
func TestUpdatePokemonInvalidEntrySource(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Bisasam")

	req := httptest.NewRequest(http.MethodPut, pathPokemonByP1, jsonBody(t, map[string]any{"entry_source": "imported"}))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusBadRequest)
	}
}

// TestAddManualPokemonDoesNotBecomeActive verifies that the first hand-entered
// catch on a fresh install stays out of the hotkey path.
func TestAddManualPokemonDoesNotBecomeActive(t *testing.T) {
	mux, deps := newTestMux(t)

	if w := postPokemon(t, mux, manualCatchBody(t, "2024-05-01T12:00:00Z")); w.Code != http.StatusCreated {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusCreated)
	}

	st := deps.stateMgr.GetState()
	if st.ActiveID != "" {
		t.Errorf("ActiveID = %q, want it empty", st.ActiveID)
	}
	if st.Pokemon[0].IsActive {
		t.Error("a manual entry must not become the active hunt")
	}
}

// --- PUT /api/pokemon/{id}/completed_at --------------------------------------

// completedAtPath builds the re-dating route for an id.
func completedAtPath(id string) string { return pathPokemon + "/" + id + "/completed_at" }

// putCompletedAt sends a re-dating request and returns the recorder.
func putCompletedAt(t *testing.T, mux *http.ServeMux, id string, body *bytes.Buffer) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, completedAtPath(id), body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	return w
}

// TestSetCompletedAtSuccess verifies that an archived entry can be re-dated.
func TestSetCompletedAtSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Bisasam")
	if !deps.stateMgr.CompletePokemon("p1") {
		t.Fatal("setup: CompletePokemon failed")
	}

	want := time.Date(2021, 3, 4, 5, 6, 7, 0, time.UTC)
	w := putCompletedAt(t, mux, "p1", jsonBody(t, map[string]any{"completed_at": want.Format(time.RFC3339)}))
	if w.Code != http.StatusNoContent {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNoContent)
	}

	got := deps.stateMgr.GetState().Pokemon[0].CompletedAt
	if got == nil || !got.Equal(want) {
		t.Errorf("CompletedAt = %v, want %v", got, want)
	}
	if deps.saveCount == 0 {
		t.Error(fmtWantSaveCall)
	}
}

// TestSetCompletedAtRunningHunt verifies that a hunt in progress is refused:
// finishing it is /complete, not a re-dating.
func TestSetCompletedAtRunningHunt(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Bisasam")

	w := putCompletedAt(t, mux, "p1", jsonBody(t, map[string]any{"completed_at": "2021-03-04T05:06:07Z"}))
	if w.Code != http.StatusBadRequest {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusBadRequest)
	}
}

// TestSetCompletedAtUnknownID verifies that an unknown id returns 404.
func TestSetCompletedAtUnknownID(t *testing.T) {
	mux, _ := newTestMux(t)

	w := putCompletedAt(t, mux, "ghost", jsonBody(t, map[string]any{"completed_at": "2021-03-04T05:06:07Z"}))
	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
}

// TestSetCompletedAtInvalidBody verifies that an unparsable timestamp and a
// malformed body both return 400 without touching the state.
func TestSetCompletedAtInvalidBody(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Bisasam")
	if !deps.stateMgr.CompletePokemon("p1") {
		t.Fatal("setup: CompletePokemon failed")
	}

	for _, body := range []string{"{invalid", `{"completed_at":"04.03.2021"}`, `{}`} {
		req := httptest.NewRequest(http.MethodPut, completedAtPath("p1"), bytes.NewBufferString(body))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest {
			t.Errorf("body %q: status = %d, want %d", body, w.Code, http.StatusBadRequest)
		}
	}
}

// TestSetCompletedAtMethodNotAllowed verifies that only PUT is accepted.
func TestSetCompletedAtMethodNotAllowed(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, completedAtPath("p1"), nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusMethodNotAllowed)
	}
}

// TestAddPokemonRejectsInvalidPhaseLink verifies that a posted phase link runs
// through the shared validator.
func TestAddPokemonRejectsInvalidPhaseLink(t *testing.T) {
	mux, _ := newTestMux(t)

	w := postPokemon(t, mux, jsonBody(t, map[string]any{"name": "Bisasam", "phase_number": 2}))
	if w.Code != http.StatusBadRequest {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusBadRequest)
	}
}

// TestAddPokemonDerivesPhaseNumber verifies that a posted phase without a
// number gets the next one derived from its parent.
func TestAddPokemonDerivesPhaseNumber(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "hunt", "Bisasam")

	w := postPokemon(t, mux, jsonBody(t, map[string]any{"name": "Karpador", "phase_of": "hunt"}))
	if w.Code != http.StatusCreated {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusCreated)
	}
	var p state.Pokemon
	decodeJSON(t, w, &p)
	if p.PhaseNumber != 1 {
		t.Errorf("PhaseNumber = %d, want 1", p.PhaseNumber)
	}
}
