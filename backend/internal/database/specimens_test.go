package database

import (
	"testing"
)

func TestMigrateCaughtOverridesToSpecimens(t *testing.T) {
	d := openInternalTestDB(t)
	_, err := d.db.Exec(`INSERT INTO pokedex_overrides (pokedex_id,species_id,form_canonical,caught,seen,meta_json) VALUES ('default',37,'vulpix-alola',1,1,'{"nickname":"Snow"}')`)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := d.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err := migrateAddPokedexSpecimens(tx); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	rows, err := d.ListPokedexSpecimens()
	if err != nil || len(rows) != 1 {
		t.Fatalf("specimens = %+v, err = %v", rows, err)
	}
	if rows[0].SpeciesID != 37 || rows[0].FormCanonical != "vulpix-alola" || rows[0].MetaJSON != `{"nickname":"Snow"}` {
		t.Fatalf("migrated specimen = %+v", rows[0])
	}
	var caught, seen int
	if err := d.db.QueryRow(`SELECT caught,seen FROM pokedex_overrides WHERE id=?`, *rows[0].SourceOverrideID).Scan(&caught, &seen); err != nil {
		t.Fatal(err)
	}
	if caught != 0 || seen != 1 {
		t.Fatalf("legacy flags = %d/%d", caught, seen)
	}
}

func TestPokedexSpecimenCRUD(t *testing.T) {
	d := openInternalTestDB(t)
	created, err := d.SavePokedexSpecimen(PokedexSpecimenRow{
		PokedexID: "default", SpeciesID: 1, Game: "pokemon-red", CompletedAt: "2020-01-02",
		HuntType: "soft_reset", Encounters: 8192, TimerAccumulatedMs: 3_661_000,
		PhaseOf: 7, PhaseNumber: 3,
		MetaJSON: `{"evolutions":[{"canonical_name":"ivysaur"}]}`,
	})
	if err != nil || created.ID == 0 {
		t.Fatalf("create = %+v, err = %v", created, err)
	}
	if created.Game != "pokemon-red" || created.CompletedAt != "2020-01-02" || created.HuntType != "soft_reset" || created.Encounters != 8192 || created.TimerAccumulatedMs != 3_661_000 {
		t.Fatalf("hunt details = %+v", created)
	}
	if created.PhaseOf != 7 || created.PhaseNumber != 3 {
		t.Fatalf("phase link after insert = %d/%d, want 7/3", created.PhaseOf, created.PhaseNumber)
	}
	created.SpeciesID = 2
	created.PhaseOf = 9
	created.PhaseNumber = 4
	updated, err := d.SavePokedexSpecimen(created)
	if err != nil || updated.SpeciesID != 2 {
		t.Fatalf("update = %+v, err = %v", updated, err)
	}
	if updated.PhaseOf != 9 || updated.PhaseNumber != 4 {
		t.Fatalf("phase link after update = %d/%d, want 9/4", updated.PhaseOf, updated.PhaseNumber)
	}
	listed, err := d.ListPokedexSpecimens()
	if err != nil || len(listed) != 1 {
		t.Fatalf("list = %+v, err = %v", listed, err)
	}
	if listed[0].PhaseOf != 9 || listed[0].PhaseNumber != 4 {
		t.Fatalf("listed phase link = %d/%d, want 9/4", listed[0].PhaseOf, listed[0].PhaseNumber)
	}
	if err := d.DeletePokedexSpecimen(created.ID); err != nil {
		t.Fatal(err)
	}
}

// TestPokedexSpecimenPhaseSurvivesParentDelete verifies that deleting a parent
// specimen leaves its phases in place as orphans instead of unlinking them, so
// the "was a phase" fact is never silently erased.
func TestPokedexSpecimenPhaseSurvivesParentDelete(t *testing.T) {
	d := openInternalTestDB(t)
	parent, err := d.SavePokedexSpecimen(PokedexSpecimenRow{PokedexID: "default", SpeciesID: 1})
	if err != nil {
		t.Fatalf("create parent: %v", err)
	}
	phase, err := d.SavePokedexSpecimen(PokedexSpecimenRow{
		PokedexID: "default", SpeciesID: 129, PhaseOf: parent.ID, PhaseNumber: 1,
	})
	if err != nil {
		t.Fatalf("create phase: %v", err)
	}

	if err := d.DeletePokedexSpecimen(parent.ID); err != nil {
		t.Fatalf("delete parent: %v", err)
	}

	rows, err := d.ListPokedexSpecimens()
	if err != nil || len(rows) != 1 {
		t.Fatalf("rows after delete = %+v, err = %v", rows, err)
	}
	if rows[0].ID != phase.ID || rows[0].PhaseOf != parent.ID || rows[0].PhaseNumber != 1 {
		t.Fatalf("orphaned phase = %+v, want phase_of %d and phase_number 1", rows[0], parent.ID)
	}
}
