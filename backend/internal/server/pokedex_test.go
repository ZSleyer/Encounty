// pokedex_test.go tests the Pokédex HTTP handlers.
package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/pokedex"
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

func TestPokedexHandleGetPokedex(t *testing.T) {
	srv := newTestServer(t)
	configDir := srv.state.GetConfigDir()

	if err := os.WriteFile(filepath.Join(configDir, pokedex.Filename), fixturePokedexJSON(), 0644); err != nil {
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

	var entries []pokedex.Entry
	if err := json.Unmarshal(w.Body.Bytes(), &entries); err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 {
		t.Errorf("expected 3 entries, got %d", len(entries))
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
