package settings

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// findHotkey returns the stored per-hunt combo of the entry with the given id.
func findHotkey(t *testing.T, deps *testDeps, id string) string {
	t.Helper()
	for _, p := range deps.StateManager().GetState().Pokemon {
		if p.ID == id {
			return p.Hotkey
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

	if rec := putHotkey(t, mux, "/api/hotkeys/pokemon/p1", "F5"); rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body %s", rec.Code, rec.Body.String())
	}
	if got := findHotkey(t, deps, "p1"); got != "F5" {
		t.Errorf("stored hotkey = %q, want %q", got, "F5")
	}

	if rec := putHotkey(t, mux, "/api/hotkeys/pokemon/p1", ""); rec.Code != http.StatusOK {
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

	if rec := putHotkey(t, mux, "/api/hotkeys/pokemon/p1", "F5"); rec.Code != http.StatusOK {
		t.Fatalf("first assignment status = %d, want 200", rec.Code)
	}

	rec := putHotkey(t, mux, "/api/hotkeys/pokemon/p2", "F5")
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
	rec := putHotkey(t, mux, "/api/hotkeys/pokemon/p1", "F1")
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409, body %s", rec.Code, rec.Body.String())
	}
}

func TestSetPokemonHotkeyUnknownEntry(t *testing.T) {
	mux, _ := newTestMux(t)

	if rec := putHotkey(t, mux, "/api/hotkeys/pokemon/nope", "F5"); rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestHotkeyBindingsEndpoint(t *testing.T) {
	mux, deps := newTestMux(t)
	sm := deps.StateManager()
	sm.AddPokemon(state.Pokemon{ID: "p1", Name: "Pikachu"})
	if rec := putHotkey(t, mux, "/api/hotkeys/pokemon/p1", "F5"); rec.Code != http.StatusOK {
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
