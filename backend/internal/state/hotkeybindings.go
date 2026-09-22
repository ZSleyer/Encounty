// hotkeybindings.go resolves the persisted hotkey configuration into the flat
// list of bindings the platform hotkey managers register, and answers whether
// a combo is still free. The global bindings of HotkeyMap and the optional key
// a single hunt or group carries live in different places, so every consumer
// that needs "all keys currently in use" goes through here instead of
// assembling the two halves itself.

package state

import "strings"

// hotkeyActionsInOrder pairs each global action name with the HotkeyMap field
// holding its combo. The names are the ones the managers and the dispatcher
// match on, which is why "next" appears here and not the "next_pokemon" the
// HTTP and JSON layers use.
func hotkeyActionsInOrder(hm HotkeyMap) []HotkeyBinding {
	return []HotkeyBinding{
		{Action: "increment", Combo: hm.Increment},
		{Action: "decrement", Combo: hm.Decrement},
		{Action: "reset", Combo: hm.Reset},
		{Action: "next", Combo: hm.NextPokemon},
		{Action: "hunt_toggle", Combo: hm.HuntToggle},
	}
}

// HotkeyBindings returns every key binding that should currently be live: the
// global ones from HotkeyMap, which follow the active target, followed by one
// increment binding for each running hunt and each group that carries a key of
// its own. Finished hunts are skipped because their counter cannot move, so
// leaving their key registered would occupy it for nothing.
func (m *Manager) HotkeyBindings() []HotkeyBinding {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return HotkeyBindingsOf(m.state)
}

// HotkeyBindingsOf builds the binding list from a state snapshot. The change
// notifier hands its listeners a snapshot, so building from one lets a listener
// rebind without reaching back into the manager for a state that may already
// have moved on.
func HotkeyBindingsOf(st AppState) []HotkeyBinding {
	out := make([]HotkeyBinding, 0, 5+len(st.Pokemon)+len(st.Groups))
	for _, b := range hotkeyActionsInOrder(st.Hotkeys) {
		if b.Combo != "" {
			out = append(out, b)
		}
	}
	for _, p := range st.Pokemon {
		if p.Hotkey == "" || !isLiveHunt(p) {
			continue
		}
		out = append(out, HotkeyBinding{Action: "increment", Combo: p.Hotkey, PokemonID: p.ID})
	}
	for _, g := range st.Groups {
		if g.Hotkey == "" {
			continue
		}
		out = append(out, HotkeyBinding{Action: "increment", Combo: g.Hotkey, GroupID: g.ID})
	}
	return out
}

// isLiveHunt reports whether the entry is a hunt that can still be counted.
// A completed or failed hunt is an archive entry; increments skip it.
func isLiveHunt(p Pokemon) bool {
	return p.CompletedAt == nil && !p.Failed
}

// HotkeyOwner names what currently holds a combo. Kind is "action", "pokemon"
// or "group"; ID is the entry id, empty for a global action; Label is the
// action name or the entry's display name, so a caller can tell the user which
// binding is in the way.
type HotkeyOwner struct {
	Kind  string `json:"kind"`
	ID    string `json:"id,omitempty"`
	Label string `json:"label"`
}

// HotkeyConflict reports which other binding already holds combo, ignoring the
// binding identified by exceptKind and exceptID so reassigning a key to its
// current holder is not a conflict. It returns nil when the combo is free.
//
// The check has to be a hard gate rather than a hint: on Windows a duplicate
// combo makes RegisterHotKey fail for whichever binding is registered second,
// and that failure is invisible to the user.
func (m *Manager) HotkeyConflict(combo, exceptKind, exceptID string) *HotkeyOwner {
	if combo == "" {
		return nil
	}
	m.mu.RLock()
	defer m.mu.RUnlock()

	if owner := m.conflictingAction(combo, exceptKind, exceptID); owner != nil {
		return owner
	}
	for _, p := range m.state.Pokemon {
		if !isLiveHunt(p) || !sameCombo(p.Hotkey, combo) {
			continue
		}
		if exceptKind == "pokemon" && exceptID == p.ID {
			continue
		}
		return &HotkeyOwner{Kind: "pokemon", ID: p.ID, Label: p.Name}
	}
	for _, g := range m.state.Groups {
		if !sameCombo(g.Hotkey, combo) {
			continue
		}
		if exceptKind == "group" && exceptID == g.ID {
			continue
		}
		return &HotkeyOwner{Kind: "group", ID: g.ID, Label: g.Name}
	}
	return nil
}

// conflictingAction reports which global action holds combo. Callers hold m.mu.
func (m *Manager) conflictingAction(combo, exceptKind, exceptID string) *HotkeyOwner {
	for _, b := range hotkeyActionsInOrder(m.state.Hotkeys) {
		if !sameCombo(b.Combo, combo) {
			continue
		}
		if exceptKind == "action" && exceptID == b.Action {
			continue
		}
		return &HotkeyOwner{Kind: "action", ID: b.Action, Label: b.Action}
	}
	return nil
}

// sameCombo compares two key combos the way the managers do, which is case
// insensitively: the recorder sends "F5" while a hand-edited config may hold
// "f5", and both register the same physical key.
func sameCombo(a, b string) bool {
	return a != "" && strings.EqualFold(a, b)
}

// SetPokemonHotkey stores the per-hunt key combo on the given entry. An empty
// combo clears it. Returns false if no entry with that id exists.
func (m *Manager) SetPokemonHotkey(id, combo string) bool {
	m.mu.Lock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			m.state.Pokemon[i].Hotkey = combo
			m.mu.Unlock()
			m.markDirty()
			return true
		}
	}
	m.mu.Unlock()
	return false
}

// SetGroupHotkey stores the per-group key combo. An empty combo clears it.
// Returns false if no group with that id exists.
func (m *Manager) SetGroupHotkey(id, combo string) bool {
	m.mu.Lock()
	for i := range m.state.Groups {
		if m.state.Groups[i].ID == id {
			m.state.Groups[i].Hotkey = combo
			m.mu.Unlock()
			m.markDirty()
			return true
		}
	}
	m.mu.Unlock()
	return false
}

// hotkeyTakenByOther reports whether combo is held by any live binding other
// than the hunt with the given id. Callers hold m.mu.
func (m *Manager) hotkeyTakenByOther(combo, exceptPokemonID string) bool {
	if combo == "" {
		return false
	}
	if m.conflictingAction(combo, "", "") != nil {
		return true
	}
	for _, p := range m.state.Pokemon {
		if p.ID != exceptPokemonID && isLiveHunt(p) && sameCombo(p.Hotkey, combo) {
			return true
		}
	}
	for _, g := range m.state.Groups {
		if sameCombo(g.Hotkey, combo) {
			return true
		}
	}
	return false
}
