// games.go loads the Pokemon game catalogue from the SQLite database and
// serves it via GET /api/games. When the database is empty on first load,
// an automatic sync from PokeAPI is triggered to populate the catalogue.
// A parsed, sorted slice is cached in memory after the first load.
package server

import (
	"encoding/json"
	"log/slog"
	"sort"

	"github.com/zsleyer/encounty/backend/internal/database"
)

// GamesStore abstracts database operations for the games catalogue.
type GamesStore interface {
	SaveGames(rows []database.GameRow) error
	LoadGames() ([]database.GameRow, error)
	HasGames() bool
}

// gamesDB is set by the server at startup to enable DB-backed game storage.
var gamesDB GamesStore

// GameEntry is the public representation of one Pokemon game returned by the
// API. The Key field is the stable identifier used in Pokemon.Game.
type GameEntry struct {
	Key        string            `json:"key"`
	Names      map[string]string `json:"names"`
	Generation int               `json:"generation"`
	Platform   string            `json:"platform"`
}

var cachedGames []GameEntry

// loadGames returns the full game catalogue. It loads from the database,
// triggering a PokeAPI sync on the very first call when the DB is empty.
func loadGames() []GameEntry {
	if cachedGames != nil {
		return cachedGames
	}

	// Load from database
	if gamesDB != nil && gamesDB.HasGames() {
		rows, err := gamesDB.LoadGames()
		if err == nil && len(rows) > 0 {
			entries := gameRowsToEntries(rows)
			cachedGames = entries
			return entries
		}
		if err != nil {
			slog.Warn("Could not load games from DB", "error", err)
		}
	}

	// Database is empty — trigger initial sync from PokeAPI
	if gamesDB != nil {
		slog.Info("No games in database, syncing from PokeAPI...")
		result, err := SyncGamesFromPokeAPI()
		if err != nil {
			slog.Warn("Initial games sync failed", "error", err)
			return nil
		}
		slog.Info("Initial games sync complete", "added", result.Added)
		// Retry loading after sync
		rows, err := gamesDB.LoadGames()
		if err == nil && len(rows) > 0 {
			entries := gameRowsToEntries(rows)
			cachedGames = entries
			return entries
		}
	}

	return nil
}

// gameRowsToEntries converts database rows to GameEntry slices.
func gameRowsToEntries(rows []database.GameRow) []GameEntry {
	entries := make([]GameEntry, 0, len(rows))
	for _, r := range rows {
		var names map[string]string
		if err := json.Unmarshal(r.NamesJSON, &names); err != nil {
			continue
		}
		entries = append(entries, GameEntry{
			Key:        r.Key,
			Names:      names,
			Generation: r.Generation,
			Platform:   r.Platform,
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Generation != entries[j].Generation {
			return entries[i].Generation < entries[j].Generation
		}
		return entries[i].Names["en"] < entries[j].Names["en"]
	})
	return entries
}

// entriesToGameRows converts GameEntry slices to database rows.
func entriesToGameRows(entries []GameEntry) []database.GameRow {
	rows := make([]database.GameRow, 0, len(entries))
	for _, e := range entries {
		namesJSON, err := json.Marshal(e.Names)
		if err != nil {
			continue
		}
		rows = append(rows, database.GameRow{
			Key:        e.Key,
			NamesJSON:  namesJSON,
			Generation: e.Generation,
			Platform:   e.Platform,
		})
	}
	return rows
}
