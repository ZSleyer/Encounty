// Package gamesync loads the Pokemon game catalogue from the database and
// provides PokeAPI synchronisation. A parsed, sorted slice is cached in
// memory after the first load; the cache is invalidated after each sync.
package gamesync

import (
	"encoding/json"
	"log/slog"
	"sort"
	"sync"

	"github.com/zsleyer/encounty/backend/internal/database"
)

// GamesStore abstracts database operations for the games catalogue.
type GamesStore interface {
	SaveGames(rows []database.GameRow) error
	LoadGames() ([]database.GameRow, error)
	HasGames() bool
}

// GameEntry is the public representation of one Pokemon game returned by the
// API. The Key field is the stable identifier used in Pokemon.Game.
type GameEntry struct {
	Key        string            `json:"key"`
	Names      map[string]string `json:"names"`
	Generation int               `json:"generation"`
	Platform   string            `json:"platform"`
}

var (
	cachedGames []GameEntry
	gamesMu     sync.Mutex
)

// LoadGames returns the full game catalogue. It loads from the database,
// triggering a PokeAPI sync on the very first call when the DB is empty.
// The function is safe for concurrent use.
func LoadGames(store GamesStore) []GameEntry {
	gamesMu.Lock()
	defer gamesMu.Unlock()

	if cachedGames != nil {
		return cachedGames
	}

	cachedGames = loadGamesFromDB(store)
	return cachedGames
}

// InvalidateCache clears the in-memory games cache so the next call
// to LoadGames re-reads from the database.
func InvalidateCache() {
	gamesMu.Lock()
	cachedGames = nil
	gamesMu.Unlock()
}

// invalidateCacheUnlocked clears the cache without acquiring the mutex.
// It must only be called while gamesMu is already held (e.g. from
// SyncFromPokeAPI called within loadGamesFromDB).
func invalidateCacheUnlocked() {
	cachedGames = nil
}

// loadGamesFromDB loads games from the database, triggering a PokeAPI sync
// if the database is empty.
func loadGamesFromDB(store GamesStore) []GameEntry {
	// Load from database
	if store != nil && store.HasGames() {
		rows, err := store.LoadGames()
		if err == nil && len(rows) > 0 {
			return RowsToEntries(rows)
		}
		if err != nil {
			slog.Warn("Could not load games from DB", "error", err)
		}
	}

	// Database is empty — trigger initial sync from PokeAPI
	if store != nil {
		slog.Info("No games in database, syncing from PokeAPI...")
		result, err := SyncFromPokeAPI(store, nil)
		if err != nil {
			slog.Warn("Initial games sync failed", "error", err)
			return nil
		}
		slog.Info("Initial games sync complete", "added", result.Added)
		// Retry loading after sync
		rows, err := store.LoadGames()
		if err == nil && len(rows) > 0 {
			return RowsToEntries(rows)
		}
	}

	return nil
}

// RowsToEntries converts database rows to GameEntry slices.
func RowsToEntries(rows []database.GameRow) []GameEntry {
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

// EntriesToRows converts GameEntry slices to database rows.
func EntriesToRows(entries []GameEntry) []database.GameRow {
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
