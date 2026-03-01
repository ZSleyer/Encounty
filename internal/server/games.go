package server

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sort"
)

// defaultGamesJSON is set by main.go via SetDefaultGamesJSON so that the
// embedded games.json bytes can be used as a fallback without requiring a
// relative //go:embed path that crosses module boundaries.
var defaultGamesJSON []byte

// SetDefaultGamesJSON injects the embedded games.json bytes from main.go.
func SetDefaultGamesJSON(data []byte) {
	defaultGamesJSON = data
}

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

	data, err := readGamesJSON()
	if err != nil {
		log.Printf("Warning: could not load games.json: %v", err)
		return nil
	}

	var raw map[string]rawGameEntry
	if err := json.Unmarshal(data, &raw); err != nil {
		log.Printf("Warning: could not parse games.json: %v", err)
		return nil
	}

	entries := make([]GameEntry, 0, len(raw))
	for key, v := range raw {
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

	cachedGames = entries
	return entries
}

func readGamesJSON() ([]byte, error) {
	// 1. Next to the binary (external file takes priority so users can customise it)
	if exe, err := os.Executable(); err == nil {
		p := filepath.Join(filepath.Dir(exe), "games.json")
		if data, err := os.ReadFile(p); err == nil {
			return data, nil
		}
	}

	// 2. Working directory
	if data, err := os.ReadFile("games.json"); err == nil {
		return data, nil
	}

	// 3. Fall back to the embedded default (set by main.go) and write it next
	//    to the binary so the user can edit it in the future.
	if len(defaultGamesJSON) > 0 {
		log.Println("games.json not found – writing default from embedded data")
		if exe, err := os.Executable(); err == nil {
			p := filepath.Join(filepath.Dir(exe), "games.json")
			if werr := os.WriteFile(p, defaultGamesJSON, 0644); werr != nil {
				log.Printf("Warning: could not write default games.json: %v", werr)
			}
		}
		return defaultGamesJSON, nil
	}

	return nil, os.ErrNotExist
}
