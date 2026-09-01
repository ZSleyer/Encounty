// state_save_detector.go writes the detector tables (detector_templates,
// template_regions and detection_log) for every Pokémon. It is the save half of
// the detector persistence, split out of state_save.go.

package database

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// ---------------------------------------------------------------------------
// Detector helpers
// ---------------------------------------------------------------------------

// saveDetectorTemplates handles upsert/insert/delete logic for detector_templates.
func saveDetectorTemplates(tx *sql.Tx, pokemon []state.Pokemon) error {
	referencedIDs, err := upsertDetectorTemplates(tx, pokemon)
	if err != nil {
		return err
	}
	return deleteUnreferencedTemplates(tx, referencedIDs)
}

// upsertDetectorTemplates updates existing templates and inserts new ones,
// returning the set of DB IDs that are still in use.
func upsertDetectorTemplates(tx *sql.Tx, pokemon []state.Pokemon) (map[int64]bool, error) {
	referencedIDs := map[int64]bool{}
	for _, p := range pokemon {
		if p.DetectorConfig == nil {
			continue
		}
		if err := upsertPokemonTemplates(tx, p.ID, p.DetectorConfig.Templates, referencedIDs); err != nil {
			return nil, err
		}
	}
	return referencedIDs, nil
}

// upsertPokemonTemplates processes all templates for a single pokemon,
// updating existing ones and inserting new ones.
func upsertPokemonTemplates(tx *sql.Tx, pokemonID string, templates []state.DetectorTemplate, referencedIDs map[int64]bool) error {
	for sortOrder, tmpl := range templates {
		enabledVal := boolToInt(tmpl.Enabled == nil || *tmpl.Enabled)
		calibrationVal := calibrationToDB(tmpl.Calibration)
		if tmpl.TemplateDBID > 0 {
			if _, err := tx.Exec(
				`UPDATE detector_templates SET name = ?, sort_order = ?, enabled = ?, calibration = ?, precision_val = ?, hysteresis_factor = ?,
					consecutive_hits = ?, cooldown_sec = ?, poll_interval_ms = ?, min_poll_ms = ?, max_poll_ms = ?, hysteresis_mode = ? WHERE id = ?`,
				tmpl.Name, sortOrder, enabledVal, calibrationVal, tmpl.Precision, tmpl.HysteresisFactor,
				tmpl.ConsecutiveHits, tmpl.CooldownSec, tmpl.PollIntervalMs, tmpl.MinPollMs, tmpl.MaxPollMs, tmpl.HysteresisMode, tmpl.TemplateDBID,
			); err != nil {
				return fmt.Errorf("update template sort_order %d: %w", tmpl.TemplateDBID, err)
			}
			referencedIDs[tmpl.TemplateDBID] = true
		} else if tmpl.ImageData != nil {
			res, err := tx.Exec(
				`INSERT INTO detector_templates (pokemon_id, image_data, name, sort_order, enabled, calibration, precision_val, hysteresis_factor,
					consecutive_hits, cooldown_sec, poll_interval_ms, min_poll_ms, max_poll_ms, hysteresis_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				pokemonID, tmpl.ImageData, tmpl.Name, sortOrder, enabledVal, calibrationVal, tmpl.Precision, tmpl.HysteresisFactor,
				tmpl.ConsecutiveHits, tmpl.CooldownSec, tmpl.PollIntervalMs, tmpl.MinPollMs, tmpl.MaxPollMs, tmpl.HysteresisMode,
			)
			if err != nil {
				return fmt.Errorf("insert new template for %q: %w", pokemonID, err)
			}
			newID, _ := res.LastInsertId()
			referencedIDs[newID] = true
		}
	}
	return nil
}

// calibrationToDB converts an opaque calibration JSON blob to a nullable
// TEXT value for storage. Empty means NULL.
func calibrationToDB(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	return string(raw)
}

// deleteUnreferencedTemplates removes detector_templates rows whose IDs are
// not in the referencedIDs set.
func deleteUnreferencedTemplates(tx *sql.Tx, referencedIDs map[int64]bool) error {
	rows, err := tx.Query(`SELECT id FROM detector_templates`)
	if err != nil {
		return fmt.Errorf("query detector_templates: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var toDelete []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("scan template id: %w", err)
		}
		if !referencedIDs[id] {
			toDelete = append(toDelete, id)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate template ids: %w", err)
	}
	for _, id := range toDelete {
		if _, err := tx.Exec(`DELETE FROM detector_templates WHERE id = ?`, id); err != nil {
			return fmt.Errorf("delete template %d: %w", id, err)
		}
	}
	return nil
}

// saveTemplateRegions replaces all template_regions for every template.
func saveTemplateRegions(tx *sql.Tx, pokemon []state.Pokemon) error {
	if err := saveExistingTemplateRegions(tx, pokemon); err != nil {
		return err
	}
	return saveNewTemplateRegions(tx, pokemon)
}

// saveExistingTemplateRegions replaces regions for templates that already
// have a database ID (TemplateDBID > 0).
func saveExistingTemplateRegions(tx *sql.Tx, pokemon []state.Pokemon) error {
	for _, p := range pokemon {
		if p.DetectorConfig == nil {
			continue
		}
		for _, tmpl := range p.DetectorConfig.Templates {
			if tmpl.TemplateDBID <= 0 {
				continue
			}
			if _, err := tx.Exec(`DELETE FROM template_regions WHERE template_id = ?`, tmpl.TemplateDBID); err != nil {
				return fmt.Errorf("delete regions for template %d: %w", tmpl.TemplateDBID, err)
			}
			if err := insertRegions(tx, tmpl.TemplateDBID, tmpl.Regions); err != nil {
				return err
			}
		}
	}
	return nil
}

// saveNewTemplateRegions handles regions for newly inserted templates
// (TemplateDBID was 0) by looking them up via pokemon_id + sort_order.
func saveNewTemplateRegions(tx *sql.Tx, pokemon []state.Pokemon) error {
	for _, p := range pokemon {
		if p.DetectorConfig == nil {
			continue
		}
		for sortOrder, tmpl := range p.DetectorConfig.Templates {
			if tmpl.TemplateDBID > 0 || tmpl.ImageData == nil {
				continue
			}
			var newID int64
			err := tx.QueryRow(
				`SELECT id FROM detector_templates WHERE pokemon_id = ? AND sort_order = ?`,
				p.ID, sortOrder,
			).Scan(&newID)
			if err != nil {
				return fmt.Errorf("find new template for %q sort %d: %w", p.ID, sortOrder, err)
			}
			if err := insertRegions(tx, newID, tmpl.Regions); err != nil {
				return err
			}
		}
	}
	return nil
}

// insertRegions inserts a slice of MatchedRegion rows for a given template ID.
func insertRegions(tx *sql.Tx, templateID int64, regions []state.MatchedRegion) error {
	for i, r := range regions {
		if _, err := tx.Exec(`
			INSERT INTO template_regions (template_id, type, expected_text,
				rect_x, rect_y, rect_w, rect_h, sort_order, is_negative, category)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			templateID, r.Type, r.ExpectedText,
			r.Rect.X, r.Rect.Y, r.Rect.W, r.Rect.H, i, 0, r.Category,
		); err != nil {
			return fmt.Errorf("insert region for template %d: %w", templateID, err)
		}
	}
	return nil
}

// saveDetectionLogs syncs detection_log entries for each pokemon with a detector config.
// Entries are capped at 20 per pokemon.
func saveDetectionLogs(tx *sql.Tx, pokemon []state.Pokemon) error {
	cfgIDs := collectDetectorPokemonIDs(pokemon)
	if err := deleteNotIn(tx, "detection_log", "pokemon_id", cfgIDs); err != nil {
		return fmt.Errorf("delete orphan detection_log: %w", err)
	}
	for _, p := range pokemon {
		if p.DetectorConfig == nil {
			continue
		}
		if err := replacePokemonDetectionLog(tx, p); err != nil {
			return err
		}
	}
	return nil
}

// collectDetectorPokemonIDs returns the IDs of Pokemon that have a DetectorConfig.
func collectDetectorPokemonIDs(pokemon []state.Pokemon) []string {
	ids := make([]string, 0, len(pokemon))
	for _, p := range pokemon {
		if p.DetectorConfig != nil {
			ids = append(ids, p.ID)
		}
	}
	return ids
}

// replacePokemonDetectionLog deletes and re-inserts detection_log entries
// for a single Pokemon, capped at 20 entries.
func replacePokemonDetectionLog(tx *sql.Tx, p state.Pokemon) error {
	if _, err := tx.Exec(`DELETE FROM detection_log WHERE pokemon_id = ?`, p.ID); err != nil {
		return fmt.Errorf("delete detection_log for %q: %w", p.ID, err)
	}
	entries := p.DetectorConfig.DetectionLog
	if len(entries) > 20 {
		entries = entries[len(entries)-20:]
	}
	for _, e := range entries {
		if _, err := tx.Exec(
			`INSERT INTO detection_log (pokemon_id, at, confidence, category) VALUES (?, ?, ?, ?)`,
			p.ID, e.At.UTC().Format(time.RFC3339), e.Confidence, e.Category,
		); err != nil {
			return fmt.Errorf("insert detection_log for %q: %w", p.ID, err)
		}
	}
	return nil
}
