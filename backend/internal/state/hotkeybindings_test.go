package state

import (
	"testing"
	"time"
)

// newHotkeyTestManager returns a manager with two running hunts, one finished
// hunt and one group, each carrying a key of its own.
func newHotkeyTestManager(t *testing.T) *Manager {
	t.Helper()
	m := NewManager(t.TempDir())
	done := time.Now()
	m.AddPokemon(Pokemon{ID: "a", Name: "Pikachu", Hotkey: "F5"})
	m.AddPokemon(Pokemon{ID: "b", Name: "Eevee", Hotkey: "F6"})
	m.AddPokemon(Pokemon{ID: "c", Name: "Ditto", Hotkey: "F7", CompletedAt: &done})
	g, err := m.CreateGroup("Safari", "")
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	m.SetGroupHotkey(g.ID, "F8")
	return m
}

func TestHotkeyBindingsIncludesGlobalsAndTargets(t *testing.T) {
	m := newHotkeyTestManager(t)

	byCombo := map[string]HotkeyBinding{}
	for _, b := range m.HotkeyBindings() {
		byCombo[b.Combo] = b
	}

	// The defaults bind increment through next_pokemon to F1..F4.
	if got := byCombo["F1"]; got.Action != "increment" || got.PokemonID != "" || got.GroupID != "" {
		t.Errorf("F1 binding = %+v, want a global increment", got)
	}
	if got := byCombo["F4"]; got.Action != "next" {
		t.Errorf("F4 action = %q, want %q", got.Action, "next")
	}
	if got := byCombo["F5"]; got.Action != "increment" || got.PokemonID != "a" {
		t.Errorf("F5 binding = %+v, want an increment pinned to hunt a", got)
	}
	if got := byCombo["F8"]; got.Action != "increment" || got.GroupID == "" {
		t.Errorf("F8 binding = %+v, want an increment pinned to the group", got)
	}
}

func TestHotkeyBindingsSkipsFinishedHunts(t *testing.T) {
	m := newHotkeyTestManager(t)
	for _, b := range m.HotkeyBindings() {
		if b.PokemonID == "c" {
			t.Fatalf("finished hunt still bound: %+v", b)
		}
	}

	// Failing a hunt retires its key the same way completing one does.
	m.SetPokemonHotkey("b", "F6")
	m.FailPokemon("b")
	for _, b := range m.HotkeyBindings() {
		if b.PokemonID == "b" {
			t.Fatalf("failed hunt still bound: %+v", b)
		}
	}
}

func TestHotkeyConflict(t *testing.T) {
	m := newHotkeyTestManager(t)

	tests := []struct {
		name       string
		combo      string
		exceptKind string
		exceptID   string
		wantKind   string
		wantID     string
	}{
		{name: "free combo", combo: "F12"},
		{name: "empty combo", combo: ""},
		{name: "global action", combo: "F1", wantKind: "action", wantID: "increment"},
		{name: "another hunt", combo: "F5", wantKind: "pokemon", wantID: "a"},
		{name: "a group", combo: "F8", wantKind: "group"},
		{name: "case insensitive", combo: "f5", wantKind: "pokemon", wantID: "a"},
		{name: "its own holder", combo: "F5", exceptKind: "pokemon", exceptID: "a"},
		{name: "finished hunt frees its key", combo: "F7"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := m.HotkeyConflict(tc.combo, tc.exceptKind, tc.exceptID)
			if tc.wantKind == "" {
				if got != nil {
					t.Fatalf("HotkeyConflict(%q) = %+v, want no conflict", tc.combo, got)
				}
				return
			}
			if got == nil {
				t.Fatalf("HotkeyConflict(%q) = nil, want %s %s", tc.combo, tc.wantKind, tc.wantID)
			}
			if tc.wantID != "" && got.ID != tc.wantID {
				t.Errorf("HotkeyConflict(%q) id = %q, want %q", tc.combo, got.ID, tc.wantID)
			}
			if got.Kind != tc.wantKind {
				t.Errorf("HotkeyConflict(%q) = %+v, want kind %q", tc.combo, got, tc.wantKind)
			}
		})
	}
}

func TestUncompleteClearsATakenHotkey(t *testing.T) {
	m := NewManager(t.TempDir())
	done := time.Now()
	m.AddPokemon(Pokemon{ID: "a", Name: "Pikachu", Hotkey: "F5", CompletedAt: &done})
	m.AddPokemon(Pokemon{ID: "b", Name: "Eevee", Hotkey: "F5"})

	if !m.UncompletePokemon("a") {
		t.Fatal("UncompletePokemon returned false")
	}
	for _, p := range m.GetState().Pokemon {
		if p.ID == "a" && p.Hotkey != "" {
			t.Errorf("revived hunt kept the taken key %q, want it cleared", p.Hotkey)
		}
		if p.ID == "b" && p.Hotkey != "F5" {
			t.Errorf("holder lost its key, Hotkey = %q, want %q", p.Hotkey, "F5")
		}
	}
}

func TestUncompleteKeepsAFreeHotkey(t *testing.T) {
	m := NewManager(t.TempDir())
	done := time.Now()
	m.AddPokemon(Pokemon{ID: "a", Name: "Pikachu", Hotkey: "F9", CompletedAt: &done})

	if !m.UncompletePokemon("a") {
		t.Fatal("UncompletePokemon returned false")
	}
	if got := m.GetState().Pokemon[0].Hotkey; got != "F9" {
		t.Errorf("Hotkey = %q, want %q", got, "F9")
	}
}
