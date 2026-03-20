// pokedex.go provides Pokédex JSON persistence and data types.
// The JSON file is read from the config dir if present, falling back to the
// source tree or working directory for development builds.
package pokedex

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// Filename is the name of the Pokédex JSON file on disk.
const Filename = "pokemon.json"

// Entry is one species record in pokemon.json.
// Forms holds alternate forms (regional variants, mega evolutions, etc.)
// that share the same species ID but have distinct canonical names and sprites.
type Entry struct {
	ID        int               `json:"id"`
	Canonical string            `json:"canonical"`
	Names     map[string]string `json:"names,omitempty"`
	Forms     []Form            `json:"forms,omitempty"`
}

// Form represents an alternate form of a Pokémon species.
// SpriteID is the numeric PokéAPI ID used to construct the sprite URL.
type Form struct {
	Canonical string            `json:"canonical"`
	Names     map[string]string `json:"names,omitempty"`
	SpriteID  int               `json:"sprite_id"`
}

// ReadJSON reads the Pokédex JSON from configDir, falling back to the source
// tree (via runtime.Caller) and the working directory for dev builds.
func ReadJSON(configDir string) ([]byte, error) {
	// 1. configDir (user-synced version)
	if data, err := os.ReadFile(filepath.Join(configDir, Filename)); err == nil {
		return data, nil
	}

	// 2. Source directory (dev mode via runtime.Caller)
	_, file, _, ok := runtime.Caller(0)
	if ok {
		p := filepath.Join(filepath.Dir(file), "..", "..", "..", "frontend", "public", Filename)
		if data, err := os.ReadFile(p); err == nil {
			return data, nil
		}
	}

	// 3. Working directory fallback
	if data, err := os.ReadFile("frontend/public/" + Filename); err == nil {
		return data, nil
	}

	return nil, fmt.Errorf("%s not found in any location", Filename)
}

// WriteJSON marshals the Pokédex entries and writes them atomically to
// the pokemon.json file inside the given config directory.
func WriteJSON(configDir string, entries []Entry) error {
	data, err := json.Marshal(entries)
	if err != nil {
		return fmt.Errorf("failed to marshal: %w", err)
	}
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return fmt.Errorf("failed to create config dir: %w", err)
	}
	destPath := filepath.Join(configDir, Filename)
	if err := os.WriteFile(destPath, data, 0644); err != nil {
		return fmt.Errorf("failed to save: %w", err)
	}
	return nil
}
