// persist.go handles reading and writing AppState to disk or database.
// All disk I/O uses atomic writes (write to .tmp, then rename) to prevent
// data corruption on unexpected process termination. When a database handle
// is available, state is loaded from the normalized schema (v2); the legacy
// JSON blob path is used only for migration bootstrapping.
package state

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

const stateFile = "state.json"

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
// schema. These fixes are idempotent and safe to run on every load (both
// from v2 DB and legacy JSON). Must be called with m.mu held.
func (m *Manager) applyMigrations() {
	// DataPath is derived, never trusted from storage: it reports where the
	// database actually is, which a row written before a relocation cannot know.
	m.state.DataPath = m.dbDir
	if m.state.DataPath == "" {
		m.state.DataPath = m.configDir
	}
	// The OBS text files belong next to the database: moving the database to a
	// different disk should take the output with it, and both are data the user
	// actively looks for, unlike the caches in the config directory.
	if m.state.Settings.OutputDir == "" {
		m.state.Settings.OutputDir = filepath.Join(m.dbDir, "output")
	}
	// AccentColor replaced the legacy UIAnimations toggle in v0.7.x.
	if m.state.Settings.AccentColor == "" {
		m.state.Settings.AccentColor = "violet"
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
	migrateOverlaySettings(&m.state.Settings.Overlay, m.state.Pokemon, m.state.Settings.Languages)
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
	}
}

// migrateOverlaySettings applies overlay-specific migrations (trigger
// decrement, title element) to the global overlay and each per-Pokemon
// overlay.
//
// languages is the user's configured language list. Every fill migration takes
// its replacement element from the default layout, and that element carries a
// caption, so the caption has to be written in the user's language rather than
// in English.
func migrateOverlaySettings(global *OverlaySettings, pokemon []Pokemon, languages []string) {
	// TriggerDecrement was added after v0.6.4; empty string means "none".
	migrateOverlayTriggerDecrement(global)
	// Migrate overlay settings to include title element when loaded from
	// state saved before TitleElement was added.
	migrateTitleElement(global, languages)
	migrateTimerElement(global, languages)
	migrateOddsElement(global, languages)
	migratePhasingElements(global, languages)
	migrateRemovedBackgroundAnimation(global)

	for i := range pokemon {
		if pokemon[i].Overlay != nil {
			migrateOverlayTriggerDecrement(pokemon[i].Overlay)
			migrateTitleElement(pokemon[i].Overlay, languages)
			migrateTimerElement(pokemon[i].Overlay, languages)
			migrateOddsElement(pokemon[i].Overlay, languages)
			migratePhasingElements(pokemon[i].Overlay, languages)
			migrateRemovedBackgroundAnimation(pokemon[i].Overlay)
		}
	}
}

// removedBackgroundAnimations lists the background animations that were
// rendered by an external WebGL library which is no longer bundled.
var removedBackgroundAnimations = map[string]bool{
	"rb-aurora":     true,
	"rb-galaxy":     true,
	"rb-silk":       true,
	"rb-pixelblast": true,
}

// migrateRemovedBackgroundAnimation replaces a background animation that no
// longer exists with "waves", the closest surviving option and the value used
// by the built-in default overlay. Mirrors the database migration so state
// restored from legacy JSON is normalized the same way.
func migrateRemovedBackgroundAnimation(o *OverlaySettings) {
	if removedBackgroundAnimations[o.BackgroundAnimation] {
		o.BackgroundAnimation = "waves"
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
// Like every migration below it takes the current default layout but forces the
// layer hidden: a stored overlay belongs to its owner, and switching a layer on
// that the user never had would change what their stream shows.
func migrateTitleElement(o *OverlaySettings, languages []string) {
	if o.Title.Width == 0 && o.Title.Height == 0 {
		o.Title = defaultOverlaySettings(languages).Title
		o.Title.Visible = false
		clampIntoCanvas(&o.Title.OverlayElementBase, o)
	}
}

// migrateTimerElement fills in default values for a TimerElement that was
// zero-valued after loading state saved before the field existed.
func migrateTimerElement(o *OverlaySettings, languages []string) {
	if o.Timer.Width == 0 && o.Timer.Height == 0 {
		o.Timer = defaultOverlaySettings(languages).Timer
		o.Timer.Visible = false
		clampIntoCanvas(&o.Timer.OverlayElementBase, o)
	}
}

// migrateOddsElement fills in default values for an OddsElement that was
// zero-valued after loading state saved before the field existed, and
// ensures Format defaults to "fractional" on partially-initialized rows.
func migrateOddsElement(o *OverlaySettings, languages []string) {
	if o.Odds.Width == 0 && o.Odds.Height == 0 {
		o.Odds = defaultOverlaySettings(languages).Odds
		o.Odds.Visible = false
		clampIntoCanvas(&o.Odds.OverlayElementBase, o)
		return
	}
	if o.Odds.Format == "" {
		o.Odds.Format = "fractional"
	}
}

// migratePhasingElements fills in default values for the overlay elements that
// arrived with the phasing feature (phase number, total encounters, total
// timer) plus the sprite cycling settings, for state saved before they existed.
func migratePhasingElements(o *OverlaySettings, languages []string) {
	def := defaultOverlaySettings(languages)
	fillLabeledTextElement(&o.Phase, def.Phase, o)
	fillLabeledTextElement(&o.TotalCounter, def.TotalCounter, o)
	fillLabeledTextElement(&o.TotalTimer, def.TotalTimer, o)
	// 0 would stop the sprite cycling from ever advancing.
	if o.Sprite.CycleIntervalMs <= 0 {
		o.Sprite.CycleIntervalMs = defaultSpriteCycleIntervalMs
	}
	// State saved before the transition setting existed carries none, and it
	// crossfaded, so that is the effect it keeps.
	if o.Sprite.CycleTransition == "" {
		o.Sprite.CycleTransition = defaultSpriteCycleTransition
	}
}

// fillLabeledTextElement replaces el with def when el was never persisted.
// Zero width and height identify such a row, the same probe migrateOddsElement
// uses: no user can size an element down to nothing in the editor.
func fillLabeledTextElement(el *LabeledTextElement, def LabeledTextElement, o *OverlaySettings) {
	if el.Width == 0 && el.Height == 0 {
		*el = def
		clampIntoCanvas(&el.OverlayElementBase, o)
	}
}

// clampIntoCanvas pulls a freshly filled element back inside the stored canvas.
// The default layout is authored for the current 800x264 panel, but an overlay
// saved before that layout existed keeps the canvas size it was created with,
// and the card does not clip its content: an element placed on the newer grid
// would render outside the panel over the game capture. A zero canvas dimension
// means the size was never persisted either, so there is nothing to clamp to.
func clampIntoCanvas(el *OverlayElementBase, o *OverlaySettings) {
	if o.CanvasWidth > 0 && el.X+el.Width > o.CanvasWidth {
		el.X = max(0, o.CanvasWidth-el.Width)
	}
	if o.CanvasHeight > 0 && el.Y+el.Height > o.CanvasHeight {
		el.Y = max(0, o.CanvasHeight-el.Height)
	}
}

// Save writes the current state to the database when available, falling
// back to an atomic JSON file write.
func (m *Manager) Save() error {
	if m.db != nil {
		m.mu.RLock()
		st := cloneState(m.state)
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

// Save debounce timing: coalesce bursts of mutations, but never defer a flush
// longer than saveMaxDelay so a sustained stream (e.g. auto-detection) still
// persists and a crash loses at most saveMaxDelay of progress.
const (
	saveDebounce = 500 * time.Millisecond
	saveMaxDelay = 5 * time.Second
)

// ScheduleSave debounces saves by saveDebounce, capped at saveMaxDelay so a
// continuous mutation stream cannot starve persistence indefinitely.
func (m *Manager) ScheduleSave() {
	m.saveMu.Lock()
	defer m.saveMu.Unlock()

	if m.saveTimer == nil {
		// Start of a new debounce window: set the hard flush deadline.
		m.saveDeadline = time.Now().Add(saveMaxDelay)
	} else {
		m.saveTimer.Stop()
	}

	delay := saveDebounce
	if remaining := time.Until(m.saveDeadline); remaining < delay {
		delay = max(remaining, 0)
	}

	m.saveTimer = time.AfterFunc(delay, func() {
		m.saveMu.Lock()
		m.saveTimer = nil
		m.saveMu.Unlock()
		if err := m.flushSave(); err != nil {
			slog.Error("scheduled state save failed", "error", err)
		}
	})
}

// flushSave persists the pending changes accumulated since the last flush. It
// takes the fast UpdatePokemonCounters path only when a database is present and
// no structural change is pending; otherwise it falls back to a full Save. The
// dirty flags are read and cleared under saveMu before any persistence work, so
// a mutation arriving mid-flush simply re-arms the flags for the next cycle.
func (m *Manager) flushSave() error {
	m.saveMu.Lock()
	structural := m.structuralDirty
	var ids []string
	if !structural {
		ids = make([]string, 0, len(m.counterDirty))
		for id := range m.counterDirty {
			ids = append(ids, id)
		}
	}
	m.structuralDirty = false
	m.counterDirty = nil
	m.saveMu.Unlock()

	// Fall back to a full save whenever the fast path cannot guarantee
	// correctness: no database (JSON file), a pending structural change, or no
	// counter-only changes to apply.
	if m.db == nil || structural || len(ids) == 0 {
		return m.Save()
	}
	return m.saveCounters(ids)
}

// saveCounters writes only the counter and timer scalars for the given Pokémon
// IDs via the database fast path. Values are snapshotted under RLock; the
// pointer fields are replaced wholesale by mutations rather than mutated in
// place, so the snapshot is safe to persist after the lock is released.
func (m *Manager) saveCounters(ids []string) error {
	want := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		want[id] = struct{}{}
	}

	m.mu.RLock()
	counters := make([]PokemonCounters, 0, len(want))
	for i := range m.state.Pokemon {
		p := &m.state.Pokemon[i]
		if _, ok := want[p.ID]; !ok {
			continue
		}
		counters = append(counters, PokemonCounters{
			ID:                 p.ID,
			Encounters:         p.Encounters,
			TimerStartedAt:     p.TimerStartedAt,
			TimerAccumulatedMs: p.TimerAccumulatedMs,
		})
	}
	m.mu.RUnlock()

	if len(counters) == 0 {
		return nil
	}
	return m.db.UpdatePokemonCounters(counters)
}
