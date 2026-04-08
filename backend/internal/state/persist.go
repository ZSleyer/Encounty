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
			m.applyLegacyDefaults()
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
	m.applyLegacyDefaults()
	return nil
}

// LoadFromJSON reads state exclusively from the JSON file, ignoring the
// database. This is used during early startup to resolve the custom config
// path before the database is opened.
func (m *Manager) LoadFromJSON() error {
	return m.loadFromJSON()
}

// applyMigrations applies default values for fields added after the initial
// schema. These fixes are idempotent and safe to run on every load (both
// from v2 DB and legacy JSON). Must be called with m.mu held.
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

	migratePokemonDefaults(m.state.Pokemon)
	migrateOverlaySettings(&m.state.Settings.Overlay, m.state.Pokemon)
}

// migratePokemonDefaults fills in zero-value fields on each Pokemon that were
// added in later versions. Safe to call on every load.
func migratePokemonDefaults(pokemon []Pokemon) {
	for i := range pokemon {
		if pokemon[i].OverlayMode == "" {
			if pokemon[i].Overlay != nil {
				pokemon[i].OverlayMode = "custom"
			} else {
				pokemon[i].OverlayMode = "default"
			}
		}
		// HuntMode was added after v0.6.4; empty string means "both".
		if pokemon[i].HuntMode == "" {
			pokemon[i].HuntMode = "both"
		}
		// AdaptiveCooldownMin 0 is never a valid value; default to 3.
		dc := pokemon[i].DetectorConfig
		if dc != nil && dc.AdaptiveCooldownMin == 0 {
			dc.AdaptiveCooldownMin = 3
		}
		// HysteresisFactor 0 is never a valid value; default to 0.7.
		if dc != nil && dc.HysteresisFactor == 0 {
			dc.HysteresisFactor = 0.7
		}
	}
}

// migrateOverlaySettings applies overlay-specific migrations (trigger
// decrement, title element) to the global overlay and each per-Pokemon
// overlay.
func migrateOverlaySettings(global *OverlaySettings, pokemon []Pokemon) {
	// TriggerDecrement was added after v0.6.4; empty string means "none".
	migrateOverlayTriggerDecrement(global)
	// Migrate overlay settings to include title element when loaded from
	// state saved before TitleElement was added.
	migrateTitleElement(global)

	for i := range pokemon {
		if pokemon[i].Overlay != nil {
			migrateOverlayTriggerDecrement(pokemon[i].Overlay)
			migrateTitleElement(pokemon[i].Overlay)
		}
	}
}

// applyLegacyDefaults sets defaults for fields that cannot be distinguished
// from intentional user values on subsequent loads. This runs only when
// loading from legacy JSON (state.json or app_state blob), never from the
// v2 database. Must be called with m.mu held.
func (m *Manager) applyLegacyDefaults() {
	// AccentColor replaced the legacy UIAnimations toggle in v0.7.x.
	// Default to "blue" so legacy JSON loads stay visually consistent.
	if m.state.Settings.AccentColor == "" {
		m.state.Settings.AccentColor = "blue"
	}

	// Migrate detector configs from v0.6.4 frontend defaults to v0.7.0
	// backend defaults where values still match the old defaults.
	for i := range m.state.Pokemon {
		dc := m.state.Pokemon[i].DetectorConfig
		if dc == nil {
			continue
		}
		if dc.Precision == 0.80 {
			dc.Precision = 0.55
		}
		if dc.CooldownSec == 8 {
			dc.CooldownSec = 5
		}
		if dc.PollIntervalMs == 50 {
			dc.PollIntervalMs = 200
		}
		if dc.MinPollMs == 30 {
			dc.MinPollMs = 50
		}
		if dc.MaxPollMs == 500 {
			dc.MaxPollMs = 2000
		}
	}
}

// migrateOverlayTriggerDecrement fills in "none" for TriggerDecrement fields
// that were empty after loading state saved before the field existed.
func migrateOverlayTriggerDecrement(o *OverlaySettings) {
	if o.Sprite.TriggerDecrement == "" {
		o.Sprite.TriggerDecrement = animationNone
	}
	if o.Name.TriggerDecrement == "" {
		o.Name.TriggerDecrement = animationNone
	}
	if o.Title.TriggerDecrement == "" {
		o.Title.TriggerDecrement = animationNone
	}
	if o.Counter.TriggerDecrement == "" {
		o.Counter.TriggerDecrement = animationNone
	}
}

// migrateTitleElement fills in default values for a TitleElement that was
// zero-valued after loading state saved before the field existed.
func migrateTitleElement(o *OverlaySettings) {
	if o.Title.Width == 0 && o.Title.Height == 0 {
		o.Title = TitleElement{
			OverlayElementBase: OverlayElementBase{Visible: false, X: 200, Y: 60, Width: 300, Height: 30, ZIndex: 4},
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
			IdleAnimation:    "none",
			TriggerEnter:     "none",
			TriggerDecrement: "none",
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
	m.markDirty()
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
