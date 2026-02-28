package server

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sort"
)

type GameEntry struct {
	Key        string `json:"key"`
	NameDE     string `json:"name_de"`
	NameEN     string `json:"name_en"`
	Generation int    `json:"generation"`
	Platform   string `json:"platform"`
}

type rawGameEntry struct {
	NameDE     string `json:"name_de"`
	NameEN     string `json:"name_en"`
	Generation int    `json:"generation"`
	Platform   string `json:"platform"`
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
			NameDE:     v.NameDE,
			NameEN:     v.NameEN,
			Generation: v.Generation,
			Platform:   v.Platform,
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Generation != entries[j].Generation {
			return entries[i].Generation < entries[j].Generation
		}
		return entries[i].NameEN < entries[j].NameEN
	})

	cachedGames = entries
	return entries
}

func readGamesJSON() ([]byte, error) {
	// 1. Next to the binary
	exe, err := os.Executable()
	if err == nil {
		p := filepath.Join(filepath.Dir(exe), "games.json")
		if data, err := os.ReadFile(p); err == nil {
			return data, nil
		}
	}

	// 2. Working directory
	if data, err := os.ReadFile("games.json"); err == nil {
		return data, nil
	}

	// 3. Source directory (dev mode)
	_, file, _, ok := runtime.Caller(0)
	if ok {
		p := filepath.Join(filepath.Dir(file), "..", "..", "games.json")
		if data, err := os.ReadFile(p); err == nil {
			return data, nil
		}
	}

	return nil, os.ErrNotExist
}
