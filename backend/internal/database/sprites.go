// sprites.go provides storage for user-uploaded local Pokemon sprite images.
// Sprites are stored directly in the SQLite database (one BLOB per pokemon) so
// all application data lives in a single file, mirroring detector_templates.
// The data column is fetched on demand via LoadSprite and is never loaded
// during LoadFullState to keep WebSocket state messages small.
package database

import (
	"fmt"
	"time"
)

// SaveSprite upserts the sprite image BLOB and mime type for the given pokemon.
// An existing sprite for the same pokemon is replaced.
func (d *DB) SaveSprite(pokemonID string, data []byte, mime string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := d.db.Exec(
		`INSERT INTO pokemon_sprites (pokemon_id, data, mime, updated_at)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(pokemon_id) DO UPDATE SET
			data       = excluded.data,
			mime       = excluded.mime,
			updated_at = excluded.updated_at`,
		pokemonID, data, mime, now,
	)
	if err != nil {
		return fmt.Errorf("save sprite for %q: %w", pokemonID, err)
	}
	return nil
}

// LoadSprite returns the stored image bytes and mime type for the given pokemon.
// It returns an error when no sprite exists for the pokemon.
func (d *DB) LoadSprite(pokemonID string) (data []byte, mime string, err error) {
	err = d.db.QueryRow(
		`SELECT data, mime FROM pokemon_sprites WHERE pokemon_id = ?`, pokemonID,
	).Scan(&data, &mime)
	if err != nil {
		return nil, "", fmt.Errorf("load sprite for %q: %w", pokemonID, err)
	}
	return data, mime, nil
}

// DeleteSprite removes the stored sprite for the given pokemon. Deleting a
// non-existent sprite is not an error.
func (d *DB) DeleteSprite(pokemonID string) error {
	_, err := d.db.Exec(`DELETE FROM pokemon_sprites WHERE pokemon_id = ?`, pokemonID)
	if err != nil {
		return fmt.Errorf("delete sprite for %q: %w", pokemonID, err)
	}
	return nil
}
