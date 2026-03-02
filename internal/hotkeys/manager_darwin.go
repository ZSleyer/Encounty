//go:build darwin

package hotkeys

import (
	"fmt"

	"github.com/zsleyer/encounty/internal/state"
)

type darwinManager struct {
	actions chan Action
}

// New returns a no-op Manager for macOS (not yet implemented).
func New(_ *state.Manager) Manager {
	return &darwinManager{actions: make(chan Action)}
}

func (m *darwinManager) Start() error                           { return nil }
func (m *darwinManager) Stop()                                  {}
func (m *darwinManager) SetPaused(_ bool)                       {}
func (m *darwinManager) UpdateBinding(_, _ string) error        { return nil }
func (m *darwinManager) UpdateAllBindings(_ state.HotkeyMap) error { return nil }
func (m *darwinManager) Actions() <-chan Action                  { return m.actions }
func (m *darwinManager) IsAvailable() bool                      { return false }

// platformValidateKey always returns an error on macOS (no key map implemented).
func platformValidateKey(key string) error {
	return fmt.Errorf("hotkeys not supported on macOS (key: %q)", key)
}
