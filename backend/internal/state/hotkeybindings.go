// hotkeybindings.go resolves the persisted hotkey configuration into the flat
// list of bindings the platform hotkey managers register, and answers whether
// a combo is still free. The global bindings of HotkeyMap and the optional key
// a single hunt or group carries live in different places, so every consumer
// that needs "all keys currently in use" goes through here instead of
// assembling the two halves itself.

package state

import (
	"log/slog"
	"sync"

	"github.com/zsleyer/encounty/backend/internal/keycombo"
)

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
//
// Every combo appears at most once in the result. The conflict checks keep
// duplicates out of new edits, but a restored backup, a legacy JSON file or an
// old database can still carry two bindings for one physical key, and
// registering both would count one press twice (or, on Windows, silently fail
// the second registration). Precedence is the list order, first wins: global
// actions, then running hunts in state order, then groups in state order. That
// matches the macOS Electron path, where the first registration of an
// accelerator wins. Each dropped binding is logged once per process.
func HotkeyBindingsOf(st AppState) []HotkeyBinding {
	perEntry := len(EntryHotkeyActions)
	out := make([]HotkeyBinding, 0, 5+perEntry*(len(st.Pokemon)+len(st.Groups)))
	for _, b := range hotkeyActionsInOrder(st.Hotkeys) {
		if b.Combo != "" {
			out = append(out, b)
		}
	}
	for _, p := range st.Pokemon {
		if p.Hotkeys.IsEmpty() || !isLiveHunt(p) {
			continue
		}
		for _, action := range EntryHotkeyActions {
			if combo := p.Hotkeys.Combo(action); combo != "" {
				out = append(out, HotkeyBinding{Action: action, Combo: combo, PokemonID: p.ID})
			}
		}
	}
	for _, g := range st.Groups {
		for _, action := range EntryHotkeyActions {
			if combo := g.Hotkeys.Combo(action); combo != "" {
				out = append(out, HotkeyBinding{Action: action, Combo: combo, GroupID: g.ID})
			}
		}
	}
	return dropDuplicateCombos(out)
}

// droppedHotkeysLogged remembers which dropped bindings were already reported.
// The list is rebuilt on every state change, counter presses included, so
// without it one stale duplicate would log a warning per encounter.
var droppedHotkeysLogged sync.Map

// dropDuplicateCombos keeps the first binding of every canonical combo and
// logs each later one it discards. It filters in place because the input is a
// freshly built slice nobody else holds.
func dropDuplicateCombos(in []HotkeyBinding) []HotkeyBinding {
	seen := make(map[string]HotkeyBinding, len(in))
	out := in[:0]
	for _, b := range in {
		key := keycombo.Canonical(b.Combo)
		if winner, taken := seen[key]; taken {
			logDroppedHotkey(key, b, winner)
			continue
		}
		seen[key] = b
		out = append(out, b)
	}
	return out
}

// logDroppedHotkey warns about a binding that lost its combo to winner, once
// per distinct loser.
func logDroppedHotkey(key string, b, winner HotkeyBinding) {
	id := key + "|" + b.Action + "|" + b.PokemonID + "|" + b.GroupID
	if _, already := droppedHotkeysLogged.LoadOrStore(id, struct{}{}); already {
		return
	}
	slog.Warn("Dropping hotkey binding whose combo is already bound",
		"combo", b.Combo,
		"dropped_action", b.Action,
		"dropped_pokemon_id", b.PokemonID,
		"dropped_group_id", b.GroupID,
		"kept_action", winner.Action,
		"kept_pokemon_id", winner.PokemonID,
		"kept_group_id", winner.GroupID)
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

// HotkeyTarget identifies one bindable slot: a global action, or one action on
// one hunt or group. It is what a conflict check excludes so that re-recording
// a key onto the slot already holding it is not a conflict.
type HotkeyTarget struct {
	Kind   string // "action" | "pokemon" | "group"
	ID     string // entry id, or the action name when Kind is "action"
	Action string // ignored when Kind is "action"
}

// HotkeyConflict reports which other binding already holds combo, ignoring the
// slot named by except. It returns nil when the combo is free.
//
// The check has to be a hard gate rather than a hint: on Windows a duplicate
// combo makes RegisterHotKey fail for whichever binding is registered second,
// and that failure is invisible to the user.
func (m *Manager) HotkeyConflict(combo string, except HotkeyTarget) *HotkeyOwner {
	if combo == "" {
		return nil
	}
	m.mu.RLock()
	defer m.mu.RUnlock()

	if owner := m.conflictingAction(combo, except); owner != nil {
		return owner
	}
	for _, p := range m.state.Pokemon {
		if !isLiveHunt(p) {
			continue
		}
		if holds(p.Hotkeys, combo, except, "pokemon", p.ID) {
			return &HotkeyOwner{Kind: "pokemon", ID: p.ID, Label: pokemonHotkeyLabel(p)}
		}
	}
	for _, g := range m.state.Groups {
		if holds(g.Hotkeys, combo, except, "group", g.ID) {
			return &HotkeyOwner{Kind: "group", ID: g.ID, Label: g.Name}
		}
	}
	return nil
}

// holds reports whether the entry binds combo on an action other than the one
// the caller excludes. Callers hold m.mu.
func holds(keys EntryHotkeys, combo string, except HotkeyTarget, kind, id string) bool {
	for _, action := range EntryHotkeyActions {
		if !sameCombo(keys.Combo(action), combo) {
			continue
		}
		if except.Kind == kind && except.ID == id && except.Action == action {
			continue
		}
		return true
	}
	return false
}

// conflictingAction reports which global action holds combo. Callers hold m.mu.
func (m *Manager) conflictingAction(combo string, except HotkeyTarget) *HotkeyOwner {
	for _, b := range hotkeyActionsInOrder(m.state.Hotkeys) {
		if !sameCombo(b.Combo, combo) {
			continue
		}
		if except.Kind == "action" && except.ID == b.Action {
			continue
		}
		return &HotkeyOwner{Kind: "action", ID: b.Action, Label: b.Action}
	}
	return nil
}

// sameCombo reports whether two combos register the same physical key. The
// managers ignore modifier order, fold aliases like "Control" and ignore case,
// so a plain string comparison would let "Shift+Ctrl+F1" slip past a stored
// "Ctrl+Shift+F1".
func sameCombo(a, b string) bool {
	return keycombo.Same(a, b)
}

// pokemonHotkeyLabel names a hunt in a conflict message. The species alone is
// ambiguous when two hunts share it, so a nickname wins when set, and the game
// is appended otherwise.
func pokemonHotkeyLabel(p Pokemon) string {
	if p.Nickname != "" {
		return p.Nickname
	}
	if p.Game != "" {
		return p.Name + " (" + p.Game + ")"
	}
	return p.Name
}

// SetPokemonHotkey binds combo to one action on the given hunt. An empty combo
// clears that action. Returns false if the entry or the action is unknown.
func (m *Manager) SetPokemonHotkey(id, action, combo string) bool {
	m.mu.Lock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID != id {
			continue
		}
		next, ok := m.state.Pokemon[i].Hotkeys.WithCombo(action, combo)
		if ok {
			m.state.Pokemon[i].Hotkeys = next
		}
		m.mu.Unlock()
		if ok {
			m.markDirty()
		}
		return ok
	}
	m.mu.Unlock()
	return false
}

// SetGroupHotkey binds combo to one action on the given group. An empty combo
// clears that action. Returns false if the group or the action is unknown.
func (m *Manager) SetGroupHotkey(id, action, combo string) bool {
	m.mu.Lock()
	for i := range m.state.Groups {
		if m.state.Groups[i].ID != id {
			continue
		}
		next, ok := m.state.Groups[i].Hotkeys.WithCombo(action, combo)
		if ok {
			m.state.Groups[i].Hotkeys = next
		}
		m.mu.Unlock()
		if ok {
			m.markDirty()
		}
		return ok
	}
	m.mu.Unlock()
	return false
}

// freeHotkeysLocked drops every combo of the entry that another live binding
// already holds, keeping the ones still free. Callers hold m.mu.
func (m *Manager) freeHotkeysLocked(keys EntryHotkeys, exceptPokemonID string) EntryHotkeys {
	for _, action := range EntryHotkeyActions {
		if m.hotkeyTakenByOther(keys.Combo(action), exceptPokemonID) {
			keys, _ = keys.WithCombo(action, "")
		}
	}
	return keys
}

// hotkeyTakenByOther reports whether combo is held by any live binding other
// than the hunt with the given id. Callers hold m.mu.
func (m *Manager) hotkeyTakenByOther(combo, exceptPokemonID string) bool {
	if combo == "" {
		return false
	}
	if m.conflictingAction(combo, HotkeyTarget{}) != nil {
		return true
	}
	for _, p := range m.state.Pokemon {
		if p.ID == exceptPokemonID || !isLiveHunt(p) {
			continue
		}
		if holds(p.Hotkeys, combo, HotkeyTarget{}, "pokemon", p.ID) {
			return true
		}
	}
	for _, g := range m.state.Groups {
		if holds(g.Hotkeys, combo, HotkeyTarget{}, "group", g.ID) {
			return true
		}
	}
	return false
}

// HotkeyMapConflict reports the first combo in hm that cannot be stored: one
// the map binds to two actions at once, or one a hunt or a group already holds.
// The currently stored global bindings are not consulted, because hm replaces
// them wholesale. Returns nil when the whole map is free.
func (m *Manager) HotkeyMapConflict(hm HotkeyMap) *HotkeyOwner {
	m.mu.RLock()
	defer m.mu.RUnlock()

	seen := make(map[string]string, 5)
	for _, b := range hotkeyActionsInOrder(hm) {
		if b.Combo == "" {
			continue
		}
		key := keycombo.Canonical(b.Combo)
		if other, taken := seen[key]; taken {
			return &HotkeyOwner{Kind: "action", ID: other, Label: other}
		}
		seen[key] = b.Action
		if owner := m.entryHoldingLocked(b.Combo); owner != nil {
			return owner
		}
	}
	return nil
}

// entryHoldingLocked reports which hunt or group holds combo. Callers hold m.mu.
func (m *Manager) entryHoldingLocked(combo string) *HotkeyOwner {
	for _, p := range m.state.Pokemon {
		if isLiveHunt(p) && holds(p.Hotkeys, combo, HotkeyTarget{}, "pokemon", p.ID) {
			return &HotkeyOwner{Kind: "pokemon", ID: p.ID, Label: pokemonHotkeyLabel(p)}
		}
	}
	for _, g := range m.state.Groups {
		if holds(g.Hotkeys, combo, HotkeyTarget{}, "group", g.ID) {
			return &HotkeyOwner{Kind: "group", ID: g.ID, Label: g.Name}
		}
	}
	return nil
}
