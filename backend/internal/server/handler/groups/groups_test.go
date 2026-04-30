// Package groups tests the HTTP handlers for Pokémon organisational groups
// and bulk hunt start/stop endpoints.
package groups

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// --- Mock broadcaster --------------------------------------------------------

// broadcastMsg captures a single BroadcastRaw call for assertions.
type broadcastMsg struct {
	Type    string
	Payload any
}

// --- testDeps ----------------------------------------------------------------

// testDeps wires a real state.Manager to the Deps interface and records
// broadcast calls made by the handlers under test.
type testDeps struct {
	mgr        *state.Manager
	events     []broadcastMsg
	stateEvts  int
	savedCount int
}

func (d *testDeps) StateListGroups() []state.Group { return d.mgr.ListGroups() }

func (d *testDeps) StateCreateGroup(name, color string) (state.Group, error) {
	return d.mgr.CreateGroup(name, color)
}

func (d *testDeps) StateUpdateGroup(id string, patch state.GroupPatch) (state.Group, error) {
	return d.mgr.UpdateGroup(id, patch)
}

func (d *testDeps) StateDeleteGroup(id string) bool { return d.mgr.DeleteGroup(id) }

func (d *testDeps) StateGetState() state.AppState { return d.mgr.GetState() }

func (d *testDeps) StateToggleHunt(id string) (bool, string, bool) {
	return d.mgr.ToggleHunt(id)
}

func (d *testDeps) StateScheduleSave() { d.savedCount++ }

func (d *testDeps) Broadcast(msgType string, payload any) {
	d.events = append(d.events, broadcastMsg{Type: msgType, Payload: payload})
}

func (d *testDeps) BroadcastState() { d.stateEvts++ }

// newTestMux builds a ServeMux with the groups routes registered against a
// fresh testDeps.
func newTestMux(t *testing.T) (*http.ServeMux, *testDeps) {
	t.Helper()
	d := &testDeps{mgr: state.NewManager(t.TempDir())}
	mux := http.NewServeMux()
	RegisterRoutes(mux, d)
	return mux, d
}

// --- CRUD round-trip ---------------------------------------------------------

// TestCreateListUpdateDelete exercises the full CRUD flow over HTTP.
func TestCreateListUpdateDelete(t *testing.T) {
	mux, d := newTestMux(t)

	// Create
	body, _ := json.Marshal(map[string]string{"name": "Legendaries", "color": "#ff0000"})
	req := httptest.NewRequest(http.MethodPost, "/api/groups", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want 201; body = %s", rec.Code, rec.Body.String())
	}
	var created state.Group
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode created: %v", err)
	}
	if created.ID == "" || created.Name != "Legendaries" {
		t.Errorf("created = %+v", created)
	}

	// List
	req = httptest.NewRequest(http.MethodGet, "/api/groups", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list status = %d, want 200", rec.Code)
	}
	var list listGroupsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(list.Groups) != 1 || list.Groups[0].ID != created.ID {
		t.Errorf("list = %+v", list)
	}

	// Update (toggle collapsed)
	up, _ := json.Marshal(map[string]any{"collapsed": true})
	req = httptest.NewRequest(http.MethodPut, "/api/groups/"+created.ID, bytes.NewReader(up))
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("update status = %d, want 200", rec.Code)
	}
	var updated state.Group
	if err := json.Unmarshal(rec.Body.Bytes(), &updated); err != nil {
		t.Fatalf("decode updated: %v", err)
	}
	if !updated.Collapsed {
		t.Error("Collapsed should be true after update")
	}

	// Delete
	req = httptest.NewRequest(http.MethodDelete, "/api/groups/"+created.ID, nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204", rec.Code)
	}
	if got := d.mgr.ListGroups(); len(got) != 0 {
		t.Errorf("ListGroups len = %d, want 0 after delete", len(got))
	}
}

// TestCreateEmptyNameReturns400 verifies the validation error is surfaced
// as an HTTP 400 rather than silently creating a nameless group.
func TestCreateEmptyNameReturns400(t *testing.T) {
	mux, _ := newTestMux(t)
	body, _ := json.Marshal(map[string]string{"name": "  "})
	req := httptest.NewRequest(http.MethodPost, "/api/groups", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

// TestUpdateUnknownGroupReturns404 verifies that PUT on an unknown id fails.
func TestUpdateUnknownGroupReturns404(t *testing.T) {
	mux, _ := newTestMux(t)
	name := "new"
	body, _ := json.Marshal(map[string]any{"name": name})
	req := httptest.NewRequest(http.MethodPut, "/api/groups/missing", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

// --- Start / stop hunt -------------------------------------------------------

// TestStartHuntOnlyAffectsNonRunningMembers verifies that start-hunt toggles
// and broadcasts only for Pokémon that are not already running.
func TestStartHuntOnlyAffectsNonRunningMembers(t *testing.T) {
	mux, d := newTestMux(t)
	g, err := d.mgr.CreateGroup("Hunts", "")
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}

	// Three Pokémon: p1 and p2 in the group, p3 outside. p2 already running.
	d.mgr.AddPokemon(state.Pokemon{ID: "p1", Name: "A", CreatedAt: time.Now(), HuntMode: "timer"})
	d.mgr.AddPokemon(state.Pokemon{ID: "p2", Name: "B", CreatedAt: time.Now(), HuntMode: "both"})
	d.mgr.AddPokemon(state.Pokemon{ID: "p3", Name: "C", CreatedAt: time.Now()})
	if !d.mgr.SetPokemonGroup("p1", g.ID) || !d.mgr.SetPokemonGroup("p2", g.ID) {
		t.Fatal("SetPokemonGroup failed")
	}
	if !d.mgr.StartTimer("p2") {
		t.Fatal("StartTimer p2 failed")
	}

	req := httptest.NewRequest(http.MethodPost, "/api/groups/"+g.ID+"/start-hunt", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", rec.Code, rec.Body.String())
	}

	var resp huntBulkResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.Members) != 2 {
		t.Fatalf("Members len = %d, want 2", len(resp.Members))
	}

	results := map[string]huntMemberResult{}
	for _, m := range resp.Members {
		results[m.ID] = m
	}
	if !results["p1"].Started {
		t.Errorf("p1 Started = false, want true")
	}
	if results["p2"].Started {
		t.Errorf("p2 Started = true, want false (already running)")
	}
	if results["p2"].Reason != reasonAlreadyRun {
		t.Errorf("p2 Reason = %q, want %q", results["p2"].Reason, reasonAlreadyRun)
	}

	// Broadcast: one hunt_start_requested event per in-group member (2).
	// The currently running p2 still gets an event so the frontend can
	// (re)start a detection loop that was never attached.
	startEvents := map[string]map[string]any{}
	for _, e := range d.events {
		if e.Type == wsHuntStartEvent {
			payload, ok := e.Payload.(map[string]any)
			if !ok {
				t.Fatalf("payload type = %T, want map[string]any", e.Payload)
			}
			id, _ := payload["pokemon_id"].(string)
			startEvents[id] = payload
		}
	}
	if len(startEvents) != 2 {
		t.Errorf("start events = %d, want 2 (p1 and p2)", len(startEvents))
	}
	if startEvents["p1"] == nil {
		t.Error("missing start event for p1")
	} else if startEvents["p1"]["hunt_mode"] != "timer" {
		t.Errorf("p1 hunt_mode = %v, want %q", startEvents["p1"]["hunt_mode"], "timer")
	}
	if startEvents["p2"] == nil {
		t.Error("missing start event for p2 (already running)")
	}

	// p3 (outside the group) must not have been touched.
	st := d.mgr.GetState()
	for _, p := range st.Pokemon {
		if p.ID == "p3" && p.TimerStartedAt != nil {
			t.Error("p3 (outside group) should not have been started")
		}
	}
}

// TestStopHuntOnlyAffectsRunningMembers verifies that stop-hunt toggles and
// broadcasts only for Pokémon whose timer is currently running.
func TestStopHuntOnlyAffectsRunningMembers(t *testing.T) {
	mux, d := newTestMux(t)
	g, _ := d.mgr.CreateGroup("Hunts", "")

	d.mgr.AddPokemon(state.Pokemon{ID: "p1", Name: "A", CreatedAt: time.Now()})
	d.mgr.AddPokemon(state.Pokemon{ID: "p2", Name: "B", CreatedAt: time.Now()})
	d.mgr.SetPokemonGroup("p1", g.ID)
	d.mgr.SetPokemonGroup("p2", g.ID)
	// p1 running, p2 idle.
	d.mgr.StartTimer("p1")

	req := httptest.NewRequest(http.MethodPost, "/api/groups/"+g.ID+"/stop-hunt", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var resp huntBulkResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	results := map[string]huntMemberResult{}
	for _, m := range resp.Members {
		results[m.ID] = m
	}
	if !results["p1"].Stopped {
		t.Errorf("p1 Stopped = false, want true")
	}
	if results["p2"].Stopped {
		t.Errorf("p2 Stopped = true, want false (was not running)")
	}
	if results["p2"].Reason != reasonNotRunning {
		t.Errorf("p2 Reason = %q, want %q", results["p2"].Reason, reasonNotRunning)
	}

	// Both members get a stop event so the frontend can tear down detection
	// loops even on members whose timer was never started.
	stopEvents := map[string]bool{}
	for _, e := range d.events {
		if e.Type == wsHuntStopEvent {
			payload, _ := e.Payload.(map[string]any)
			if id, ok := payload["pokemon_id"].(string); ok {
				stopEvents[id] = true
			}
		}
	}
	if len(stopEvents) != 2 {
		t.Errorf("stop events = %d, want 2 (p1 and p2)", len(stopEvents))
	}
	if !stopEvents["p1"] || !stopEvents["p2"] {
		t.Errorf("missing stop event: got %v", stopEvents)
	}
}

// TestStartHuntUnknownGroup verifies 404 for an unknown group id.
func TestStartHuntUnknownGroup(t *testing.T) {
	mux, _ := newTestMux(t)
	req := httptest.NewRequest(http.MethodPost, "/api/groups/missing/start-hunt", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

// TestStopHuntUnknownGroup verifies 404 for an unknown group id.
func TestStopHuntUnknownGroup(t *testing.T) {
	mux, _ := newTestMux(t)
	req := httptest.NewRequest(http.MethodPost, "/api/groups/missing/stop-hunt", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

// TestMethodNotAllowed verifies that unsupported methods return 405.
func TestMethodNotAllowed(t *testing.T) {
	mux, _ := newTestMux(t)
	req := httptest.NewRequest(http.MethodPatch, "/api/groups", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", rec.Code)
	}
}
