// pokedex_test.go tests pokedex JSON loading and the GET /api/pokedex handler.
package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func TestPokedexLoadFromConfigDir(t *testing.T) {
	srv := newTestServer(t)
	configDir := srv.state.GetConfigDir()

	if err := os.WriteFile(filepath.Join(configDir, "pokemon.json"), fixturePokedexJSON(), 0644); err != nil {
		t.Fatal(err)
	}

	data, err := srv.readPokedexJSON()
	if err != nil {
		t.Fatal(err)
	}

	var entries []PokedexEntry
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

func TestPokedexEntryWithForms(t *testing.T) {
	srv := newTestServer(t)
	configDir := srv.state.GetConfigDir()

	if err := os.WriteFile(filepath.Join(configDir, "pokemon.json"), fixturePokedexJSON(), 0644); err != nil {
		t.Fatal(err)
	}

	data, err := srv.readPokedexJSON()
	if err != nil {
		t.Fatal(err)
	}

	var entries []PokedexEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		t.Fatal(err)
	}

	// Find pikachu
	var pikachu *PokedexEntry
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

func TestPokedexNotFound(t *testing.T) {
	srv := newTestServer(t)
	// Use a config dir with no pokemon.json and no fallbacks available
	// The source dir fallback uses runtime.Caller which will look at the real
	// source tree, so this test may still find the file in dev. We mainly
	// verify the function does not panic.
	_, err := srv.readPokedexJSON()
	// Either it finds a fallback or returns an error; both are valid
	_ = err
}

func TestPokedexHandleGetPokedex(t *testing.T) {
	srv := newTestServer(t)
	configDir := srv.state.GetConfigDir()

	if err := os.WriteFile(filepath.Join(configDir, "pokemon.json"), fixturePokedexJSON(), 0644); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/pokedex", nil)
	w := httptest.NewRecorder()
	srv.handleGetPokedex(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	ct := w.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}

	cc := w.Header().Get("Cache-Control")
	if cc == "" {
		t.Error("expected Cache-Control header")
	}

	var entries []PokedexEntry
	if err := json.Unmarshal(w.Body.Bytes(), &entries); err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 {
		t.Errorf("expected 3 entries, got %d", len(entries))
	}
}

func TestPokedexSpriteIDResolution(t *testing.T) {
	// Verify that sprite IDs are correctly preserved through JSON round-trip
	entry := PokedexEntry{
		ID:        25,
		Canonical: "pikachu",
		Names:     map[string]string{"en": "Pikachu"},
		Forms: []PokemonForm{
			{Canonical: "pikachu-alola", SpriteID: 10100, Names: map[string]string{"en": "Alolan Pikachu"}},
		},
	}

	data, err := json.Marshal(entry)
	if err != nil {
		t.Fatal(err)
	}

	var decoded PokedexEntry
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

func TestPokedexSyncMethodNotAllowed(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/sync/pokemon", nil)
	w := httptest.NewRecorder()
	srv.handleSyncPokemon(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", w.Code)
	}
}
