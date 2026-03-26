// Package detector provides configuration management and platform capabilities
// for the browser-based WebGPU detection engine. The actual detection pipeline
// runs entirely in the browser; this package only manages templates, configs,
// and the match submission endpoint.
package detector

import (
	"github.com/zsleyer/encounty/backend/internal/state"
)

// Manager holds references needed by detector HTTP handlers. It no longer
// manages any running detection goroutines — all detection happens in the
// browser via WebGPU.
type Manager struct {
	stateMgr  *state.Manager
	configDir string
}

// NewManager creates a Manager.
func NewManager(stateMgr *state.Manager, configDir string) *Manager {
	return &Manager{
		stateMgr:  stateMgr,
		configDir: configDir,
	}
}

// StateManager returns the state manager reference.
func (m *Manager) StateManager() *state.Manager {
	return m.stateMgr
}

// ConfigDir returns the configuration directory path.
func (m *Manager) ConfigDir() string {
	return m.configDir
}
