// phases_test.go covers the persistence of the phasing data: the phase_of and
// phase_number columns on pokemon, the phase_targets table, and the cascade
// that removes targets together with their Pokémon.
package database

import (
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// TestPhaseRoundTrip verifies that a full SaveFullState / LoadFullState cycle
// preserves the phase link, the phase number and the phase targets, that a
// second save replaces the targets instead of duplicating them, and that
// deleting a Pokémon cascades to its target rows.
func TestPhaseRoundTrip(t *testing.T) {
	d := openInternalTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	st := &state.AppState{
		ActiveID: "hunt",
		Pokemon: []state.Pokemon{
			{
				ID: "hunt", Name: "Rattfratz", CanonicalName: "rattata",
				SpriteURL: "u", SpriteType: "normal", Language: "de",
				CreatedAt: now, IsActive: true, OverlayMode: "default",
				Tags: []string{},
				PhaseTargets: []state.PhaseTarget{
					{CanonicalName: "hoothoot", Name: "Hoothoot", SpriteURL: "h.png"},
					{CanonicalName: "sentret", Name: "Wiesor", SpriteURL: "s.png"},
				},
			},
			{
				ID: "phase1", Name: "Hoothoot", CanonicalName: "hoothoot",
				SpriteURL: "u", SpriteType: "shiny", Language: "de",
				CreatedAt: now, OverlayMode: "default", CompletedAt: &now,
				Encounters: 420, Tags: []string{},
				PhaseOf: "hunt", PhaseNumber: 1,
				PhaseTargets: []state.PhaseTarget{},
			},
		},
		Groups:   []state.Group{},
		Sessions: []state.Session{},
		Settings: state.Settings{Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}

	if err := d.SaveFullState(st); err != nil {
		t.Fatalf(fmtSaveFullState, err)
	}
	// Saving twice must not accumulate duplicate target rows.
	if err := d.SaveFullState(st); err != nil {
		t.Fatalf(fmtSaveFullState, err)
	}

	loaded, err := d.LoadFullState()
	if err != nil {
		t.Fatalf(fmtLoadFullState, err)
	}
	if loaded == nil {
		t.Fatal("LoadFullState returned nil")
	}
	if len(loaded.Pokemon) != 2 {
		t.Fatalf("Pokemon len = %d, want 2", len(loaded.Pokemon))
	}

	hunt, phase := loaded.Pokemon[0], loaded.Pokemon[1]
	if hunt.ID != "hunt" || phase.ID != "phase1" {
		hunt, phase = phase, hunt
	}

	if hunt.PhaseOf != "" || hunt.PhaseNumber != 0 {
		t.Errorf("hunt phase link = %q/%d, want empty/0", hunt.PhaseOf, hunt.PhaseNumber)
	}
	if phase.PhaseOf != "hunt" {
		t.Errorf("phase PhaseOf = %q, want %q", phase.PhaseOf, "hunt")
	}
	if phase.PhaseNumber != 1 {
		t.Errorf("phase PhaseNumber = %d, want 1", phase.PhaseNumber)
	}
	if phase.Encounters != 420 {
		t.Errorf("phase Encounters = %d, want 420", phase.Encounters)
	}

	wantTargets := []state.PhaseTarget{
		{CanonicalName: "hoothoot", Name: "Hoothoot", SpriteURL: "h.png"},
		{CanonicalName: "sentret", Name: "Wiesor", SpriteURL: "s.png"},
	}
	if len(hunt.PhaseTargets) != len(wantTargets) {
		t.Fatalf("hunt PhaseTargets len = %d, want %d", len(hunt.PhaseTargets), len(wantTargets))
	}
	for i, want := range wantTargets {
		if hunt.PhaseTargets[i] != want {
			t.Errorf("hunt PhaseTargets[%d] = %+v, want %+v", i, hunt.PhaseTargets[i], want)
		}
	}
	// A Pokémon without targets must load as a non-nil empty slice.
	if phase.PhaseTargets == nil {
		t.Error("phase PhaseTargets should be non-nil empty slice after load")
	}
	if len(phase.PhaseTargets) != 0 {
		t.Errorf("phase PhaseTargets len = %d, want 0", len(phase.PhaseTargets))
	}

	// The foreign key must take the target rows down with the Pokémon.
	if _, err := d.db.Exec(`DELETE FROM pokemon WHERE id = ?`, "hunt"); err != nil {
		t.Fatalf("delete pokemon: %v", err)
	}
	var count int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM phase_targets WHERE pokemon_id = ?`, "hunt").Scan(&count); err != nil {
		t.Fatalf("count phase_targets: %v", err)
	}
	if count != 0 {
		t.Errorf("phase_targets rows after cascade = %d, want 0", count)
	}
}
