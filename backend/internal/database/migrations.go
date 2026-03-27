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
