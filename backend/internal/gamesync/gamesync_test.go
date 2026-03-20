// gamesync_test.go tests loading, caching, and row conversion for the games catalogue.
package gamesync

import (
	"encoding/json"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/database"
)

// mockGamesStore is an in-memory GamesStore for testing.
type mockGamesStore struct {
	rows []database.GameRow
}

func (m *mockGamesStore) SaveGames(rows []database.GameRow) error {
	m.rows = rows
	return nil
}

func (m *mockGamesStore) LoadGames() ([]database.GameRow, error) {
	return m.rows, nil
}

func (m *mockGamesStore) HasGames() bool {
	return len(m.rows) > 0
}

// resetCache clears the package-level cache so each test starts fresh.
func resetCache(t *testing.T) {
	t.Helper()
	gamesMu.Lock()
	cachedGames = nil
	gamesMu.Unlock()
}

func mustMarshal(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

// fixtureGameRows returns minimal valid game rows for testing.
func fixtureGameRows() []database.GameRow {
	return []database.GameRow{
		{Key: "red", NamesJSON: mustMarshal(map[string]string{"en": "Red", "de": "Rot"}), Generation: 1, Platform: "gb"},
		{Key: "gold", NamesJSON: mustMarshal(map[string]string{"en": "Gold", "de": "Gold"}), Generation: 2, Platform: "gbc"},
		{Key: "ruby", NamesJSON: mustMarshal(map[string]string{"en": "Ruby", "de": "Rubin"}), Generation: 3, Platform: "gba"},
	}
}

const fmtExpect3 = "expected 3 entries, got %d"

func TestLoadGamesFromDB(t *testing.T) {
	resetCache(t)

	store := &mockGamesStore{rows: fixtureGameRows()}
	entries := LoadGames(store)
	if entries == nil {
		t.Fatal("LoadGames returned nil")
	}
	if len(entries) != 3 {
		t.Fatalf(fmtExpect3, len(entries))
	}

	// Verify sorting by generation
	for i := 1; i < len(entries); i++ {
		if entries[i].Generation < entries[i-1].Generation {
			t.Errorf("entries not sorted by generation: gen %d before gen %d",
				entries[i-1].Generation, entries[i].Generation)
		}
	}
}

func TestLoadGamesCaching(t *testing.T) {
	resetCache(t)

	store := &mockGamesStore{rows: fixtureGameRows()}
	first := LoadGames(store)
	if first == nil {
		t.Fatal("first call returned nil")
	}

	// Clear the store; cached result should still be returned
	store.rows = nil

	second := LoadGames(store)
	if second == nil {
		t.Fatal("second call returned nil after cache")
	}
	if len(second) != len(first) {
		t.Errorf("cached length mismatch: %d vs %d", len(second), len(first))
	}
}

func TestLoadGamesNilStoreReturnsNil(t *testing.T) {
	resetCache(t)

	entries := LoadGames(nil)
	if entries != nil {
		t.Errorf("expected nil, got %d entries", len(entries))
	}
}

func TestRowsRoundTrip(t *testing.T) {
	rows := fixtureGameRows()
	entries := RowsToEntries(rows)
	if len(entries) != 3 {
		t.Fatalf(fmtExpect3, len(entries))
	}

	roundTripped := EntriesToRows(entries)
	if len(roundTripped) != 3 {
		t.Fatalf("expected 3 rows after round-trip, got %d", len(roundTripped))
	}
}

func TestInvalidateCache(t *testing.T) {
	resetCache(t)

	store := &mockGamesStore{rows: fixtureGameRows()}
	first := LoadGames(store)
	if first == nil {
		t.Fatal("first call returned nil")
	}

	InvalidateCache()

	// After invalidation, should re-read from store
	store.rows = fixtureGameRows()[:1] // only one row
	second := LoadGames(store)
	if len(second) != 1 {
		t.Errorf("expected 1 entry after invalidation, got %d", len(second))
	}
}
