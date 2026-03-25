// fallback.go embeds the fallback games JSON and provides functions to parse
// and seed the database from the embedded data when no network is available.
package gamesync

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/zsleyer/encounty/backend/internal/database"
)

//go:embed fallback_games.json
var FallbackGamesJSON []byte

// LoadFallbackGames parses the embedded fallback games JSON into a sorted
// slice of GameEntry values.
func LoadFallbackGames() ([]GameEntry, error) {
	var raw map[string]rawGameEntry
	if err := json.Unmarshal(FallbackGamesJSON, &raw); err != nil {
		return nil, fmt.Errorf("parse fallback games: %w", err)
	}
	rows := make([]database.GameRow, 0, len(raw))
	for key, v := range raw {
		namesJSON, err := json.Marshal(v.Names)
		if err != nil {
			continue
		}
		rows = append(rows, database.GameRow{
			Key:        key,
			NamesJSON:  namesJSON,
			Generation: v.Generation,
			Platform:   v.Platform,
		})
	}
	return RowsToEntries(rows), nil
}

// SeedFromFallback writes the embedded fallback games into the database.
// It skips seeding if the store already contains games.
func SeedFromFallback(store GamesStore) error {
	if store == nil {
		return fmt.Errorf("no database available")
	}
	if store.HasGames() {
		slog.Info("SeedGames: database already has games, skipping fallback")
		return nil
	}
	entries, err := LoadFallbackGames()
	if err != nil {
		return err
	}
	rows := EntriesToRows(entries)
	if err := store.SaveGames(rows); err != nil {
		return fmt.Errorf("seed fallback games: %w", err)
	}
	InvalidateCache()
	slog.Info("SeedGames: seeded from embedded fallback", "count", len(entries))
	return nil
}
