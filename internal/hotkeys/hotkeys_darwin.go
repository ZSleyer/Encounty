//go:build darwin

package hotkeys

import "github.com/zsleyer/encounty/internal/state"

// Manager is a no-op stub for darwin (not a supported target platform).
type Manager struct {
	actions chan Action
}

func New(_ *state.Manager) *Manager {
	return &Manager{actions: make(chan Action)}
}

func (m *Manager) Actions() <-chan Action                      { return m.actions }
func (m *Manager) Start()                                      {}
func (m *Manager) Stop()                                       {}
func (m *Manager) Pause()                                      {}
func (m *Manager) Resume()                                     {}
func (m *Manager) Reload(_ state.HotkeyMap, _ *state.Manager) {}
