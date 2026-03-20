// persist.go handles reading and writing AppState to disk or database.
// All disk I/O uses atomic writes (write to .tmp, then rename) to prevent
// data corruption on unexpected process termination. When a database handle
// is available, state is loaded from the normalized schema (v2); the legacy
// JSON blob path is used only for migration bootstrapping.
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

// Load reads state from the database when available, falling back to the
// JSON file on disk. If neither source contains data, Load returns nil and
// the in-memory state keeps the defaults set by NewManager.
func (m *Manager) Load() error {
	if m.db != nil && m.db.HasState() {
		m.mu.Lock()
		defer m.mu.Unlock()
		loaded, err := m.db.LoadFullState()
		if err != nil {
			return err
		}
		if loaded != nil {
			m.state = *loaded
			m.applyMigrations()
			return nil
		}
	}

	// Try legacy JSON blob in DB
	if m.db != nil && m.db.HasAppState() {
		data, err := m.db.LoadAppState()
		if err != nil {
			return err
		}
		if data != nil {
			m.mu.Lock()
			defer m.mu.Unlock()
			if err := json.Unmarshal(data, &m.state); err != nil {
				return err
			}
			m.applyMigrations()
			return nil
		}
	}

	// Fall back to JSON file
	return m.loadFromJSON()
}

// loadFromJSON reads state from the JSON file on disk. Used as fallback
// when the database has no state row (fresh install or pre-migration).
func (m *Manager) loadFromJSON() error {
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
	if err := json.Unmarshal(data, &m.state); err != nil {
		return err
	}
	m.applyMigrations()
	return nil
}

// LoadFromJSON reads state exclusively from the JSON file, ignoring the
// database. This is used during early startup to resolve the custom config
// path before the database is opened.
func (m *Manager) LoadFromJSON() error {
	return m.loadFromJSON()
}

// applyMigrations applies default values for fields added after the initial
// schema. Must be called with m.mu held.
func (m *Manager) applyMigrations() {
	m.state.DataPath = m.configDir
	if m.state.Settings.OutputDir == "" {
		m.state.Settings.OutputDir = filepath.Join(m.configDir, "output")
	}
	if m.state.Settings.Overlay.BackgroundAnimation == "" {
		m.state.Settings.Overlay.BackgroundAnimation = "none"
	}
	// Ensure all timers are paused on startup. Graceful shutdown folds
	// elapsed time into accumulated_ms before saving; this is a safety net
	// for crashes where the save may have stale timer_started_at values.
	for i := range m.state.Pokemon {
		m.state.Pokemon[i].TimerStartedAt = nil
	}
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].OverlayMode == "" {
			if m.state.Pokemon[i].Overlay != nil {
				m.state.Pokemon[i].OverlayMode = "custom"
			} else {
				m.state.Pokemon[i].OverlayMode = "default"
			}
		}
	}
	// Migrate overlay settings to include title element when loaded from
	// state saved before TitleElement was added.
	migrateTitleElement(&m.state.Settings.Overlay)
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].Overlay != nil {
			migrateTitleElement(m.state.Pokemon[i].Overlay)
		}
	}
}

// migrateTitleElement fills in default values for a TitleElement that was
// zero-valued after loading state saved before the field existed.
func migrateTitleElement(o *OverlaySettings) {
	if o.Title.Width == 0 && o.Title.Height == 0 {
		o.Title = TitleElement{
			OverlayElementBase: OverlayElementBase{Visible: true, X: 200, Y: 60, Width: 300, Height: 30, ZIndex: 4},
			Style: TextStyle{
				FontFamily:   "pokemon",
				FontSize:     20,
				FontWeight:   700,
				ColorType:    "solid",
				Color:        "#ffffff",
				OutlineType:  "solid",
				OutlineWidth: 3,
				OutlineColor: "#000000",
			},
			IdleAnimation: "none",
			TriggerEnter:  "fade-in",
		}
	}
}

// Save writes the current state to the database when available, falling
// back to an atomic JSON file write.
func (m *Manager) Save() error {
	if m.db != nil {
		m.mu.RLock()
		st := m.state
		m.mu.RUnlock()
		return m.db.SaveFullState(&st)
	}

	// Fallback: atomic JSON file write
	m.mu.RLock()
	data, err := json.MarshalIndent(m.state, "", "  ")
	m.mu.RUnlock()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(m.configDir, 0755); err != nil {
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
