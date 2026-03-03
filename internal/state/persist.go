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
	return json.Unmarshal(data, &m.state)
}

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
