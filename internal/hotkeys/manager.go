package hotkeys

import "github.com/zsleyer/encounty/internal/state"

// Action represents a hotkey-triggered action.
type Action struct {
	Type      string // "increment" | "decrement" | "reset" | "next"
	PokemonID string
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

	// UpdateBinding replaces a single action's key binding at runtime.
	// keyCombo == "" removes the binding. Returns an error if the combo is invalid.
	UpdateBinding(action, keyCombo string) error

	// UpdateAllBindings replaces all bindings atomically.
	UpdateAllBindings(hm state.HotkeyMap) error

	// Actions returns the channel on which triggered actions are delivered.
	Actions() <-chan Action

	// IsAvailable reports whether the hotkey backend successfully initialised.
	// Returns false when e.g. the user lacks /dev/input read permission.
	IsAvailable() bool
}
