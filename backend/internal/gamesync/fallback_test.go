// fallback_test.go tests loading and seeding from the embedded fallback games JSON.
package gamesync

import (
	"testing"
)

// TestLoadFallbackGames verifies that the embedded fallback JSON parses into
// a non-empty slice of game entries.
func TestLoadFallbackGames(t *testing.T) {
	entries, err := LoadFallbackGames()
	if err != nil {
		t.Fatalf("LoadFallbackGames() error: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("LoadFallbackGames() returned an empty slice")
	}
}

// TestLoadFallbackGamesHasExpectedKeys spot-checks that well-known game keys
// are present in the fallback data.
func TestLoadFallbackGamesHasExpectedKeys(t *testing.T) {
	entries, err := LoadFallbackGames()
	if err != nil {
		t.Fatalf("LoadFallbackGames() error: %v", err)
	}

	keys := make(map[string]bool, len(entries))
	for _, e := range entries {
		keys[e.Key] = true
	}

	for _, want := range []string{"pokemon-red", "pokemon-gold"} {
		if !keys[want] {
			t.Errorf("expected key %q not found in fallback games", want)
		}
	}
}

// TestSeedFallbackGames verifies that SeedFromFallback delegates correctly
// to the store's SaveGames method.
func TestSeedFallbackGames(t *testing.T) {
	store := &mockGamesStore{} // empty, HasGames returns false

	if err := SeedFromFallback(store); err != nil {
		t.Fatalf("SeedFromFallback() error: %v", err)
	}

	if len(store.rows) == 0 {
		t.Fatal("store.rows is empty after seeding")
	}
}

// TestSeedFallbackGamesSkipsWhenPopulated verifies that seeding is skipped
// when the store already has games.
func TestSeedFallbackGamesSkipsWhenPopulated(t *testing.T) {
	store := &mockGamesStore{rows: fixtureGameRows()}

	if err := SeedFromFallback(store); err != nil {
		t.Fatalf("SeedFromFallback() error: %v", err)
	}

	// Store should retain original rows, not be overwritten.
	if len(store.rows) != len(fixtureGameRows()) {
		t.Errorf("expected %d rows (unchanged), got %d", len(fixtureGameRows()), len(store.rows))
	}
}
