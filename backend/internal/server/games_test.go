// games_test.go tests the games/pokedex HTTP route wiring through the server.
package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/gamesync"
)

// mockGamesStore is an in-memory gamesync.GamesStore for testing.
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

// fixtureGameRows returns minimal valid game rows for testing.
func fixtureGameRows() []database.GameRow {
	return []database.GameRow{
		{Key: "red", NamesJSON: mustMarshal(map[string]string{"en": "Red", "de": "Rot"}), Generation: 1, Platform: "gb"},
		{Key: "gold", NamesJSON: mustMarshal(map[string]string{"en": "Gold", "de": "Gold"}), Generation: 2, Platform: "gbc"},
		{Key: "ruby", NamesJSON: mustMarshal(map[string]string{"en": "Ruby", "de": "Rubin"}), Generation: 3, Platform: "gba"},
	}
}

const fmtExpect3 = "expected 3 entries, got %d"

func TestGamesHTTPGetGames(t *testing.T) {
	gamesync.InvalidateCache()

	store := &mockGamesStore{rows: fixtureGameRows()}
	// Pre-load the cache via gamesync so the HTTP handler finds data.
	entries := gamesync.LoadGames(store)
	if len(entries) != 3 {
		t.Fatalf(fmtExpect3, len(entries))
	}

	srv := newTestServer(t)
	mux := http.NewServeMux()
	srv.registerRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/games", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var result []gamesync.GameEntry
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(result) != 3 {
		t.Errorf(fmtExpect3, len(result))
	}

	gamesync.InvalidateCache()
}

func TestGameRowsRoundTrip(t *testing.T) {
	rows := fixtureGameRows()
	entries := gamesync.RowsToEntries(rows)
	if len(entries) != 3 {
		t.Fatalf(fmtExpect3, len(entries))
	}

	roundTripped := gamesync.EntriesToRows(entries)
	if len(roundTripped) != 3 {
		t.Fatalf("expected 3 rows after round-trip, got %d", len(roundTripped))
	}
}
