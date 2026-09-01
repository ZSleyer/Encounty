// fallback.go embeds a bundled Pokédex JSON so the application can populate
// the database on first launch without requiring a PokeAPI connection.
package pokedex

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"log/slog"
)

// FallbackPokedexJSON is the Pokédex shipped inside the binary. It is what an
// offline setup uses when PokéAPI cannot be reached.
//
//go:embed fallback_pokemon.json
var FallbackPokedexJSON []byte

// LoadFallbackPokedex parses the embedded Pokédex JSON into Entry slices.
func LoadFallbackPokedex() ([]Entry, error) {
	var entries []Entry
	if err := json.Unmarshal(FallbackPokedexJSON, &entries); err != nil {
		return nil, fmt.Errorf("parse fallback pokédex: %w", err)
	}
	return entries, nil
}

// SeedFromFallback writes the embedded fallback Pokédex into the database.
// It skips seeding if the store already has sufficient data.
func SeedFromFallback(store PokedexStore) error {
	if store == nil {
		return fmt.Errorf("no database available")
	}
	if !NeedsSync(store) {
		slog.Info("SeedPokedex: database already has sufficient data, skipping fallback")
		return nil
	}

	entries, err := LoadFallbackPokedex()
	if err != nil {
		return err
	}

	species, forms := EntriesToRows(entries)
	if err := store.SavePokedex(species, forms); err != nil {
		return fmt.Errorf("seed fallback pokédex: %w", err)
	}

	InvalidateCache()
	slog.Info("SeedPokedex: seeded from embedded fallback", "species", len(species), "forms", len(forms))
	return nil
}
