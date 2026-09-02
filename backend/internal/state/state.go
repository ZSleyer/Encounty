// Package state defines all application data types and the in-memory state
// manager. The Manager is the single source of truth for mutable runtime
// state and coordinates safe concurrent access via a read/write mutex.
// Persistence is handled in persist.go, the type definitions in types.go and
// types_overlay.go.
package state

import (
	"errors"
	"fmt"
	"maps"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"log/slog"
)

// Shared string literals used in default overlay settings and overlay resolution.
const (
	colorBlack          = "#000000"
	colorTypeSolid      = "solid"
	outlineTypeNone     = "none"
	animationNone       = "none"
	fontSans            = "sans"
	overlayLinkedPrefix = "linked:"
)

// Tempest design-system colors baked into the default overlay layout. The
// overlay stores plain hex rather than a CSS custom property: the editor's
// color picker only round-trips 6-digit hex, and the OBS browser source keeps
// its own theme and accent preset. The token each value came from is recorded
// here so a later theme change stays traceable.
const (
	colorBgPrimary     = "#0d1117" // --bg-primary
	colorBorderSubtle  = "#2a3644" // --border-subtle
	colorTextPrimary   = "#eef3f8" // --text-primary
	colorTextSecondary = "#b7c5d3" // --text-secondary
	colorTextMuted     = "#8fa3b5" // --text-muted
	colorAccentViolet  = "#a685f0" // --accent-blue, violet preset (the default accent)
)

// defaultSpriteCycleIntervalMs is the dwell time per sprite when the overlay
// cycles through the phase targets.
const defaultSpriteCycleIntervalMs = 3000

// defaultSpriteCycleTransition is the effect played on a sprite swap while
// cycling. Cycling shipped with the crossfade as its only behavior, so it is
// both the default and the fallback for an overlay that carries no choice.
const defaultSpriteCycleTransition = "fade"

// Sentinel errors returned by the phase transitions so HTTP handlers can map
// them to status codes without string matching.
var (
	// ErrPhaseParentNotFound reports that the hunt a phase operation refers to
	// does not exist (unknown id, or an orphaned phase entry whose parent hunt
	// has been deleted).
	ErrPhaseParentNotFound = errors.New("phase parent not found")
	// ErrNotPhaseable reports that the referenced entry cannot take part in the
	// requested phase transition: a completed hunt or a phase entry cannot end a
	// phase, and only the newest phase of a hunt can be undone.
	ErrNotPhaseable = errors.New("entry is not phaseable")
)

// AppState is the complete serializable snapshot of the application. It is
// sent to the frontend on every WebSocket connection and after every mutation.
type AppState struct {
	Pokemon         []Pokemon `json:"pokemon"`
	Sessions        []Session `json:"sessions"`
	Groups          []Group   `json:"groups"` // Organizational Sidebar sections; always an array, never null
	ActiveID        string    `json:"active_id"`
	ActiveGroupID   string    `json:"active_group_id"`
	Hotkeys         HotkeyMap `json:"hotkeys"`
	Settings        Settings  `json:"settings"`
	DataPath        string    `json:"data_path"`
	LicenseAccepted bool      `json:"license_accepted"`
}

// PokemonCounters carries the scalar counter and timer fields that the fast
// persistence path updates without rewriting the entire Pokémon row. It is used
// by the counter-only save path taken for hot-path mutations (increment,
// decrement, timer ticks) that touch no structural data.
type PokemonCounters struct {
	ID                 string
	Encounters         int
	TimerStartedAt     *time.Time
	TimerAccumulatedMs int64
}

// StateStore abstracts the database operations needed for state persistence.
// The database.DB type satisfies this interface implicitly.
type StateStore interface {
	// Normalized state persistence (v2 schema).
	SaveFullState(st *AppState) error
	LoadFullState() (*AppState, error)
	HasState() bool

	// UpdatePokemonCounters writes only the encounter and timer columns for the
	// given Pokémon rows. It is the fast path used when a mutation changed only
	// counter or timer scalars and no structural data.
	UpdatePokemonCounters(counters []PokemonCounters) error

	// Template image BLOB operations (used by detector API).
	SaveTemplateImage(pokemonID string, imageData []byte, sortOrder int) (int64, error)
	LoadTemplateImage(templateDBID int64) ([]byte, error)
	DeleteTemplateImage(templateDBID int64) error
}

// Manager holds all in-memory application state and coordinates safe
// concurrent access. All mutations go through Manager methods, which
// hold the appropriate lock and then dispatch onChange callbacks so
// that the WebSocket hub can broadcast the updated state.
type Manager struct {
	mu           sync.RWMutex
	state        AppState
	configDir    string
	dbDir        string
	db           StateStore
	onChange     []func(AppState)
	dirty        chan struct{}
	stopNotifier chan struct{}

	// Debounced-save state (guarded by saveMu, per-instance so multiple
	// Managers never cancel each other's saves). saveDeadline caps how long a
	// continuous stream of mutations can defer a flush.
	//
	// structuralDirty forces the next flush to rewrite the full state;
	// counterDirty accumulates the IDs of Pokémon whose counter/timer scalars
	// changed and are eligible for the fast UpdatePokemonCounters path. When
	// structuralDirty is set the counter set is ignored and a full save runs,
	// so correctness never depends on the fast path being taken.
	saveMu          sync.Mutex
	saveTimer       *time.Timer
	saveDeadline    time.Time
	structuralDirty bool
	counterDirty    map[string]struct{}
}

// NewManager creates a Manager with sensible defaults for all settings.
// The defaults are used as-is until Load() overwrites them from disk.
func NewManager(configDir string) *Manager {
	// Hoisted out of the literal below because the seeded overlay reads it:
	// the first entry decides which language the overlay captions are in.
	languages := []string{"de", "en"}
	m := &Manager{
		configDir:    configDir,
		dbDir:        configDir,
		dirty:        make(chan struct{}, 1),
		stopNotifier: make(chan struct{}),
		state: AppState{
			DataPath: configDir,
			Pokemon:  []Pokemon{},
			Sessions: []Session{},
			Groups:   []Group{},
			Settings: Settings{
				OutputEnabled:      false,
				OutputDir:          filepath.Join(configDir, "output"),
				AutoSave:           true,
				Languages:          languages,
				CrispSprites:       true,
				AccentColor:        "violet",
				CaptureResolutions: map[string]string{},
				Overlay:            defaultOverlaySettings(languages),
			},
			Hotkeys: HotkeyMap{
				Increment:   "F1",
				Decrement:   "F2",
				Reset:       "F3",
				NextPokemon: "F4",
			},
		},
	}
	return m
}

// SetDB injects the database-backed store used for state persistence.
func (m *Manager) SetDB(store StateStore) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.db = store
}

// OnChange registers a callback that is invoked (in its own goroutine) after
// every state mutation. The callback receives a value copy of the state so it
// is safe to read without holding the lock.
func (m *Manager) OnChange(fn func(AppState)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.onChange = append(m.onChange, fn)
}

// notifyChange signals the notifier goroutine that state has changed.
// Multiple rapid calls are coalesced into a single notification cycle.
// Safe to call without holding any lock.
func (m *Manager) notifyChange() {
	select {
	case m.dirty <- struct{}{}:
	default:
		// Already marked dirty, coalescing
	}
}

// markDirty records a structural state change: it schedules a broadcast and
// forces the next scheduled save to rewrite the full state. It is the default
// signal for every mutation; the counter/timer hot path calls markCounterDirty
// instead to stay eligible for the fast counter-only save path. Safe to call
// without holding m.mu.
func (m *Manager) markDirty() {
	m.saveMu.Lock()
	m.structuralDirty = true
	m.saveMu.Unlock()
	m.notifyChange()
}

// markCounterDirty records a counter/timer-only change to the given Pokémon
// IDs, scheduling a broadcast while keeping the change eligible for the fast
// counter-only save path. It never sets structuralDirty, so if a structural
// change is also pending the next flush still performs a full save.
func (m *Manager) markCounterDirty(ids ...string) {
	m.saveMu.Lock()
	if m.counterDirty == nil {
		m.counterDirty = make(map[string]struct{})
	}
	for _, id := range ids {
		m.counterDirty[id] = struct{}{}
	}
	m.saveMu.Unlock()
	m.notifyChange()
}

// StartNotifier launches the background goroutine that coalesces rapid
// state mutations into batched onChange dispatches. It should be called
// once during application startup, after all OnChange callbacks are
// registered.
func (m *Manager) StartNotifier() {
	go func() {
		for {
			select {
			case <-m.stopNotifier:
				return
			case <-m.dirty:
				// Coalesce: keep waiting while more mutations arrive
				// within 50 ms windows, then dispatch once.
				m.coalesceAndDispatch()
			}
		}
	}()
	slog.Debug("State notifier started")
}

// coalesceAndDispatch waits for a 50 ms quiet period, draining any
// additional dirty signals, then reads the current state under RLock
// and dispatches all onChange callbacks.
func (m *Manager) coalesceAndDispatch() {
	timer := time.NewTimer(50 * time.Millisecond)
	defer timer.Stop()

	for {
		select {
		case <-m.dirty:
			// Reset the timer on each new dirty signal
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(50 * time.Millisecond)
		case <-timer.C:
			// 50 ms elapsed with no new mutations, dispatch now
			m.mu.RLock()
			state := cloneState(m.state)
			callbacks := m.onChange
			m.mu.RUnlock()

			for _, fn := range callbacks {
				go fn(state)
			}
			return
		case <-m.stopNotifier:
			return
		}
	}
}

// StopNotifier shuts down the background notifier goroutine.
// It should be called during graceful application shutdown.
func (m *Manager) StopNotifier() {
	close(m.stopNotifier)
	slog.Debug("State notifier stopped")
}

// GetState returns a value copy of the current application state with the
// Pokémon slice sorted ascending by SortOrder (stable). Sorting operates on a
// copy so the underlying storage order is never mutated. Safe to call
// concurrently; acquires a read lock.
func (m *Manager) GetState() AppState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	st := cloneState(m.state)
	sort.SliceStable(st.Pokemon, func(i, j int) bool {
		return st.Pokemon[i].SortOrder < st.Pokemon[j].SortOrder
	})
	return st
}

// cloneState returns a snapshot of s that is safe to read (marshal, persist)
// after the caller releases the state lock, without racing in-place mutations
// of the live state. The slices that are mutated in place (Pokemon and each
// Pokemon's Tags and PhaseTargets) and the CaptureResolutions map receive fresh
// backing storage; Sessions, Groups and Languages are also cloned since they are
// appended to. Pointer fields (Overlay, DetectorConfig, *time.Time) are replaced
// wholesale under Lock rather than mutated in place, so sharing those pointers
// is safe.
func cloneState(s AppState) AppState {
	s.Pokemon = slices.Clone(s.Pokemon)
	for i := range s.Pokemon {
		s.Pokemon[i].Tags = slices.Clone(s.Pokemon[i].Tags)
		s.Pokemon[i].PhaseTargets = slices.Clone(s.Pokemon[i].PhaseTargets)
	}
	s.Sessions = slices.Clone(s.Sessions)
	s.Groups = slices.Clone(s.Groups)
	s.Settings.Languages = slices.Clone(s.Settings.Languages)
	s.Settings.CaptureResolutions = maps.Clone(s.Settings.CaptureResolutions)
	return s
}

// GetActivePokemon returns a pointer to a copy of the currently active
// Pokémon, or nil if no Pokémon is active. The returned value is safe to
// read after the lock is released because it is a copy.
func (m *Manager) GetActivePokemon() *Pokemon {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == m.state.ActiveID {
			p := m.state.Pokemon[i]
			return &p
		}
	}
	return nil
}

// AddPokemon appends p to the Pokémon list. If the list was empty before and p
// is not already finished, p is automatically set as the active Pokémon. Tags
// and PhaseTargets are normalized to non-nil slices so JSON serialization never
// emits null.
func (m *Manager) AddPokemon(p Pokemon) {
	if p.Tags == nil {
		p.Tags = []string{}
	}
	p.PhaseTargets = normalizePhaseTargets(p.PhaseTargets)
	m.mu.Lock()
	m.state.Pokemon = append(m.state.Pokemon, p)
	// An entry that arrives with a CompletedAt is history, not a hunt in
	// progress. Without this guard the first hand-entered catch on a fresh
	// install would become the running hunt and take the hotkeys with it.
	if m.state.ActiveID == "" && m.state.ActiveGroupID == "" && p.CompletedAt == nil {
		m.state.ActiveID = p.ID
		for i := range m.state.Pokemon {
			m.state.Pokemon[i].IsActive = m.state.Pokemon[i].ID == p.ID
		}
	}
	m.mu.Unlock()
	m.markDirty()
}

// applyPokemonUpdate merges non-zero fields from update into dst. Only
// user-editable fields are touched; immutable fields like ID, CreatedAt and the
// phase link (PhaseOf, PhaseNumber) are preserved.
func applyPokemonUpdate(dst *Pokemon, update Pokemon) {
	applyBasicFields(dst, update)
	applyOverlayUpdate(dst, update)
	// Always update Step (0 means default of 1)
	dst.Step = update.Step
	// Always update SortOrder (0 is a valid first position)
	dst.SortOrder = update.SortOrder
}

// applyBasicFields copies non-zero basic fields from update to dst.
func applyBasicFields(dst *Pokemon, update Pokemon) {
	if update.Name != "" {
		dst.Name = update.Name
		dst.Nickname = strings.TrimSpace(update.Nickname)
	}
	// Always update Title (allow clearing to "")
	dst.Title = update.Title
	if update.CanonicalName != "" {
		dst.CanonicalName = update.CanonicalName
	}
	if update.Gender != "" {
		dst.Gender = update.Gender
	}
	if update.SpriteURL != "" {
		dst.SpriteURL = update.SpriteURL
	}
	if update.SpriteType != "" {
		dst.SpriteType = update.SpriteType
	}
	// Always update SpriteStyle (allow clearing to "" which means "classic")
	dst.SpriteStyle = update.SpriteStyle
	if update.Language != "" {
		dst.Language = update.Language
	}
	if update.Game != "" {
		dst.Game = update.Game
	}
	if update.HuntType != "" {
		dst.HuntType = update.HuntType
	}
	// Always update HuntMode (allow clearing to "" which means "both")
	dst.HuntMode = update.HuntMode
	// Always update ShinyCharm (bool zero-value = false is a valid state)
	dst.ShinyCharm = update.ShinyCharm
	// Always update SparklingPower (0 = no sandwich boost is a valid state)
	dst.SparklingPower = update.SparklingPower
	// Always update ShinyVariant so an entry can be reset to "" (any) again.
	dst.ShinyVariant = update.ShinyVariant
	// Always update Failed, so a hand-entered phase can be turned back into a
	// catch. A body that never mentions the field keeps the stored value; the
	// handler carries it over before the update reaches here.
	dst.Failed = update.Failed
	// Always update GroupID (empty string means "no group").
	dst.GroupID = update.GroupID
	// Always replace Tags when the caller supplied them (non-nil). A nil Tags
	// slice on update indicates the caller did not touch tags and preserves
	// existing values. Empty slice explicitly clears all tags.
	if update.Tags != nil {
		dst.Tags = normalizeTags(update.Tags)
	}
	// Same contract as Tags: nil means "not touched", empty clears the list.
	// PhaseOf and PhaseNumber are intentionally absent here; a phase link is
	// established by EndPhase alone and must survive every edit of the entry.
	// Catch is absent for the same reason: it is written by SetCatchMeta alone,
	// so an edit form that never loaded it cannot wipe it.
	if update.PhaseTargets != nil {
		dst.PhaseTargets = normalizePhaseTargets(update.PhaseTargets)
	}
	if update.PokedexIDs != nil {
		dst.PokedexIDs = normalizeTags(update.PokedexIDs)
	}
}

// normalizeTags trims whitespace, drops empty entries, and removes duplicates
// while preserving the first-seen order. Returns a non-nil slice so JSON
// serialization produces [] rather than null.
func normalizeTags(raw []string) []string {
	seen := make(map[string]struct{}, len(raw))
	out := make([]string, 0, len(raw))
	for _, t := range raw {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		if _, dup := seen[t]; dup {
			continue
		}
		seen[t] = struct{}{}
		out = append(out, t)
	}
	return out
}

// normalizePhaseTargets trims every field, drops targets without a canonical
// name and removes duplicates by canonical name while preserving the first-seen
// order. The canonical name is the identity of a target: it is the second half
// of the phase_targets primary key, so a duplicate or empty one would collide in
// the database. Returns a non-nil slice so JSON serialization produces []
// rather than null.
func normalizePhaseTargets(raw []PhaseTarget) []PhaseTarget {
	seen := make(map[string]struct{}, len(raw))
	out := make([]PhaseTarget, 0, len(raw))
	for _, t := range raw {
		t.CanonicalName = strings.TrimSpace(t.CanonicalName)
		t.Name = strings.TrimSpace(t.Name)
		t.SpriteURL = strings.TrimSpace(t.SpriteURL)
		if t.CanonicalName == "" {
			continue
		}
		if _, dup := seen[t.CanonicalName]; dup {
			continue
		}
		seen[t.CanonicalName] = struct{}{}
		out = append(out, t)
	}
	return out
}

// applyOverlayUpdate handles overlay and overlay-mode changes, clearing the
// per-pokemon overlay when switching away from "custom" mode.
func applyOverlayUpdate(dst *Pokemon, update Pokemon) {
	dst.Overlay = update.Overlay
	if update.OverlayMode != "" {
		dst.OverlayMode = update.OverlayMode
		if update.OverlayMode != "custom" {
			dst.Overlay = nil
		}
	}
}

// UpdatePokemon applies non-zero fields from update to the Pokémon with the
// given id. Returns false if no matching Pokémon was found.
// Only user-editable fields are updated; immutable fields like ID and
// CreatedAt are always preserved.
func (m *Manager) UpdatePokemon(id string, update Pokemon) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			applyPokemonUpdate(&m.state.Pokemon[i], update)
			m.markDirty()
			return true
		}
	}
	return false
}

// ClearPokemonSprite resets sprite_url to empty for the Pokémon with the given
// id. UpdatePokemon cannot do this itself since it treats an empty SpriteURL
// as "leave unchanged" so uploads are never accidentally wiped by unrelated
// field patches. Returns false if no matching Pokémon was found.
func (m *Manager) ClearPokemonSprite(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			m.state.Pokemon[i].SpriteURL = ""
			m.markDirty()
			return true
		}
	}
	return false
}

// ReorderPokemon assigns each Pokémon in orderedIDs a zero-based SortOrder
// matching its position. It returns an error if any id is unknown.
func (m *Manager) ReorderPokemon(orderedIDs []string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	// Index existing Pokémon by id so we can validate before mutating.
	indexByID := make(map[string]int, len(m.state.Pokemon))
	for i := range m.state.Pokemon {
		indexByID[m.state.Pokemon[i].ID] = i
	}
	for _, id := range orderedIDs {
		if _, ok := indexByID[id]; !ok {
			return fmt.Errorf("unknown pokemon id: %s", id)
		}
	}
	for order, id := range orderedIDs {
		m.state.Pokemon[indexByID[id]].SortOrder = order
	}
	m.markDirty()
	return nil
}

// resetLinkedOverlays resets any Pokemon whose overlay is linked to the given id back to "default".
func (m *Manager) resetLinkedOverlays(id string) {
	linked := overlayLinkedPrefix + id
	for j := range m.state.Pokemon {
		if m.state.Pokemon[j].OverlayMode == linked {
			m.state.Pokemon[j].OverlayMode = "default"
		}
	}
}

// DeletePokemon removes the Pokémon with the given id. If it was the active
// Pokémon, the first remaining entry becomes active. Returns false if not found.
//
// Deliberately keeps PhaseOf on the deleted hunt's phase entries instead of
// clearing it: an orphaned phase keeps its "phase N" marking (the frontend just
// omits the link back to the hunt). Clearing it would silently rewrite those
// entries into ordinary hunts and erase the fact that they were phases.
func (m *Manager) DeletePokemon(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, p := range m.state.Pokemon {
		if p.ID == id {
			m.state.Pokemon = append(m.state.Pokemon[:i], m.state.Pokemon[i+1:]...)
			if m.state.ActiveID == id {
				m.state.ActiveID = ""
				if len(m.state.Pokemon) > 0 {
					m.state.ActiveID = m.state.Pokemon[0].ID
					m.state.Pokemon[0].IsActive = true
				}
			}
			m.resetLinkedOverlays(id)
			m.markDirty()
			return true
		}
	}
	return false
}

// SetActive marks the Pokémon with the given id as active and clears the
// IsActive flag on all others. Returns false if no matching Pokémon exists.
func (m *Manager) SetActive(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	found := false
	for _, p := range m.state.Pokemon {
		if p.ID == id {
			found = true
			break
		}
	}
	if !found {
		return false
	}
	m.state.ActiveID = id
	m.state.ActiveGroupID = ""
	for i := range m.state.Pokemon {
		m.state.Pokemon[i].IsActive = m.state.Pokemon[i].ID == id
	}
	m.markDirty()
	return true
}

// SetActiveGroup marks the group with the given ID as the active hotkey target.
// It clears ActiveID so individual-pokemon hotkeys do not fire simultaneously.
// Returns false if groupID is not found.
func (m *Manager) SetActiveGroup(groupID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if groupID != "" {
		found := false
		for _, g := range m.state.Groups {
			if g.ID == groupID {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	m.state.ActiveGroupID = groupID
	m.state.ActiveID = ""
	for i := range m.state.Pokemon {
		m.state.Pokemon[i].IsActive = false
	}
	m.markDirty()
	return true
}

// GetActiveGroupID returns the ID of the currently active group, or "" if none.
func (m *Manager) GetActiveGroupID() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.state.ActiveGroupID
}

// CompletePokemon stamps the Pokémon's CompletedAt field with the current
// time, marking the hunt as finished. Returns false if not found.
func (m *Manager) CompletePokemon(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			now := time.Now()
			// Finalize a running timer so elapsed ms are preserved and the
			// counter stops advancing after completion.
			if m.state.Pokemon[i].TimerStartedAt != nil {
				elapsed := now.Sub(*m.state.Pokemon[i].TimerStartedAt)
				m.state.Pokemon[i].TimerAccumulatedMs += elapsed.Milliseconds()
				m.state.Pokemon[i].TimerStartedAt = nil
			}
			m.state.Pokemon[i].CompletedAt = &now
			m.markDirty()
			return true
		}
	}
	return false
}

// SetCompletedAt re-dates an entry that is already finished, overwriting its
// CompletedAt with at. Returns false for an unknown id and for an entry whose
// CompletedAt is still nil: finishing a running hunt goes through
// CompletePokemon, which also finalizes the timer.
func (m *Manager) SetCompletedAt(id string, at time.Time) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID != id {
			continue
		}
		if m.state.Pokemon[i].CompletedAt == nil {
			return false
		}
		stamped := at
		m.state.Pokemon[i].CompletedAt = &stamped
		m.markDirty()
		return true
	}
	return false
}

// FailPokemon stamps the Pokémon's CompletedAt field with the current time
// and marks it as failed, archiving the hunt as "shiny sighted, not caught"
// instead of a regular catch. Returns false if not found.
//
// Phase entries are refused: a phase can only be failed through EndPhase,
// which archives it as a new child instead of mutating the phase itself.
func (m *Manager) FailPokemon(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			if m.state.Pokemon[i].PhaseOf != "" {
				return false
			}
			now := time.Now()
			// Finalize a running timer so elapsed ms are preserved and the
			// counter stops advancing after completion.
			if m.state.Pokemon[i].TimerStartedAt != nil {
				elapsed := now.Sub(*m.state.Pokemon[i].TimerStartedAt)
				m.state.Pokemon[i].TimerAccumulatedMs += elapsed.Milliseconds()
				m.state.Pokemon[i].TimerStartedAt = nil
			}
			m.state.Pokemon[i].CompletedAt = &now
			m.state.Pokemon[i].Failed = true
			m.markDirty()
			return true
		}
	}
	return false
}

// SetCatchMeta replaces the recorded catch details of the Pokémon with the
// given id. A nil meta, or one that carries nothing once its ribbons are
// normalized, clears the record. Returns false if not found.
func (m *Manager) SetCatchMeta(id string, meta *CatchMeta, nickname, gender string, spriteURL *string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID != id {
			continue
		}
		var stored *CatchMeta
		if meta != nil {
			normalized := *meta
			normalized.Nickname = ""
			normalized.Ribbons = normalizeTags(normalized.Ribbons)
			if !normalized.IsEmpty() {
				stored = &normalized
			}
		}
		m.state.Pokemon[i].Catch = stored
		m.state.Pokemon[i].Nickname = strings.TrimSpace(nickname)
		m.state.Pokemon[i].Gender = gender
		if spriteURL != nil {
			m.state.Pokemon[i].SpriteURL = *spriteURL
		}
		m.markDirty()
		return true
	}
	return false
}

// UncompletePokemon clears the CompletedAt timestamp, moving the Pokémon
// back to active-hunt status. It also clears Failed, so reactivating a failed
// hunt lifts the fail state without a separate "unfail" action. Returns false
// if not found.
//
// Phase entries are refused: a reactivated phase would keep counting while its
// frozen encounters and time still flow into the totals of its parent hunt.
// UndoPhase is the supported way to take a phase back.
func (m *Manager) UncompletePokemon(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			if m.state.Pokemon[i].PhaseOf != "" {
				return false
			}
			m.state.Pokemon[i].CompletedAt = nil
			m.state.Pokemon[i].Failed = false
			m.markDirty()
			return true
		}
	}
	return false
}

// NextPokemon advances the active Pokémon to the next entry in the list,
// wrapping around at the end. No-ops when the list is empty.
func (m *Manager) NextPokemon() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.state.Pokemon) == 0 {
		return
	}
	idx := 0
	for i, p := range m.state.Pokemon {
		if p.ID == m.state.ActiveID {
			idx = (i + 1) % len(m.state.Pokemon)
			break
		}
	}
	m.state.ActiveID = m.state.Pokemon[idx].ID
	for i := range m.state.Pokemon {
		m.state.Pokemon[i].IsActive = m.state.Pokemon[i].ID == m.state.ActiveID
	}
	m.markDirty()
}

// UpdateSettings replaces the application settings atomically and notifies
// all listeners so the frontend and file-output writer stay in sync.
func (m *Manager) UpdateSettings(s Settings) {
	m.mu.Lock()
	// Preserve per-device capture resolutions when a settings payload omits
	// them (the dedicated /api/capture/resolution endpoint owns that map).
	if s.CaptureResolutions == nil {
		s.CaptureResolutions = m.state.Settings.CaptureResolutions
	}
	if s.CaptureResolutions == nil {
		s.CaptureResolutions = map[string]string{}
	}
	m.state.Settings = s
	m.mu.Unlock()
	m.markDirty()
}

// SetCaptureResolution stores the preferred capture resolution for a single
// camera deviceId and notifies listeners. An empty resolution removes the
// entry (falling back to the frontend default). The map is created lazily so
// older state loaded without it stays valid.
func (m *Manager) SetCaptureResolution(deviceKey, resolution string) {
	m.mu.Lock()
	if m.state.Settings.CaptureResolutions == nil {
		m.state.Settings.CaptureResolutions = map[string]string{}
	}
	if resolution == "" {
		delete(m.state.Settings.CaptureResolutions, deviceKey)
	} else {
		m.state.Settings.CaptureResolutions[deviceKey] = resolution
	}
	m.mu.Unlock()
	m.markDirty()
}

// UpdateHotkeys replaces the full hotkey map and notifies listeners.
func (m *Manager) UpdateHotkeys(h HotkeyMap) {
	m.mu.Lock()
	m.state.Hotkeys = h
	m.mu.Unlock()
	m.markDirty()
}

// UpdateSingleHotkey updates one field of the HotkeyMap and notifies listeners.
// Returns false if action is not a recognized key name.
func (m *Manager) UpdateSingleHotkey(action, key string) bool {
	m.mu.Lock()
	switch action {
	case "increment":
		m.state.Hotkeys.Increment = key
	case "decrement":
		m.state.Hotkeys.Decrement = key
	case "reset":
		m.state.Hotkeys.Reset = key
	case "next_pokemon":
		m.state.Hotkeys.NextPokemon = key
	case "hunt_toggle":
		m.state.Hotkeys.HuntToggle = key
	default:
		m.mu.Unlock()
		return false
	}
	m.mu.Unlock()
	m.markDirty()
	return true
}

// AcceptLicense records that the user has accepted the AGPLv3 license.
// The flag is persisted so the dialog is not shown again on future launches.
func (m *Manager) AcceptLicense() {
	m.mu.Lock()
	m.state.LicenseAccepted = true
	m.mu.Unlock()
	m.markDirty()
}

// AddSession appends a new session record. Sessions are informational only
// and are not currently used to drive encounter counts.
func (m *Manager) AddSession(sess Session) {
	m.mu.Lock()
	m.state.Sessions = append(m.state.Sessions, sess)
	m.mu.Unlock()
	m.markDirty()
}

// EndSession sets the EndedAt timestamp on the open session with the given id.
func (m *Manager) EndSession(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	for i := range m.state.Sessions {
		if m.state.Sessions[i].ID == id && m.state.Sessions[i].EndedAt == nil {
			m.state.Sessions[i].EndedAt = &now
			break
		}
	}
	m.markDirty()
}

// SetDetectorConfig replaces the DetectorConfig for the Pokémon with the given id.
// Pass nil to disable auto-detection for that hunt.
// Returns false if no matching Pokémon was found.
func (m *Manager) SetDetectorConfig(id string, cfg *DetectorConfig) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			m.state.Pokemon[i].DetectorConfig = cfg
			m.markDirty()
			return true
		}
	}
	return false
}

// GetConfigDir returns the directory used for state persistence
// (e.g. ~/.config/encounty on Linux).
func (m *Manager) GetConfigDir() string {
	return m.configDir
}

// SetDBDir points the manager at the directory holding the database. It also
// updates the state snapshot so a broadcast after a relocation reports the new
// location instead of the one the app started with.
func (m *Manager) SetDBDir(dir string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.dbDir = dir
	m.state.DataPath = dir
}

// SetOutputDir points the OBS text output at dir. UpdateSettings replaces the
// whole settings object and would clobber concurrent edits, so a relocation
// that only concerns this one path uses its own setter.
func (m *Manager) SetOutputDir(dir string) {
	m.mu.Lock()
	m.state.Settings.OutputDir = dir
	m.mu.Unlock()
	m.markDirty()
}

// GetDBDir returns the directory holding the database. It equals the
// configuration directory unless the user relocated the database.
func (m *Manager) GetDBDir() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.dbDir
}

// ResolveOverlay returns the effective OverlaySettings for a Pokemon,
// following links and falling back to the default layout.
func (m *Manager) ResolveOverlay(pokemonID string) OverlaySettings {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.resolveOverlayLocked(pokemonID, make(map[string]bool))
}

// resolveOverlayLocked recursively resolves the overlay for a Pokemon,
// using a visited set to break cycles in linked overlays.
func (m *Manager) resolveOverlayLocked(pokemonID string, visited map[string]bool) OverlaySettings {
	if visited[pokemonID] {
		return m.state.Settings.Overlay // break cycle
	}
	visited[pokemonID] = true
	for _, p := range m.state.Pokemon {
		if p.ID == pokemonID {
			switch {
			case strings.HasPrefix(p.OverlayMode, overlayLinkedPrefix):
				targetID := strings.TrimPrefix(p.OverlayMode, overlayLinkedPrefix)
				return m.resolveOverlayLocked(targetID, visited)
			case p.OverlayMode == "custom" && p.Overlay != nil:
				return *p.Overlay
			default:
				return m.state.Settings.Overlay
			}
		}
	}
	return m.state.Settings.Overlay
}

// UnlinkOverlay copies the resolved overlay settings for a Pokemon
// and sets its mode to "custom", breaking any link.
func (m *Manager) UnlinkOverlay(pokemonID string) bool {
	resolved := m.ResolveOverlay(pokemonID)
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, p := range m.state.Pokemon {
		if p.ID == pokemonID {
			m.state.Pokemon[i].OverlayMode = "custom"
			m.state.Pokemon[i].Overlay = &resolved
			m.markDirty()
			return true
		}
	}
	return false
}

// AppendDetectionLog records a confirmed auto-detection match for the Pokémon
// with the given id. Only the last maxDetectionLog entries are retained; older
// entries are dropped (FIFO). No-ops silently if the Pokémon has no DetectorConfig.
func (m *Manager) AppendDetectionLog(id string, confidence float64, category string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		p := &m.state.Pokemon[i]
		if p.ID != id || p.DetectorConfig == nil {
			continue
		}
		entry := DetectionLogEntry{At: time.Now().UTC(), Confidence: confidence, Category: category}
		p.DetectorConfig.DetectionLog = append(p.DetectorConfig.DetectionLog, entry)
		if len(p.DetectorConfig.DetectionLog) > maxDetectionLog {
			p.DetectorConfig.DetectionLog = p.DetectorConfig.DetectionLog[len(p.DetectorConfig.DetectionLog)-maxDetectionLog:]
		}
		m.markDirty()
		return
	}
}

// ClearDetectionLog removes all detection log entries for the given Pokemon.
// No-ops silently if the Pokémon or its DetectorConfig does not exist.
func (m *Manager) ClearDetectionLog(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		p := &m.state.Pokemon[i]
		if p.ID == id && p.DetectorConfig != nil {
			p.DetectorConfig.DetectionLog = nil
			m.markDirty()
			return
		}
	}
}

// ClearAllTemplates removes all templates for the given Pokemon.
// No-ops silently if the Pokémon or its DetectorConfig does not exist.
func (m *Manager) ClearAllTemplates(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		p := &m.state.Pokemon[i]
		if p.ID == id && p.DetectorConfig != nil {
			p.DetectorConfig.Templates = nil
			m.markDirty()
			return
		}
	}
}
