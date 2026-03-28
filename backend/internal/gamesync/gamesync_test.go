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

func TestRowsToEntriesSort(t *testing.T) {
	// Provide rows out of order to verify sorting by generation then name.
	rows := []database.GameRow{
		{Key: "ruby", NamesJSON: mustMarshal(map[string]string{"en": "Ruby"}), Generation: 3, Platform: "gba"},
		{Key: "red", NamesJSON: mustMarshal(map[string]string{"en": "Red"}), Generation: 1, Platform: "gb"},
		{Key: "blue", NamesJSON: mustMarshal(map[string]string{"en": "Blue"}), Generation: 1, Platform: "gb"},
		{Key: "gold", NamesJSON: mustMarshal(map[string]string{"en": "Gold"}), Generation: 2, Platform: "gbc"},
	}
	entries := RowsToEntries(rows)
	if len(entries) != 4 {
		t.Fatalf("expected 4 entries, got %d", len(entries))
	}
	// Generation 1 entries should come first, sorted by name.
	if entries[0].Names["en"] != "Blue" {
		t.Errorf("entries[0] en = %q, want Blue", entries[0].Names["en"])
	}
	if entries[1].Names["en"] != "Red" {
		t.Errorf("entries[1] en = %q, want Red", entries[1].Names["en"])
	}
	if entries[2].Generation != 2 {
		t.Errorf("entries[2] generation = %d, want 2", entries[2].Generation)
	}
	if entries[3].Generation != 3 {
		t.Errorf("entries[3] generation = %d, want 3", entries[3].Generation)
	}
}

func TestRowsToEntriesBadJSON(t *testing.T) {
	rows := []database.GameRow{
		{Key: "good", NamesJSON: mustMarshal(map[string]string{"en": "Good"}), Generation: 1},
		{Key: "bad", NamesJSON: []byte(`not valid json`), Generation: 1},
	}
	entries := RowsToEntries(rows)
	// The bad row should be skipped.
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry (bad JSON skipped), got %d", len(entries))
	}
	if entries[0].Key != "good" {
		t.Errorf("entry key = %q, want good", entries[0].Key)
	}
}

func TestEntriesToRows(t *testing.T) {
	entries := []GameEntry{
		{Key: "red", Names: map[string]string{"en": "Red", "de": "Rot"}, Generation: 1, Platform: "gb"},
		{Key: "gold", Names: map[string]string{"en": "Gold"}, Generation: 2, Platform: "gbc"},
	}
	rows := EntriesToRows(entries)
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(rows))
	}
	// Verify roundtrip back to entries.
	roundTripped := RowsToEntries(rows)
	if len(roundTripped) != 2 {
		t.Fatalf("roundtrip expected 2, got %d", len(roundTripped))
	}
}

func TestLoadGamesFromEmptyDBNilStore(t *testing.T) {
	resetCache(t)

	// A nil store means no database is available; loadGamesFromDB should
	// return nil without attempting a network sync.
	entries := loadGamesFromDB(nil)
	if entries != nil {
		t.Errorf("expected nil for nil store, got %d entries", len(entries))
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
