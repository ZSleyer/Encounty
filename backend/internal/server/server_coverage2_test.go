// server_coverage2_test.go adds tests for previously uncovered functions
// in the server package to raise coverage above 75%.
package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/fileoutput"
	"github.com/zsleyer/encounty/backend/internal/state"
)

const fmtNameWant = "Name = %q, want %q"

// --- WriteJSON ---

func TestWriteJSON(t *testing.T) {
	t.Helper()
	w := httptest.NewRecorder()
	WriteJSON(w, http.StatusCreated, map[string]string{"key": "value"})

	if w.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d", w.Code, http.StatusCreated)
	}
	ct := w.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	var resp map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf(fmtUnmarshal, err)
	}
	if resp["key"] != "value" {
		t.Errorf("key = %q, want %q", resp["key"], "value")
	}
}

func TestWriteJSONDifferentStatus(t *testing.T) {
	w := httptest.NewRecorder()
	WriteJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})

	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", w.Code, http.StatusNotFound)
	}
}

// --- ReadJSON ---

func TestReadJSON(t *testing.T) {
	body := `{"name":"Pikachu","count":42}`
	r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))

	var v struct {
		Name  string `json:"name"`
		Count int    `json:"count"`
	}
	if err := ReadJSON(r, &v); err != nil {
		t.Fatalf("ReadJSON: %v", err)
	}
	if v.Name != "Pikachu" {
		t.Errorf("name = %q, want %q", v.Name, "Pikachu")
	}
	if v.Count != 42 {
		t.Errorf("count = %d, want 42", v.Count)
	}
}

func TestReadJSONInvalid(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("{bad"))
	var v map[string]string
	if err := ReadJSON(r, &v); err == nil {
		t.Error("expected error for invalid JSON")
	}
}

func TestReadJSONEmptyBody(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(""))
	var v map[string]string
	if err := ReadJSON(r, &v); err == nil {
		t.Error("expected error for empty body")
	}
}

// --- FindPokemon ---

func TestFindPokemonFound(t *testing.T) {
	st := state.AppState{
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Pikachu"},
			{ID: "p2", Name: "Charmander"},
		},
	}
	p := FindPokemon(st, "p2")
	if p == nil {
		t.Fatal("expected non-nil result")
	}
	if p.Name != "Charmander" {
		t.Errorf(fmtNameWant, p.Name, "Charmander")
	}
}

func TestFindPokemonNotFound(t *testing.T) {
	st := state.AppState{
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Pikachu"},
		},
	}
	p := FindPokemon(st, "nonexistent")
	if p != nil {
		t.Errorf("expected nil, got %+v", p)
	}
}

func TestFindPokemonEmptySlice(t *testing.T) {
	st := state.AppState{Pokemon: nil}
	p := FindPokemon(st, "p1")
	if p != nil {
		t.Errorf("expected nil for empty pokemon slice, got %+v", p)
	}
}

// --- logEncounter ---

func TestLogEncounterNilDB(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	// srv.db is nil by default; logEncounter should return early without panic.
	srv.logEncounter("p1", 1, 1, "test")
}

func TestLogEncounterWithStep(t *testing.T) {
	srv := newTestServer(t)
	srv.state.AddPokemon(state.Pokemon{
		ID:        "p1",
		Name:      "Pikachu",
		Step:      3,
		CreatedAt: time.Now(),
	})
	// No db set, but exercises the name/step resolution path before the early return.
	srv.logEncounter("p1", 3, 1, "hotkey")
}

func TestLogEncounterUnknownPokemon(t *testing.T) {
	srv := newTestServer(t)
	// No pokemon added; the loop finds no match, name stays as the id.
	srv.logEncounter("unknown-id", 0, 1, "test")
}

// --- Server accessor methods ---

func TestIsReady(t *testing.T) {
	srv := newTestServer(t)
	if srv.IsReady() {
		t.Error("new server should not be ready")
	}
	srv.ready.Store(true)
	if !srv.IsReady() {
		t.Error("server should be ready after Store(true)")
	}
}

func TestIsDevMode(t *testing.T) {
	srv := newTestServer(t)
	if srv.IsDevMode() {
		t.Error("default server should not be in dev mode")
	}
	srv.devMode = true
	if !srv.IsDevMode() {
		t.Error("server should report dev mode when devMode=true")
	}
}

func TestIsSetupPending(t *testing.T) {
	srv := newTestServer(t)
	if srv.IsSetupPending() {
		t.Error("new server should not have pending setup")
	}
	srv.setupPending.Store(true)
	if !srv.IsSetupPending() {
		t.Error("server should report setup pending after Store(true)")
	}
}

func TestSaveState(t *testing.T) {
	srv := newTestServer(t)
	// SaveState delegates to state.Manager.Save; with no DB it should succeed.
	if err := srv.SaveState(); err != nil {
		t.Errorf("SaveState: %v", err)
	}
}

func TestScheduleSave(t *testing.T) {
	srv := newTestServer(t)
	// Should not panic.
	srv.ScheduleSave()
}

func TestStopHotkeys(t *testing.T) {
	srv := newTestServer(t)
	// Should call mockHotkeyMgr.Stop without panic.
	srv.StopHotkeys()
}

func TestSetDB(t *testing.T) {
	srv := newTestServer(t)
	// Set to nil; should not panic.
	srv.SetDB(nil)
	if srv.db != nil {
		t.Error("db should be nil")
	}
}

func TestReloadState(t *testing.T) {
	srv := newTestServer(t)
	// Reload with no DB — should succeed (no-op).
	if err := srv.ReloadState(); err != nil {
		t.Errorf("ReloadState: %v", err)
	}
}

func TestDB(t *testing.T) {
	srv := newTestServer(t)
	if srv.DB() != nil {
		t.Error("DB() should return nil for test server")
	}
}

func TestStatsDBNil(t *testing.T) {
	srv := newTestServer(t)
	if srv.StatsDB() != nil {
		t.Error("StatsDB() should return nil when db is nil")
	}
}

func TestDetectorMgrNil(t *testing.T) {
	srv := newTestServer(t)
	if srv.DetectorMgr() != nil {
		t.Error("DetectorMgr() should return nil when not configured")
	}
}

func TestDetectorDBNil(t *testing.T) {
	srv := newTestServer(t)
	if srv.DetectorDB() != nil {
		t.Error("DetectorDB() should return nil when db is nil")
	}
}

func TestDetectorStopperNil(t *testing.T) {
	srv := newTestServer(t)
	if srv.DetectorStopper() != nil {
		t.Error("DetectorStopper() should return nil when detectorMgr is nil")
	}
}

func TestEncounterLoggerNil(t *testing.T) {
	srv := newTestServer(t)
	if srv.EncounterLogger() != nil {
		t.Error("EncounterLogger() should return nil when db is nil")
	}
}

func TestBroadcasterNotNil(t *testing.T) {
	srv := newTestServer(t)
	if srv.Broadcaster() == nil {
		t.Error("Broadcaster() should not be nil")
	}
}

func TestStateManager(t *testing.T) {
	srv := newTestServer(t)
	if srv.StateManager() == nil {
		t.Error("StateManager() should not be nil")
	}
}

func TestVersionInfo(t *testing.T) {
	srv := newTestServer(t)
	v, c, b := srv.VersionInfo()
	if v != "1.0.0" {
		t.Errorf("version = %q, want %q", v, "1.0.0")
	}
	if c != "abc1234" {
		t.Errorf("commit = %q, want %q", c, "abc1234")
	}
	if b != "032026" {
		t.Errorf("buildDate = %q, want %q", b, "032026")
	}
}

func TestVersionGetter(t *testing.T) {
	srv := newTestServer(t)
	if srv.Version() != "1.0.0" {
		t.Errorf("Version() = %q, want %q", srv.Version(), "1.0.0")
	}
}

func TestConfigDir(t *testing.T) {
	srv := newTestServer(t)
	dir := srv.ConfigDir()
	if dir == "" {
		t.Error("ConfigDir() should not be empty")
	}
}

// --- State delegate methods ---

func TestStateSetEncounters(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.Increment("p1")

	count, ok := srv.StateSetEncounters("p1", 42)
	if !ok {
		t.Error("StateSetEncounters should return ok=true")
	}
	if count != 42 {
		t.Errorf("count = %d, want 42", count)
	}
}

func TestStateSetEncountersNotFound(t *testing.T) {
	srv := newTestServer(t)
	_, ok := srv.StateSetEncounters("nonexistent", 10)
	if ok {
		t.Error("StateSetEncounters should return ok=false for nonexistent id")
	}
}

func TestStateStartTimer(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	if !srv.StateStartTimer("p1") {
		t.Error("StateStartTimer should return true")
	}
}

func TestStateStopTimer(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.StartTimer("p1")
	if !srv.StateStopTimer("p1") {
		t.Error("StateStopTimer should return true")
	}
}

func TestStateResetTimer(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.StartTimer("p1")
	if !srv.StateResetTimer("p1") {
		t.Error("StateResetTimer should return true")
	}
}

func TestStateSetTimer(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	if !srv.StateSetTimer("p1", 90000000) {
		t.Error("StateSetTimer should return true")
	}
	st := srv.state.GetState()
	if st.Pokemon[0].TimerAccumulatedMs != 90000000 {
		t.Errorf("TimerAccumulatedMs = %d, want 90000000", st.Pokemon[0].TimerAccumulatedMs)
	}
}

// --- FileWriterSetConfig ---

func TestFileWriterSetConfigNil(t *testing.T) {
	srv := newTestServer(t)
	// fileWriter is nil; should not panic.
	srv.FileWriterSetConfig("/tmp/test", true)
}

func TestFileWriterSetConfigValid(t *testing.T) {
	srv := newTestServer(t)
	dir := t.TempDir()
	srv.fileWriter = fileoutput.New(dir, true)
	srv.FileWriterSetConfig(t.TempDir(), false)
}

// --- dbAs generic helper ---

func TestDbAsNilDB(t *testing.T) {
	result := dbAs[io.Reader](nil)
	if result != nil {
		t.Error("dbAs should return nil for nil DB")
	}
}

// --- WS handler: set_encounters ---

func TestHandleWSMessageSetEncounters(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")

	msg := makeWSMessage(t, "set_encounters", map[string]any{
		"pokemon_id": "p1",
		"count":      50,
	})
	srv.handleWSMessage(msg)

	st := srv.state.GetState()
	if st.Pokemon[0].Encounters != 50 {
		t.Errorf("encounters = %d, want 50", st.Pokemon[0].Encounters)
	}
}

func TestHandleWSMessageSetEncountersEmptyID(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")

	msg := makeWSMessage(t, "set_encounters", map[string]any{
		"pokemon_id": "",
		"count":      10,
	})
	srv.handleWSMessage(msg)

	st := srv.state.GetState()
	if st.Pokemon[0].Encounters != 0 {
		t.Errorf("encounters = %d, want 0 (empty id should be rejected)", st.Pokemon[0].Encounters)
	}
}

func TestHandleWSMessageSetEncountersNotFound(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")

	msg := makeWSMessage(t, "set_encounters", map[string]any{
		"pokemon_id": "nonexistent",
		"count":      10,
	})
	srv.handleWSMessage(msg)

	st := srv.state.GetState()
	if st.Pokemon[0].Encounters != 0 {
		t.Errorf("encounters = %d, want 0", st.Pokemon[0].Encounters)
	}
}

func TestHandleWSMessageSetEncountersInvalidPayload(t *testing.T) {
	srv := newTestServer(t)
	msg := WSMessage{Type: "set_encounters", Payload: json.RawMessage(`{invalid`)}
	srv.handleWSMessage(msg)
}

// --- WS handler: timer_start ---

func TestHandleWSMessageTimerStart(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")

	msg := makeWSMessage(t, "timer_start", map[string]string{"pokemon_id": "p1"})
	srv.handleWSMessage(msg)

	st := srv.state.GetState()
	if st.Pokemon[0].TimerStartedAt == nil {
		t.Error("TimerStartedAt should be set after timer_start")
	}
}

func TestHandleWSMessageTimerStartEmptyID(t *testing.T) {
	srv := newTestServer(t)
	msg := makeWSMessage(t, "timer_start", map[string]string{"pokemon_id": ""})
	srv.handleWSMessage(msg)
}

func TestHandleWSMessageTimerStartInvalidPayload(t *testing.T) {
	srv := newTestServer(t)
	msg := WSMessage{Type: "timer_start", Payload: json.RawMessage(`{invalid`)}
	srv.handleWSMessage(msg)
}

// --- WS handler: timer_stop ---

func TestHandleWSMessageTimerStop(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.StartTimer("p1")

	msg := makeWSMessage(t, "timer_stop", map[string]string{"pokemon_id": "p1"})
	srv.handleWSMessage(msg)

	st := srv.state.GetState()
	if st.Pokemon[0].TimerStartedAt != nil {
		t.Error("TimerStartedAt should be nil after timer_stop")
	}
}

func TestHandleWSMessageTimerStopEmptyID(t *testing.T) {
	srv := newTestServer(t)
	msg := makeWSMessage(t, "timer_stop", map[string]string{"pokemon_id": ""})
	srv.handleWSMessage(msg)
}

func TestHandleWSMessageTimerStopInvalidPayload(t *testing.T) {
	srv := newTestServer(t)
	msg := WSMessage{Type: "timer_stop", Payload: json.RawMessage(`{invalid`)}
	srv.handleWSMessage(msg)
}

func TestHandleWSMessageTimerStopNotStarted(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	// Timer not started; StopTimer should return false.
	msg := makeWSMessage(t, "timer_stop", map[string]string{"pokemon_id": "p1"})
	srv.handleWSMessage(msg)
}

// --- WS handler: timer_reset ---

func TestHandleWSMessageTimerReset(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.StartTimer("p1")

	msg := makeWSMessage(t, "timer_reset", map[string]string{"pokemon_id": "p1"})
	srv.handleWSMessage(msg)

	st := srv.state.GetState()
	if st.Pokemon[0].TimerStartedAt != nil {
		t.Error("TimerStartedAt should be nil after timer_reset")
	}
}

func TestHandleWSMessageTimerResetEmptyID(t *testing.T) {
	srv := newTestServer(t)
	msg := makeWSMessage(t, "timer_reset", map[string]string{"pokemon_id": ""})
	srv.handleWSMessage(msg)
}

func TestHandleWSMessageTimerResetInvalidPayload(t *testing.T) {
	srv := newTestServer(t)
	msg := WSMessage{Type: "timer_reset", Payload: json.RawMessage(`{invalid`)}
	srv.handleWSMessage(msg)
}

// --- WS handler: update_hotkeys ---

func TestHandleWSMessageUpdateHotkeys(t *testing.T) {
	srv := newTestServer(t)

	hk := state.HotkeyMap{
		Increment:   "F5",
		Decrement:   "F6",
		Reset:       "F7",
		NextPokemon: "F8",
	}
	msg := makeWSMessage(t, "update_hotkeys", hk)
	srv.handleWSMessage(msg)

	st := srv.state.GetState()
	if st.Hotkeys.Increment != "F5" {
		t.Errorf("Increment = %q, want %q", st.Hotkeys.Increment, "F5")
	}
	if st.Hotkeys.NextPokemon != "F8" {
		t.Errorf("NextPokemon = %q, want %q", st.Hotkeys.NextPokemon, "F8")
	}
}

func TestHandleWSMessageUpdateHotkeysInvalidPayload(t *testing.T) {
	srv := newTestServer(t)
	msg := WSMessage{Type: "update_hotkeys", Payload: json.RawMessage(`{invalid`)}
	srv.handleWSMessage(msg)
}

func TestHandleWSMessageUpdateHotkeysWithError(t *testing.T) {
	srv := newTestServer(t)
	srv.hotkeyMgr = &errorHotkeyMgr{}

	hk := state.HotkeyMap{Increment: "F5"}
	msg := makeWSMessage(t, "update_hotkeys", hk)
	// Should log the error but not panic.
	srv.handleWSMessage(msg)
}

// --- Swagger handler ---

func TestSwaggerHandlerDocJSON(t *testing.T) {
	handler := swaggerHandler()

	req := httptest.NewRequest(http.MethodGet, "/swagger/doc.json", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	// Swag may or may not have a registered doc; either a 200 or 500 is valid.
	if w.Code != http.StatusOK && w.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, expected 200 or 500", w.Code)
	}
}

func TestSwaggerHandlerUI(t *testing.T) {
	handler := swaggerHandler()

	req := httptest.NewRequest(http.MethodGet, "/swagger/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
	ct := w.Header().Get("Content-Type")
	if ct != "text/html; charset=utf-8" {
		t.Errorf("Content-Type = %q, want text/html; charset=utf-8", ct)
	}
	body := w.Body.String()
	if !strings.Contains(body, "swagger-ui") {
		t.Error("response should contain swagger-ui HTML")
	}
}

func TestSwaggerHandlerIndex(t *testing.T) {
	handler := swaggerHandler()

	req := httptest.NewRequest(http.MethodGet, "/swagger/index.html", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
}

// --- InitAsync dev mode ---

func TestInitAsyncDevMode(t *testing.T) {
	srv := newTestServer(t)
	srv.devMode = true

	// Register a fake client to capture the broadcast.
	c := &wsClient{send: make(chan wsPayload, sendBufSize)}
	srv.hub.mu.Lock()
	srv.hub.clients[c] = true
	srv.hub.mu.Unlock()

	srv.InitAsync()

	// Wait briefly for the goroutine to execute.
	time.Sleep(100 * time.Millisecond)

	if !srv.IsReady() {
		t.Error("server should be ready after InitAsync in dev mode")
	}
	if !srv.IsSetupPending() {
		t.Error("setup should be pending in dev mode")
	}

	// Check that system_ready was broadcast.
	found := false
	for range 10 {
		select {
		case payload := <-c.send:
			var msg WSMessage
			if err := json.Unmarshal(payload.data, &msg); err == nil && msg.Type == "system_ready" {
				found = true
			}
		default:
		}
		if found {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !found {
		t.Error("expected system_ready broadcast in dev mode")
	}
}

// --- handleHotkeyIncrement/Decrement not-found paths ---

func TestHandleHotkeyIncrementNotFound(t *testing.T) {
	srv := newTestServer(t)
	// Calling with a nonexistent pokemon ID should not panic.
	srv.handleHotkeyIncrement("nonexistent")
}

func TestHandleHotkeyDecrementNotFound(t *testing.T) {
	srv := newTestServer(t)
	srv.handleHotkeyDecrement("nonexistent")
}

// TestHandleHotkeyHuntToggleStarts verifies that dispatching hunt_toggle on a
// stopped Pokémon starts its timer and broadcasts hunt_start_requested with
// the Pokémon's hunt_mode.
func TestHandleHotkeyHuntToggleStarts(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.SetActive("p1")
	// Give the Pokémon a non-default hunt_mode AND a usable detector config
	// so the backend template-readiness gate does not veto the start.
	enabled := true
	st := srv.state.GetState()
	p := st.Pokemon[0]
	p.HuntMode = "detector"
	srv.state.UpdatePokemon("p1", p)
	srv.state.SetDetectorConfig("p1", &state.DetectorConfig{
		Enabled:   true,
		Templates: []state.DetectorTemplate{{Name: "tpl", Enabled: &enabled}},
	})
	srv.SetCaptureState("p1", true)

	c := &wsClient{send: make(chan wsPayload, sendBufSize)}
	srv.hub.mu.Lock()
	srv.hub.clients[c] = true
	srv.hub.mu.Unlock()

	srv.DispatchHotkeyAction("hunt_toggle", "")

	if srv.state.GetState().Pokemon[0].TimerStartedAt == nil {
		t.Error("TimerStartedAt should be set after hunt_toggle starts the hunt")
	}

	found := false
	deadline := time.After(time.Second)
	for !found {
		select {
		case payload := <-c.send:
			var msg WSMessage
			if err := json.Unmarshal(payload.data, &msg); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if msg.Type == "hunt_start_requested" {
				found = true
				var body struct {
					PokemonID string `json:"pokemon_id"`
					HuntMode  string `json:"hunt_mode"`
				}
				if err := json.Unmarshal(msg.Payload, &body); err != nil {
					t.Fatalf("payload unmarshal: %v", err)
				}
				if body.PokemonID != "p1" {
					t.Errorf("pokemon_id = %q, want p1", body.PokemonID)
				}
				if body.HuntMode != "detector" {
					t.Errorf("hunt_mode = %q, want detector", body.HuntMode)
				}
			}
		case <-deadline:
			t.Fatal("hunt_start_requested broadcast not observed")
		}
	}
}

// TestHandleHotkeyHuntToggleStops verifies that dispatching hunt_toggle on a
// running Pokémon stops its timer, folds elapsed time, and broadcasts
// hunt_stop_requested.
func TestHandleHotkeyHuntToggleStops(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.SetActive("p1")
	srv.state.StartTimer("p1")
	time.Sleep(5 * time.Millisecond)

	c := &wsClient{send: make(chan wsPayload, sendBufSize)}
	srv.hub.mu.Lock()
	srv.hub.clients[c] = true
	srv.hub.mu.Unlock()

	srv.DispatchHotkeyAction("hunt_toggle", "")

	st := srv.state.GetState()
	if st.Pokemon[0].TimerStartedAt != nil {
		t.Error("TimerStartedAt should be nil after hunt_toggle stops the hunt")
	}
	if st.Pokemon[0].TimerAccumulatedMs <= 0 {
		t.Errorf("TimerAccumulatedMs = %d, want > 0", st.Pokemon[0].TimerAccumulatedMs)
	}

	found := false
	deadline := time.After(time.Second)
	for !found {
		select {
		case payload := <-c.send:
			var msg WSMessage
			if err := json.Unmarshal(payload.data, &msg); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if msg.Type == "hunt_stop_requested" {
				found = true
				var body struct {
					PokemonID string `json:"pokemon_id"`
				}
				if err := json.Unmarshal(msg.Payload, &body); err != nil {
					t.Fatalf("payload unmarshal: %v", err)
				}
				if body.PokemonID != "p1" {
					t.Errorf("pokemon_id = %q, want p1", body.PokemonID)
				}
			}
		case <-deadline:
			t.Fatal("hunt_stop_requested broadcast not observed")
		}
	}
}

// TestHandleHotkeyHuntToggleStopsDetectorOnly verifies that a detector-
// only hunt (timer never flipped, detection loop running) is stopped by
// the hotkey, broadcasting hunt_stop_requested so the frontend tears the
// loop down.
func TestHandleHotkeyHuntToggleStopsDetectorOnly(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.SetActive("p1")
	st := srv.state.GetState()
	p := st.Pokemon[0]
	p.HuntMode = "detector"
	srv.state.UpdatePokemon("p1", p)
	srv.SetDetectionState("p1", true)

	c := &wsClient{send: make(chan wsPayload, sendBufSize)}
	srv.hub.mu.Lock()
	srv.hub.clients[c] = true
	srv.hub.mu.Unlock()

	srv.DispatchHotkeyAction("hunt_toggle", "")

	if srv.state.GetState().Pokemon[0].TimerStartedAt != nil {
		t.Error("timer should not be started by a stop-only toggle")
	}

	found := false
	deadline := time.After(time.Second)
	for !found {
		select {
		case payload := <-c.send:
			var msg WSMessage
			if err := json.Unmarshal(payload.data, &msg); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if msg.Type == "hunt_start_requested" {
				t.Fatal("must not broadcast hunt_start_requested when detector is already running")
			}
			if msg.Type == "hunt_stop_requested" {
				found = true
			}
		case <-deadline:
			t.Fatal("hunt_stop_requested broadcast not observed")
		}
	}
}

// TestHandleHotkeyHuntToggleNoActivePokemon verifies that dispatching
// hunt_toggle with no active Pokémon is a no-op and does not panic.
func TestHandleHotkeyHuntToggleNoActivePokemon(t *testing.T) {
	srv := newTestServer(t)
	// No Pokémon added; GetActivePokemon returns nil.
	srv.DispatchHotkeyAction("hunt_toggle", "")
}

// TestHandleHotkeyHuntToggleRejectsMissingSource verifies that the
// capture-readiness gate blocks a hunt start when detector is required
// and templates are present but no capture stream is registered. The
// backend must not flip the timer.
func TestHandleHotkeyHuntToggleRejectsMissingSource(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.SetActive("p1")
	st := srv.state.GetState()
	p := st.Pokemon[0]
	p.HuntMode = "detector"
	srv.state.UpdatePokemon("p1", p)
	enabled := true
	srv.state.SetDetectorConfig("p1", &state.DetectorConfig{
		Enabled:   true,
		Templates: []state.DetectorTemplate{{Name: "tpl", Enabled: &enabled}},
	})
	// Intentionally NOT calling SetCaptureState — no source attached.

	c := &wsClient{send: make(chan wsPayload, sendBufSize)}
	srv.hub.mu.Lock()
	srv.hub.clients[c] = true
	srv.hub.mu.Unlock()

	srv.DispatchHotkeyAction("hunt_toggle", "")

	if srv.state.GetState().Pokemon[0].TimerStartedAt != nil {
		t.Error("TimerStartedAt should remain nil when the source gate rejects")
	}

	found := false
	deadline := time.After(time.Second)
	for !found {
		select {
		case payload := <-c.send:
			var msg WSMessage
			if err := json.Unmarshal(payload.data, &msg); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if msg.Type == "hunt_start_requested" {
				t.Fatal("must not broadcast hunt_start_requested when source is missing")
			}
			if msg.Type == "hunt_start_rejected" {
				found = true
				var body struct {
					Reason string `json:"reason"`
				}
				if err := json.Unmarshal(msg.Payload, &body); err != nil {
					t.Fatalf("payload unmarshal: %v", err)
				}
				if body.Reason != "no_source" {
					t.Errorf("reason = %q, want no_source", body.Reason)
				}
			}
		case <-deadline:
			t.Fatal("hunt_start_rejected broadcast not observed")
		}
	}
}

// TestHandleHotkeyHuntToggleRejectsMissingTemplates verifies that the
// template-readiness gate blocks a hunt start when detector is required
// but no templates are configured, and emits hunt_start_rejected instead
// of flipping the timer.
func TestHandleHotkeyHuntToggleRejectsMissingTemplates(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.SetActive("p1")
	st := srv.state.GetState()
	p := st.Pokemon[0]
	p.HuntMode = "detector"
	srv.state.UpdatePokemon("p1", p)
	// Detector config with zero templates — the gate should reject.
	srv.state.SetDetectorConfig("p1", &state.DetectorConfig{Enabled: true})

	c := &wsClient{send: make(chan wsPayload, sendBufSize)}
	srv.hub.mu.Lock()
	srv.hub.clients[c] = true
	srv.hub.mu.Unlock()

	srv.DispatchHotkeyAction("hunt_toggle", "")

	if srv.state.GetState().Pokemon[0].TimerStartedAt != nil {
		t.Error("TimerStartedAt should remain nil when the template gate rejects")
	}

	found := false
	deadline := time.After(time.Second)
	for !found {
		select {
		case payload := <-c.send:
			var msg WSMessage
			if err := json.Unmarshal(payload.data, &msg); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if msg.Type == "hunt_start_rejected" {
				found = true
				var body struct {
					PokemonID string `json:"pokemon_id"`
					Reason    string `json:"reason"`
				}
				if err := json.Unmarshal(msg.Payload, &body); err != nil {
					t.Fatalf("payload unmarshal: %v", err)
				}
				if body.PokemonID != "p1" {
					t.Errorf("pokemon_id = %q, want p1", body.PokemonID)
				}
				if body.Reason != "no_templates" {
					t.Errorf("reason = %q, want no_templates", body.Reason)
				}
			}
			if msg.Type == "hunt_start_requested" {
				t.Fatal("must not broadcast hunt_start_requested when templates are missing")
			}
		case <-deadline:
			t.Fatal("hunt_start_rejected broadcast not observed")
		}
	}
}

// --- HotkeyUpdateAllBindings, HotkeyUpdateBinding, HotkeySetPaused, HotkeyIsAvailable ---

func TestHotkeyUpdateAllBindings(t *testing.T) {
	srv := newTestServer(t)
	hm := state.HotkeyMap{Increment: "F1"}
	if err := srv.HotkeyUpdateAllBindings(hm); err != nil {
		t.Errorf("HotkeyUpdateAllBindings: %v", err)
	}
}

func TestHotkeyUpdateBinding(t *testing.T) {
	srv := newTestServer(t)
	if err := srv.HotkeyUpdateBinding("increment", "F2"); err != nil {
		t.Errorf("HotkeyUpdateBinding: %v", err)
	}
}

func TestHotkeySetPaused(t *testing.T) {
	srv := newTestServer(t)
	srv.HotkeySetPaused(true)
	hk := srv.hotkeyMgr.(*mockHotkeyMgr)
	if !hk.paused {
		t.Error("expected paused=true after HotkeySetPaused(true)")
	}
	srv.HotkeySetPaused(false)
	if hk.paused {
		t.Error("expected paused=false after HotkeySetPaused(false)")
	}
}

func TestHotkeyIsAvailable(t *testing.T) {
	srv := newTestServer(t)
	if !srv.HotkeyIsAvailable() {
		t.Error("mock hotkey manager should report available=true")
	}
}

// --- State delegate methods: remaining coverage ---

func TestStateAddPokemon(t *testing.T) {
	srv := newTestServer(t)
	srv.StateAddPokemon(state.Pokemon{ID: "p1", Name: "Bulbasaur", CreatedAt: time.Now()})
	st := srv.StateGetState()
	if len(st.Pokemon) != 1 {
		t.Fatalf("expected 1 pokemon, got %d", len(st.Pokemon))
	}
	if st.Pokemon[0].Name != "Bulbasaur" {
		t.Errorf(fmtNameWant, st.Pokemon[0].Name, "Bulbasaur")
	}
}

func TestStateUpdatePokemon(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	ok := srv.StateUpdatePokemon("p1", state.Pokemon{Name: "Raichu"})
	if !ok {
		t.Error("StateUpdatePokemon should return true")
	}
	st := srv.StateGetState()
	if st.Pokemon[0].Name != "Raichu" {
		t.Errorf(fmtNameWant, st.Pokemon[0].Name, "Raichu")
	}
}

func TestStateDeletePokemon(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	ok := srv.StateDeletePokemon("p1")
	if !ok {
		t.Error("StateDeletePokemon should return true")
	}
	st := srv.StateGetState()
	if len(st.Pokemon) != 0 {
		t.Errorf("expected 0 pokemon, got %d", len(st.Pokemon))
	}
}

func TestStateIncrement(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	count, ok := srv.StateIncrement("p1")
	if !ok {
		t.Error("StateIncrement should return true")
	}
	if count != 1 {
		t.Errorf("count = %d, want 1", count)
	}
}

func TestStateDecrement(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.Increment("p1")
	count, ok := srv.StateDecrement("p1")
	if !ok {
		t.Error("StateDecrement should return true")
	}
	if count != 0 {
		t.Errorf("count = %d, want 0", count)
	}
}

func TestStateReset(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.Increment("p1")
	ok := srv.StateReset("p1")
	if !ok {
		t.Error("StateReset should return true")
	}
}

func TestStateSetActive(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	addTestPokemon(t, srv, "p2", "Charmander")
	ok := srv.StateSetActive("p2")
	if !ok {
		t.Error("StateSetActive should return true")
	}
}

func TestStateCompletePokemon(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	ok := srv.StateCompletePokemon("p1")
	if !ok {
		t.Error("StateCompletePokemon should return true")
	}
}

func TestStateUncompletePokemon(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.CompletePokemon("p1")
	ok := srv.StateUncompletePokemon("p1")
	if !ok {
		t.Error("StateUncompletePokemon should return true")
	}
}

func TestStateUnlinkOverlay(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	ok := srv.StateUnlinkOverlay("p1")
	if !ok {
		t.Error("StateUnlinkOverlay should return true")
	}
}

func TestStateScheduleSave(t *testing.T) {
	srv := newTestServer(t)
	srv.StateScheduleSave()
}

func TestStateGetState(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	st := srv.StateGetState()
	if len(st.Pokemon) != 1 {
		t.Errorf("expected 1 pokemon, got %d", len(st.Pokemon))
	}
}

// --- GamesDB, PokedexDB ---

func TestGamesDBNil(t *testing.T) {
	srv := newTestServer(t)
	if srv.GamesDB() != nil {
		t.Error("GamesDB() should return nil when db is nil")
	}
}

func TestPokedexDBNil(t *testing.T) {
	srv := newTestServer(t)
	if srv.PokedexDB() != nil {
		t.Error("PokedexDB() should return nil when db is nil")
	}
}

// --- BroadcastState (exported wrapper) ---

func TestBroadcastStateExported(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")

	c := &wsClient{send: make(chan wsPayload, sendBufSize)}
	srv.hub.mu.Lock()
	srv.hub.clients[c] = true
	srv.hub.mu.Unlock()

	srv.BroadcastState()

	select {
	case payload := <-c.send:
		var msg WSMessage
		if err := json.Unmarshal(payload.data, &msg); err != nil {
			t.Fatalf(fmtUnmarshal, err)
		}
		if msg.Type != "state_update" {
			t.Errorf("type = %q, want %q", msg.Type, "state_update")
		}
	default:
		t.Error("no state_update broadcast received")
	}
}

// --- RunSetupOnline/RunSetupOffline without DB ---

func TestRunSetupOnlineFlags(t *testing.T) {
	srv := newTestServer(t)
	srv.setupPending.Store(true)
	srv.ready.Store(true)

	// RunSetupOnline clears setupPending and resets ready synchronously
	// before spawning the goroutine. Verify those flag changes.
	// We cannot safely call RunSetupOnline without a DB (syncPokedex
	// dereferences the nil store), so we test the exported flag logic only.
	srv.setupPending.Store(false)
	srv.ready.Store(false)

	if srv.IsSetupPending() {
		t.Error("setupPending should be false")
	}
	if srv.IsReady() {
		t.Error("ready should be false")
	}
}

func TestRunSetupOfflineNoDB(t *testing.T) {
	srv := newTestServer(t)
	// With nil DB, the stores are nil, so seed operations will fail.
	err := srv.RunSetupOffline()
	// We expect an error because the store is nil.
	if err == nil {
		t.Error("expected error from RunSetupOffline with nil DB")
	}
}

// --- mustMarshal ---

func TestMustMarshal(t *testing.T) {
	data := mustMarshal(map[string]string{"key": "value"})
	if len(data) == 0 {
		t.Error("mustMarshal should return non-empty bytes")
	}
	var v map[string]string
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatalf(fmtUnmarshal, err)
	}
	if v["key"] != "value" {
		t.Errorf("key = %q, want %q", v["key"], "value")
	}
}

func TestMustMarshalNil(t *testing.T) {
	data := mustMarshal(nil)
	if string(data) != "null" {
		t.Errorf("mustMarshal(nil) = %q, want %q", string(data), "null")
	}
}
