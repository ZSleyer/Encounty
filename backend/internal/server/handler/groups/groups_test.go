// Package groups tests the HTTP handlers for Pokémon organisational groups
// and bulk hunt start/stop endpoints.
package groups

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

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

// TestMethodNotAllowed verifies that unsupported methods return 405.
// TestRemovedHuntRoutesDoNotMatchAnotherOperation pins where the retired bulk
// endpoints land now. The suffix branches are gone, so the trailing segment
// stays part of the id: the request must fail to find a group rather than
// silently reaching another group operation with a nonsense id.
func TestRemovedHuntRoutesDoNotMatchAnotherOperation(t *testing.T) {
	mux, deps := newTestMux(t)
	g, err := deps.mgr.CreateGroup("Team", "")
	if err != nil {
		t.Fatal(err)
	}

	for _, suffix := range []string{"/start-hunt", "/stop-hunt"} {
		req := httptest.NewRequest(http.MethodPost, "/api/groups/"+g.ID+suffix, nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)

		if w.Code != http.StatusMethodNotAllowed {
			t.Errorf("POST %s = %d, want 405", suffix, w.Code)
		}
		if groups := deps.mgr.ListGroups(); len(groups) != 1 || groups[0].Name != "Team" {
			t.Errorf("group was modified by POST %s: %+v", suffix, groups)
		}
	}

	// The same path with a mutating method must not update or delete the group
	// either: the id carries the suffix and matches nothing.
	req := httptest.NewRequest(http.MethodDelete, "/api/groups/"+g.ID+"/start-hunt", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("DELETE with a stale suffix = %d, want 404", w.Code)
	}
	if len(deps.mgr.ListGroups()) != 1 {
		t.Error("group was deleted through a stale hunt URL")
	}
}

func TestMethodNotAllowed(t *testing.T) {
	mux, _ := newTestMux(t)
	req := httptest.NewRequest(http.MethodPatch, "/api/groups", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", rec.Code)
	}
}
