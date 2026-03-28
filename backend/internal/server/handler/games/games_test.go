// Package games tests the game catalogue, hunt type, and Pokédex HTTP handlers.
package games

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/gamesync"
	"github.com/zsleyer/encounty/backend/internal/pokedex"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// Duplicated test format strings and paths (S1192).
const (
	fmtStatusWant200  = "status = %d, want 200"
	fmtUnmarshalError = "unmarshal: %v"
	fmtStatusWant405  = "status = %d, want 405"
	gamesPath         = "/api/games"
	pokedexPath       = "/api/pokedex"
)

// --- Mock stores -------------------------------------------------------------

// mockGamesStore is an in-memory gamesync.GamesStore for testing.
type mockGamesStore struct {
	rows    []database.GameRow
	saveErr error
}

func (m *mockGamesStore) SaveGames(rows []database.GameRow) error {
	if m.saveErr != nil {
		return m.saveErr
	}
	m.rows = rows
	return nil
}

func (m *mockGamesStore) LoadGames() ([]database.GameRow, error) {
	return m.rows, nil
}

func (m *mockGamesStore) HasGames() bool {
	return len(m.rows) > 0
}

// mockPokedexStore is an in-memory pokedex.PokedexStore for testing.
type mockPokedexStore struct {
	species []database.PokedexSpeciesRow
	forms   []database.PokedexFormRow
	saveErr error
}

func (m *mockPokedexStore) SavePokedex(species []database.PokedexSpeciesRow, forms []database.PokedexFormRow) error {
	if m.saveErr != nil {
		return m.saveErr
	}
	m.species = species
	m.forms = forms
	return nil
}

func (m *mockPokedexStore) LoadPokedex() ([]database.PokedexSpeciesRow, []database.PokedexFormRow, error) {
	return m.species, m.forms, nil
}

func (m *mockPokedexStore) HasPokedex() bool {
	return len(m.species) > 0
}

func (m *mockPokedexStore) PokedexCount() int {
	return len(m.species)
}

// mockDeps implements Deps for testing.
type mockDeps struct {
	games   gamesync.GamesStore
	pokedex pokedex.PokedexStore
	cfgDir  string
}

func (d *mockDeps) GamesDB() gamesync.GamesStore   { return d.games }
func (d *mockDeps) PokedexDB() pokedex.PokedexStore { return d.pokedex }
func (d *mockDeps) ConfigDir() string               { return d.cfgDir }

// mustMarshalJSON marshals v to JSON or panics.
func mustMarshalJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

// fixtureGameRows returns minimal game rows for testing.
func fixtureGameRows() []database.GameRow {
	return []database.GameRow{
		{Key: "red", NamesJSON: mustMarshalJSON(map[string]string{"en": "Red"}), Generation: 1, Platform: "gb"},
		{Key: "gold", NamesJSON: mustMarshalJSON(map[string]string{"en": "Gold"}), Generation: 2, Platform: "gbc"},
	}
}

// fixturePokedexRows returns minimal species rows for testing.
func fixturePokedexRows() []database.PokedexSpeciesRow {
	return []database.PokedexSpeciesRow{
		{ID: 1, Canonical: "bulbasaur", NamesJSON: mustMarshalJSON(map[string]string{"en": "Bulbasaur"})},
		{ID: 25, Canonical: "pikachu", NamesJSON: mustMarshalJSON(map[string]string{"en": "Pikachu"})},
	}
}

// newTestMux registers the games routes with mock dependencies. It invalidates
// both caches before and after the test to avoid cross-test pollution.
func newTestMux(t *testing.T, deps *mockDeps) *http.ServeMux {
	t.Helper()
	gamesync.InvalidateCache()
	pokedex.InvalidateCache()
	t.Cleanup(func() {
		gamesync.InvalidateCache()
		pokedex.InvalidateCache()
	})
	mux := http.NewServeMux()
	RegisterRoutes(mux, deps)
	return mux
}

// --- GetGames tests ----------------------------------------------------------

func TestGetGames(t *testing.T) {
	store := &mockGamesStore{rows: fixtureGameRows()}
	// Pre-load cache so the handler finds data.
	gamesync.InvalidateCache()
	entries := gamesync.LoadGames(store)
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}

	deps := &mockDeps{games: store, pokedex: &mockPokedexStore{}, cfgDir: t.TempDir()}
	mux := http.NewServeMux()
	RegisterRoutes(mux, deps)
	t.Cleanup(func() { gamesync.InvalidateCache() })

	req := httptest.NewRequest(http.MethodGet, gamesPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code)
	}

	var got []gamesync.GameEntry
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf(fmtUnmarshalError, err)
	}
	if len(got) != 2 {
		t.Errorf("len(games) = %d, want 2", len(got))
	}
	if got[0].Key != "red" {
		t.Errorf("first game key = %q, want %q", got[0].Key, "red")
	}
}

func TestGetGamesReturnsList(t *testing.T) {
	// Use a store with one row so LoadGames returns from the store without
	// triggering a PokeAPI sync (which happens when HasGames is false).
	store := &mockGamesStore{rows: []database.GameRow{
		{Key: "silver", NamesJSON: mustMarshalJSON(map[string]string{"en": "Silver"}), Generation: 2, Platform: "gbc"},
	}}
	deps := &mockDeps{games: store, pokedex: &mockPokedexStore{}, cfgDir: t.TempDir()}
	mux := newTestMux(t, deps)

	req := httptest.NewRequest(http.MethodGet, gamesPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code)
	}

	var got []gamesync.GameEntry
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf(fmtUnmarshalError, err)
	}
	if len(got) != 1 {
		t.Errorf("len(games) = %d, want 1", len(got))
	}
}

// --- GetHuntTypes tests ------------------------------------------------------

func TestGetHuntTypes(t *testing.T) {
	deps := &mockDeps{games: &mockGamesStore{}, pokedex: &mockPokedexStore{}, cfgDir: t.TempDir()}
	mux := newTestMux(t, deps)

	req := httptest.NewRequest(http.MethodGet, "/api/hunt-types", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code)
	}

	var got []state.HuntTypePreset
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf(fmtUnmarshalError, err)
	}
	if len(got) == 0 {
		t.Error("expected non-empty hunt type presets")
	}
	if len(got) != len(state.HuntTypePresets) {
		t.Errorf("len(presets) = %d, want %d", len(got), len(state.HuntTypePresets))
	}
}

// --- GetPokedex tests --------------------------------------------------------

func TestGetPokedex(t *testing.T) {
	store := &mockPokedexStore{species: fixturePokedexRows()}
	deps := &mockDeps{games: &mockGamesStore{}, pokedex: store, cfgDir: t.TempDir()}
	mux := newTestMux(t, deps)

	req := httptest.NewRequest(http.MethodGet, pokedexPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code)
	}

	var got []pokedex.Entry
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf(fmtUnmarshalError, err)
	}
	if len(got) != 2 {
		t.Errorf("len(pokedex) = %d, want 2", len(got))
	}
}

func TestGetPokedexEmpty(t *testing.T) {
	deps := &mockDeps{games: &mockGamesStore{}, pokedex: &mockPokedexStore{}, cfgDir: t.TempDir()}
	mux := newTestMux(t, deps)

	req := httptest.NewRequest(http.MethodGet, pokedexPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code)
	}

	// Should return an empty JSON array, not null.
	body := w.Body.String()
	if body != "[]" && body != "[]\n" {
		t.Errorf("body = %q, want empty JSON array", body)
	}
}

// --- SyncGames tests ---------------------------------------------------------

func TestSyncGamesMethodNotAllowed(t *testing.T) {
	deps := &mockDeps{games: &mockGamesStore{}, pokedex: &mockPokedexStore{}, cfgDir: t.TempDir()}
	mux := newTestMux(t, deps)

	req := httptest.NewRequest(http.MethodGet, "/api/games/sync", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(fmtStatusWant405, w.Code)
	}
}

// --- SyncPokemon tests -------------------------------------------------------

func TestSyncPokemonMethodNotAllowed(t *testing.T) {
	deps := &mockDeps{games: &mockGamesStore{}, pokedex: &mockPokedexStore{}, cfgDir: t.TempDir()}
	mux := newTestMux(t, deps)

	req := httptest.NewRequest(http.MethodGet, "/api/sync/pokemon", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(fmtStatusWant405, w.Code)
	}
}

// --- LoadGames / LoadPokedex helper tests ------------------------------------

func TestLoadGamesReturnsEntries(t *testing.T) {
	store := &mockGamesStore{rows: fixtureGameRows()}
	gamesync.InvalidateCache()
	t.Cleanup(func() { gamesync.InvalidateCache() })

	deps := &mockDeps{games: store, pokedex: &mockPokedexStore{}, cfgDir: t.TempDir()}
	entries := LoadGames(deps)
	if len(entries) != 2 {
		t.Errorf("LoadGames returned %d entries, want 2", len(entries))
	}
}

func TestLoadGamesEmpty(t *testing.T) {
	store := &mockGamesStore{rows: []database.GameRow{}}
	gamesync.InvalidateCache()
	t.Cleanup(func() { gamesync.InvalidateCache() })

	deps := &mockDeps{games: store, pokedex: &mockPokedexStore{}, cfgDir: t.TempDir()}
	entries := LoadGames(deps)
	// Empty store may trigger a sync attempt or return empty; either is valid.
	_ = entries
}

func TestLoadPokedexReturnsEntries(t *testing.T) {
	store := &mockPokedexStore{species: fixturePokedexRows()}
	pokedex.InvalidateCache()
	t.Cleanup(func() { pokedex.InvalidateCache() })

	deps := &mockDeps{games: &mockGamesStore{}, pokedex: store, cfgDir: t.TempDir()}
	entries := LoadPokedex(deps)
	if len(entries) != 2 {
		t.Errorf("LoadPokedex returned %d entries, want 2", len(entries))
	}
}

func TestLoadPokedexEmpty(t *testing.T) {
	store := &mockPokedexStore{}
	pokedex.InvalidateCache()
	t.Cleanup(func() { pokedex.InvalidateCache() })

	deps := &mockDeps{games: &mockGamesStore{}, pokedex: store, cfgDir: t.TempDir()}
	entries := LoadPokedex(deps)
	if len(entries) != 0 {
		t.Errorf("LoadPokedex returned %d entries, want 0 or nil", len(entries))
	}
}

// --- GetPokedex with forms ---------------------------------------------------

func TestGetPokedexWithForms(t *testing.T) {
	store := &mockPokedexStore{
		species: fixturePokedexRows(),
		forms: []database.PokedexFormRow{
			{SpeciesID: 25, Canonical: "pikachu-alola", SpriteID: 10100, NamesJSON: mustMarshalJSON(map[string]string{"en": "Alolan Pikachu"})},
		},
	}
	deps := &mockDeps{games: &mockGamesStore{}, pokedex: store, cfgDir: t.TempDir()}
	mux := newTestMux(t, deps)

	req := httptest.NewRequest(http.MethodGet, pokedexPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code)
	}

	var got []pokedex.Entry
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf(fmtUnmarshalError, err)
	}
	if len(got) != 2 {
		t.Fatalf("len(pokedex) = %d, want 2", len(got))
	}
	// The pikachu entry should have a form
	for _, e := range got {
		if e.Canonical == "pikachu" && len(e.Forms) == 0 {
			t.Error("expected pikachu to have at least one form")
		}
	}
}

// --- RegisterRoutes verification ---------------------------------------------

func TestRegisterRoutesGames(t *testing.T) {
	deps := &mockDeps{games: &mockGamesStore{rows: fixtureGameRows()}, pokedex: &mockPokedexStore{}, cfgDir: t.TempDir()}
	mux := newTestMux(t, deps)

	// Verify /api/games route is registered
	req := httptest.NewRequest(http.MethodGet, gamesPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code == http.StatusNotFound {
		t.Error(gamesPath + " route not registered")
	}

	// Verify /api/hunt-types route is registered
	req = httptest.NewRequest(http.MethodGet, "/api/hunt-types", nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code == http.StatusNotFound {
		t.Error("/api/hunt-types route not registered")
	}

	// Verify /api/pokedex route is registered
	req = httptest.NewRequest(http.MethodGet, pokedexPath, nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code == http.StatusNotFound {
		t.Error(pokedexPath + " route not registered")
	}
}

// --- SyncGames/SyncPokemon method not allowed for other methods --------------

func TestSyncGamesMethodNotAllowedPut(t *testing.T) {
	deps := &mockDeps{games: &mockGamesStore{}, pokedex: &mockPokedexStore{}, cfgDir: t.TempDir()}
	mux := newTestMux(t, deps)

	req := httptest.NewRequest(http.MethodPut, "/api/games/sync", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(fmtStatusWant405, w.Code)
	}
}

func TestSyncPokemonMethodNotAllowedPut(t *testing.T) {
	deps := &mockDeps{games: &mockGamesStore{}, pokedex: &mockPokedexStore{}, cfgDir: t.TempDir()}
	mux := newTestMux(t, deps)

	req := httptest.NewRequest(http.MethodPut, "/api/sync/pokemon", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(fmtStatusWant405, w.Code)
	}
}
