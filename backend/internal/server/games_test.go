// games_test.go tests loading and caching of the games catalogue.
package server

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// resetGamesCache clears the package-level cache so each test starts fresh.
func resetGamesCache(t *testing.T) {
	t.Helper()
	cachedGames = nil
	defaultGamesJSON = nil
	gamesConfigDir = ""
}

// fixtureGamesJSON returns a minimal valid games.json for testing.
func fixtureGamesJSON() []byte {
	return []byte(`{
		"red": {"names":{"en":"Red","de":"Rot"},"generation":1,"platform":"gb"},
		"gold": {"names":{"en":"Gold","de":"Gold"},"generation":2,"platform":"gbc"},
		"ruby": {"names":{"en":"Ruby","de":"Rubin"},"generation":3,"platform":"gba"}
	}`)
}

func TestGamesLoadFromConfigDir(t *testing.T) {
	resetGamesCache(t)

	dir := t.TempDir()
	gamesConfigDir = dir
	if err := os.WriteFile(filepath.Join(dir, "games.json"), fixtureGamesJSON(), 0644); err != nil {
		t.Fatal(err)
	}

	entries := loadGames()
	if entries == nil {
		t.Fatal("loadGames returned nil")
	}
	if len(entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(entries))
	}

	// Verify sorting by generation
	for i := 1; i < len(entries); i++ {
		if entries[i].Generation < entries[i-1].Generation {
			t.Errorf("entries not sorted by generation: gen %d before gen %d",
				entries[i-1].Generation, entries[i].Generation)
		}
	}
}

func TestGamesLoadFromEmbeddedDefault(t *testing.T) {
	resetGamesCache(t)

	// No config dir file, but embedded default is set
	gamesConfigDir = t.TempDir()
	SetDefaultGamesJSON(fixtureGamesJSON())

	entries := loadGames()
	if entries == nil {
		t.Fatal("loadGames returned nil")
	}
	if len(entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(entries))
	}

	// Verify it wrote the default to config dir
	written, err := os.ReadFile(filepath.Join(gamesConfigDir, "games.json"))
	if err != nil {
		t.Fatalf("expected games.json to be written to config dir: %v", err)
	}
	if len(written) == 0 {
		t.Error("written games.json is empty")
	}
}

func TestGamesCaching(t *testing.T) {
	resetGamesCache(t)

	dir := t.TempDir()
	gamesConfigDir = dir
	if err := os.WriteFile(filepath.Join(dir, "games.json"), fixtureGamesJSON(), 0644); err != nil {
		t.Fatal(err)
	}

	first := loadGames()
	if first == nil {
		t.Fatal("first call returned nil")
	}

	// Remove the file; cached result should still be returned
	_ = os.Remove(filepath.Join(dir, "games.json"))

	second := loadGames()
	if second == nil {
		t.Fatal("second call returned nil after cache")
	}
	if len(second) != len(first) {
		t.Errorf("cached length mismatch: %d vs %d", len(second), len(first))
	}
}

func TestGamesLoadNoFileNoDefault(t *testing.T) {
	resetGamesCache(t)

	gamesConfigDir = t.TempDir()
	// No file, no default
	entries := loadGames()
	if entries != nil {
		t.Errorf("expected nil, got %d entries", len(entries))
	}
}

func TestGamesDeduplication(t *testing.T) {
	resetGamesCache(t)

	// Two entries with the same English name and platform should be deduped
	data := []byte(`{
		"red_v1": {"names":{"en":"Red"},"generation":1,"platform":"gb"},
		"red_v2": {"names":{"en":"Red"},"generation":1,"platform":"gb"}
	}`)
	dir := t.TempDir()
	gamesConfigDir = dir
	if err := os.WriteFile(filepath.Join(dir, "games.json"), data, 0644); err != nil {
		t.Fatal(err)
	}

	entries := loadGames()
	if len(entries) != 1 {
		t.Errorf("expected 1 entry after dedup, got %d", len(entries))
	}
}

func TestGamesInvalidJSON(t *testing.T) {
	resetGamesCache(t)

	dir := t.TempDir()
	gamesConfigDir = dir
	if err := os.WriteFile(filepath.Join(dir, "games.json"), []byte("{bad json}"), 0644); err != nil {
		t.Fatal(err)
	}

	entries := loadGames()
	if entries != nil {
		t.Errorf("expected nil for invalid JSON, got %d entries", len(entries))
	}
}

func TestGamesHandleGetGames(t *testing.T) {
	resetGamesCache(t)

	dir := t.TempDir()
	gamesConfigDir = dir
	if err := os.WriteFile(filepath.Join(dir, "games.json"), fixtureGamesJSON(), 0644); err != nil {
		t.Fatal(err)
	}

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
		t.Errorf("expected 3 entries, got %d", len(result))
	}
}
