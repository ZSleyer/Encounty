// sync_test.go tests the generation parser and the cheap PokeAPI freshness
// check in sync.go.
package gamesync

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/database"
)

func TestParseGeneration(t *testing.T) {
	cases := map[string]int{
		"generation-i":     1,
		"generation-iv":    4,
		"generation-ix":    9,
		"generation-x":     10,
		"generation-xi":    11,
		"generation-xiv":   14,
		"generation-xix":   19,
		"generation-xx":    20,
		"generation-xxiv":  24,
		"generation-":      0,
		"":                 0,
		"generation-iiii":  0,
		"generation-vx":    0,
		"generation-XI":    0,
		"generation-11":    0,
		"gen-x":            0,
		"generation-x-dlc": 0,
	}
	for in, want := range cases {
		if got := parseGeneration(in); got != want {
			t.Errorf("parseGeneration(%q) = %d, want %d", in, got, want)
		}
	}
}

// withMockREST redirects pokeAPIBase to an httptest server serving body for
// the duration of the test.
func withMockREST(t *testing.T, body string) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)

	original := pokeAPIBase
	pokeAPIBase = server.URL
	t.Cleanup(func() { pokeAPIBase = original })
}

func gameRow(key string) database.GameRow {
	return database.GameRow{Key: key, NamesJSON: mustMarshal(map[string]string{"en": key}), Generation: 1, Platform: "GB"}
}

func TestHasNewVersions(t *testing.T) {
	withMockREST(t, `{"results":[{"name":"red"},{"name":"red-japan"},{"name":"the-teal-mask"},{"name":"the-teal-mask-scarlet"},{"name":"blue"}]}`)

	upToDate := &mockGamesStore{rows: []database.GameRow{gameRow("pokemon-red"), gameRow("pokemon-blue")}}
	got, err := HasNewVersions(upToDate)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got {
		t.Error("skipped versions must not count as new")
	}

	missing := &mockGamesStore{rows: []database.GameRow{gameRow("pokemon-red")}}
	got, err = HasNewVersions(missing)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !got {
		t.Error("expected pokemon-blue to be reported as new")
	}
}

func TestHasNewVersionsErrors(t *testing.T) {
	if _, err := HasNewVersions(nil); err == nil {
		t.Error("expected error for nil store")
	}

	original := pokeAPIBase
	pokeAPIBase = "http://127.0.0.1:0"
	t.Cleanup(func() { pokeAPIBase = original })
	if _, err := HasNewVersions(&mockGamesStore{}); err == nil {
		t.Error("expected error when PokeAPI is unreachable")
	}
}
