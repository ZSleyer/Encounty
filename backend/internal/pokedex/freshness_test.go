// freshness_test.go tests HasNewSpecies, the single-request check that
// decides whether a background Pokédex sync is worth running.
package pokedex

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHasNewSpecies(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/pokemon-species/" || r.URL.Query().Get("limit") != "1" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"count":1025,"results":[{"name":"bulbasaur"}]}`))
	}))
	t.Cleanup(server.Close)
	original := pokeAPIREST
	pokeAPIREST = server.URL
	t.Cleanup(func() { pokeAPIREST = original })

	for _, tc := range []struct {
		local int
		want  bool
	}{{1025, false}, {1100, false}, {1024, true}, {0, true}} {
		got, err := HasNewSpecies(&mockPokedexStore{count: tc.local})
		if err != nil {
			t.Fatalf("local=%d: unexpected error: %v", tc.local, err)
		}
		if got != tc.want {
			t.Errorf("local=%d: got %v, want %v", tc.local, got, tc.want)
		}
	}
}

func TestHasNewSpeciesErrors(t *testing.T) {
	if _, err := HasNewSpecies(nil); err == nil {
		t.Error("expected error for nil store")
	}

	original := pokeAPIREST
	pokeAPIREST = "http://127.0.0.1:0"
	t.Cleanup(func() { pokeAPIREST = original })
	if _, err := HasNewSpecies(&mockPokedexStore{}); err == nil {
		t.Error("expected error when PokéAPI is unreachable")
	}
}
