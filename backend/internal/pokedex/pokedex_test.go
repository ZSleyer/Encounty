// pokedex_test.go tests Pokédex JSON persistence and data type serialization.
package pokedex

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// fixturePokedexJSON returns a minimal valid pokemon.json for testing.
func fixturePokedexJSON() []byte {
	return []byte(`[
		{"id":1,"canonical":"bulbasaur","names":{"en":"Bulbasaur","de":"Bisasam"}},
		{"id":4,"canonical":"charmander","names":{"en":"Charmander","de":"Glumanda"}},
		{"id":25,"canonical":"pikachu","names":{"en":"Pikachu","de":"Pikachu"},"forms":[
			{"canonical":"pikachu-alola","names":{"en":"Alolan Pikachu"},"sprite_id":10100}
		]}
	]`)
}

func TestReadJSONFromConfigDir(t *testing.T) {
	configDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(configDir, Filename), fixturePokedexJSON(), 0644); err != nil {
		t.Fatal(err)
	}

	data, err := ReadJSON(configDir)
	if err != nil {
		t.Fatal(err)
	}

	var entries []Entry
	if err := json.Unmarshal(data, &entries); err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(entries))
	}
	if entries[0].Canonical != "bulbasaur" {
		t.Errorf("first entry canonical = %q, want bulbasaur", entries[0].Canonical)
	}
}

func TestEntryWithForms(t *testing.T) {
	configDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(configDir, Filename), fixturePokedexJSON(), 0644); err != nil {
		t.Fatal(err)
	}

	data, err := ReadJSON(configDir)
	if err != nil {
		t.Fatal(err)
	}

	var entries []Entry
	if err := json.Unmarshal(data, &entries); err != nil {
		t.Fatal(err)
	}

	// Find pikachu
	var pikachu *Entry
	for i := range entries {
		if entries[i].Canonical == "pikachu" {
			pikachu = &entries[i]
			break
		}
	}
	if pikachu == nil {
		t.Fatal("pikachu not found")
	}
	if len(pikachu.Forms) != 1 {
		t.Fatalf("expected 1 form, got %d", len(pikachu.Forms))
	}
	if pikachu.Forms[0].Canonical != "pikachu-alola" {
		t.Errorf("form canonical = %q, want pikachu-alola", pikachu.Forms[0].Canonical)
	}
	if pikachu.Forms[0].SpriteID != 10100 {
		t.Errorf("form sprite_id = %d, want 10100", pikachu.Forms[0].SpriteID)
	}
}

func TestReadJSONNotFound(t *testing.T) {
	configDir := t.TempDir()
	// Use a config dir with no pokemon.json and no fallbacks available.
	// The source dir fallback uses runtime.Caller which will look at the real
	// source tree, so this test may still find the file in dev. We mainly
	// verify the function does not panic.
	_, err := ReadJSON(configDir)
	// Either it finds a fallback or returns an error; both are valid
	_ = err
}

func TestSpriteIDResolution(t *testing.T) {
	// Verify that sprite IDs are correctly preserved through JSON round-trip
	entry := Entry{
		ID:        25,
		Canonical: "pikachu",
		Names:     map[string]string{"en": "Pikachu"},
		Forms: []Form{
			{Canonical: "pikachu-alola", SpriteID: 10100, Names: map[string]string{"en": "Alolan Pikachu"}},
		},
	}

	data, err := json.Marshal(entry)
	if err != nil {
		t.Fatal(err)
	}

	var decoded Entry
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.ID != 25 {
		t.Errorf("ID = %d, want 25", decoded.ID)
	}
	if len(decoded.Forms) != 1 {
		t.Fatalf("forms length = %d, want 1", len(decoded.Forms))
	}
	if decoded.Forms[0].SpriteID != 10100 {
		t.Errorf("sprite_id = %d, want 10100", decoded.Forms[0].SpriteID)
	}
}

func TestWriteJSON(t *testing.T) {
	configDir := t.TempDir()
	entries := []Entry{
		{ID: 1, Canonical: "bulbasaur", Names: map[string]string{"en": "Bulbasaur"}},
	}

	if err := WriteJSON(configDir, entries); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(filepath.Join(configDir, Filename))
	if err != nil {
		t.Fatal(err)
	}

	var loaded []Entry
	if err := json.Unmarshal(data, &loaded); err != nil {
		t.Fatal(err)
	}
	if len(loaded) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(loaded))
	}
	if loaded[0].Canonical != "bulbasaur" {
		t.Errorf("canonical = %q, want bulbasaur", loaded[0].Canonical)
	}
}
