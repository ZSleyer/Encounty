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
	created, err := d.SavePokedexSpecimen(PokedexSpecimenRow{PokedexID: "default", SpeciesID: 1, MetaJSON: `{"evolutions":[{"canonical_name":"ivysaur"}]}`})
	if err != nil || created.ID == 0 {
		t.Fatalf("create = %+v, err = %v", created, err)
	}
	created.SpeciesID = 2
	updated, err := d.SavePokedexSpecimen(created)
	if err != nil || updated.SpeciesID != 2 {
		t.Fatalf("update = %+v, err = %v", updated, err)
	}
	if err := d.DeletePokedexSpecimen(created.ID); err != nil {
		t.Fatal(err)
	}
}
