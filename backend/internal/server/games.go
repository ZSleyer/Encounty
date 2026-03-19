// games.go loads the Pokémon game catalogue from games.json and serves it
// via GET /api/games. The file is resolved in priority order:
// config dir → binary dir → working dir → embedded default.
// A parsed, sorted slice is cached in memory after the first load.
package server

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sort"

	"github.com/zsleyer/encounty/backend/internal/database"
)

// defaultGamesJSON is set by main.go via SetDefaultGamesJSON so that the
// embedded games.json bytes can be used as a fallback without requiring a
// relative //go:embed path that crosses module boundaries.
var defaultGamesJSON []byte

// SetDefaultGamesJSON injects the embedded games.json bytes from main.go.
func SetDefaultGamesJSON(data []byte) {
	defaultGamesJSON = data
}

// gamesConfigDir is set once by the server at startup so we know where to
// read/write the user-editable games.json inside the config directory.
var gamesConfigDir string

// GamesStore abstracts database operations for the games catalogue.
type GamesStore interface {
	SaveGames(rows []database.GameRow) error
	LoadGames() ([]database.GameRow, error)
	HasGames() bool
}

// gamesDB is set by the server at startup to enable DB-backed game storage.
var gamesDB GamesStore

// GameEntry is the public representation of one Pokémon game returned by the
// API. The Key field is the stable identifier used in Pokemon.Game.
type GameEntry struct {
	Key        string            `json:"key"`
	Names      map[string]string `json:"names"`
	Generation int               `json:"generation"`
	Platform   string            `json:"platform"`
}

type rawGameEntry struct {
	Names      map[string]string `json:"names"`
	Generation int               `json:"generation"`
	Platform   string            `json:"platform"`
}

var cachedGames []GameEntry

func loadGames() []GameEntry {
	if cachedGames != nil {
		return cachedGames
	}

	// Try loading from database first
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

	// Fall back to JSON files
	data, err := readGamesJSON()
	if err != nil {
		slog.Warn("Could not load games.json", "error", err)
		return nil
	}

	entries := parseGamesData(data)
	if entries == nil {
		return nil
	}

	// Persist loaded JSON games into DB for future loads
	if gamesDB != nil {
		rows := entriesToGameRows(entries)
		if err := gamesDB.SaveGames(rows); err != nil {
			slog.Warn("Could not persist games to DB", "error", err)
		}
	}

	cachedGames = entries
	return entries
}

// parseGamesData unmarshals raw games JSON data into a sorted, deduplicated slice.
func parseGamesData(data []byte) []GameEntry {
	var raw map[string]rawGameEntry
	if err := json.Unmarshal(data, &raw); err != nil {
		slog.Warn("Could not parse games.json", "error", err)
		return nil
	}

	seen := make(map[string]bool)
	entries := make([]GameEntry, 0, len(raw))
	for key, v := range raw {
		dedup := v.Names["en"] + "|" + v.Platform
		if seen[dedup] {
			continue
		}
		seen[dedup] = true
		entries = append(entries, GameEntry{
			Key:        key,
			Names:      v.Names,
			Generation: v.Generation,
			Platform:   v.Platform,
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

// readGamesJSONFromDisk tries to load games.json from the config directory,
// next to the binary, and then the working directory, in that order.
// Returns the raw bytes and true on success, or nil and false if not found.
func readGamesJSONFromDisk() ([]byte, bool) {
	if gamesConfigDir != "" {
		p := filepath.Join(gamesConfigDir, gamesFilename)
		if data, err := os.ReadFile(p); err == nil {
			return data, true
		}
	}
	if exe, err := os.Executable(); err == nil {
		p := filepath.Join(filepath.Dir(exe), gamesFilename)
		if data, err := os.ReadFile(p); err == nil {
			return data, true
		}
	}
	if data, err := os.ReadFile(gamesFilename); err == nil {
		return data, true
	}
	return nil, false
}

// writeEmbeddedDefault writes the embedded games.json into the config directory
// so the user can find and edit it in the future.
func writeEmbeddedDefault() {
	if gamesConfigDir == "" {
		slog.Info("games.json not found, using embedded default (no config dir set)")
		return
	}
	p := filepath.Join(gamesConfigDir, gamesFilename)
	slog.Info("games.json not found, writing default", "path", p)
	if werr := os.MkdirAll(gamesConfigDir, 0755); werr == nil {
		if werr := os.WriteFile(p, defaultGamesJSON, 0644); werr != nil {
			slog.Warn("Could not write default games.json", "error", werr)
		}
	}
}

func readGamesJSON() ([]byte, error) {
	if data, ok := readGamesJSONFromDisk(); ok {
		return data, nil
	}

	if len(defaultGamesJSON) > 0 {
		writeEmbeddedDefault()
		return defaultGamesJSON, nil
	}

	return nil, os.ErrNotExist
}
