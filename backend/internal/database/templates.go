// templates.go provides CRUD operations for detector template image BLOBs.
// Template images are stored directly in the SQLite database to keep all
// application data in a single file. The image_data column is intentionally
// NOT loaded during LoadFullState to avoid bloating WebSocket messages;
// callers fetch individual images on demand via LoadTemplateImage.
package database

import "fmt"

// SaveTemplateImage inserts a new template image BLOB and returns its row ID.
func (d *DB) SaveTemplateImage(pokemonID string, imageData []byte, sortOrder int) (int64, error) {
	res, err := d.db.Exec(
		`INSERT INTO detector_templates (pokemon_id, image_data, sort_order) VALUES (?, ?, ?)`,
		pokemonID, imageData, sortOrder,
	)
	if err != nil {
		return 0, fmt.Errorf("insert template image: %w", err)
	}
	return res.LastInsertId()
}

// LoadTemplateImage returns the PNG bytes for a template by its DB row ID.
func (d *DB) LoadTemplateImage(templateDBID int64) ([]byte, error) {
	var data []byte
	err := d.db.QueryRow(`SELECT image_data FROM detector_templates WHERE id = ?`, templateDBID).Scan(&data)
	if err != nil {
		return nil, fmt.Errorf("load template image %d: %w", templateDBID, err)
	}
	return data, nil
}

// DeleteTemplateImage removes a template and its regions (cascade).
func (d *DB) DeleteTemplateImage(templateDBID int64) error {
	_, err := d.db.Exec(`DELETE FROM detector_templates WHERE id = ?`, templateDBID)
	if err != nil {
		return fmt.Errorf("delete template image %d: %w", templateDBID, err)
	}
	return nil
}
