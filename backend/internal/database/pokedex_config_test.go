package database

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestPokedexScopeAllowsExactGamesAndManualOverrides(t *testing.T) {
	if !pokedexScopeAllows(25, "pokemon-red", nil, []string{"pokemon-red"}, nil, nil, nil, []string{"pokemon-red"}) {
		t.Fatal("official game member should be allowed")
	}
	if pokedexScopeAllows(151, "pokemon-red", nil, []string{"pokemon-red"}, nil, nil, nil, nil) {
		t.Fatal("species absent from the official game dex should be rejected")
	}
	if !pokedexScopeAllows(151, "pokemon-red", nil, []string{"pokemon-red"}, nil, []int{151}, nil, nil) {
		t.Fatal("manual include should override target catalogues")
	}
	if pokedexScopeAllows(25, "pokemon-red", nil, nil, nil, nil, []int{25}, nil) {
		t.Fatal("manual exclude should win")
	}
}

func TestHidingFormsDoesNotInvalidateExistingAssignments(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.db.Exec(`
		INSERT INTO pokedex_species (id, canonical) VALUES (6, 'charizard');
		INSERT INTO pokedex_forms (species_id, canonical, sprite_id) VALUES (6, 'charizard-mega-x', 10034);
		INSERT INTO pokemon (id, name, canonical_name) VALUES ('caught-form', 'Mega Charizard X', 'charizard-mega-x');
		INSERT INTO pokedex_pokemon (pokedex_id, pokemon_id) VALUES ('default', 'caught-form')`); err != nil {
		t.Fatalf("seed assigned form: %v", err)
	}
	rows, err := db.ListUserPokedexes()
	if err != nil {
		t.Fatalf("ListUserPokedexes: %v", err)
	}
	row := rows[0]
	row.ShowForms = false
	if err := db.SaveUserPokedex(row); err != nil {
		t.Fatalf("hide forms: %v", err)
	}
}

func TestDefaultPokedexCanBeRenamed(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	rows, err := db.ListUserPokedexes()
	if err != nil || len(rows) != 1 {
		t.Fatalf("ListUserPokedexes: rows=%v err=%v", rows, err)
	}
	row := rows[0]
	row.Name = "Mein Nationaldex"
	if err := db.SaveUserPokedex(row); err != nil {
		t.Fatalf("rename default Pokédex: %v", err)
	}
	rows, err = db.ListUserPokedexes()
	if err != nil || rows[0].ID != "default" || rows[0].Name != "Mein Nationaldex" {
		t.Fatalf("renamed default Pokédex = %#v, err=%v", rows, err)
	}
	if err := db.DeleteUserPokedex("default"); !errors.Is(err, ErrDefaultPokedex) {
		t.Fatalf("DeleteUserPokedex(default) error = %v", err)
	}
}
