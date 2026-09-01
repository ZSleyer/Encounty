// timers.go holds the hunt timer mutations. Elapsed time is kept as a start
// timestamp plus an accumulated total rather than a single counter, so a timer
// left running survives a restart and stopping one never loses the time it has
// already counted.

package state

import "time"

// StartTimer sets TimerStartedAt for the Pokémon, beginning time accumulation.
// No-ops if the timer is already running. Returns false if not found.
func (m *Manager) StartTimer(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			if m.state.Pokemon[i].TimerStartedAt == nil {
				now := time.Now()
				m.state.Pokemon[i].TimerStartedAt = &now
			}
			m.markCounterDirty(id)
			return true
		}
	}
	return false
}

// StopTimer calculates elapsed time since TimerStartedAt, adds it to
// TimerAccumulatedMs, and clears TimerStartedAt. Returns false if not found.
func (m *Manager) StopTimer(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			if m.state.Pokemon[i].TimerStartedAt != nil {
				elapsed := time.Since(*m.state.Pokemon[i].TimerStartedAt)
				m.state.Pokemon[i].TimerAccumulatedMs += elapsed.Milliseconds()
				m.state.Pokemon[i].TimerStartedAt = nil
			}
			m.markCounterDirty(id)
			return true
		}
	}
	return false
}

// ToggleHunt flips the timer state for the Pokémon with the given id.
// If the timer is running, it is stopped and the elapsed segment is folded
// into TimerAccumulatedMs; running is false (now stopped).
// If the timer is not running, it is started; running is true (now running).
// huntMode carries the Pokémon's current hunt_mode so callers can include it
// in the broadcast without a second lookup. ok is false only when no Pokémon
// with the given id exists.
//
// The detector loop runs in-browser, so this method intentionally only toggles
// the backend-owned timer. Callers broadcast a typed WebSocket event so the
// frontend can start or stop its detection loop in lockstep.
func (m *Manager) ToggleHunt(id string) (running bool, huntMode string, ok bool) {
	m.mu.Lock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID != id {
			continue
		}
		mode := m.state.Pokemon[i].HuntMode
		if m.state.Pokemon[i].TimerStartedAt != nil {
			elapsed := time.Since(*m.state.Pokemon[i].TimerStartedAt)
			m.state.Pokemon[i].TimerAccumulatedMs += elapsed.Milliseconds()
			m.state.Pokemon[i].TimerStartedAt = nil
			m.mu.Unlock()
			m.markCounterDirty(id)
			return false, mode, true
		}
		now := time.Now()
		m.state.Pokemon[i].TimerStartedAt = &now
		m.mu.Unlock()
		m.markCounterDirty(id)
		return true, mode, true
	}
	m.mu.Unlock()
	return false, "", false
}

// StopAllTimers folds elapsed time into accumulated for every running timer
// and clears TimerStartedAt. Used during graceful shutdown.
func (m *Manager) StopAllTimers() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].TimerStartedAt != nil {
			elapsed := time.Since(*m.state.Pokemon[i].TimerStartedAt)
			m.state.Pokemon[i].TimerAccumulatedMs += elapsed.Milliseconds()
			m.state.Pokemon[i].TimerStartedAt = nil
		}
	}
}

// ResetTimer clears both TimerStartedAt and TimerAccumulatedMs.
// Returns false if not found.
func (m *Manager) ResetTimer(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			m.state.Pokemon[i].TimerStartedAt = nil
			m.state.Pokemon[i].TimerAccumulatedMs = 0
			m.markCounterDirty(id)
			return true
		}
	}
	return false
}

// SetTimer sets TimerAccumulatedMs to the given value. If the timer is
// currently running, the running segment is discarded (not folded) because
// the caller is explicitly overriding the total. Returns false if not found.
func (m *Manager) SetTimer(id string, ms int64) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			m.state.Pokemon[i].TimerStartedAt = nil
			if ms < 0 {
				ms = 0
			}
			m.state.Pokemon[i].TimerAccumulatedMs = ms
			m.markCounterDirty(id)
			return true
		}
	}
	return false
}
