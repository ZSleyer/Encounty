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
