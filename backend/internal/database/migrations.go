// migrations.go implements a versioned database migration system for SQLite.
// Each migration is tracked in a dedicated migrations table and executed
// exactly once, in order, within its own transaction.
package database

import (
	"database/sql"
	"fmt"
	"time"
)

// migration represents a single schema migration with a unique version number.
type migration struct {
	version     int
	description string
	fn          func(tx *sql.Tx) error
}

// migrations is the ordered list of all known schema migrations.
// New migrations must be appended with a strictly increasing version number.
var migrations = []migration{
	{
		version:     1,
		description: "baseline schema with legacy tables and normalized v2",
		fn:          migrateBaseline,
	},
	{
		version:     2,
		description: "add columns introduced after initial baseline",
		fn:          migrateAddMissingColumns,
	},
	{
		version:     3,
		description: "drop legacy relative_regions column from detector_configs",
		fn:          migrateDropLegacyColumns,
	},
	{
		version:     4,
		description: "add name column to detector_templates",
		fn:          migrateAddTemplateName,
	},
	{
		version:     5,
		description: "drop unused browser_port column from settings",
		fn:          migrateDropBrowserPort,
	},
	{
		version:     6,
		description: "add trigger_decrement column to overlay_elements",
		fn:          migrateAddTriggerDecrement,
	},
	{
		version:     7,
		description: "add hysteresis_factor column to detector_configs",
		fn:          migrateAddHysteresisFactor,
	},
	{
		version:     8,
		description: "add background_animation_config column to overlay_settings",
		fn:          migrateAddBgAnimConfig,
	},
	{
		version:     9,
		description: "force auto_save enabled for all users",
		fn:          migrateForceAutoSave,
	},
	{
		version:     10,
		description: "add shiny_charm column to pokemon",
		fn:          migrateAddShinyCharm,
	},
	{
		version:     11,
		description: "remove negative regions and full-frame fallback regions",
		fn:          migrateRemoveNegativeAndFullFrameRegions,
	},
	{
		version:     12,
		description: "add generations column to pokedex_forms",
		fn:          migrateAddFormGenerations,
	},
	{
		version:     13,
		description: "force pokedex re-sync to populate form generations",
		fn:          migrateForcePokedexResync,
	},
}

// RunMigrations creates the migrations tracking table if needed, then applies
// any pending migrations in order. Each migration runs in its own transaction;
// if a migration fails, that transaction is rolled back and the error is returned.
func RunMigrations(db *sql.DB) error {
	// The migrations table itself is created outside a migration to bootstrap.
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS migrations (
		version     INTEGER PRIMARY KEY,
		description TEXT    NOT NULL,
		applied_at  TEXT    NOT NULL
	)`); err != nil {
		return fmt.Errorf("create migrations table: %w", err)
	}

	var current int
	if err := db.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM migrations`).Scan(&current); err != nil {
		return fmt.Errorf("query current migration version: %w", err)
	}

	for _, m := range migrations {
		if m.version <= current {
			continue
		}

		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("begin migration %d: %w", m.version, err)
		}

		if err := m.fn(tx); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("migration %d (%s): %w", m.version, m.description, err)
		}

		if _, err := tx.Exec(
			`INSERT INTO migrations (version, description, applied_at) VALUES (?, ?, ?)`,
			m.version, m.description, time.Now().UTC().Format(time.RFC3339),
		); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("record migration %d: %w", m.version, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %d: %w", m.version, err)
		}
	}

	return nil
}

// migrateBaseline creates all legacy and v2 schema tables. Every statement
// uses IF NOT EXISTS / IF NOT EXISTS so the migration is idempotent and safe
// to run against databases that already have some or all of these tables.
func migrateBaseline(tx *sql.Tx) error {
	stmts := []string{
		// Legacy tables (preserved for backward compatibility and data migration).
		`CREATE TABLE IF NOT EXISTS encounter_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			pokemon_id TEXT NOT NULL,
			pokemon_name TEXT NOT NULL,
			timestamp TEXT NOT NULL,
			delta INTEGER NOT NULL,
			count_after INTEGER NOT NULL,
			source TEXT DEFAULT 'manual'
		)`,
		`CREATE INDEX IF NOT EXISTS idx_encounter_pokemon ON encounter_events(pokemon_id)`,
		`CREATE INDEX IF NOT EXISTS idx_encounter_ts ON encounter_events(timestamp)`,
		`CREATE TABLE IF NOT EXISTS timer_sessions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			pokemon_id TEXT NOT NULL,
			started_at TEXT NOT NULL,
			ended_at TEXT,
			encounters_during INTEGER DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_timer_pokemon ON timer_sessions(pokemon_id)`,
		`CREATE TABLE IF NOT EXISTS app_state (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			data TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS games (
			key TEXT PRIMARY KEY,
			names TEXT NOT NULL,
			generation INTEGER NOT NULL,
			platform TEXT NOT NULL
		)`,
	}

	// Append all normalized v2 schema statements.
	stmts = append(stmts, schemaV2...)

	for _, s := range stmts {
		if _, err := tx.Exec(s); err != nil {
			return fmt.Errorf("exec %q: %w", s[:min(40, len(s))], err)
		}
	}

	// Idempotent ALTER TABLE upgrades. SQLite does not support
	// IF NOT EXISTS for ALTER TABLE ADD COLUMN, so duplicate-column
	// errors are silently ignored.
	alterStmts := []string{
		`ALTER TABLE detector_templates ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1`,
		`ALTER TABLE detector_configs ADD COLUMN adaptive_cooldown INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE detector_configs ADD COLUMN adaptive_cooldown_min INTEGER NOT NULL DEFAULT 3`,
		`ALTER TABLE settings ADD COLUMN ui_animations INTEGER NOT NULL DEFAULT 1`,
		`ALTER TABLE pokemon ADD COLUMN hunt_mode TEXT NOT NULL DEFAULT 'both'`,
		`ALTER TABLE template_regions ADD COLUMN is_negative INTEGER NOT NULL DEFAULT 0`,
	}
	for _, s := range alterStmts {
		_, _ = tx.Exec(s)
	}

	return nil
}

// migrateAddMissingColumns re-runs the idempotent ALTER TABLE statements from
// migrateBaseline so that databases which already completed migration 1 (before
// these columns were added to the baseline) pick them up.
func migrateAddMissingColumns(tx *sql.Tx) error {
	stmts := []string{
		`ALTER TABLE detector_templates ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1`,
		`ALTER TABLE detector_configs ADD COLUMN adaptive_cooldown INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE detector_configs ADD COLUMN adaptive_cooldown_min INTEGER NOT NULL DEFAULT 3`,
		`ALTER TABLE settings ADD COLUMN ui_animations INTEGER NOT NULL DEFAULT 1`,
		`ALTER TABLE pokemon ADD COLUMN hunt_mode TEXT NOT NULL DEFAULT 'both'`,
		`ALTER TABLE template_regions ADD COLUMN is_negative INTEGER NOT NULL DEFAULT 0`,
	}
	for _, s := range stmts {
		_, _ = tx.Exec(s)
	}
	return nil
}

// migrateDropLegacyColumns removes detector config columns that are no longer
// used after the native backend detector engine was removed. Errors are ignored
// because the column may not exist on fresh databases where the schema was
// already created without it.
func migrateDropLegacyColumns(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE detector_configs DROP COLUMN relative_regions`)
	return nil
}

// migrateAddTemplateName adds the name column to detector_templates so each
// template can have a user-visible label. Errors are ignored because the column
// may already exist on fresh databases.
func migrateAddTemplateName(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE detector_templates ADD COLUMN name TEXT NOT NULL DEFAULT ''`)
	return nil
}

// migrateDropBrowserPort removes the browser_port column from the settings
// table. The port is now a hardcoded constant (8192) in main.go.
// Errors are ignored because the column may not exist on fresh databases.
func migrateDropBrowserPort(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE settings DROP COLUMN browser_port`)
	return nil
}

// migrateAddTriggerDecrement adds the trigger_decrement column to
// overlay_elements. Errors are ignored for idempotency.
func migrateAddTriggerDecrement(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE overlay_elements ADD COLUMN trigger_decrement TEXT NOT NULL DEFAULT 'none'`)
	return nil
}

// migrateAddHysteresisFactor adds the hysteresis_factor column to
// detector_configs. Errors are ignored for idempotency.
func migrateAddHysteresisFactor(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE detector_configs ADD COLUMN hysteresis_factor REAL NOT NULL DEFAULT 0.7`)
	return nil
}

// migrateAddBgAnimConfig adds the background_animation_config column to
// overlay_settings for storing per-animation configuration as JSON.
func migrateAddBgAnimConfig(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE overlay_settings ADD COLUMN background_animation_config TEXT NOT NULL DEFAULT ''`)
	return nil
}

// migrateForceAutoSave sets auto_save to enabled for all users.
// Auto-save is now always on and the toggle has been removed from the UI.
func migrateForceAutoSave(tx *sql.Tx) error {
	_, err := tx.Exec(`UPDATE settings SET auto_save = 1`)
	return err
}

// migrateAddShinyCharm adds the shiny_charm column to the pokemon table.
// Errors are ignored for idempotency.
func migrateAddShinyCharm(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE pokemon ADD COLUMN shiny_charm INTEGER NOT NULL DEFAULT 0`)
	return nil
}

// migrateRemoveNegativeAndFullFrameRegions cleans up legacy region data:
//  1. Delete all negative regions (is_negative = 1) since polarity was removed.
//  2. Delete full-frame fallback regions: templates with exactly one region
//     starting at (0,0). These were auto-created by the old frontend when saving
//     without user-defined regions.
//
// After cleanup, affected templates will have zero regions and must be edited
// by the user before they can be used for detection.
func migrateRemoveNegativeAndFullFrameRegions(tx *sql.Tx) error {
	// Step 1: delete all negative regions.
	if _, err := tx.Exec(`DELETE FROM template_regions WHERE is_negative = 1`); err != nil {
		return fmt.Errorf("delete negative regions: %w", err)
	}

	// Step 2: delete full-frame fallback regions.
	// A full-frame fallback is identified as the sole region of a template
	// that starts at origin (0,0). Templates with multiple regions are left
	// untouched since the user explicitly defined them.
	if _, err := tx.Exec(`
		DELETE FROM template_regions
		WHERE id IN (
			SELECT r.id
			FROM template_regions r
			JOIN (
				SELECT template_id
				FROM template_regions
				GROUP BY template_id
				HAVING COUNT(*) = 1
			) singles ON singles.template_id = r.template_id
			WHERE r.rect_x = 0 AND r.rect_y = 0
		)
	`); err != nil {
		return fmt.Errorf("delete full-frame fallback regions: %w", err)
	}

	return nil
}

// migrateAddFormGenerations adds the generations column to pokedex_forms.
// The column stores a JSON array of generation IDs (e.g. "[7,8]") indicating
// which Pokémon generations a given form is available in. An empty array
// means the form is shown unconditionally. Errors are ignored for idempotency
// because SQLite does not support IF NOT EXISTS for ADD COLUMN.
func migrateAddFormGenerations(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE pokedex_forms ADD COLUMN generations TEXT NOT NULL DEFAULT '[]'`)
	return nil
}

// migrateForcePokedexResync clears the cached pokedex tables so the next
// application start performs a full PokeAPI sync. This is required because
// migration 12 introduced the generations column, which can only be populated
// from the upstream API — there is no local source for the data.
func migrateForcePokedexResync(tx *sql.Tx) error {
	if _, err := tx.Exec(`DELETE FROM pokedex_forms`); err != nil {
		return fmt.Errorf("clear pokedex_forms: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM pokedex_species`); err != nil {
		return fmt.Errorf("clear pokedex_species: %w", err)
	}
	return nil
}
