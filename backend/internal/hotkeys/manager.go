package hotkeys

import (
	"log/slog"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// Action represents a hotkey-triggered action.
type Action struct {
	Type      string // "increment" | "decrement" | "reset" | "next" | "hunt_toggle"
	PokemonID string
	GroupID   string
}

// Manager is the platform-independent hotkey manager interface.
// Implementations are in manager_linux.go, manager_windows.go, manager_darwin.go.
type Manager interface {
	// Start begins listening for hotkey events. Returns an error if the
	// underlying input device is unavailable (non-fatal; hotkeys simply won't fire).
	Start() error

	// Stop releases all resources. Safe to call multiple times.
	Stop()

	// SetPaused pauses (true) or resumes (false) hotkey dispatch.
	// On Windows this unregisters/re-registers Win32 hotkeys.
	// On Linux evdev reading continues but events are discarded while paused.
	SetPaused(paused bool)

	// UpdateAllBindings replaces all bindings atomically. The caller always
	// passes the complete list: a binding is identified by its position, not by
	// its action, because the same action and even the same combo may occur
	// several times once keys are pinned to individual hunts or groups.
	UpdateAllBindings(bindings []state.HotkeyBinding) error

	// Actions returns the channel on which triggered actions are delivered.
	Actions() <-chan Action

	// IsAvailable reports whether the hotkey backend successfully initialized.
	// Returns false when e.g. the user lacks /dev/input read permission.
	IsAvailable() bool
}

// resolvedBinding is one binding with its combo already parsed and validated
// against the platform key set, so the hot path of a key event only has to
// compare numbers instead of re-parsing strings.
type resolvedBinding struct {
	combo     KeyCombo
	action    string
	pokemonID string
	groupID   string
}

// resolveBindings parses and validates every binding and drops the ones the
// platform cannot express. The result is a slice rather than a map keyed by
// action or combo: a combo bound globally and a combo pinned to a hunt may be
// identical, and both must survive.
func resolveBindings(bindings []state.HotkeyBinding) []resolvedBinding {
	resolved := make([]resolvedBinding, 0, len(bindings))
	for _, b := range bindings {
		if b.Action == "" || b.Combo == "" {
			continue
		}
		kc, err := ParseKeyCombo(b.Combo)
		if err != nil {
			slog.Warn("Hotkeys: parse error", "combo", b.Combo, "action", b.Action,
				"pokemon_id", b.PokemonID, "group_id", b.GroupID, "error", err)
			continue
		}
		if platformValidateKey(kc.Key) != nil {
			slog.Warn("Hotkeys: unknown key", "key", kc.Key, "combo", b.Combo, "action", b.Action,
				"pokemon_id", b.PokemonID, "group_id", b.GroupID)
			continue
		}
		resolved = append(resolved, resolvedBinding{
			combo:     kc,
			action:    b.Action,
			pokemonID: b.PokemonID,
			groupID:   b.GroupID,
		})
	}
	return resolved
}

// actionFor turns a matched binding into the action to dispatch. A binding that
// names a hunt or a group acts on that entry no matter what the user has
// selected; one that names neither follows the active target, which is what
// keeps the five global keys working on whatever is currently in focus.
func actionFor(stateMgr *state.Manager, b resolvedBinding) Action {
	if b.pokemonID != "" || b.groupID != "" {
		return Action{Type: b.action, PokemonID: b.pokemonID, GroupID: b.groupID}
	}
	if gid := stateMgr.GetActiveGroupID(); gid != "" {
		return Action{Type: b.action, GroupID: gid}
	}
	var pid string
	if active := stateMgr.GetActivePokemon(); active != nil {
		pid = active.ID
	}
	return Action{Type: b.action, PokemonID: pid}
}
