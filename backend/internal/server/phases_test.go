// phases_test.go covers the encounter history guard for phased hunts on the
// paths the application actually uses: the WebSocket decrement and reset
// actions sent by the dashboard and the global decrement hotkey.
package server

import (
	"path/filepath"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// newPhaseTestServer returns a test server backed by a real database with the
// hunt "p1" at one encounter and one logged encounter event. With withPhase the
// hunt also carries a finished phase, which is what the history guard keys on.
func newPhaseTestServer(t *testing.T, withPhase bool) *Server {
	t.Helper()
	srv := newTestServer(t)
	db, err := database.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	srv.db = db

	addTestPokemon(t, srv, "p1", "Rattata")
	if withPhase {
		if _, err := srv.state.EndPhase("p1", state.PhaseCatch{Name: "Hoothoot"}); err != nil {
			t.Fatalf("EndPhase: %v", err)
		}
	}
	srv.state.SetEncounters("p1", 1)
	if err := db.LogEncounter("p1", "Rattata", 1, 1, "test"); err != nil {
		t.Fatalf("LogEncounter: %v", err)
	}
	return srv
}

// encounterEventCount returns the number of encounter events stored for the
// given Pokémon.
func encounterEventCount(t *testing.T, srv *Server, id string) int {
	t.Helper()
	events, err := srv.db.GetEncounterHistory(id, 100, 0)
	if err != nil {
		t.Fatalf("GetEncounterHistory: %v", err)
	}
	return len(events)
}

// TestWSDecrementToZeroKeepsPhasedHistory verifies that counting a phased hunt
// back down to zero over the WebSocket keeps the encounter events. They belong
// to all phases of the hunt, so deleting them would wipe the whole chart.
func TestWSDecrementToZeroKeepsPhasedHistory(t *testing.T) {
	srv := newPhaseTestServer(t, true)

	srv.handleWSMessage(makeWSMessage(t, "decrement", map[string]string{"pokemon_id": "p1"}))

	// The seeded event plus the one logged for the decrement itself.
	if got := encounterEventCount(t, srv, "p1"); got != 2 {
		t.Errorf("encounter events = %d, want 2 (history kept on a phased hunt)", got)
	}
}

// TestWSDecrementToZeroClearsHistoryWithoutPhases verifies that the guard is
// limited to phased hunts: an ordinary hunt still drops its events at zero.
func TestWSDecrementToZeroClearsHistoryWithoutPhases(t *testing.T) {
	srv := newPhaseTestServer(t, false)

	srv.handleWSMessage(makeWSMessage(t, "decrement", map[string]string{"pokemon_id": "p1"}))

	if got := encounterEventCount(t, srv, "p1"); got != 0 {
		t.Errorf("encounter events = %d, want 0 (history cleared without phases)", got)
	}
}

// TestWSResetKeepsPhasedHistory verifies that a reset over the WebSocket keeps
// the encounter events of a phased hunt: it only zeroes the counter of the
// running phase, the phase entries keep their own encounters.
func TestWSResetKeepsPhasedHistory(t *testing.T) {
	srv := newPhaseTestServer(t, true)

	srv.handleWSMessage(makeWSMessage(t, "reset", map[string]string{"pokemon_id": "p1"}))

	if got := encounterEventCount(t, srv, "p1"); got != 1 {
		t.Errorf("encounter events = %d, want 1 (history kept on a phased hunt)", got)
	}
}

// TestWSResetClearsHistoryWithoutPhases verifies that a reset still clears the
// events of a hunt without phases.
func TestWSResetClearsHistoryWithoutPhases(t *testing.T) {
	srv := newPhaseTestServer(t, false)

	srv.handleWSMessage(makeWSMessage(t, "reset", map[string]string{"pokemon_id": "p1"}))

	if got := encounterEventCount(t, srv, "p1"); got != 0 {
		t.Errorf("encounter events = %d, want 0 (history cleared without phases)", got)
	}
}

// TestHotkeyDecrementToZeroKeepsPhasedHistory verifies that the global decrement
// hotkey follows the same rule as the WebSocket path.
func TestHotkeyDecrementToZeroKeepsPhasedHistory(t *testing.T) {
	srv := newPhaseTestServer(t, true)

	srv.handleHotkeyDecrement("p1")

	if got := encounterEventCount(t, srv, "p1"); got != 2 {
		t.Errorf("encounter events = %d, want 2 (history kept on a phased hunt)", got)
	}
}

// TestHotkeyDecrementToZeroClearsHistoryWithoutPhases verifies that the hotkey
// still clears the events of a hunt without phases.
func TestHotkeyDecrementToZeroClearsHistoryWithoutPhases(t *testing.T) {
	srv := newPhaseTestServer(t, false)

	srv.handleHotkeyDecrement("p1")

	if got := encounterEventCount(t, srv, "p1"); got != 0 {
		t.Errorf("encounter events = %d, want 0 (history cleared without phases)", got)
	}
}
