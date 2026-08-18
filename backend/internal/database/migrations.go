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
