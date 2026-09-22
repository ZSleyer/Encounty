package settings

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// findHotkey returns the stored increment combo of the entry with the given id.
func findHotkey(t *testing.T, deps *testDeps, id string) string {
	t.Helper()
	for _, p := range deps.StateManager().GetState().Pokemon {
		if p.ID == id {
			return p.Hotkeys.Increment
		}
	}
	t.Fatalf("no entry with id %q", id)
	return ""
}

// putHotkey issues a PUT against one of the hotkey routes and returns the
// recorder, so a test can assert on both the status and the body.
func putHotkey(t *testing.T, mux *http.ServeMux, path, key string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]string{"key": key})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPut, path, bytes.NewReader(body))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestSetPokemonHotkey(t *testing.T) {
	mux, deps := newTestMux(t)
	sm := deps.StateManager()
	sm.AddPokemon(state.Pokemon{ID: "p1", Name: "Pikachu"})

	if rec := putHotkey(t, mux, "/api/hotkeys/pokemon/p1/increment", "F5"); rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body %s", rec.Code, rec.Body.String())
	}
	if got := findHotkey(t, deps, "p1"); got != "F5" {
		t.Errorf("stored hotkey = %q, want %q", got, "F5")
	}

	if rec := putHotkey(t, mux, "/api/hotkeys/pokemon/p1/increment", ""); rec.Code != http.StatusOK {
		t.Fatalf("clear status = %d, want 200", rec.Code)
	}
	if got := findHotkey(t, deps, "p1"); got != "" {
		t.Errorf("hotkey after clear = %q, want empty", got)
	}
}

func TestSetPokemonHotkeyRejectsATakenCombo(t *testing.T) {
	mux, deps := newTestMux(t)
	sm := deps.StateManager()
	sm.AddPokemon(state.Pokemon{ID: "p1", Name: "Pikachu"})
	sm.AddPokemon(state.Pokemon{ID: "p2", Name: "Eevee"})

	if rec := putHotkey(t, mux, "/api/hotkeys/pokemon/p1/increment", "F5"); rec.Code != http.StatusOK {
		t.Fatalf("first assignment status = %d, want 200", rec.Code)
	}

	rec := putHotkey(t, mux, "/api/hotkeys/pokemon/p2/increment", "F5")
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409, body %s", rec.Code, rec.Body.String())
	}
	var resp hotkeyConflictResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Owner == nil || resp.Owner.ID != "p1" {
		t.Errorf("owner = %+v, want the hunt p1", resp.Owner)
	}
	if got := findHotkey(t, deps, "p2"); got != "" {
		t.Errorf("rejected key was stored anyway: %q", got)
	}
}

func TestSetPokemonHotkeyRejectsAGlobalCombo(t *testing.T) {
	mux, deps := newTestMux(t)
	deps.StateManager().AddPokemon(state.Pokemon{ID: "p1", Name: "Pikachu"})

	// F1 is the default increment binding.
	rec := putHotkey(t, mux, "/api/hotkeys/pokemon/p1/increment", "F1")
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409, body %s", rec.Code, rec.Body.String())
	}
}

func TestSetPokemonHotkeyUnknownEntry(t *testing.T) {
	mux, _ := newTestMux(t)

	if rec := putHotkey(t, mux, "/api/hotkeys/pokemon/nope/increment", "F5"); rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestHotkeyBindingsEndpoint(t *testing.T) {
	mux, deps := newTestMux(t)
	sm := deps.StateManager()
	sm.AddPokemon(state.Pokemon{ID: "p1", Name: "Pikachu"})
	if rec := putHotkey(t, mux, "/api/hotkeys/pokemon/p1/increment", "F5"); rec.Code != http.StatusOK {
		t.Fatalf("assignment status = %d, want 200", rec.Code)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/hotkeys/bindings", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var bindings []struct {
		Action    string `json:"action"`
		Combo     string `json:"combo"`
		PokemonID string `json:"pokemon_id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &bindings); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	found := false
	for _, b := range bindings {
		if b.Combo == "F5" && b.PokemonID == "p1" && b.Action == "increment" {
			found = true
		}
	}
	if !found {
		t.Errorf("bindings = %+v, want one pinned to p1", bindings)
	}
}

func TestSetPokemonHotkeyPerAction(t *testing.T) {
	mux, deps := newTestMux(t)
	sm := deps.StateManager()
	sm.AddPokemon(state.Pokemon{ID: "p1", Name: "Pikachu"})

	for path, key := range map[string]string{
		"/api/hotkeys/pokemon/p1/increment": "F5",
		"/api/hotkeys/pokemon/p1/decrement": "F6",
		"/api/hotkeys/pokemon/p1/reset":     "F7",
	} {
		if rec := putHotkey(t, mux, path, key); rec.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want 200, body %s", path, rec.Code, rec.Body.String())
		}
	}

	keys := deps.StateManager().GetState().Pokemon[0].Hotkeys
	if keys.Increment != "F5" || keys.Decrement != "F6" || keys.Reset != "F7" {
		t.Fatalf("stored keys = %+v, want F5/F6/F7", keys)
	}

	// Clearing one slot must leave the other two alone.
	if rec := putHotkey(t, mux, "/api/hotkeys/pokemon/p1/decrement", ""); rec.Code != http.StatusOK {
		t.Fatalf("clear status = %d, want 200", rec.Code)
	}
	keys = deps.StateManager().GetState().Pokemon[0].Hotkeys
	if keys.Increment != "F5" || keys.Decrement != "" || keys.Reset != "F7" {
		t.Errorf("keys after clearing decrement = %+v, want F5//F7", keys)
	}
}

func TestSetPokemonHotkeyUnknownAction(t *testing.T) {
	mux, deps := newTestMux(t)
	deps.StateManager().AddPokemon(state.Pokemon{ID: "p1", Name: "Pikachu"})

	// hunt_toggle is a global action and cannot be bound per entry.
	if rec := putHotkey(t, mux, "/api/hotkeys/pokemon/p1/hunt_toggle", "F5"); rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body %s", rec.Code, rec.Body.String())
	}
}

func TestSetGroupHotkeyPerAction(t *testing.T) {
	mux, deps := newTestMux(t)
	g, err := deps.StateManager().CreateGroup("Safari", "")
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}

	if rec := putHotkey(t, mux, "/api/hotkeys/group/"+g.ID+"/reset", "F8"); rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body %s", rec.Code, rec.Body.String())
	}
	if got := deps.StateManager().GetState().Groups[0].Hotkeys.Reset; got != "F8" {
		t.Errorf("group reset key = %q, want %q", got, "F8")
	}
}
