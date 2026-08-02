// fileoutput_phase_test.go covers the phase-aware part of the file output: the
// three derived files of the active hunt (phase, total encounters, total timer)
// and the rule that phase entries get no per-Pokémon directory of their own.
package fileoutput

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// phaseState builds a hunt with two finished phases plus an unrelated hunt.
func phaseState() state.AppState {
	now := time.Now()
	return state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Pikachu", Encounters: 100, TimerAccumulatedMs: 1000, CreatedAt: now, IsActive: true},
			{ID: "c1", Name: "Zubat", Encounters: 200, TimerAccumulatedMs: 3600000, CreatedAt: now, PhaseOf: "p1", PhaseNumber: 1},
			{ID: "c2", Name: "Golbat", Encounters: 300, TimerAccumulatedMs: 61000, CreatedAt: now, PhaseOf: "p1", PhaseNumber: 2},
			{ID: "p2", Name: "Charmander", Encounters: 20, CreatedAt: now},
		},
	}
}

// readOutput reads an output file and fails the test when it is missing.
func readOutput(t *testing.T, dir, name string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		t.Fatalf("reading %s: %v", name, err)
	}
	return string(data)
}

// TestWritePhaseTotals verifies that the three derived phase files of the
// active hunt are written and that the per-phase counter files keep showing the
// values of the running phase only.
func TestWritePhaseTotals(t *testing.T) {
	dir := t.TempDir()
	New(dir, true).Write(phaseState())

	cases := []struct{ file, want string }{
		{"phase.txt", "3"},
		{"total_encounters.txt", "600"},
		{"total_timer.txt", "01:01:02"},
		{"encounters.txt", "100"},
		// The phase entries keep their encounters, so the daily total is
		// unchanged by a phase switch.
		{"encounters_today.txt", "620"},
	}
	for _, c := range cases {
		if got := readOutput(t, dir, c.file); got != c.want {
			t.Errorf("%s = %q, want %q", c.file, got, c.want)
		}
	}
}

// TestWriteSkipsPhaseDirs verifies that only real hunts get a per-Pokémon
// directory: phase entries are skipped so a long hunt does not multiply the
// file operations of every encounter.
func TestWriteSkipsPhaseDirs(t *testing.T) {
	dir := t.TempDir()
	New(dir, true).Write(phaseState())

	if _, err := os.Stat(filepath.Join(dir, "Pikachu_p1")); err != nil {
		t.Errorf("hunt directory should exist: %v", err)
	}
	for _, sub := range []string{"Zubat_c1", "Golbat_c2"} {
		if _, err := os.Stat(filepath.Join(dir, sub)); !os.IsNotExist(err) {
			t.Errorf("phase directory %s should not be created", sub)
		}
	}
}

// TestWritePhaseTotalsWithRunningTimer verifies that the running timer segment
// of the hunt is added to the accumulated time of all phases.
func TestWritePhaseTotalsWithRunningTimer(t *testing.T) {
	dir := t.TempDir()
	st := phaseState()
	startedAt := time.Now().Add(-2 * time.Hour)
	st.Pokemon[0].TimerStartedAt = &startedAt

	New(dir, true).Write(st)

	// 01:01:02 accumulated over hunt and phases plus the running 2h segment.
	if got := readOutput(t, dir, "total_timer.txt"); got != "03:01:02" {
		t.Errorf("total_timer.txt = %q, want %q", got, "03:01:02")
	}
}

// TestWritePhaseFilesWithoutActivePokemon verifies that the phase files are
// still written with zero values when no hunt is active, so a stream overlay
// reading them never hits a missing file.
func TestWritePhaseFilesWithoutActivePokemon(t *testing.T) {
	dir := t.TempDir()
	New(dir, true).Write(state.AppState{ActiveID: "", Pokemon: []state.Pokemon{}})

	cases := []struct{ file, want string }{
		{"phase.txt", "0"},
		{"total_encounters.txt", "0"},
		{"total_timer.txt", "00:00:00"},
	}
	for _, c := range cases {
		if got := readOutput(t, dir, c.file); got != c.want {
			t.Errorf("%s = %q, want %q", c.file, got, c.want)
		}
	}
}

// TestFormatClock verifies the HH:MM:SS formatting used by the timer files,
// including negative and sub-second inputs and durations beyond 24 hours.
func TestFormatClock(t *testing.T) {
	cases := []struct {
		ms   int64
		want string
	}{
		{0, "00:00:00"},
		{-5, "00:00:00"},
		{999, "00:00:00"},
		{61000, "00:01:01"},
		{3661000, "01:01:01"},
		{360000000, "100:00:00"},
	}
	for _, c := range cases {
		if got := formatClock(c.ms); got != c.want {
			t.Errorf("formatClock(%d) = %q, want %q", c.ms, got, c.want)
		}
	}
}
