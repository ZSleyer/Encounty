// pokedex_test.go tests the Pokedex HTTP handlers via mux routing.
package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/pokedex"
)

// seedTestPokedex inserts fixture data into the database.
func seedTestPokedex(t *testing.T, db *database.DB) {
	t.Helper()
	species := []database.PokedexSpeciesRow{
		{ID: 1, Canonical: "bulbasaur", NamesJSON: []byte(`{"en":"Bulbasaur","de":"Bisasam"}`)},
		{ID: 4, Canonical: "charmander", NamesJSON: []byte(`{"en":"Charmander","de":"Glumanda"}`)},
		{ID: 25, Canonical: "pikachu", NamesJSON: []byte(`{"en":"Pikachu","de":"Pikachu"}`)},
	}
	forms := []database.PokedexFormRow{
		{SpeciesID: 25, Canonical: "pikachu-alola", SpriteID: 10100, NamesJSON: []byte(`{"en":"Alolan Pikachu"}`)},
	}
	if err := db.SavePokedex(species, forms); err != nil {
		t.Fatal(err)
	}
}

func TestPokedexHandleGetPokedex(t *testing.T) {
	srv := newTestServer(t)

	// Open a test database and seed Pokédex data.
	db, err := database.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	srv.db = db
	seedTestPokedex(t, db)

	// Clear any cached data from previous tests.
	pokedex.InvalidateCache()

	mux := http.NewServeMux()
	srv.registerRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/pokedex", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	ct := w.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}

	var entries []pokedex.Entry
	if err := json.Unmarshal(w.Body.Bytes(), &entries); err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 {
		t.Errorf("expected 3 entries, got %d", len(entries))
	}

	// Verify forms are attached.
	for _, e := range entries {
		if e.Canonical == "pikachu" && len(e.Forms) != 1 {
			t.Errorf("pikachu: expected 1 form, got %d", len(e.Forms))
		}
	}

	// Clean up cache for other tests.
	pokedex.InvalidateCache()
}

func TestPokedexSyncMethodNotAllowed(t *testing.T) {
	srv := newTestServer(t)
	mux := http.NewServeMux()
	srv.registerRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/sync/pokemon", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", w.Code)
	}
}
