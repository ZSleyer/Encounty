// backgrounds.go provides storage for user-uploaded overlay background images.
// They live in the database next to detector templates and uploaded sprites, so
// everything a user brings along is in one file: a backup carries it, and
// relocating the database takes it along. The data column is fetched on demand
// and never enters the in-memory AppState.
package database

import (
	"fmt"
	"time"
)

// SaveBackground upserts the image BLOB and mime type under filename, which is
// the same name the overlay settings reference.
func (d *DB) SaveBackground(filename string, data []byte, mime string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := d.db.Exec(
		`INSERT INTO backgrounds (filename, data, mime, created_at)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(filename) DO UPDATE SET
			data       = excluded.data,
			mime       = excluded.mime,
			created_at = excluded.created_at`,
		filename, data, mime, now,
	)
	if err != nil {
		return fmt.Errorf("save background %q: %w", filename, err)
	}
	return nil
}

// LoadBackground returns the stored image bytes and mime type for filename.
// It returns an error when no such background exists.
func (d *DB) LoadBackground(filename string) (data []byte, mime string, err error) {
	err = d.db.QueryRow(
		`SELECT data, mime FROM backgrounds WHERE filename = ?`, filename,
	).Scan(&data, &mime)
	if err != nil {
		return nil, "", fmt.Errorf("load background %q: %w", filename, err)
	}
	return data, mime, nil
}

// DeleteBackground removes the stored image. Deleting one that is not there is
// not an error.
func (d *DB) DeleteBackground(filename string) error {
	if _, err := d.db.Exec(`DELETE FROM backgrounds WHERE filename = ?`, filename); err != nil {
		return fmt.Errorf("delete background %q: %w", filename, err)
	}
	return nil
}

// HasBackground reports whether an image is stored under filename.
func (d *DB) HasBackground(filename string) bool {
	var n int
	_ = d.db.QueryRow(`SELECT 1 FROM backgrounds WHERE filename = ?`, filename).Scan(&n)
	return n == 1
}

// DeleteOrphanBackgrounds removes every image no overlay references any more.
// Overlays exist globally and per Pokémon, and a copied overlay can carry the
// same filename, so the check spans every row of overlay_settings rather than
// just the global one. Returns how many images were removed.
func (d *DB) DeleteOrphanBackgrounds() (int, error) {
	res, err := d.db.Exec(`DELETE FROM backgrounds WHERE filename NOT IN (
		SELECT background_image FROM overlay_settings WHERE background_image != ''
	)`)
	if err != nil {
		return 0, fmt.Errorf("delete orphan backgrounds: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, nil
	}
	return int(n), nil
}
