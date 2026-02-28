package server

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

type PokedexEntry struct {
	ID        int           `json:"id"`
	Canonical string        `json:"canonical"`
	DE        string        `json:"de"`
	EN        string        `json:"en"`
	Forms     []PokemonForm `json:"forms,omitempty"`
}

type PokemonForm struct {
	Canonical string `json:"canonical"`
	DE        string `json:"de"`
	EN        string `json:"en"`
	SpriteID  int    `json:"sprite_id"`
}

// handleGetPokedex serves the pokemon list (configDir first, then embedded, then source).
func (s *Server) handleGetPokedex(w http.ResponseWriter, _ *http.Request) {
	data, err := s.readPokedexJSON()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{"could not load pokedex: " + err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = w.Write(data)
}

// handleSyncPokemon downloads the latest pokemon list from PokeAPI and saves it to configDir.
func (s *Server) handleSyncPokemon(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	// Load current pokedex
	currentData, err := s.readPokedexJSON()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{"could not load current pokedex: " + err.Error()})
		return
	}

	var current []PokedexEntry
	if err := json.Unmarshal(currentData, &current); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{"could not parse current pokedex: " + err.Error()})
		return
	}

	// Build index of existing canonical names
	existing := make(map[string]bool, len(current))
	for _, e := range current {
		existing[e.Canonical] = true
	}

	// Fetch from PokeAPI
	type pokeAPIEntry struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	}
	type pokeAPIList struct {
		Count   int            `json:"count"`
		Results []pokeAPIEntry `json:"results"`
	}

	resp, err := http.Get("https://pokeapi.co/api/v2/pokemon?limit=10000") //nolint:noctx
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, errResp{"PokeAPI unavailable: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{"failed to read response: " + err.Error()})
		return
	}

	var apiList pokeAPIList
	if err := json.Unmarshal(body, &apiList); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{"failed to parse PokeAPI response: " + err.Error()})
		return
	}

	// Extract numeric ID from PokeAPI URL like ".../pokemon/1/"
	extractID := func(url string) int {
		parts := strings.Split(strings.TrimSuffix(url, "/"), "/")
		if len(parts) == 0 {
			return 0
		}
		id, _ := strconv.Atoi(parts[len(parts)-1])
		return id
	}

	// Find new base-species Pokémon (IDs 1–2000; forms have IDs > 10000)
	var added []string
	for _, entry := range apiList.Results {
		if existing[entry.Name] {
			continue
		}
		id := extractID(entry.URL)
		if id <= 0 || id > 2000 {
			continue // skip forms and invalid entries
		}
		current = append(current, PokedexEntry{
			ID:        id,
			Canonical: entry.Name,
			DE:        entry.Name,
			EN:        entry.Name,
		})
		added = append(added, entry.Name)
		existing[entry.Name] = true
	}

	// Save updated pokedex to configDir
	updatedData, err := json.Marshal(current)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{"failed to marshal: " + err.Error()})
		return
	}

	configDir := s.state.GetConfigDir()
	if err := os.MkdirAll(configDir, 0755); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{"failed to create config dir: " + err.Error()})
		return
	}
	destPath := filepath.Join(configDir, "pokemon.json")
	if err := os.WriteFile(destPath, updatedData, 0644); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{"failed to save: " + err.Error()})
		return
	}

	log.Printf("Pokedex sync complete: %d new entries added", len(added))
	writeJSON(w, http.StatusOK, map[string]any{
		"total": len(current),
		"added": len(added),
		"new":   added,
	})
}

// readPokedexJSON reads the pokedex JSON: configDir > source dir > embedded FS > cwd.
func (s *Server) readPokedexJSON() ([]byte, error) {
	// 1. configDir (user-synced version)
	configDir := s.state.GetConfigDir()
	if data, err := os.ReadFile(filepath.Join(configDir, "pokemon.json")); err == nil {
		return data, nil
	}

	// 2. Source directory (dev mode via runtime.Caller)
	_, file, _, ok := runtime.Caller(0)
	if ok {
		p := filepath.Join(filepath.Dir(file), "..", "..", "frontend", "public", "pokemon.json")
		if data, err := os.ReadFile(p); err == nil {
			return data, nil
		}
	}

	// 3. Embedded frontend FS
	if s.frontendFS != nil {
		f, err := s.frontendFS.Open("frontend/dist/pokemon.json")
		if err == nil {
			defer f.Close()
			return io.ReadAll(f)
		}
	}

	// 4. Working directory fallback
	if data, err := os.ReadFile("frontend/public/pokemon.json"); err == nil {
		return data, nil
	}

	return nil, fmt.Errorf("pokemon.json not found in any location")
}
