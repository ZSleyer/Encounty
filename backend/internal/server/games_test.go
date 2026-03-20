// games_test.go tests loading and caching of the games catalogue.
package server

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

// resetGamesCache clears the package-level cache so each test starts fresh.
func resetGamesCache(t *testing.T) {
	t.Helper()
	cachedGames = nil
	gamesDB = nil
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

func TestGamesLoadFromDB(t *testing.T) {
	resetGamesCache(t)

	store := &mockGamesStore{rows: fixtureGameRows()}
	gamesDB = store

	entries := loadGames()
	if entries == nil {
		t.Fatal("loadGames returned nil")
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

func TestGamesCaching(t *testing.T) {
	resetGamesCache(t)

	store := &mockGamesStore{rows: fixtureGameRows()}
	gamesDB = store

	first := loadGames()
	if first == nil {
		t.Fatal("first call returned nil")
	}

	// Clear the store; cached result should still be returned
	store.rows = nil

	second := loadGames()
	if second == nil {
		t.Fatal("second call returned nil after cache")
	}
	if len(second) != len(first) {
		t.Errorf("cached length mismatch: %d vs %d", len(second), len(first))
	}
}

func TestGamesLoadNoDBReturnsNil(t *testing.T) {
	resetGamesCache(t)

	// No DB wired
	entries := loadGames()
	if entries != nil {
		t.Errorf("expected nil, got %d entries", len(entries))
	}
}

func TestGamesHandleGetGames(t *testing.T) {
	resetGamesCache(t)

	store := &mockGamesStore{rows: fixtureGameRows()}
	gamesDB = store

	srv := newTestServer(t)
	req := newGetRequest("/api/games")
	w := doRequest(srv.handleGetGames, req)

	if w.Code != 200 {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var result []GameEntry
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(result) != 3 {
		t.Errorf(fmtExpect3, len(result))
	}
}

func TestGameRowsRoundTrip(t *testing.T) {
	resetGamesCache(t)

	rows := fixtureGameRows()
	entries := gameRowsToEntries(rows)
	if len(entries) != 3 {
		t.Fatalf(fmtExpect3, len(entries))
	}

	roundTripped := entriesToGameRows(entries)
	if len(roundTripped) != 3 {
		t.Fatalf("expected 3 rows after round-trip, got %d", len(roundTripped))
	}
}
