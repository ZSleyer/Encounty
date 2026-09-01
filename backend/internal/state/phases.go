// phases.go holds the derivation helpers for phased hunts. A phase is a normal
// Pokémon entry that carries PhaseOf and PhaseNumber; every aggregate over the
// phases of a hunt (phase number, total encounters, total time) is derived from
// a state snapshot and never stored. These functions are the only derivation
// source in the backend, so the numbers in the file output, the API and the
// frontend cannot drift apart. Everything here is pure and snapshot-based
// except HasPhaseChildren, which reads the live state under a read lock.
package state

import (
	"errors"
	"sort"
	"time"

	"github.com/google/uuid"
)

// PhaseChildren returns the phase entries belonging to the hunt with parentID,
// sorted ascending by PhaseNumber. The result is a fresh slice and never nil.
// It operates on a caller-provided snapshot and takes no lock.
func PhaseChildren(all []Pokemon, parentID string) []Pokemon {
	out := make([]Pokemon, 0, 4)
	if parentID == "" {
		return out
	}
	for _, p := range all {
		if p.PhaseOf == parentID {
			out = append(out, p)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].PhaseNumber < out[j].PhaseNumber
	})
	return out
}

// HasPhaseChildren reports whether the hunt with parentID has phase entries.
// It answers from the live Pokémon slice under a read lock instead of cloning
// the whole state, so callers on the hot counter path (decrement, reset) pay a
// single scan. Returns a bool rather than the entries themselves so no slice
// that the state mutates in place can escape the lock.
func (m *Manager) HasPhaseChildren(parentID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(PhaseChildren(m.state.Pokemon, parentID)) > 0
}

// PhaseNumber returns the phase number of the entry with the given id: for a
// running hunt the number of the phase currently in progress, for a phase entry
// its own frozen number. Returns 0 when no entry with that id exists.
//
// The running phase is max(child.PhaseNumber) + 1, which yields 1 for a hunt
// without phases and stays stable when a child in the middle is deleted. This
// is the single phase-number formula in the backend; the frontend mirrors it.
func PhaseNumber(all []Pokemon, id string) int {
	entry, ok := findPhaseEntry(all, id)
	if !ok {
		return 0
	}
	if entry.PhaseOf != "" {
		return entry.PhaseNumber
	}
	highest := 0
	for _, p := range all {
		if p.PhaseOf == id && p.PhaseNumber > highest {
			highest = p.PhaseNumber
		}
	}
	return highest + 1
}

// PhaseTotals returns the encounters, accumulated timer milliseconds and phase
// number of the entry with the given id, summed over all of its phases. For a
// phase entry it returns that entry's own frozen values, for a running hunt its
// own values plus those of every child. Returns zero values for an unknown id.
//
// timerMs deliberately excludes a currently running timer segment: the function
// stays pure so callers can cache its result. Callers that display a live time
// add time.Since(*p.TimerStartedAt) themselves.
func PhaseTotals(all []Pokemon, id string) (encounters int, timerMs int64, phase int) {
	entry, ok := findPhaseEntry(all, id)
	if !ok {
		return 0, 0, 0
	}
	encounters = entry.Encounters
	timerMs = entry.TimerAccumulatedMs
	if entry.PhaseOf != "" {
		return encounters, timerMs, entry.PhaseNumber
	}
	highest := 0
	for _, p := range all {
		if p.PhaseOf != id {
			continue
		}
		encounters += p.Encounters
		timerMs += p.TimerAccumulatedMs
		if p.PhaseNumber > highest {
			highest = p.PhaseNumber
		}
	}
	return encounters, timerMs, highest + 1
}

// findPhaseEntry looks up a Pokémon by id in a snapshot and reports whether it
// was found.
func findPhaseEntry(all []Pokemon, id string) (Pokemon, bool) {
	if id == "" {
		return Pokemon{}, false
	}
	for _, p := range all {
		if p.ID == id {
			return p, true
		}
	}
	return Pokemon{}, false
}

// ResolvePhaseLink validates the phase link (parentID, number) an entry wants
// to carry and returns the number it should be stored with. id is the entry
// being linked and "" for one that does not exist yet. A link that is left
// open (no parent, no number) resolves to 0 without error, which is how an
// ordinary catch passes through.
//
// This is the single phase-link validator in the backend so the hunt API and
// EndPhase cannot drift apart. A missing parent is reported as
// ErrPhaseParentNotFound; every other violation is a plain descriptive error
// that callers surface as a 400. Membership in a Pokédex is deliberately not
// checked: a phase inherits its parent's Pokédex membership, so the two can
// never disagree.
func ResolvePhaseLink(all []Pokemon, id, parentID string, number int) (int, error) {
	if parentID == "" && number == 0 {
		return 0, nil
	}
	if number < 0 {
		return 0, errors.New("phase_number must not be negative")
	}
	if parentID == "" {
		return 0, errors.New("phase_number requires phase_of")
	}
	if id != "" && parentID == id {
		return 0, errors.New("an entry cannot be a phase of itself")
	}
	parent, ok := findPhaseEntry(all, parentID)
	if !ok {
		return 0, ErrPhaseParentNotFound
	}
	if parent.PhaseOf != "" {
		return 0, errors.New("phase_of must reference an entry that is not itself a phase")
	}
	if id != "" && len(PhaseChildren(all, id)) > 0 {
		return 0, errors.New("an entry with phases cannot become a phase itself")
	}
	if number <= 0 {
		number = PhaseNumber(all, parentID)
	}
	return number, nil
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

// indexOfPokemon returns the position of the Pokémon with the given id in list,
// or -1 when it is not present.
func indexOfPokemon(list []Pokemon, id string) int {
	for i := range list {
		if list[i].ID == id {
			return i
		}
	}
	return -1
}

// EndPhase closes the running phase of the hunt with parentID. The off-target
// shiny described by catch becomes a completed child entry that freezes the
// hunt's encounters and elapsed time, and the hunt itself restarts at zero
// while a running timer keeps running. failed marks the resulting child entry
// as a sighted-but-not-caught phase instead of a regular catch.
//
// Returns the created child entry, ErrPhaseParentNotFound when parentID is
// unknown, or ErrNotPhaseable when the target is itself a phase or is already
// completed.
//
// The whole transition runs under a single lock and reimplements the pieces of
// CompletePokemon, Reset and AddPokemon it needs instead of calling them: each
// of those takes the lock itself, so a broadcast or save could observe the hunt
// already reset but the phase entry not yet inserted. Reset also only raises
// markCounterDirty, which would let the fast counter-only save path write the
// zeroed hunt without ever inserting the new row.
func (m *Manager) EndPhase(parentID string, catch PhaseCatch, failed bool) (Pokemon, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	idx := indexOfPokemon(m.state.Pokemon, parentID)
	if idx < 0 {
		return Pokemon{}, ErrPhaseParentNotFound
	}
	parent := m.state.Pokemon[idx]
	// Guard EndPhase adds on top of the shared link rules: a hunt that is
	// already archived cannot start another phase.
	if parent.CompletedAt != nil {
		return Pokemon{}, ErrNotPhaseable
	}
	// The link itself is validated by the single phase-link validator so the
	// hunt API and EndPhase cannot disagree about what a valid parent is.
	if _, err := ResolvePhaseLink(m.state.Pokemon, "", parentID, 0); err != nil {
		if errors.Is(err, ErrPhaseParentNotFound) {
			return Pokemon{}, ErrPhaseParentNotFound
		}
		return Pokemon{}, ErrNotPhaseable
	}

	now := time.Now()
	child := buildPhaseChild(m.state.Pokemon, parent, catch, now, failed)

	// Reset the hunt before appending: append may reallocate the slice, so the
	// index must still refer to the live backing array.
	m.state.Pokemon[idx].Encounters = 0
	m.state.Pokemon[idx].TimerAccumulatedMs = 0
	if m.state.Pokemon[idx].TimerStartedAt != nil {
		// The timer keeps running across the phase change; only its origin moves
		// so the new phase starts at zero.
		started := now
		m.state.Pokemon[idx].TimerStartedAt = &started
	}
	m.state.Pokemon = append(m.state.Pokemon, child)

	m.markDirty()
	return child, nil
}

// buildPhaseChild assembles the completed archive entry for a finished phase.
// It inherits the hunt context (game, language, method, charm, hunt mode, sprite
// style, group) and freezes the hunt's encounters and elapsed time, including a
// currently running timer segment measured up to now. failed marks the entry as
// a sighted-but-not-caught phase instead of a regular catch.
//
// DetectorConfig stays nil on purpose: copying it would duplicate every template
// image of the hunt for each phase. Overlay, IsActive, Tags and PhaseTargets are
// not inherited either; they describe the running hunt, not its history.
func buildPhaseChild(all []Pokemon, parent Pokemon, catch PhaseCatch, now time.Time, failed bool) Pokemon {
	frozenMs := parent.TimerAccumulatedMs
	if parent.TimerStartedAt != nil {
		frozenMs += now.Sub(*parent.TimerStartedAt).Milliseconds()
	}
	completedAt := now
	return Pokemon{
		ID:                 uuid.NewString(),
		Name:               catch.Name,
		BaseName:           catch.BaseName,
		FormName:           catch.FormName,
		CanonicalName:      catch.CanonicalName,
		Gender:             catch.Gender,
		SpriteURL:          catch.SpriteURL,
		SpriteType:         "shiny",
		SpriteStyle:        parent.SpriteStyle,
		Encounters:         parent.Encounters,
		CreatedAt:          phaseStartedAt(all, parent),
		Language:           parent.Language,
		Game:               parent.Game,
		CompletedAt:        &completedAt,
		Failed:             failed,
		OverlayMode:        "default",
		HuntType:           parent.HuntType,
		ShinyCharm:         parent.ShinyCharm,
		SparklingPower:     parent.SparklingPower,
		TimerAccumulatedMs: frozenMs,
		HuntMode:           parent.HuntMode,
		GroupID:            parent.GroupID,
		Tags:               []string{},
		SortOrder:          len(all),
		PhaseOf:            parent.ID,
		PhaseNumber:        PhaseNumber(all, parent.ID),
		PhaseTargets:       []PhaseTarget{},
		PokedexIDs:         append([]string(nil), parent.PokedexIDs...),
	}
}

// phaseStartedAt returns the start of the phase that is ending: the moment the
// previous phase was caught, or the creation of the hunt for the first phase.
// Storing it as the child's CreatedAt keeps the phase duration derivable and
// the archive sorted in the order the phases actually happened.
func phaseStartedAt(all []Pokemon, parent Pokemon) time.Time {
	children := PhaseChildren(all, parent.ID)
	if len(children) > 0 {
		if last := children[len(children)-1]; last.CompletedAt != nil {
			return *last.CompletedAt
		}
	}
	return parent.CreatedAt
}

// UndoPhase takes back the most recent phase change of a hunt: the phase entry
// with childID returns its encounters and accumulated time to its parent hunt
// and is removed. Returns the updated parent hunt.
//
// Only the newest phase can be undone, because any older one would leave a hole
// that the max(phase_number)+1 numbering cannot express. Returns
// ErrPhaseParentNotFound when childID is unknown or its parent hunt no longer
// exists, and ErrNotPhaseable when the entry is not a phase or not the newest
// one.
func (m *Manager) UndoPhase(childID string) (Pokemon, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	ci := indexOfPokemon(m.state.Pokemon, childID)
	if ci < 0 {
		return Pokemon{}, ErrPhaseParentNotFound
	}
	child := m.state.Pokemon[ci]
	if child.PhaseOf == "" {
		return Pokemon{}, ErrNotPhaseable
	}
	for _, sibling := range m.state.Pokemon {
		if sibling.PhaseOf == child.PhaseOf && sibling.PhaseNumber > child.PhaseNumber {
			return Pokemon{}, ErrNotPhaseable
		}
	}
	pi := indexOfPokemon(m.state.Pokemon, child.PhaseOf)
	if pi < 0 {
		return Pokemon{}, ErrPhaseParentNotFound
	}

	// The parent keeps its own running timer; only the frozen milliseconds of
	// the phase flow back, so an undo during a running hunt loses no time.
	m.state.Pokemon[pi].Encounters += child.Encounters
	m.state.Pokemon[pi].TimerAccumulatedMs += child.TimerAccumulatedMs

	m.state.Pokemon = append(m.state.Pokemon[:ci], m.state.Pokemon[ci+1:]...)
	m.resetLinkedOverlays(childID)
	if m.state.ActiveID == childID {
		// Hand the selection to the hunt the phase belonged to rather than
		// leaving a dangling active id behind.
		m.state.ActiveID = child.PhaseOf
		for i := range m.state.Pokemon {
			m.state.Pokemon[i].IsActive = m.state.Pokemon[i].ID == child.PhaseOf
		}
	}

	m.markDirty()
	// Re-resolve the index: removing the phase entry shifted everything after it.
	return m.state.Pokemon[indexOfPokemon(m.state.Pokemon, child.PhaseOf)], nil
}
