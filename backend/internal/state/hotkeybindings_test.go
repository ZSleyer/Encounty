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
	m.AddPokemon(Pokemon{ID: "a", Name: "Pikachu", Hotkeys: EntryHotkeys{Increment: "F5", Decrement: "F9"}})
	m.AddPokemon(Pokemon{ID: "b", Name: "Eevee", Hotkeys: EntryHotkeys{Increment: "F6"}})
	m.AddPokemon(Pokemon{ID: "c", Name: "Ditto", Hotkeys: EntryHotkeys{Increment: "F7"}, CompletedAt: &done})
	g, err := m.CreateGroup("Safari", "")
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	m.SetGroupHotkey(g.ID, "increment", "F8")
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
	m.SetPokemonHotkey("b", "increment", "F6")
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
		name     string
		combo    string
		except   HotkeyTarget
		wantKind string
		wantID   string
	}{
		{name: "free combo", combo: "F12"},
		{name: "a free combo next to a taken one", combo: "F11"},
		{name: "empty combo", combo: ""},
		{name: "global action", combo: "F1", wantKind: "action", wantID: "increment"},
		{name: "another hunt", combo: "F5", wantKind: "pokemon", wantID: "a"},
		{name: "a group", combo: "F8", wantKind: "group"},
		{name: "case insensitive", combo: "f5", wantKind: "pokemon", wantID: "a"},
		{name: "its own slot", combo: "F5", except: HotkeyTarget{Kind: "pokemon", ID: "a", Action: "increment"}},
		{name: "another slot on the same entry", combo: "F5", except: HotkeyTarget{Kind: "pokemon", ID: "a", Action: "reset"}, wantKind: "pokemon", wantID: "a"},
		{name: "a decrement key", combo: "F9", wantKind: "pokemon", wantID: "a"},
		{name: "finished hunt frees its key", combo: "F7"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := m.HotkeyConflict(tc.combo, tc.except)
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
	m.AddPokemon(Pokemon{ID: "a", Name: "Pikachu", Hotkeys: EntryHotkeys{Increment: "F5"}, CompletedAt: &done})
	m.AddPokemon(Pokemon{ID: "b", Name: "Eevee", Hotkeys: EntryHotkeys{Increment: "F5"}})

	if !m.UncompletePokemon("a") {
		t.Fatal("UncompletePokemon returned false")
	}
	for _, p := range m.GetState().Pokemon {
		if p.ID == "a" && p.Hotkeys.Increment != "" {
			t.Errorf("revived hunt kept the taken key %q, want it cleared", p.Hotkeys.Increment)
		}
		if p.ID == "b" && p.Hotkeys.Increment != "F5" {
			t.Errorf("holder lost its key, Increment = %q, want %q", p.Hotkeys.Increment, "F5")
		}
	}
}

func TestUncompleteKeepsAFreeHotkey(t *testing.T) {
	m := NewManager(t.TempDir())
	done := time.Now()
	m.AddPokemon(Pokemon{ID: "a", Name: "Pikachu", Hotkeys: EntryHotkeys{Increment: "F9"}, CompletedAt: &done})

	if !m.UncompletePokemon("a") {
		t.Fatal("UncompletePokemon returned false")
	}
	if got := m.GetState().Pokemon[0].Hotkeys.Increment; got != "F9" {
		t.Errorf("Increment = %q, want %q", got, "F9")
	}
}

func TestHotkeyMapConflict(t *testing.T) {
	m := newHotkeyTestManager(t)

	// A map that binds one combo to two actions cannot be registered.
	dup := HotkeyMap{Increment: "F11", Decrement: "F11"}
	if got := m.HotkeyMapConflict(dup); got == nil || got.Kind != "action" {
		t.Errorf("HotkeyMapConflict(duplicate) = %+v, want an action conflict", got)
	}

	// A combo a running hunt holds is taken too.
	if got := m.HotkeyMapConflict(HotkeyMap{Increment: "F5"}); got == nil || got.ID != "a" {
		t.Errorf("HotkeyMapConflict(hunt key) = %+v, want the hunt a", got)
	}

	// Reusing the keys the map itself replaces is fine.
	free := HotkeyMap{Increment: "F1", Decrement: "F2", Reset: "F3", NextPokemon: "F4"}
	if got := m.HotkeyMapConflict(free); got != nil {
		t.Errorf("HotkeyMapConflict(current defaults) = %+v, want no conflict", got)
	}
}

// TestHotkeyConflictUsesCanonicalCombo checks that reordered modifiers and
// modifier aliases are recognized as the key already taken.
func TestHotkeyConflictUsesCanonicalCombo(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(Pokemon{ID: "a", Name: "Pikachu", Hotkeys: EntryHotkeys{Increment: "Ctrl+Shift+F1", Reset: "Control+F2"}})

	for _, combo := range []string{"Shift+Ctrl+F1", "shift+control+f1", "Ctrl+F2"} {
		if got := m.HotkeyConflict(combo, HotkeyTarget{}); got == nil || got.ID != "a" {
			t.Errorf("HotkeyConflict(%q) = %+v, want hunt a", combo, got)
		}
	}
	if got := m.HotkeyMapConflict(HotkeyMap{Increment: "F3", Decrement: "Shift+Ctrl+F1"}); got == nil || got.ID != "a" {
		t.Errorf("HotkeyMapConflict(reordered) = %+v, want hunt a", got)
	}
	if got := m.HotkeyMapConflict(HotkeyMap{Increment: "Alt+Ctrl+F3", Decrement: "Ctrl+Alt+F3"}); got == nil || got.Kind != "action" {
		t.Errorf("HotkeyMapConflict(duplicate within map) = %+v, want an action conflict", got)
	}
}
