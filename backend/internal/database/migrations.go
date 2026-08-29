// migrations.go implements a versioned database migration system for SQLite.
// Each migration is tracked in a dedicated migrations table and executed
// exactly once, in order, within its own transaction.
package database

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/zsleyer/encounty/backend/internal/state"
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
	{
		version:     14,
		description: "replace ui_animations toggle with accent_color preset",
		fn:          migrateAddAccentColor,
	},
	{
		version:     15,
		description: "add form name fields to pokemon and pokedex_forms",
		fn:          migrateAddFormNameFields,
	},
	{
		version:     16,
		description: "force pokedex re-sync to populate form names",
		fn:          migrateForcePokedexResync,
	},
	{
		version:     17,
		description: "add hunt_toggle column to hotkeys",
		fn:          migrateAddHuntToggleHotkey,
	},
	{
		version:     18,
		description: "add pokemon groups and tags",
		fn:          migrateAddPokemonGroupsAndTags,
	},
	{
		version:     19,
		description: "add format column to overlay_elements",
		fn:          migrateAddOverlayElementFormat,
	},
	{
		version:     20,
		description: "add pokemon_sprites table for local sprite uploads",
		fn:          migrateAddPokemonSprites,
	},
	{
		version:     21,
		description: "add category column to template_regions",
		fn:          migrateAddRegionCategory,
	},
	{
		version:     22,
		description: "add category column to detection_log",
		fn:          migrateAddDetectionLogCategory,
	},
	{
		version:     23,
		description: "add capture_resolutions table",
		fn:          migrateAddCaptureResolutions,
	},
	{
		version:     24,
		description: "add calibration column to detector_templates",
		fn:          migrateAddTemplateCalibration,
	},
	{
		version:     25,
		description: "add per-template detection settings",
		fn:          migrateAddTemplateDetectionSettings,
	},
	{
		version:     26,
		description: "add per-template cooldown, hits and polling settings",
		fn:          migrateAddTemplatePollingSettings,
	},
	{
		version:     27,
		description: "add hysteresis_mode column to detector_templates",
		fn:          migrateAddTemplateHysteresisMode,
	},
	{
		version:     28,
		description: "remap accent color presets to new palette",
		fn:          migrateRemapAccentColorPresets,
	},
	{
		version:     29,
		description: "add sprite_slug column to pokedex_forms",
		fn:          migrateAddFormSpriteSlug,
	},
	{
		version:     30,
		description: "force pokedex re-sync to populate cosmetic forms",
		fn:          migrateForcePokedexResync,
	},
	{
		version:     31,
		description: "add phasing columns and phase_targets table",
		fn:          migrateAddPhasing,
	},
	{
		version:     32,
		description: "add sprite cycling columns to overlay_elements",
		fn:          migrateAddSpriteCycling,
	},
	{
		version:     33,
		description: "add prefix_text and suffix_text columns to overlay_elements",
		fn:          migrateAddPrefixSuffixText,
	},
	{
		version:     34,
		description: "replace removed WebGL background animations with waves",
		fn:          migrateReplaceRemovedBgAnimations,
	},
	{
		version:     35,
		description: "drop the unused trigger_exit column from overlay_elements",
		fn:          migrateDropTriggerExit,
	},
	{
		version:     36,
		description: "fold gradient text shadows into a single shadow colour",
		fn:          migrateDropShadowGradient,
	},
	{
		version:     37,
		description: "add the sprite cycle transition column to overlay_elements",
		fn:          migrateAddSpriteCycleTransition,
	},
	{
		version:     38,
		description: "add the catch metadata column",
		fn:          migrateAddCatchMeta,
	},
	{
		version:     39,
		description: "add gender column to pokedex_forms",
		fn:          migrateAddFormGender,
	},
	{
		version:     40,
		description: "force pokedex re-sync to populate gender data",
		fn:          migrateForcePokedexResync,
	},
	{
		version:     41,
		description: "add pokedex_overrides table for manual caught/seen overrides",
		fn:          migrateAddPokedexOverrides,
	},
	{
		version:     42,
		description: "add meta_json column to pokedex_overrides",
		fn:          migrateAddOverrideMeta,
	},
	{
		version:     43,
		description: "add failed column to pokemon",
		fn:          migrateAddFailed,
	},
	{
		version:     44,
		description: "move gender to pokemon and add species gender rates",
		fn:          migrateGenderOwnership,
	},
	{
		version:     45,
		description: "force pokedex re-sync to populate gender rates",
		fn:          migrateForcePokedexResync,
	},
	{
		version:     46,
		description: "add pokemon nicknames",
		fn:          migrateAddPokemonNickname,
	},
	{
		version:     47,
		description: "add configurable user pokedexes",
		fn:          migrateAddUserPokedexes,
	},
	{
		version:     48,
		description: "add exact game catalogues to pokedex species",
		fn:          migrateAddPokedexSpeciesGames,
	},
	{
		version:     49,
		description: "add manual pokedex specimens",
		fn:          migrateAddPokedexSpecimens,
	},
	{
		version:     50,
		description: "add direct evolution links to pokedex species",
		fn:          migrateAddPokedexEvolutionLinks,
	},
	{
		version:     51,
		description: "add hunt details to manual pokedex specimens",
		fn:          migrateAddPokedexSpecimenHuntDetails,
	},
	{
		version:     52,
		description: "add shiny variant to pokemon",
		fn:          migrateAddShinyVariant,
	},
	{
		version:     53,
		description: "add phase links to manual pokedex specimens",
		fn:          migrateAddPokedexSpecimenPhases,
	},
	{
		version:     54,
		description: "add entry source marker to pokemon",
		fn:          migrateAddEntrySource,
	},
	{
		version:     55,
		description: "migrate manual pokedex specimens into the hunt archive",
		fn:          migrateSpecimensToPokemon,
	},
	{
		version:     56,
		description: "drop the legacy app_state JSON blob table",
		fn:          migrateDropAppState,
	},
	{
		version:     57,
		description: "drop the legacy timer_sessions table",
		fn:          migrateDropTimerSessions,
	},
	{
		version:     58,
		description: "drop the pokedex_specimens table and two write-only columns",
		fn:          migrateDropSpecimensAndDeadColumns,
	},
}

// migrateDropAppState removes the single-row table that held the whole state as
// one JSON blob before the normalized schema. Nothing has read it since the
// migration to that schema, and its leftover row only ever confused the
// question of whether an install was already migrated.
//
// The CREATE in migrateBaseline stays: the migration chain has to remain
// replayable from scratch, so a fresh database creates the table and this
// migration drops it again a moment later.
func migrateDropAppState(tx *sql.Tx) error {
	_, err := tx.Exec(`DROP TABLE IF EXISTS app_state`)
	return err
}

// migrateDropTimerSessions removes the table that recorded timer start/stop
// cycles before the normalized schema. Its replacement is the sessions table,
// which the state manager reads and writes; timer_sessions had no caller left
// outside its own tests. As with app_state, the CREATE in the baseline stays so
// the chain replays from scratch.
func migrateDropTimerSessions(tx *sql.Tx) error {
	_, err := tx.Exec(`DROP TABLE IF EXISTS timer_sessions`)
	return err
}

// migrateDropSpecimensAndDeadColumns removes what migration 55 and the
// database relocation left behind.
//
// pokedex_specimens held hand-entered catches before they became ordinary
// pokemon rows; migration 55 moved them and kept the table as a safety copy,
// which has served its purpose.
//
// app_config.data_path and settings.config_path are written on every save and
// discarded on every load: the data path is derived from the directory the
// database was opened in, and the config path is read from the pointer
// state.json before the database exists. The Go fields stay, only the columns
// go. Errors are swallowed the way the other column drops in this file do, so
// a re-run on a database that never had them is a no-op.
func migrateDropSpecimensAndDeadColumns(tx *sql.Tx) error {
	if _, err := tx.Exec(`DROP TABLE IF EXISTS pokedex_specimens`); err != nil {
		return err
	}
	_, _ = tx.Exec(`ALTER TABLE app_config DROP COLUMN data_path`)
	_, _ = tx.Exec(`ALTER TABLE settings DROP COLUMN config_path`)
	return nil
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
		// Legacy ui_animations column kept for migration #14 to drop later.
		`ALTER TABLE settings ADD COLUMN ui_animations INTEGER NOT NULL DEFAULT 1`,
		`ALTER TABLE pokemon ADD COLUMN hunt_mode TEXT NOT NULL DEFAULT 'both'`,
		`ALTER TABLE template_regions ADD COLUMN is_negative INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE pokedex_forms ADD COLUMN form_names_json TEXT NOT NULL DEFAULT '{}'`,
		`ALTER TABLE pokemon ADD COLUMN base_name TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE pokemon ADD COLUMN form_name TEXT NOT NULL DEFAULT ''`,
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
		// Legacy ui_animations column kept for migration #14 to drop later.
		`ALTER TABLE settings ADD COLUMN ui_animations INTEGER NOT NULL DEFAULT 1`,
		`ALTER TABLE pokemon ADD COLUMN hunt_mode TEXT NOT NULL DEFAULT 'both'`,
		`ALTER TABLE template_regions ADD COLUMN is_negative INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE pokedex_forms ADD COLUMN form_names_json TEXT NOT NULL DEFAULT '{}'`,
		`ALTER TABLE pokemon ADD COLUMN base_name TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE pokemon ADD COLUMN form_name TEXT NOT NULL DEFAULT ''`,
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

// migrateAddAccentColor introduces the accent_color preset column on settings
// and removes the legacy ui_animations toggle. UI animations are no longer
// configurable in the main app — overlay animations are controlled separately
// via OverlaySettings.background_animation. The replacement is a preset accent
// color that themes the main UI.
func migrateAddAccentColor(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE settings ADD COLUMN accent_color TEXT NOT NULL DEFAULT 'blue'`)
	_, _ = tx.Exec(`ALTER TABLE settings DROP COLUMN ui_animations`)
	return nil
}

// migrateAddFormNameFields adds form name columns to the pokemon and
// pokedex_forms tables so base name and form descriptor can be stored
// separately from the combined display name.
func migrateAddFormNameFields(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE pokedex_forms ADD COLUMN form_names_json TEXT NOT NULL DEFAULT '{}'`)
	_, _ = tx.Exec(`ALTER TABLE pokemon ADD COLUMN base_name TEXT NOT NULL DEFAULT ''`)
	_, _ = tx.Exec(`ALTER TABLE pokemon ADD COLUMN form_name TEXT NOT NULL DEFAULT ''`)
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
// migrateAddPokemonSprites creates the pokemon_sprites table on databases that
// predate it. New databases get the table from the baseline schema; this
// migration brings existing ones up to date. The definition mirrors schema.go.
func migrateAddPokemonSprites(tx *sql.Tx) error {
	_, err := tx.Exec(`CREATE TABLE IF NOT EXISTS pokemon_sprites (
		pokemon_id TEXT PRIMARY KEY,
		data       BLOB NOT NULL,
		mime       TEXT NOT NULL,
		updated_at TEXT NOT NULL DEFAULT '',
		FOREIGN KEY (pokemon_id) REFERENCES pokemon(id) ON DELETE CASCADE
	)`)
	if err != nil {
		return fmt.Errorf("create pokemon_sprites table: %w", err)
	}
	return nil
}

// migrateAddCaptureResolutions creates the capture_resolutions table on
// databases that predate per-device capture resolution. New databases get it
// from the baseline schema; this brings existing ones up to date. Mirrors
// schema.go.
func migrateAddCaptureResolutions(tx *sql.Tx) error {
	_, err := tx.Exec(`CREATE TABLE IF NOT EXISTS capture_resolutions (
		device_key TEXT PRIMARY KEY,
		resolution TEXT NOT NULL DEFAULT ''
	)`)
	if err != nil {
		return fmt.Errorf("create capture_resolutions table: %w", err)
	}
	return nil
}

// migrateAddTemplateHysteresisMode adds the nullable hysteresis_mode column
// to detector_templates. NULL means the legacy score-based hysteresis exit;
// the frontend detection engine interprets the value. The ALTER TABLE error
// is ignored because the column may already exist on fresh databases.
func migrateAddTemplateHysteresisMode(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE detector_templates ADD COLUMN hysteresis_mode TEXT`)
	return nil
}

func migrateAddPokemonNickname(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE pokemon ADD COLUMN nickname TEXT NOT NULL DEFAULT ''`)
	return nil
}

// migrateRemapAccentColorPresets normalizes stored accent color presets for
// the Tempest palette (violet, acid, crimson, cyan, blue, green, pink,
// orange). The old blue, green, pink, orange and cyan keys stay valid with
// Tempest-adapted values; purple maps to violet, and anything unknown falls
// back to the new default violet.
func migrateRemapAccentColorPresets(tx *sql.Tx) error {
	if _, err := tx.Exec(`UPDATE settings SET accent_color = 'violet'
		WHERE accent_color NOT IN
		('violet', 'acid', 'crimson', 'cyan', 'blue', 'green', 'pink', 'orange')`); err != nil {
		return fmt.Errorf("remap accent_color presets: %w", err)
	}
	return nil
}

// migrateReplaceRemovedBgAnimations rewrites background animations that no
// longer exist. The rb-aurora, rb-galaxy, rb-silk and rb-pixelblast animations
// were rendered by an external WebGL library that has been dropped; the CSS
// based "waves" animation is the closest surviving option and matches the
// built-in default overlay. This touches every owner row, global and
// per-pokemon alike.
func migrateReplaceRemovedBgAnimations(tx *sql.Tx) error {
	if _, err := tx.Exec(`UPDATE overlay_settings SET background_animation = 'waves'
		WHERE background_animation IN
		('rb-aurora', 'rb-galaxy', 'rb-silk', 'rb-pixelblast')`); err != nil {
		return fmt.Errorf("replace removed background animations: %w", err)
	}
	return nil
}

// migrateAddTemplateCalibration adds the calibration column to
// detector_templates. It stores an opaque JSON blob computed by the frontend
// stability analysis. Errors are ignored because the column may already exist
// on fresh databases.
func migrateAddTemplateCalibration(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE detector_templates ADD COLUMN calibration TEXT`)
	return nil
}

// migrateAddTemplateDetectionSettings adds nullable per-template precision and
// hysteresis columns to detector_templates, then backfills existing rows from
// the owning hunt's detector_configs so template behaviour does not change for
// existing data. ALTER TABLE duplicate-column errors are ignored because the
// columns may already exist on fresh databases; backfill errors are returned.
func migrateAddTemplateDetectionSettings(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE detector_templates ADD COLUMN precision_val REAL`)
	_, _ = tx.Exec(`ALTER TABLE detector_templates ADD COLUMN hysteresis_factor REAL`)
	if _, err := tx.Exec(`UPDATE detector_templates SET
		precision_val = (SELECT precision_val FROM detector_configs WHERE detector_configs.pokemon_id = detector_templates.pokemon_id),
		hysteresis_factor = (SELECT hysteresis_factor FROM detector_configs WHERE detector_configs.pokemon_id = detector_templates.pokemon_id)
		WHERE precision_val IS NULL`); err != nil {
		return fmt.Errorf("backfill per-template detection settings: %w", err)
	}
	return nil
}

// migrateAddTemplatePollingSettings adds nullable per-template cooldown,
// consecutive-hits and adaptive-polling columns to detector_templates, then
// backfills existing rows from the owning hunt's detector_configs (still
// physically present) so existing hunts keep their effective runtime
// behaviour after the hunt-level settings are removed from the Go layer.
// ALTER TABLE duplicate-column errors are ignored (columns may already exist
// on fresh databases); backfill errors are returned.
func migrateAddTemplatePollingSettings(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE detector_templates ADD COLUMN consecutive_hits INTEGER`)
	_, _ = tx.Exec(`ALTER TABLE detector_templates ADD COLUMN cooldown_sec INTEGER`)
	_, _ = tx.Exec(`ALTER TABLE detector_templates ADD COLUMN poll_interval_ms INTEGER`)
	_, _ = tx.Exec(`ALTER TABLE detector_templates ADD COLUMN min_poll_ms INTEGER`)
	_, _ = tx.Exec(`ALTER TABLE detector_templates ADD COLUMN max_poll_ms INTEGER`)
	if _, err := tx.Exec(`UPDATE detector_templates SET
		consecutive_hits = (SELECT consecutive_hits FROM detector_configs WHERE detector_configs.pokemon_id = detector_templates.pokemon_id),
		cooldown_sec = (SELECT cooldown_sec FROM detector_configs WHERE detector_configs.pokemon_id = detector_templates.pokemon_id),
		poll_interval_ms = (SELECT poll_interval_ms FROM detector_configs WHERE detector_configs.pokemon_id = detector_templates.pokemon_id),
		min_poll_ms = (SELECT min_poll_ms FROM detector_configs WHERE detector_configs.pokemon_id = detector_templates.pokemon_id),
		max_poll_ms = (SELECT max_poll_ms FROM detector_configs WHERE detector_configs.pokemon_id = detector_templates.pokemon_id)
		WHERE consecutive_hits IS NULL`); err != nil {
		return fmt.Errorf("backfill per-template polling settings: %w", err)
	}
	return nil
}

// migrateAddRegionCategory adds the category column to template_regions on
// databases that predate per-category counting. Without it, region categories
// set in the editor are dropped on save/load and every region collapses to the
// default category, making the detector cooldown behave globally.
func migrateAddRegionCategory(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE template_regions ADD COLUMN category TEXT NOT NULL DEFAULT ''`)
	return nil
}

// migrateAddDetectionLogCategory adds the category column to detection_log so
// confirmed matches can record which counting category fired.
func migrateAddDetectionLogCategory(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE detection_log ADD COLUMN category TEXT NOT NULL DEFAULT ''`)
	return nil
}

func migrateAddShinyCharm(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE pokemon ADD COLUMN shiny_charm INTEGER NOT NULL DEFAULT 0`)
	return nil
}

// migrateAddShinyVariant adds the shiny_variant column to the pokemon table.
// Databases predating the Sword/Shield star/square distinction have no place to
// store it, so the value would be dropped on every save. The duplicate-column
// error is ignored because fresh databases already carry the column.
func migrateAddShinyVariant(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE pokemon ADD COLUMN shiny_variant TEXT NOT NULL DEFAULT ''`)
	return nil
}

// migrateAddEntrySource adds the entry_source column to the pokemon table.
// Databases predating hand-entered catches have no place to store the marker,
// so the value would be dropped on every save. The duplicate-column error is
// ignored because fresh databases already carry the column.
func migrateAddEntrySource(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE pokemon ADD COLUMN entry_source TEXT NOT NULL DEFAULT ''`)
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

// migrateAddFormSpriteSlug adds the sprite_slug column to pokedex_forms.
// The column stores the name-based sprite identifier (e.g. "201-b") for
// cosmetic forms that have no dedicated pokemon entry in PokéAPI and thus
// no numeric sprite ID. Errors are ignored for idempotency because SQLite
// does not support IF NOT EXISTS for ADD COLUMN.
func migrateAddFormSpriteSlug(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE pokedex_forms ADD COLUMN sprite_slug TEXT NOT NULL DEFAULT ''`)
	return nil
}

// migrateAddHuntToggleHotkey adds the hunt_toggle column to the hotkeys table
// so users can bind a global shortcut that starts or stops the current hunt
// (timer + detector) for the active Pokémon. Errors are ignored for
// idempotency because SQLite does not support IF NOT EXISTS on ADD COLUMN.
func migrateAddHuntToggleHotkey(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE hotkeys ADD COLUMN hunt_toggle TEXT NOT NULL DEFAULT ''`)
	return nil
}

// migrateAddPokemonGroupsAndTags introduces organizational grouping for
// Pokémon. It creates the pokemon_groups and pokemon_tags tables, adds an
// index on pokemon_tags.tag for filter lookups, and appends a group_id column
// to the existing pokemon table. CREATE TABLE and CREATE INDEX use IF NOT
// EXISTS for idempotency; the ADD COLUMN call tolerates the duplicate-column
// error that SQLite returns on re-runs since ALTER TABLE has no IF NOT EXISTS.
func migrateAddPokemonGroupsAndTags(tx *sql.Tx) error {
	if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS pokemon_groups (
		id         TEXT PRIMARY KEY,
		name       TEXT NOT NULL,
		color      TEXT NOT NULL DEFAULT '',
		sort_order INTEGER NOT NULL DEFAULT 0,
		collapsed  INTEGER NOT NULL DEFAULT 0
	)`); err != nil {
		return fmt.Errorf("create pokemon_groups: %w", err)
	}
	if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS pokemon_tags (
		pokemon_id TEXT NOT NULL,
		tag        TEXT NOT NULL,
		PRIMARY KEY (pokemon_id, tag),
		FOREIGN KEY (pokemon_id) REFERENCES pokemon(id) ON DELETE CASCADE
	)`); err != nil {
		return fmt.Errorf("create pokemon_tags: %w", err)
	}
	if _, err := tx.Exec(`CREATE INDEX IF NOT EXISTS idx_pokemon_tags_tag ON pokemon_tags(tag)`); err != nil {
		return fmt.Errorf("create idx_pokemon_tags_tag: %w", err)
	}
	// ALTER TABLE ADD COLUMN has no IF NOT EXISTS in SQLite; ignore the
	// duplicate-column error that occurs when the migration is re-run on a
	// database whose baseline already contained the column.
	_, _ = tx.Exec(`ALTER TABLE pokemon ADD COLUMN group_id TEXT NOT NULL DEFAULT ''`)
	return nil
}

// migrateAddOverlayElementFormat adds the format column to overlay_elements
// so odds-element rows can persist their display format ("fractional" or
// "percent"). Errors are ignored for idempotency because SQLite does not
// support IF NOT EXISTS on ADD COLUMN.
func migrateAddOverlayElementFormat(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE overlay_elements ADD COLUMN format TEXT NOT NULL DEFAULT ''`)
	return nil
}

// migrateAddPhasing introduces shiny hunt phasing. It appends the phase_of and
// phase_number columns to the pokemon table and creates the phase_targets table
// holding the species a hunter expects as off-target shinies. CREATE TABLE uses
// IF NOT EXISTS for idempotency; the ADD COLUMN calls tolerate the
// duplicate-column error that SQLite returns on re-runs since ALTER TABLE has
// no IF NOT EXISTS.
func migrateAddPhasing(tx *sql.Tx) error {
	if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS phase_targets (
		pokemon_id     TEXT    NOT NULL,
		canonical_name TEXT    NOT NULL,
		name           TEXT    NOT NULL DEFAULT '',
		sprite_url     TEXT    NOT NULL DEFAULT '',
		sort_order     INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (pokemon_id, canonical_name),
		FOREIGN KEY (pokemon_id) REFERENCES pokemon(id) ON DELETE CASCADE
	)`); err != nil {
		return fmt.Errorf("create phase_targets: %w", err)
	}
	_, _ = tx.Exec(`ALTER TABLE pokemon ADD COLUMN phase_of TEXT NOT NULL DEFAULT ''`)
	_, _ = tx.Exec(`ALTER TABLE pokemon ADD COLUMN phase_number INTEGER NOT NULL DEFAULT 0`)
	return nil
}

// migrateAddSpriteCycling adds the cycle_phase_targets and cycle_interval_ms
// columns to overlay_elements so sprite rows can persist the rotation through
// the phase targets of a hunt. Both columns stay nullable like the other
// sprite-only columns: rows of every other element type leave them NULL.
// Errors are ignored for idempotency because SQLite does not support
// IF NOT EXISTS on ADD COLUMN.
func migrateAddSpriteCycling(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE overlay_elements ADD COLUMN cycle_phase_targets INTEGER`)
	_, _ = tx.Exec(`ALTER TABLE overlay_elements ADD COLUMN cycle_interval_ms INTEGER`)
	return nil
}

// migrateAddSpriteCycleTransition adds the cycle_transition column to
// overlay_elements so a sprite row can persist which effect a swap plays while
// cycling. The column stays nullable like the other sprite-only columns: rows
// of every other element type leave it NULL, and existing sprite rows read as
// "", which resolves to the crossfade they behaved like.
// Errors are ignored for idempotency because SQLite does not support
// IF NOT EXISTS on ADD COLUMN.
func migrateAddSpriteCycleTransition(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE overlay_elements ADD COLUMN cycle_transition TEXT`)
	return nil
}

// migrateAddCatchMeta adds the catch_meta column to pokemon so a finished hunt
// can carry the optional details recorded for its catch (location, nature,
// ability, ball, mark, level, individual values, ribbons) as one JSON blob.
// The empty string means "nothing recorded", which is what every row predating
// the feature reads as.
// Errors are ignored for idempotency because SQLite does not support
// IF NOT EXISTS on ADD COLUMN.
func migrateAddCatchMeta(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE pokemon ADD COLUMN catch_meta TEXT NOT NULL DEFAULT ''`)
	return nil
}

// migrateAddPrefixSuffixText adds the prefix_text and suffix_text columns to
// overlay_elements so the label-bearing text rows can persist affixes rendered
// inline with their value. Both columns stay nullable like label_text: rows of
// every other element type leave them NULL, and existing rows read as "".
// Errors are ignored for idempotency because SQLite does not support
// IF NOT EXISTS on ADD COLUMN.
func migrateAddPrefixSuffixText(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE overlay_elements ADD COLUMN prefix_text TEXT`)
	_, _ = tx.Exec(`ALTER TABLE overlay_elements ADD COLUMN suffix_text TEXT`)
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

// migrateDropTriggerExit removes the trigger_exit column from overlay_elements.
// No renderer ever read the value and no editor control ever set it, so every
// row only carried the default. The DROP COLUMN error is ignored for
// idempotency: databases created after this migration never had the column.
func migrateDropTriggerExit(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE overlay_elements DROP COLUMN trigger_exit`)
	return nil
}

// migrateDropShadowGradient removes the gradient drop shadow, which CSS
// text-shadow cannot paint: the renderer only ever used the first stop. Styles
// that stored a gradient shadow keep the colour they showed, so the first stop
// is copied into text_shadow_color before the shadow stops and the three
// gradient columns are removed. DROP COLUMN errors are ignored for idempotency
// because databases created after this migration never had the columns; the
// backfill and the cleanup delete report their errors.
func migrateDropShadowGradient(tx *sql.Tx) error {
	hasColorType, err := columnExists(tx, "text_styles", "text_shadow_color_type")
	if err != nil {
		return err
	}
	// A database created after this migration never had the column, so there is
	// no stored gradient shadow left to rescue.
	if !hasColorType {
		return nil
	}
	// Only touch rows that actually stored a gradient shadow with stops, so a
	// solid shadow keeps its own colour.
	if _, err := tx.Exec(`UPDATE text_styles SET text_shadow_color = (
			SELECT color FROM gradient_stops
			WHERE gradient_stops.text_style_id = text_styles.id
			  AND gradient_stops.gradient_type = 'shadow'
			ORDER BY gradient_stops.sort_order LIMIT 1)
		WHERE text_shadow_color_type = 'gradient'
		  AND EXISTS (
			SELECT 1 FROM gradient_stops
			WHERE gradient_stops.text_style_id = text_styles.id
			  AND gradient_stops.gradient_type = 'shadow')`); err != nil {
		return fmt.Errorf("fold shadow gradient into text_shadow_color: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM gradient_stops WHERE gradient_type = 'shadow'`); err != nil {
		return fmt.Errorf("delete shadow gradient stops: %w", err)
	}
	_, _ = tx.Exec(`ALTER TABLE text_styles DROP COLUMN text_shadow_color_type`)
	_, _ = tx.Exec(`ALTER TABLE text_styles DROP COLUMN text_shadow_gradient_angle`)
	return nil
}

// migrateAddFormGender adds the gender column to pokedex_forms. The column
// restricts a form to a single gender's appearance ("male" or "female"); an
// empty string (the default) means the form does not depend on gender. Errors
// are ignored for idempotency because SQLite does not support IF NOT EXISTS
// on ADD COLUMN.
func migrateAddFormGender(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE pokedex_forms ADD COLUMN gender TEXT NOT NULL DEFAULT ''`)
	return nil
}

// migrateAddPokedexOverrides creates the pokedex_overrides table and its
// species index so users can manually mark species/forms as caught or seen
// outside of what encounter tracking already implies. The table intentionally
// carries no foreign key: the pokedex sync deletes and reinserts
// pokedex_species and pokedex_forms on every run, which would either
// cascade-delete these user-entered overrides or break the sync outright.
func migrateAddPokedexOverrides(tx *sql.Tx) error {
	if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS pokedex_overrides (
		id              INTEGER PRIMARY KEY AUTOINCREMENT,
		species_id      INTEGER NOT NULL,
		form_canonical  TEXT    NOT NULL DEFAULT '',
		gender          TEXT    NOT NULL DEFAULT '',
		game            TEXT    NOT NULL DEFAULT '',
		caught          INTEGER NOT NULL DEFAULT 0,
		seen            INTEGER NOT NULL DEFAULT 0,
		created_at      TEXT    NOT NULL DEFAULT '',
		updated_at      TEXT    NOT NULL DEFAULT '',
		UNIQUE (species_id, form_canonical, gender, game)
	)`); err != nil {
		return fmt.Errorf("create pokedex_overrides: %w", err)
	}
	if _, err := tx.Exec(`CREATE INDEX IF NOT EXISTS idx_pokedex_overrides_species ON pokedex_overrides(species_id)`); err != nil {
		return fmt.Errorf("create idx_pokedex_overrides_species: %w", err)
	}
	return nil
}

// migrateAddOverrideMeta adds the meta_json column to pokedex_overrides so a
// manual override can optionally carry the same catch details recorded for a
// real hunt (location, ball, level, nature, ability, mark, individual values,
// ribbons), JSON-encoded. The default '{}' means "no metadata recorded",
// which is what every row predating the feature reads as. Errors are ignored
// for idempotency because SQLite does not support IF NOT EXISTS on ADD
// COLUMN, and fresh databases already get the column from the baseline
// schema.
func migrateAddOverrideMeta(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE pokedex_overrides ADD COLUMN meta_json TEXT NOT NULL DEFAULT '{}'`)
	return nil
}

// migrateAddFailed adds the failed column to the pokemon table. Errors are
// ignored for idempotency.
func migrateAddFailed(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE pokemon ADD COLUMN failed INTEGER NOT NULL DEFAULT 0`)
	return nil
}

// migrateAddUserPokedexes adds the user-owned Pokédex layer beside the global
// synced catalogue and assigns every existing hunt/catch to the Living Dex.
func migrateAddUserPokedexes(tx *sql.Tx) error {
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS user_pokedexes (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		show_forms INTEGER NOT NULL DEFAULT 1,
		generations_json TEXT NOT NULL DEFAULT '[]',
		target_games_json TEXT NOT NULL DEFAULT '[]',
		catch_games_json TEXT NOT NULL DEFAULT '[]',
		form_categories_json TEXT NOT NULL DEFAULT '["regional","mega","gigantamax","gender","cosmetic","other"]',
		include_species_json TEXT NOT NULL DEFAULT '[]',
		exclude_species_json TEXT NOT NULL DEFAULT '[]',
		created_at TEXT NOT NULL DEFAULT '',
		updated_at TEXT NOT NULL DEFAULT ''
	)`); err != nil {
		return fmt.Errorf("create user_pokedexes: %w", err)
	}
	if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS pokedex_pokemon (
		pokedex_id TEXT NOT NULL,
		pokemon_id TEXT NOT NULL,
		PRIMARY KEY (pokedex_id, pokemon_id),
		FOREIGN KEY (pokedex_id) REFERENCES user_pokedexes(id) ON DELETE CASCADE,
		FOREIGN KEY (pokemon_id) REFERENCES pokemon(id) ON DELETE CASCADE
	)`); err != nil {
		return fmt.Errorf("create pokedex_pokemon: %w", err)
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO user_pokedexes
		(id, name, show_forms, created_at, updated_at) VALUES ('default', 'Living Dex', 1, ?, ?)`, now, now); err != nil {
		return fmt.Errorf("seed Living Dex: %w", err)
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO pokedex_pokemon (pokedex_id, pokemon_id)
		SELECT 'default', id FROM pokemon`); err != nil {
		return fmt.Errorf("assign existing pokemon to Living Dex: %w", err)
	}
	var hasOverrides int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='pokedex_overrides'`).Scan(&hasOverrides); err != nil {
		return err
	}
	hasPokedexID, err := columnExists(tx, "pokedex_overrides", "pokedex_id")
	if err != nil {
		return err
	}
	if hasOverrides == 0 {
		if err := migrateAddPokedexOverrides(tx); err != nil {
			return err
		}
		_, _ = tx.Exec(`ALTER TABLE pokedex_overrides ADD COLUMN pokedex_id TEXT NOT NULL DEFAULT 'default'`)
	} else if !hasPokedexID {
		if _, err := tx.Exec(`ALTER TABLE pokedex_overrides RENAME TO pokedex_overrides_legacy`); err != nil {
			return err
		}
		if _, err := tx.Exec(`CREATE TABLE pokedex_overrides (
			id INTEGER PRIMARY KEY AUTOINCREMENT, pokedex_id TEXT NOT NULL DEFAULT 'default', species_id INTEGER NOT NULL,
			form_canonical TEXT NOT NULL DEFAULT '', gender TEXT NOT NULL DEFAULT '', game TEXT NOT NULL DEFAULT '',
			caught INTEGER NOT NULL DEFAULT 0, seen INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '',
			updated_at TEXT NOT NULL DEFAULT '', meta_json TEXT NOT NULL DEFAULT '{}',
			UNIQUE (pokedex_id, species_id, form_canonical, gender, game))`); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO pokedex_overrides (id,species_id,form_canonical,gender,game,caught,seen,created_at,updated_at,meta_json)
			SELECT id,species_id,form_canonical,gender,game,caught,seen,created_at,updated_at,meta_json FROM pokedex_overrides_legacy`); err != nil {
			return err
		}
		if _, err := tx.Exec(`DROP TABLE pokedex_overrides_legacy`); err != nil {
			return err
		}
	}
	_, err = tx.Exec(`CREATE INDEX IF NOT EXISTS idx_pokedex_overrides_species ON pokedex_overrides(species_id)`)
	if err != nil {
		return err
	}
	return nil
}

func migrateAddPokedexSpeciesGames(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE pokedex_species ADD COLUMN games_json TEXT NOT NULL DEFAULT '[]'`)
	return migrateForcePokedexResync(tx)
}

func migrateAddPokedexEvolutionLinks(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE pokedex_species ADD COLUMN evolves_from_id INTEGER NOT NULL DEFAULT 0`)
	return migrateForcePokedexResync(tx)
}

// migrateAddPokedexSpecimens turns each legacy caught override into one
// addressable manual specimen. source_override_id makes retries idempotent and
// retains enough provenance to reconstruct the old caught flag if needed.
func migrateAddPokedexSpecimens(tx *sql.Tx) error {
	if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS pokedex_specimens (
		id INTEGER PRIMARY KEY AUTOINCREMENT, pokedex_id TEXT NOT NULL DEFAULT 'default',
		species_id INTEGER NOT NULL, form_canonical TEXT NOT NULL DEFAULT '',
		gender TEXT NOT NULL DEFAULT '', game TEXT NOT NULL DEFAULT '',
		meta_json TEXT NOT NULL DEFAULT '{}', source_override_id INTEGER UNIQUE,
		created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')`); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO pokedex_specimens
		(pokedex_id,species_id,form_canonical,gender,game,meta_json,source_override_id,created_at,updated_at)
		SELECT pokedex_id,species_id,form_canonical,gender,game,meta_json,id,created_at,updated_at
		FROM pokedex_overrides WHERE caught=1`); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE pokedex_overrides SET caught=0 WHERE caught=1 AND seen=1`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM pokedex_overrides WHERE caught=1 AND seen=0`); err != nil {
		return err
	}
	_, err := tx.Exec(`CREATE INDEX IF NOT EXISTS idx_pokedex_specimens_species ON pokedex_specimens(species_id)`)
	return err
}

func migrateAddPokedexSpecimenHuntDetails(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE pokedex_specimens ADD COLUMN completed_at TEXT NOT NULL DEFAULT ''`)
	_, _ = tx.Exec(`ALTER TABLE pokedex_specimens ADD COLUMN hunt_type TEXT NOT NULL DEFAULT ''`)
	_, _ = tx.Exec(`ALTER TABLE pokedex_specimens ADD COLUMN encounters INTEGER NOT NULL DEFAULT 0`)
	_, _ = tx.Exec(`ALTER TABLE pokedex_specimens ADD COLUMN timer_accumulated_ms INTEGER NOT NULL DEFAULT 0`)
	return nil
}

// migrateAddPokedexSpecimenPhases adds the phase link columns to the manual
// specimen table so a specimen can be recorded as a phase of another specimen,
// the same way a real hunt carries phase_of and phase_number. Databases
// predating the link have no place to store it, so the parent would be dropped
// on every save. The duplicate-column errors are ignored because fresh
// databases already carry the columns from schema.go. The index error is
// returned: CREATE INDEX IF NOT EXISTS is idempotent, so anything it reports is
// a real failure worth surfacing.
func migrateAddPokedexSpecimenPhases(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE pokedex_specimens ADD COLUMN phase_of INTEGER NOT NULL DEFAULT 0`)
	_, _ = tx.Exec(`ALTER TABLE pokedex_specimens ADD COLUMN phase_number INTEGER NOT NULL DEFAULT 0`)
	_, err := tx.Exec(`CREATE INDEX IF NOT EXISTS idx_pokedex_specimens_phase_of ON pokedex_specimens(phase_of)`)
	return err
}

// migrateGenderOwnership adds gender to catches and phase targets, adds the
// upstream gender rate to species, and moves legacy catch metadata gender to
// its owning Pokemon row.
func migrateGenderOwnership(tx *sql.Tx) error {
	_, _ = tx.Exec(`ALTER TABLE pokemon ADD COLUMN gender TEXT NOT NULL DEFAULT ''`)
	_, _ = tx.Exec(`ALTER TABLE phase_targets ADD COLUMN gender TEXT NOT NULL DEFAULT ''`)
	_, _ = tx.Exec(`ALTER TABLE pokedex_species ADD COLUMN gender_rate INTEGER NOT NULL DEFAULT -2`)
	if _, err := tx.Exec(`UPDATE pokemon
		SET gender = CASE json_extract(catch_meta, '$.gender')
			WHEN 'male' THEN 'male'
			WHEN 'female' THEN 'female'
			WHEN 'genderless' THEN 'genderless'
			ELSE '' END
		WHERE gender = '' AND json_valid(catch_meta)`); err != nil {
		return fmt.Errorf("backfill pokemon gender: %w", err)
	}
	if _, err := tx.Exec(`UPDATE pokemon
		SET catch_meta = CASE
			WHEN json_remove(catch_meta, '$.gender') IN ('{}', '{"ribbons":[]}') THEN ''
			ELSE json_remove(catch_meta, '$.gender') END
		WHERE json_valid(catch_meta) AND json_type(catch_meta, '$.gender') IS NOT NULL`); err != nil {
		return fmt.Errorf("remove legacy catch metadata gender: %w", err)
	}
	hasGenderForms, err := columnExists(tx, "pokedex_forms", "gender")
	if err != nil {
		return err
	}
	if !hasGenderForms {
		return nil
	}
	// Older clients persisted a gender-specific sprite as though it were a
	// form. Move that visual variant back onto the species identity before the
	// following migration refreshes the Pokédex tables.
	if _, err := tx.Exec(`UPDATE pokemon
		SET gender = CASE WHEN gender = '' THEN (SELECT f.gender FROM pokedex_forms f WHERE f.canonical = pokemon.canonical_name LIMIT 1) ELSE gender END,
			canonical_name = (SELECT s.canonical FROM pokedex_forms f JOIN pokedex_species s ON s.id = f.species_id WHERE f.canonical = pokemon.canonical_name LIMIT 1),
			name = CASE WHEN base_name <> '' THEN base_name ELSE name END,
			base_name = '', form_name = ''
		WHERE EXISTS (SELECT 1 FROM pokedex_forms f WHERE f.canonical = pokemon.canonical_name AND f.gender <> '')`); err != nil {
		return fmt.Errorf("normalize pokemon gender forms: %w", err)
	}
	if _, err := tx.Exec(`UPDATE phase_targets
		SET gender = CASE WHEN gender = '' THEN (SELECT f.gender FROM pokedex_forms f WHERE f.canonical = phase_targets.canonical_name LIMIT 1) ELSE gender END,
			canonical_name = (SELECT s.canonical FROM pokedex_forms f JOIN pokedex_species s ON s.id = f.species_id WHERE f.canonical = phase_targets.canonical_name LIMIT 1)
		WHERE EXISTS (SELECT 1 FROM pokedex_forms f WHERE f.canonical = phase_targets.canonical_name AND f.gender <> '')`); err != nil {
		return fmt.Errorf("normalize phase target gender forms: %w", err)
	}
	return nil
}

// columnExists reports whether a table carries the given column. SQLite has no
// IF EXISTS for columns, so migrations that have to read a column before
// dropping it ask the schema first instead of relying on a swallowed error.
func columnExists(tx *sql.Tx, table, column string) (bool, error) {
	rows, err := tx.Query(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`, table, column)
	if err != nil {
		return false, fmt.Errorf("pragma_table_info(%s): %w", table, err)
	}
	defer func() { _ = rows.Close() }()
	found := rows.Next()
	return found, rows.Err()
}

// ---------------------------------------------------------------------------
// Migration 55: manual Pokédex specimens become ordinary hunt entries
// ---------------------------------------------------------------------------

// specimenRow is one pokedex_specimens row joined with the Pokédex name tables,
// carrying everything migrateSpecimensToPokemon needs to write the matching
// pokemon row without going back to the database per field.
type specimenRow struct {
	id                 int64
	pokedexID          string
	speciesID          int
	formCanonical      string
	gender             string
	game               string
	completedAt        string
	huntType           string
	encounters         int
	timerAccumulatedMs int64
	phaseOf            int64
	phaseNumber        int
	metaJSON           string
	createdAt          string
	// speciesCanonical is invalid when no pokedex_species row matches, which
	// is the normal state of a database whose Pokédex sync never ran.
	speciesCanonical sql.NullString
	speciesName      string
	formName         string
	formLabel        string
}

// migrateSpecimensToPokemon rewrites every manually recorded Pokédex specimen
// as a completed hunt in the pokemon table, which is the only catch model the
// application still knows about.
//
// The work is a Go loop rather than a single INSERT ... SELECT because SQLite
// cannot mint the uuid a pokemon row needs as its primary key, and because the
// phase links have to be remapped through those freshly minted ids.
//
// pokedex_specimens is read but never touched: it stays behind as the safety
// net for this release, and the count of already migrated rows makes a rerun
// (a restored backup, a repeated upgrade) a no-op instead of a duplicate.
func migrateSpecimensToPokemon(tx *sql.Tx) error {
	var migrated int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM pokemon WHERE entry_source='manual'`).Scan(&migrated); err != nil {
		return fmt.Errorf("count migrated specimens: %w", err)
	}
	if migrated > 0 {
		return nil
	}

	ids, err := mintSpecimenIDs(tx)
	if err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}

	language, err := specimenLanguage(tx)
	if err != nil {
		return err
	}
	rows, err := readSpecimens(tx, language)
	if err != nil {
		return err
	}
	var sortOrder int
	if err := tx.QueryRow(`SELECT COALESCE(MAX(sort_order), -1) + 1 FROM pokemon`).Scan(&sortOrder); err != nil {
		return fmt.Errorf("read highest pokemon sort order: %w", err)
	}

	for i, row := range rows {
		if err := insertSpecimenAsPokemon(tx, row, ids, language, sortOrder+i); err != nil {
			return err
		}
	}
	return nil
}

// mintSpecimenIDs assigns one uuid to every specimen id, in id order. The whole
// map is built before the first insert so a phase can point at a parent that
// has not been written yet.
func mintSpecimenIDs(tx *sql.Tx) (map[int64]string, error) {
	rows, err := tx.Query(`SELECT id FROM pokedex_specimens ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("list specimen ids: %w", err)
	}
	defer func() { _ = rows.Close() }()

	ids := map[int64]string{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan specimen id: %w", err)
		}
		ids[id] = uuid.NewString()
	}
	return ids, rows.Err()
}

// specimenLanguage returns the language the migrated names are resolved in: the
// user's primary display language, or English when none is configured. The
// empty case has to be caught here because '$.' is not a valid JSON path and
// would fail the whole migration.
func specimenLanguage(tx *sql.Tx) (string, error) {
	var language string
	err := tx.QueryRow(`SELECT language FROM settings_languages ORDER BY sort_order, id LIMIT 1`).Scan(&language)
	if errors.Is(err, sql.ErrNoRows) || language == "" {
		return "en", nil
	}
	if err != nil {
		return "", fmt.Errorf("read primary language: %w", err)
	}
	return language, nil
}

// readSpecimens loads every specimen together with its localized species and
// form names. The joins are outer joins on purpose: a specimen whose species is
// unknown must still be migrated, and dropping it would destroy user data.
func readSpecimens(tx *sql.Tx, language string) ([]specimenRow, error) {
	rows, err := tx.Query(`SELECT s.id, s.pokedex_id, s.species_id, s.form_canonical, s.gender, s.game,
			s.completed_at, s.hunt_type, s.encounters, s.timer_accumulated_ms,
			s.phase_of, s.phase_number, s.meta_json, s.created_at,
			sp.canonical,
			COALESCE(json_extract(sp.names_json, '$.' || ?), json_extract(sp.names_json, '$.en'), ''),
			COALESCE(json_extract(f.names_json, '$.' || ?), json_extract(f.names_json, '$.en'), ''),
			COALESCE(json_extract(f.form_names_json, '$.' || ?), json_extract(f.form_names_json, '$.en'), '')
		FROM pokedex_specimens s
		LEFT JOIN pokedex_species sp ON sp.id = s.species_id
		LEFT JOIN pokedex_forms f ON f.canonical = s.form_canonical AND s.form_canonical <> ''
		ORDER BY s.id`, language, language, language)
	if err != nil {
		return nil, fmt.Errorf("read specimens: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var result []specimenRow
	for rows.Next() {
		var r specimenRow
		if err := rows.Scan(&r.id, &r.pokedexID, &r.speciesID, &r.formCanonical, &r.gender, &r.game,
			&r.completedAt, &r.huntType, &r.encounters, &r.timerAccumulatedMs,
			&r.phaseOf, &r.phaseNumber, &r.metaJSON, &r.createdAt,
			&r.speciesCanonical, &r.speciesName, &r.formName, &r.formLabel); err != nil {
			return nil, fmt.Errorf("scan specimen: %w", err)
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// insertSpecimenAsPokemon writes one specimen as a completed, inactive hunt and
// links it into the Pokédex it was recorded in.
func insertSpecimenAsPokemon(tx *sql.Tx, row specimenRow, ids map[int64]string, language string, sortOrder int) error {
	canonicalName, name, baseName, formName := specimenNames(row)
	completedAt := specimenCompletedAt(row)
	createdAt := completedAt
	if t, err := time.Parse(time.RFC3339, row.createdAt); err == nil {
		createdAt = t
	}
	nickname, shinyVariant, catchMeta := splitSpecimenMeta(row.metaJSON)

	if _, err := tx.Exec(`INSERT INTO pokemon
		(id, name, base_name, form_name, nickname, title, canonical_name, gender, sprite_url, sprite_type,
		 sprite_style, encounters, step, is_active, created_at, language, game,
		 completed_at, overlay_mode, hunt_type, shiny_charm, shiny_variant, entry_source, timer_started_at,
		 timer_accumulated_ms, hunt_mode, group_id, phase_of, phase_number, sort_order, catch_meta, failed)
		VALUES (?, ?, ?, ?, ?, '', ?, ?, '', 'shiny',
		        '', ?, 0, 0, ?, ?, ?,
		        ?, 'default', ?, 0, ?, 'manual', NULL,
		        ?, 'both', '', ?, ?, ?, ?, 0)`,
		ids[row.id], name, baseName, formName, nickname, canonicalName, row.gender,
		row.encounters, createdAt.Format(time.RFC3339), language, row.game,
		completedAt.Format(time.RFC3339), row.huntType, shinyVariant,
		row.timerAccumulatedMs, specimenPhaseParent(row.phaseOf, ids), row.phaseNumber, sortOrder, catchMeta,
	); err != nil {
		return fmt.Errorf("insert specimen %d as pokemon: %w", row.id, err)
	}
	return linkSpecimenPokedex(tx, row.pokedexID, ids[row.id])
}

// specimenNames derives the four name columns of a pokemon row from a specimen.
// A species that resolves to nothing keeps a "#<species id>" placeholder rather
// than being dropped, because an unsynced Pokédex must not cost the user their
// recorded catches.
func specimenNames(row specimenRow) (canonicalName, name, baseName, formName string) {
	if !row.speciesCanonical.Valid {
		return row.formCanonical, fmt.Sprintf("#%d", row.speciesID), "", ""
	}
	speciesName := row.speciesName
	if speciesName == "" {
		speciesName = row.speciesCanonical.String
	}
	if row.formCanonical == "" {
		return row.speciesCanonical.String, speciesName, speciesName, ""
	}
	formName = row.formName
	if formName == "" {
		formName = row.formCanonical
	}
	return row.formCanonical, formName, speciesName, row.formLabel
}

// specimenCompletedAt turns the date-only completion a specimen carries into a
// timestamp at local midnight. A missing or unreadable date falls back to the
// specimen's creation time and finally to now: a pokemon row without a
// completion is a running hunt, which a recorded catch must never become.
func specimenCompletedAt(row specimenRow) time.Time {
	if t, err := time.ParseInLocation("2006-01-02", row.completedAt, time.Local); err == nil {
		return t
	}
	if t, err := time.Parse(time.RFC3339, row.createdAt); err == nil {
		return t
	}
	return time.Now()
}

// splitSpecimenMeta lifts the nickname and the shiny variant out of a specimen's
// metadata blob into their own pokemon columns and returns the remaining
// metadata for catch_meta. The remainder is re-encoded through the same
// state.CatchMeta shape the state loader reads, so a migrated row survives the
// next full save unchanged; a blob holding nothing else becomes "" (no
// metadata), never "{}".
func splitSpecimenMeta(raw string) (nickname, shinyVariant, catchMeta string) {
	var meta state.CatchMeta
	if json.Unmarshal([]byte(raw), &meta) != nil {
		return "", "", ""
	}
	nickname = meta.Nickname
	if meta.ShinyVariant == "star" || meta.ShinyVariant == "square" {
		shinyVariant = meta.ShinyVariant
	}
	meta.Nickname = ""
	meta.ShinyVariant = ""
	if meta.IsEmpty() {
		return nickname, shinyVariant, ""
	}
	if meta.Ribbons == nil {
		meta.Ribbons = []string{}
	}
	encoded, err := json.Marshal(&meta)
	if err != nil {
		return nickname, shinyVariant, ""
	}
	return nickname, shinyVariant, string(encoded)
}

// specimenPhaseParent maps a specimen's phase link onto the minted pokemon ids.
// A link to a specimen that no longer exists keeps pointing at nothing, which is
// exactly the orphaned phase a deleted hunt leaves behind.
func specimenPhaseParent(phaseOf int64, ids map[int64]string) string {
	if phaseOf == 0 {
		return ""
	}
	if id, ok := ids[phaseOf]; ok {
		return id
	}
	return uuid.NewString()
}

// linkSpecimenPokedex records the migrated hunt as a member of the Pokédex the
// specimen belonged to. pokedex_pokemon carries a foreign key on user_pokedexes,
// so a Pokédex that was deleted in the meantime falls back to the default one,
// and a database without even that keeps the hunt without a membership.
func linkSpecimenPokedex(tx *sql.Tx, pokedexID, pokemonID string) error {
	target, ok, err := existingPokedexID(tx, pokedexID)
	if err != nil || !ok {
		return err
	}
	if _, err := tx.Exec(
		`INSERT OR IGNORE INTO pokedex_pokemon (pokedex_id, pokemon_id) VALUES (?, ?)`, target, pokemonID,
	); err != nil {
		return fmt.Errorf("link pokemon %q into pokedex %q: %w", pokemonID, target, err)
	}
	return nil
}

// existingPokedexID resolves the Pokédex a migrated hunt can be attached to,
// preferring the recorded one and falling back to 'default'.
func existingPokedexID(tx *sql.Tx, pokedexID string) (string, bool, error) {
	for _, candidate := range []string{pokedexID, "default"} {
		if candidate == "" {
			continue
		}
		var found string
		err := tx.QueryRow(`SELECT id FROM user_pokedexes WHERE id = ?`, candidate).Scan(&found)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return "", false, fmt.Errorf("look up pokedex %q: %w", candidate, err)
		}
		return found, true, nil
	}
	return "", false, nil
}
