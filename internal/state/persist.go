// persist.go handles reading and writing AppState to disk.
// All disk I/O uses atomic writes (write to .tmp, then rename) to prevent
// data corruption on unexpected process termination.
package state

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const stateFile = "state.json"

var (
	saveMu    sync.Mutex
	saveTimer *time.Timer
)

// Load reads state.json from the config directory and unmarshals it into the
// Manager. If the file does not exist, Load returns nil and the in-memory
// state keeps the defaults set by NewManager. Any migration of newly added
// fields (e.g. default values for optional settings) is applied here.
func (m *Manager) Load() error {
	path := filepath.Join(m.configDir, stateFile)
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	err = json.Unmarshal(data, &m.state)
	if err != nil {
		return err
	}
	m.state.DataPath = m.configDir
	if m.state.Settings.OutputDir == "" {
		m.state.Settings.OutputDir = filepath.Join(m.configDir, "output")
	}
	// Migration: field added later — default to "none" if not present in saved state
	if m.state.Settings.Overlay.BackgroundAnimation == "" {
		m.state.Settings.Overlay.BackgroundAnimation = "none"
	}
	// Migration: infer overlay_mode from presence of overlay field
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].OverlayMode == "" {
			if m.state.Pokemon[i].Overlay != nil {
				m.state.Pokemon[i].OverlayMode = "custom"
			} else {
				m.state.Pokemon[i].OverlayMode = "default"
			}
		}
	}
	return nil
}

// Save writes the current state to state.json using an atomic
// write-to-temp-then-rename pattern to prevent partial writes.
func (m *Manager) Save() error {
	if err := os.MkdirAll(m.configDir, 0755); err != nil {
		return err
	}
	m.mu.RLock()
	data, err := json.MarshalIndent(m.state, "", "  ")
	m.mu.RUnlock()
	if err != nil {
		return err
	}
	path := filepath.Join(m.configDir, stateFile)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// Reload re-reads state from disk and notifies all listeners.
func (m *Manager) Reload() error {
	if err := m.Load(); err != nil {
		return err
	}
	m.notify()
	return nil
}

// ScheduleSave debounces saves to at most once per 500ms.
func (m *Manager) ScheduleSave() {
	saveMu.Lock()
	defer saveMu.Unlock()
	if saveTimer != nil {
		saveTimer.Stop()
	}
	saveTimer = time.AfterFunc(500*time.Millisecond, func() {
		_ = m.Save()
	})
}
