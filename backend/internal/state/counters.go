// counters.go holds the encounter counter mutations, both for a single hunt and
// for every running hunt of a group. These are by far the most frequent writes
// in the application, so each one marks only the counters it touched dirty and
// lets the persistence layer skip a full structural save.

package state

// Increment adds step encounters to the Pokémon with the given id.
// Step defaults to 1 when not set.
// Returns the new count and true, or (0, false) if not found.
func (m *Manager) Increment(id string) (int, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			step := m.state.Pokemon[i].Step
			if step <= 0 {
				step = 1
			}
			m.state.Pokemon[i].Encounters += step
			count := m.state.Pokemon[i].Encounters
			m.markCounterDirty(id)
			return count, true
		}
	}
	return 0, false
}

// Decrement subtracts step encounters from the Pokémon with the given id,
// flooring at zero to prevent negative counts.
// Returns the new count and true, or (0, false) if not found.
func (m *Manager) Decrement(id string) (int, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			step := m.state.Pokemon[i].Step
			if step <= 0 {
				step = 1
			}
			if m.state.Pokemon[i].Encounters >= step {
				m.state.Pokemon[i].Encounters -= step
			} else {
				m.state.Pokemon[i].Encounters = 0
			}
			count := m.state.Pokemon[i].Encounters
			m.markCounterDirty(id)
			return count, true
		}
	}
	return 0, false
}

// Reset sets the encounter counter for the given Pokémon to zero.
// Returns false if the Pokémon was not found.
func (m *Manager) Reset(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			m.state.Pokemon[i].Encounters = 0
			m.markCounterDirty(id)
			return true
		}
	}
	return false
}

// IncrementGroup increments all running Pokémon in the given group by their
// step value. Completed entries are skipped: phase entries inherit the group of
// their hunt, and their counters are frozen history.
func (m *Manager) IncrementGroup(groupID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var changed []string
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].GroupID != groupID || m.state.Pokemon[i].CompletedAt != nil {
			continue
		}
		step := m.state.Pokemon[i].Step
		if step <= 0 {
			step = 1
		}
		m.state.Pokemon[i].Encounters += step
		changed = append(changed, m.state.Pokemon[i].ID)
	}
	m.markCounterDirty(changed...)
}

// DecrementGroup decrements all running Pokémon in the given group by their
// step value, flooring at zero. Completed entries are skipped for the same
// reason as in IncrementGroup.
func (m *Manager) DecrementGroup(groupID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var changed []string
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].GroupID != groupID || m.state.Pokemon[i].CompletedAt != nil {
			continue
		}
		step := m.state.Pokemon[i].Step
		if step <= 0 {
			step = 1
		}
		if m.state.Pokemon[i].Encounters >= step {
			m.state.Pokemon[i].Encounters -= step
		} else {
			m.state.Pokemon[i].Encounters = 0
		}
		changed = append(changed, m.state.Pokemon[i].ID)
	}
	m.markCounterDirty(changed...)
}

// ResetGroup resets the encounter count of all running Pokémon in the given
// group to 0. Completed entries are skipped: without that guard a group reset
// would wipe the encounter counts of every phase entry in the group and destroy
// the hunt history irrecoverably.
func (m *Manager) ResetGroup(groupID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var changed []string
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].GroupID == groupID && m.state.Pokemon[i].CompletedAt == nil {
			m.state.Pokemon[i].Encounters = 0
			changed = append(changed, m.state.Pokemon[i].ID)
		}
	}
	m.markCounterDirty(changed...)
}

// SetEncounters sets the encounter counter for the given Pokémon to an exact
// value (floored at 0). Returns the new count and true, or (0, false) if not found.
func (m *Manager) SetEncounters(id string, count int) (int, bool) {
	if count < 0 {
		count = 0
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			m.state.Pokemon[i].Encounters = count
			m.markCounterDirty(id)
			return count, true
		}
	}
	return 0, false
}
