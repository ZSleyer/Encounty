// phases_test.go covers the phase transitions of a hunt: EndPhase and its
// inheritance rules, the phase numbering, UndoPhase, and the guards that keep
// completed entries (and therefore frozen phase history) out of the group-wide
// counter mutations.
package state

import (
	"errors"
	"testing"
	"time"
)

// newPhaseParent returns a manager holding a fully populated running hunt, so
// the inheritance assertions can distinguish "inherited" from "zero value".
func newPhaseParent(t *testing.T) (*Manager, Pokemon) {
	t.Helper()
	m := NewManager(t.TempDir())
	parent := Pokemon{
		ID:                 "parent",
		Name:               "Rattfratz",
		CanonicalName:      "rattata",
		SpriteURL:          "https://example.test/rattata.png",
		SpriteType:         "normal",
		SpriteStyle:        "animated",
		Encounters:         420,
		CreatedAt:          time.Now().Add(-2 * time.Hour),
		Language:           "de",
		Game:               "gold",
		OverlayMode:        "custom",
		Overlay:            &OverlaySettings{},
		HuntType:           "encounter",
		ShinyCharm:         true,
		SparklingPower:     2,
		DetectorConfig:     &DetectorConfig{Enabled: true},
		TimerAccumulatedMs: 90_000,
		HuntMode:           "timer",
		GroupID:            "g1",
		Tags:               []string{"johto"},
		PhaseTargets:       []PhaseTarget{{CanonicalName: "hoothoot", Name: "Hoothoot"}},
		IsActive:           true,
	}
	m.AddPokemon(parent)
	return m, parent
}

// catchOf returns a PhaseCatch for a named off-target shiny.
func catchOf(canonical, name string) PhaseCatch {
	return PhaseCatch{
		CanonicalName: canonical,
		Name:          name,
		BaseName:      name,
		SpriteURL:     "https://example.test/" + canonical + ".png",
	}
}

// findByID returns the entry with the given id from a state snapshot.
func findByID(t *testing.T, m *Manager, id string) Pokemon {
	t.Helper()
	for _, p := range m.GetState().Pokemon {
		if p.ID == id {
			return p
		}
	}
	t.Fatalf("pokemon %q not found in state", id)
	return Pokemon{}
}

// ---------------------------------------------------------------------------
// EndPhase
// ---------------------------------------------------------------------------

// TestEndPhaseInheritsHuntContext verifies that the phase entry inherits the
// hunt context, freezes the counters, and deliberately leaves out the fields
// that describe the running hunt rather than its history.
func TestEndPhaseInheritsHuntContext(t *testing.T) {
	m, parent := newPhaseParent(t)

	child, err := m.EndPhase(parent.ID, catchOf("hoothoot", "Hoothoot"), false)
	if err != nil {
		t.Fatalf("EndPhase: %v", err)
	}

	if child.ID == "" || child.ID == parent.ID {
		t.Errorf("child ID = %q, want a fresh id", child.ID)
	}
	if child.PhaseOf != parent.ID {
		t.Errorf("PhaseOf = %q, want %q", child.PhaseOf, parent.ID)
	}
	if child.PhaseNumber != 1 {
		t.Errorf("PhaseNumber = %d, want 1", child.PhaseNumber)
	}
	if child.CompletedAt == nil {
		t.Error("CompletedAt should be set on a phase entry")
	}
	if child.SpriteType != "shiny" {
		t.Errorf("SpriteType = %q, want %q", child.SpriteType, "shiny")
	}
	if child.Name != "Hoothoot" || child.CanonicalName != "hoothoot" {
		t.Errorf("catch identity = %q/%q, want Hoothoot/hoothoot", child.Name, child.CanonicalName)
	}

	// Inherited hunt context.
	if child.Game != parent.Game || child.Language != parent.Language {
		t.Errorf("game/language = %q/%q, want %q/%q", child.Game, child.Language, parent.Game, parent.Language)
	}
	if child.HuntType != parent.HuntType || child.HuntMode != parent.HuntMode {
		t.Errorf("hunt type/mode = %q/%q, want %q/%q", child.HuntType, child.HuntMode, parent.HuntType, parent.HuntMode)
	}
	if !child.ShinyCharm {
		t.Error("ShinyCharm should be inherited")
	}
	if child.SparklingPower != parent.SparklingPower {
		t.Errorf("SparklingPower = %d, want %d", child.SparklingPower, parent.SparklingPower)
	}
	if child.SpriteStyle != parent.SpriteStyle {
		t.Errorf("SpriteStyle = %q, want %q", child.SpriteStyle, parent.SpriteStyle)
	}
	if child.GroupID != parent.GroupID {
		t.Errorf("GroupID = %q, want %q", child.GroupID, parent.GroupID)
	}

	// Frozen counters.
	if child.Encounters != 420 {
		t.Errorf("child Encounters = %d, want 420", child.Encounters)
	}
	if child.TimerAccumulatedMs != 90_000 {
		t.Errorf("child TimerAccumulatedMs = %d, want 90000", child.TimerAccumulatedMs)
	}

	// Deliberately not inherited.
	if child.DetectorConfig != nil {
		t.Error("DetectorConfig should be nil so templates are not duplicated")
	}
	if child.Overlay != nil {
		t.Error("Overlay should not be inherited")
	}
	if child.IsActive {
		t.Error("IsActive should not be inherited")
	}
	if len(child.Tags) != 0 {
		t.Errorf("Tags = %v, want empty", child.Tags)
	}
	if len(child.PhaseTargets) != 0 {
		t.Errorf("PhaseTargets = %v, want empty", child.PhaseTargets)
	}

	// The hunt restarts at zero.
	updated := findByID(t, m, parent.ID)
	if updated.Encounters != 0 {
		t.Errorf("parent Encounters = %d, want 0", updated.Encounters)
	}
	if updated.TimerAccumulatedMs != 0 {
		t.Errorf("parent TimerAccumulatedMs = %d, want 0", updated.TimerAccumulatedMs)
	}
	if updated.CompletedAt != nil {
		t.Error("parent should stay a running hunt")
	}
}

// TestEndPhaseFailedMarksChildFailed verifies that ending a phase with
// failed=true archives the resulting child entry as sighted-but-not-caught
// (Failed set, CompletedAt still set), while a regular (failed=false) phase
// end leaves Failed unset.
func TestEndPhaseFailedMarksChildFailed(t *testing.T) {
	m, parent := newPhaseParent(t)

	child, err := m.EndPhase(parent.ID, catchOf("hoothoot", "Hoothoot"), true)
	if err != nil {
		t.Fatalf("EndPhase: %v", err)
	}
	if !child.Failed {
		t.Error("Failed should be set on a failed phase entry")
	}
	if child.CompletedAt == nil {
		t.Error("CompletedAt should still be set on a failed phase entry")
	}

	caughtChild, err := m.EndPhase(parent.ID, catchOf("sentret", "Wiesor"), false)
	if err != nil {
		t.Fatalf("EndPhase: %v", err)
	}
	if caughtChild.Failed {
		t.Error("Failed should not be set on a regular (caught) phase entry")
	}
}

// TestEndPhaseKeepsRunningTimerRunning verifies that a timer that was running
// keeps running across the phase change, with its origin moved so the new phase
// starts at zero, and that the elapsed segment is frozen into the phase entry.
func TestEndPhaseKeepsRunningTimerRunning(t *testing.T) {
	m, parent := newPhaseParent(t)
	if !m.StartTimer(parent.ID) {
		t.Fatal("StartTimer returned false")
	}
	time.Sleep(10 * time.Millisecond)

	before := time.Now()
	child, err := m.EndPhase(parent.ID, catchOf("hoothoot", "Hoothoot"), false)
	if err != nil {
		t.Fatalf("EndPhase: %v", err)
	}

	// 90s accumulated plus the segment that was still running.
	if child.TimerAccumulatedMs <= 90_000 {
		t.Errorf("child TimerAccumulatedMs = %d, want the running segment included", child.TimerAccumulatedMs)
	}

	updated := findByID(t, m, parent.ID)
	if updated.TimerStartedAt == nil {
		t.Fatal("parent TimerStartedAt should stay set while the timer runs")
	}
	if updated.TimerStartedAt.Before(before) {
		t.Errorf("TimerStartedAt = %v, want it moved to the phase change", updated.TimerStartedAt)
	}
}

// TestEndPhaseLeavesStoppedTimerStopped verifies that a stopped timer is not
// started by the phase change.
func TestEndPhaseLeavesStoppedTimerStopped(t *testing.T) {
	m, parent := newPhaseParent(t)

	child, err := m.EndPhase(parent.ID, catchOf("hoothoot", "Hoothoot"), false)
	if err != nil {
		t.Fatalf("EndPhase: %v", err)
	}
	if child.TimerAccumulatedMs != 90_000 {
		t.Errorf("child TimerAccumulatedMs = %d, want the accumulated 90000", child.TimerAccumulatedMs)
	}
	if updated := findByID(t, m, parent.ID); updated.TimerStartedAt != nil {
		t.Error("TimerStartedAt should stay nil when the timer was not running")
	}
}

// TestEndPhaseNumberingSurvivesDeletedChild verifies that the phase number is
// derived as max(child)+1, so deleting a phase in the middle does not hand out
// a number twice.
func TestEndPhaseNumberingSurvivesDeletedChild(t *testing.T) {
	m, parent := newPhaseParent(t)

	first, err := m.EndPhase(parent.ID, catchOf("hoothoot", "Hoothoot"), false)
	if err != nil {
		t.Fatalf("EndPhase first: %v", err)
	}
	second, err := m.EndPhase(parent.ID, catchOf("sentret", "Wiesor"), false)
	if err != nil {
		t.Fatalf("EndPhase second: %v", err)
	}
	if first.PhaseNumber != 1 || second.PhaseNumber != 2 {
		t.Fatalf("phase numbers = %d/%d, want 1/2", first.PhaseNumber, second.PhaseNumber)
	}

	if !m.DeletePokemon(first.ID) {
		t.Fatal("DeletePokemon returned false")
	}
	third, err := m.EndPhase(parent.ID, catchOf("ledyba", "Ledyba"), false)
	if err != nil {
		t.Fatalf("EndPhase third: %v", err)
	}
	if third.PhaseNumber != 3 {
		t.Errorf("PhaseNumber = %d, want 3 after deleting phase 1", third.PhaseNumber)
	}
}

// TestEndPhaseRejectsPhaseEntryAndCompletedHunt verifies the guards: only a
// running hunt can end a phase.
func TestEndPhaseRejectsPhaseEntryAndCompletedHunt(t *testing.T) {
	m, parent := newPhaseParent(t)
	child, err := m.EndPhase(parent.ID, catchOf("hoothoot", "Hoothoot"), false)
	if err != nil {
		t.Fatalf("EndPhase: %v", err)
	}

	if _, err := m.EndPhase("nonexistent", catchOf("sentret", "Wiesor"), false); !errors.Is(err, ErrPhaseParentNotFound) {
		t.Errorf("EndPhase on unknown id: err = %v, want ErrPhaseParentNotFound", err)
	}
	if _, err := m.EndPhase(child.ID, catchOf("sentret", "Wiesor"), false); !errors.Is(err, ErrNotPhaseable) {
		t.Errorf("EndPhase on a phase entry: err = %v, want ErrNotPhaseable", err)
	}

	if !m.CompletePokemon(parent.ID) {
		t.Fatal("CompletePokemon returned false")
	}
	if _, err := m.EndPhase(parent.ID, catchOf("sentret", "Wiesor"), false); !errors.Is(err, ErrNotPhaseable) {
		t.Errorf("EndPhase on a completed hunt: err = %v, want ErrNotPhaseable", err)
	}
}

// ---------------------------------------------------------------------------
// UndoPhase
// ---------------------------------------------------------------------------

// TestUndoPhaseReturnsCountersToParent verifies that undoing the newest phase
// hands encounters and accumulated time back and removes the phase entry.
func TestUndoPhaseReturnsCountersToParent(t *testing.T) {
	m, parent := newPhaseParent(t)
	if _, err := m.EndPhase(parent.ID, catchOf("hoothoot", "Hoothoot"), false); err != nil {
		t.Fatalf("EndPhase: %v", err)
	}
	// Encounters gathered in the new phase must survive the undo.
	m.Increment(parent.ID)

	child := PhaseChildren(m.GetState().Pokemon, parent.ID)[0]
	restored, err := m.UndoPhase(child.ID)
	if err != nil {
		t.Fatalf("UndoPhase: %v", err)
	}
	if restored.Encounters != 421 {
		t.Errorf("Encounters = %d, want 420 restored plus 1 gathered", restored.Encounters)
	}
	if restored.TimerAccumulatedMs != 90_000 {
		t.Errorf("TimerAccumulatedMs = %d, want 90000", restored.TimerAccumulatedMs)
	}
	if got := len(PhaseChildren(m.GetState().Pokemon, parent.ID)); got != 0 {
		t.Errorf("remaining phase entries = %d, want 0", got)
	}
	if len(m.GetState().Pokemon) != 1 {
		t.Errorf("state holds %d entries, want only the hunt", len(m.GetState().Pokemon))
	}
}

// TestUndoPhaseRejectsOlderAndNonPhaseEntries verifies that only the newest
// phase can be taken back.
func TestUndoPhaseRejectsOlderAndNonPhaseEntries(t *testing.T) {
	m, parent := newPhaseParent(t)
	first, err := m.EndPhase(parent.ID, catchOf("hoothoot", "Hoothoot"), false)
	if err != nil {
		t.Fatalf("EndPhase first: %v", err)
	}
	if _, err := m.EndPhase(parent.ID, catchOf("sentret", "Wiesor"), false); err != nil {
		t.Fatalf("EndPhase second: %v", err)
	}

	if _, err := m.UndoPhase(first.ID); !errors.Is(err, ErrNotPhaseable) {
		t.Errorf("UndoPhase on phase 1: err = %v, want ErrNotPhaseable", err)
	}
	if _, err := m.UndoPhase(parent.ID); !errors.Is(err, ErrNotPhaseable) {
		t.Errorf("UndoPhase on the hunt itself: err = %v, want ErrNotPhaseable", err)
	}
	if _, err := m.UndoPhase("nonexistent"); !errors.Is(err, ErrPhaseParentNotFound) {
		t.Errorf("UndoPhase on unknown id: err = %v, want ErrPhaseParentNotFound", err)
	}
}

// ---------------------------------------------------------------------------
// Guards around phase history
// ---------------------------------------------------------------------------

// TestGroupMutationsSkipCompletedEntries verifies that the group-wide counter
// mutations leave completed entries alone. Phase entries inherit the group of
// their hunt, so without the guard a group reset would wipe the whole history.
func TestGroupMutationsSkipCompletedEntries(t *testing.T) {
	m, parent := newPhaseParent(t)
	child, err := m.EndPhase(parent.ID, catchOf("hoothoot", "Hoothoot"), false)
	if err != nil {
		t.Fatalf("EndPhase: %v", err)
	}

	m.IncrementGroup("g1")
	if got := findByID(t, m, child.ID).Encounters; got != 420 {
		t.Errorf("after IncrementGroup: phase Encounters = %d, want 420", got)
	}
	if got := findByID(t, m, parent.ID).Encounters; got != 1 {
		t.Errorf("after IncrementGroup: hunt Encounters = %d, want 1", got)
	}

	m.DecrementGroup("g1")
	if got := findByID(t, m, child.ID).Encounters; got != 420 {
		t.Errorf("after DecrementGroup: phase Encounters = %d, want 420", got)
	}
	if got := findByID(t, m, parent.ID).Encounters; got != 0 {
		t.Errorf("after DecrementGroup: hunt Encounters = %d, want 0", got)
	}

	m.Increment(parent.ID)
	m.ResetGroup("g1")
	if got := findByID(t, m, child.ID).Encounters; got != 420 {
		t.Errorf("after ResetGroup: phase Encounters = %d, want 420", got)
	}
	if got := findByID(t, m, parent.ID).Encounters; got != 0 {
		t.Errorf("after ResetGroup: hunt Encounters = %d, want 0", got)
	}
}

// TestDeletePokemonKeepsPhaseOf verifies that deleting a hunt leaves the phase
// marking on its entries intact instead of silently rewriting them into
// ordinary hunts.
func TestDeletePokemonKeepsPhaseOf(t *testing.T) {
	m, parent := newPhaseParent(t)
	child, err := m.EndPhase(parent.ID, catchOf("hoothoot", "Hoothoot"), false)
	if err != nil {
		t.Fatalf("EndPhase: %v", err)
	}

	if !m.DeletePokemon(parent.ID) {
		t.Fatal("DeletePokemon returned false")
	}
	orphan := findByID(t, m, child.ID)
	if orphan.PhaseOf != parent.ID {
		t.Errorf("PhaseOf = %q, want the deleted hunt id %q", orphan.PhaseOf, parent.ID)
	}
	if orphan.PhaseNumber != 1 {
		t.Errorf("PhaseNumber = %d, want 1", orphan.PhaseNumber)
	}
}

// TestResolvePhaseLink covers every rule of the shared phase-link validator.
// The snapshot holds a running hunt, a phase of that hunt, and a stand-alone
// entry, so each rule can be triggered without further setup.
func TestResolvePhaseLink(t *testing.T) {
	completedAt := time.Now()
	all := []Pokemon{
		{ID: "hunt", Name: "Rattfratz"},
		{ID: "phase", Name: "Taubsi", PhaseOf: "hunt", PhaseNumber: 1, CompletedAt: &completedAt},
		{ID: "solo", Name: "Karpador"},
		{ID: "done", Name: "Enton", CompletedAt: &completedAt},
	}

	tests := []struct {
		name       string
		id         string
		parentID   string
		number     int
		wantNumber int
		wantErr    bool
		wantSentin error
	}{
		{name: "no link at all", wantNumber: 0},
		{name: "negative number", parentID: "hunt", number: -1, wantErr: true},
		{name: "negative number without parent", number: -1, wantErr: true},
		{name: "number without parent", number: 3, wantErr: true},
		{name: "self reference", id: "solo", parentID: "solo", wantErr: true},
		{name: "unknown parent", parentID: "ghost", wantErr: true, wantSentin: ErrPhaseParentNotFound},
		{name: "parent is itself a phase", parentID: "phase", wantErr: true},
		{name: "entry already has phases", id: "hunt", parentID: "solo", wantErr: true},
		{name: "number derived", parentID: "hunt", wantNumber: 2},
		{name: "number derived for a childless parent", parentID: "solo", wantNumber: 1},
		{name: "explicit number kept", parentID: "hunt", number: 7, wantNumber: 7},
		// A completed parent is fine here: only EndPhase refuses it, since only
		// EndPhase would restart a hunt that is already archived.
		{name: "completed parent accepted", parentID: "done", wantNumber: 1},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ResolvePhaseLink(all, tc.id, tc.parentID, tc.number)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("ResolvePhaseLink(%q, %q, %d) = %d, nil; want an error", tc.id, tc.parentID, tc.number, got)
				}
				if tc.wantSentin != nil && !errors.Is(err, tc.wantSentin) {
					t.Fatalf("error = %v, want %v", err, tc.wantSentin)
				}
				return
			}
			if err != nil {
				t.Fatalf("ResolvePhaseLink(%q, %q, %d) = %v", tc.id, tc.parentID, tc.number, err)
			}
			if got != tc.wantNumber {
				t.Errorf("number = %d, want %d", got, tc.wantNumber)
			}
		})
	}
}

// TestEndPhaseRefusesCompletedParentAcceptedByResolvePhaseLink pins the one
// rule EndPhase adds on top of the shared validator: restarting a hunt that is
// already archived is refused, while the link as such stays valid.
func TestEndPhaseRefusesCompletedParentAcceptedByResolvePhaseLink(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(Pokemon{ID: "hunt", Name: "Rattfratz", CreatedAt: time.Now()})
	if !m.CompletePokemon("hunt") {
		t.Fatal("setup: CompletePokemon failed")
	}
	all := m.GetState().Pokemon

	if _, err := ResolvePhaseLink(all, "", "hunt", 0); err != nil {
		t.Fatalf("ResolvePhaseLink on a completed parent = %v, want nil", err)
	}
	if _, err := m.EndPhase("hunt", catchOf("magikarp", "Karpador"), false); !errors.Is(err, ErrNotPhaseable) {
		t.Fatalf("EndPhase on a completed parent = %v, want %v", err, ErrNotPhaseable)
	}
}
