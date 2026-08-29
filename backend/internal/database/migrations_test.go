// migrations_test.go verifies the versioned migration system: fresh databases
// get all migrations, already-migrated databases skip completed ones, failures
// roll back cleanly, and the tracking table records versions correctly.
package database

import (
	"database/sql"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// openRawTestDB creates an in-memory SQLite database without running any
// application-level migrations. The caller is responsible for closing it.
func openRawTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open in-memory db: %v", err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// TestRunMigrationsFreshDB verifies that all registered migrations are applied
// to a brand-new database and that the expected tables exist afterwards.
func TestRunMigrationsFreshDB(t *testing.T) {
	db := openRawTestDB(t)

	if err := RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations on fresh DB: %v", err)
	}

	// The migrations table itself must exist with the correct row count.
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM migrations`).Scan(&count); err != nil {
		t.Fatalf("query migrations count: %v", err)
	}
	if count != len(migrations) {
		t.Fatalf("applied migration count = %d, want %d", count, len(migrations))
	}

	// Spot-check a few tables created by the baseline migration.
	for _, table := range []string{"encounter_events", "pokemon", "settings", "detector_configs", "capture_resolutions", "pokedex_overrides"} {
		var name string
		err := db.QueryRow(
			`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, table,
		).Scan(&name)
		if err != nil {
			t.Errorf("expected table %q to exist: %v", table, err)
		}
	}
}

// TestRunMigrationsSkipsCompleted verifies that calling RunMigrations a second
// time does not re-run already-applied migrations.
func TestRunMigrationsSkipsCompleted(t *testing.T) {
	db := openRawTestDB(t)

	if err := RunMigrations(db); err != nil {
		t.Fatalf("first RunMigrations: %v", err)
	}

	// Record the applied_at timestamp of migration 1.
	var firstAppliedAt string
	if err := db.QueryRow(`SELECT applied_at FROM migrations WHERE version = 1`).Scan(&firstAppliedAt); err != nil {
		t.Fatalf("query applied_at: %v", err)
	}

	// Small delay so any re-application would have a different timestamp.
	time.Sleep(10 * time.Millisecond)

	// Run again — should be a no-op.
	if err := RunMigrations(db); err != nil {
		t.Fatalf("second RunMigrations: %v", err)
	}

	var secondAppliedAt string
	if err := db.QueryRow(`SELECT applied_at FROM migrations WHERE version = 1`).Scan(&secondAppliedAt); err != nil {
		t.Fatalf("query applied_at after second run: %v", err)
	}

	if firstAppliedAt != secondAppliedAt {
		t.Fatalf("migration 1 was re-applied: first=%s, second=%s", firstAppliedAt, secondAppliedAt)
	}

	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM migrations`).Scan(&count); err != nil {
		t.Fatalf("query count: %v", err)
	}
	if count != len(migrations) {
		t.Fatalf("migration row count = %d after second run, want %d", count, len(migrations))
	}
}

func TestMigrationAddsPokemonNickname(t *testing.T) {
	db := openRawTestDB(t)
	if _, err := db.Exec(`CREATE TABLE pokemon (id TEXT PRIMARY KEY, name TEXT NOT NULL)`); err != nil {
		t.Fatalf("create legacy pokemon table: %v", err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin migration: %v", err)
	}
	if err := migrateAddPokemonNickname(tx); err != nil {
		t.Fatalf("migrateAddPokemonNickname: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit migration: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO pokemon (id, name, nickname) VALUES ('p1', 'Pikachu', 'Sparky')`); err != nil {
		t.Fatalf("nickname column unavailable after migration: %v", err)
	}
}

// TestRunMigrationsRollbackOnFailure verifies that a failing migration rolls
// back its transaction and does not record a tracking row.
func TestRunMigrationsRollbackOnFailure(t *testing.T) {
	db := openRawTestDB(t)

	// Temporarily append a broken migration to the registry.
	broken := migration{
		version:     9999,
		description: "intentionally broken",
		fn: func(tx *sql.Tx) error {
			return fmt.Errorf("simulated failure")
		},
	}
	original := make([]migration, len(migrations))
	copy(original, migrations)
	migrations = append(migrations, broken)
	defer func() { migrations = original }()

	err := RunMigrations(db)
	if err == nil {
		t.Fatal("expected error from broken migration, got nil")
	}

	// The baseline migration (version 1) should have succeeded and been recorded.
	var baselineCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM migrations WHERE version = 1`).Scan(&baselineCount); err != nil {
		t.Fatalf("query baseline count: %v", err)
	}
	if baselineCount != 1 {
		t.Fatalf("baseline migration count = %d, want 1", baselineCount)
	}

	// The broken migration must not have been recorded.
	var brokenCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM migrations WHERE version = 9999`).Scan(&brokenCount); err != nil {
		t.Fatalf("query broken count: %v", err)
	}
	if brokenCount != 0 {
		t.Fatalf("broken migration was recorded despite failure")
	}
}

// TestMigrationTemplateDetectionSettingsBackfill verifies that migration 25
// backfills the per-template precision_val and hysteresis_factor columns from
// the owning hunt's detector_configs row, and leaves templates that already
// carry their own values untouched.
func TestMigrationTemplateDetectionSettingsBackfill(t *testing.T) {
	db := openRawTestDB(t)

	// Apply all migrations up to (but not including) the backfill migration.
	original := migrations
	defer func() { migrations = original }()
	var upTo []migration
	for _, m := range original {
		if m.version < 25 {
			upTo = append(upTo, m)
		}
	}
	migrations = upTo
	if err := RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations up to version 24: %v", err)
	}

	// Seed a hunt config with distinct values and two templates: one without
	// per-template settings (must be backfilled) and one with its own value
	// (must be preserved).
	if _, err := db.Exec(`INSERT INTO detector_configs (pokemon_id, precision_val, hysteresis_factor) VALUES ('p1', 0.9, 0.6)`); err != nil {
		t.Fatalf("insert detector_configs: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO detector_templates (pokemon_id, image_data, name) VALUES ('p1', X'89504E47', 'inherit')`); err != nil {
		t.Fatalf("insert template without settings: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO detector_templates (pokemon_id, image_data, name, precision_val, hysteresis_factor) VALUES ('p1', X'89504E47', 'own', 0.3, 0.4)`); err != nil {
		t.Fatalf("insert template with settings: %v", err)
	}

	// Apply the remaining migrations, including the backfill.
	migrations = original
	if err := RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations including backfill: %v", err)
	}

	var precision, hysteresis float64
	if err := db.QueryRow(`SELECT precision_val, hysteresis_factor FROM detector_templates WHERE name = 'inherit'`).Scan(&precision, &hysteresis); err != nil {
		t.Fatalf("query backfilled template: %v", err)
	}
	if precision != 0.9 {
		t.Errorf("backfilled precision_val = %v, want 0.9", precision)
	}
	if hysteresis != 0.6 {
		t.Errorf("backfilled hysteresis_factor = %v, want 0.6", hysteresis)
	}

	if err := db.QueryRow(`SELECT precision_val, hysteresis_factor FROM detector_templates WHERE name = 'own'`).Scan(&precision, &hysteresis); err != nil {
		t.Fatalf("query preserved template: %v", err)
	}
	if precision != 0.3 {
		t.Errorf("preserved precision_val = %v, want 0.3", precision)
	}
	if hysteresis != 0.4 {
		t.Errorf("preserved hysteresis_factor = %v, want 0.4", hysteresis)
	}
}

// TestMigrationTemplatePollingSettingsBackfill verifies that migration 26
// backfills the per-template consecutive_hits, cooldown_sec and
// adaptive-polling columns from the owning hunt's detector_configs row, and
// leaves templates that already carry their own values untouched.
func TestMigrationTemplatePollingSettingsBackfill(t *testing.T) {
	db := openRawTestDB(t)

	// Apply all migrations up to (but not including) the backfill migration.
	original := migrations
	defer func() { migrations = original }()
	var upTo []migration
	for _, m := range original {
		if m.version < 26 {
			upTo = append(upTo, m)
		}
	}
	migrations = upTo
	if err := RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations up to version 25: %v", err)
	}

	// Seed a hunt config with distinct values and two templates: one without
	// per-template settings (must be backfilled) and one with its own value
	// (must be preserved).
	if _, err := db.Exec(`INSERT INTO detector_configs (pokemon_id, consecutive_hits, cooldown_sec, poll_interval_ms, min_poll_ms, max_poll_ms) VALUES ('p1', 4, 12, 250, 100, 1800)`); err != nil {
		t.Fatalf("insert detector_configs: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO detector_templates (pokemon_id, image_data, name) VALUES ('p1', X'89504E47', 'inherit')`); err != nil {
		t.Fatalf("insert template without settings: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO detector_templates (pokemon_id, image_data, name, consecutive_hits, cooldown_sec, poll_interval_ms, min_poll_ms, max_poll_ms) VALUES ('p1', X'89504E47', 'own', 2, 5, 150, 80, 1500)`); err != nil {
		t.Fatalf("insert template with settings: %v", err)
	}

	// Apply the remaining migrations, including the backfill.
	migrations = original
	if err := RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations including backfill: %v", err)
	}

	var hits, cooldown, base, min, max int
	if err := db.QueryRow(`SELECT consecutive_hits, cooldown_sec, poll_interval_ms, min_poll_ms, max_poll_ms FROM detector_templates WHERE name = 'inherit'`).Scan(&hits, &cooldown, &base, &min, &max); err != nil {
		t.Fatalf("query backfilled template: %v", err)
	}
	if hits != 4 || cooldown != 12 || base != 250 || min != 100 || max != 1800 {
		t.Errorf("backfilled (hits, cooldown, base, min, max) = (%d, %d, %d, %d, %d), want (4, 12, 250, 100, 1800)", hits, cooldown, base, min, max)
	}

	if err := db.QueryRow(`SELECT consecutive_hits, cooldown_sec, poll_interval_ms, min_poll_ms, max_poll_ms FROM detector_templates WHERE name = 'own'`).Scan(&hits, &cooldown, &base, &min, &max); err != nil {
		t.Fatalf("query preserved template: %v", err)
	}
	if hits != 2 || cooldown != 5 || base != 150 || min != 80 || max != 1500 {
		t.Errorf("preserved (hits, cooldown, base, min, max) = (%d, %d, %d, %d, %d), want (2, 5, 150, 80, 1500)", hits, cooldown, base, min, max)
	}
}

// TestMigrationRemapAccentColorPresets verifies that migration 28 translates
// every legacy accent color preset to its replacement in the new palette and
// maps unknown values to the default violet.
func TestMigrationRemapAccentColorPresets(t *testing.T) {
	cases := []struct {
		old  string
		want string
	}{
		{"blue", "blue"},
		{"green", "green"},
		{"purple", "violet"},
		{"pink", "pink"},
		{"orange", "orange"},
		{"cyan", "cyan"},
		{"unknown", "violet"},
	}

	for _, tc := range cases {
		t.Run(tc.old, func(t *testing.T) {
			db := openRawTestDB(t)

			// Apply all migrations up to (but not including) the remap migration.
			original := migrations
			defer func() { migrations = original }()
			var upTo []migration
			for _, m := range original {
				if m.version < 28 {
					upTo = append(upTo, m)
				}
			}
			migrations = upTo
			if err := RunMigrations(db); err != nil {
				t.Fatalf("RunMigrations up to version 27: %v", err)
			}

			// Seed the singleton settings row with a legacy preset value.
			if _, err := db.Exec(`INSERT INTO settings (id, accent_color) VALUES (1, ?)`, tc.old); err != nil {
				t.Fatalf("insert settings: %v", err)
			}

			// Apply the remaining migrations, including the remap.
			migrations = original
			if err := RunMigrations(db); err != nil {
				t.Fatalf("RunMigrations including remap: %v", err)
			}

			var got string
			if err := db.QueryRow(`SELECT accent_color FROM settings WHERE id = 1`).Scan(&got); err != nil {
				t.Fatalf("query accent_color: %v", err)
			}
			if got != tc.want {
				t.Errorf("accent_color after remap = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestMigrationReplaceRemovedBgAnimations verifies that migration 34 rewrites
// every removed WebGL background animation to waves, on the global overlay row
// as well as on per-pokemon rows, and leaves surviving values untouched.
func TestMigrationReplaceRemovedBgAnimations(t *testing.T) {
	cases := []struct {
		old  string
		want string
	}{
		{"rb-aurora", "waves"},
		{"rb-galaxy", "waves"},
		{"rb-silk", "waves"},
		{"rb-pixelblast", "waves"},
		{"none", "none"},
		{"waves", "waves"},
		{"gradient-shift", "gradient-shift"},
		{"shimmer-bg", "shimmer-bg"},
	}

	for _, tc := range cases {
		t.Run(tc.old, func(t *testing.T) {
			db := openRawTestDB(t)

			// Apply all migrations up to (but not including) the replacement.
			original := migrations
			defer func() { migrations = original }()
			var upTo []migration
			for _, m := range original {
				if m.version < 34 {
					upTo = append(upTo, m)
				}
			}
			migrations = upTo
			if err := RunMigrations(db); err != nil {
				t.Fatalf("RunMigrations up to version 33: %v", err)
			}

			// Seed a global and a per-pokemon overlay row with the same value
			// so the migration is proven to cover every owner.
			owners := []struct{ ownerType, ownerID string }{
				{"global", "default"},
				{"pokemon", "1f0c6a1e-0000-4000-8000-000000000001"},
			}
			for _, o := range owners {
				if _, err := db.Exec(
					`INSERT INTO overlay_settings (owner_type, owner_id, background_animation) VALUES (?, ?, ?)`,
					o.ownerType, o.ownerID, tc.old,
				); err != nil {
					t.Fatalf("insert overlay_settings for %s: %v", o.ownerType, err)
				}
			}

			// Apply the remaining migrations, including the replacement.
			migrations = original
			if err := RunMigrations(db); err != nil {
				t.Fatalf("RunMigrations including replacement: %v", err)
			}

			for _, o := range owners {
				var got string
				if err := db.QueryRow(
					`SELECT background_animation FROM overlay_settings WHERE owner_type = ? AND owner_id = ?`,
					o.ownerType, o.ownerID,
				).Scan(&got); err != nil {
					t.Fatalf("query background_animation for %s: %v", o.ownerType, err)
				}
				if got != tc.want {
					t.Errorf("%s background_animation = %q, want %q", o.ownerType, got, tc.want)
				}
			}
		})
	}
}

// TestRunMigrationsTracking verifies that the migrations table stores the
// correct version, description, and a valid RFC3339 timestamp for each migration.
func TestRunMigrationsTracking(t *testing.T) {
	db := openRawTestDB(t)

	if err := RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	rows, err := db.Query(`SELECT version, description, applied_at FROM migrations ORDER BY version`)
	if err != nil {
		t.Fatalf("query migrations: %v", err)
	}
	defer func() { _ = rows.Close() }()

	idx := 0
	for rows.Next() {
		var version int
		var description, appliedAt string
		if err := rows.Scan(&version, &description, &appliedAt); err != nil {
			t.Fatalf("scan row %d: %v", idx, err)
		}

		if idx >= len(migrations) {
			t.Fatalf("more rows than registered migrations")
		}

		expected := migrations[idx]
		if version != expected.version {
			t.Errorf("row %d: version = %d, want %d", idx, version, expected.version)
		}
		if description != expected.description {
			t.Errorf("row %d: description = %q, want %q", idx, description, expected.description)
		}
		if _, err := time.Parse(time.RFC3339, appliedAt); err != nil {
			t.Errorf("row %d: applied_at %q is not valid RFC3339: %v", idx, appliedAt, err)
		}
		idx++
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows iteration: %v", err)
	}
	if idx != len(migrations) {
		t.Fatalf("got %d tracking rows, want %d", idx, len(migrations))
	}
}

// ---------------------------------------------------------------------------
// Removal migrations (35, 36)
// ---------------------------------------------------------------------------

// seedLegacyOverlaySchema recreates the overlay tables as they looked before
// the trigger_exit and shadow-gradient columns were removed, so the removal
// migrations can be exercised against real legacy data.
func seedLegacyOverlaySchema(t *testing.T, db *sql.DB) {
	t.Helper()
	stmts := []string{
		`CREATE TABLE overlay_elements (
			id             INTEGER PRIMARY KEY AUTOINCREMENT,
			overlay_id     INTEGER NOT NULL,
			element_type   TEXT    NOT NULL,
			idle_animation TEXT    NOT NULL DEFAULT 'none',
			trigger_enter  TEXT    NOT NULL DEFAULT 'none',
			trigger_exit   TEXT    NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE text_styles (
			id                         INTEGER PRIMARY KEY AUTOINCREMENT,
			element_id                 INTEGER NOT NULL,
			text_shadow_color          TEXT    NOT NULL DEFAULT '',
			text_shadow_color_type     TEXT    NOT NULL DEFAULT 'solid',
			text_shadow_gradient_angle INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE gradient_stops (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			text_style_id INTEGER NOT NULL,
			gradient_type TEXT    NOT NULL,
			color         TEXT    NOT NULL,
			position      REAL    NOT NULL,
			sort_order    INTEGER NOT NULL DEFAULT 0
		)`,
		`INSERT INTO overlay_elements (id, overlay_id, element_type, trigger_exit)
			VALUES (1, 1, 'sprite', 'fade-out')`,
		// Style 1 stored a gradient shadow, style 2 a solid one.
		`INSERT INTO text_styles (id, element_id, text_shadow_color, text_shadow_color_type, text_shadow_gradient_angle)
			VALUES (1, 1, '#111111', 'gradient', 180)`,
		`INSERT INTO text_styles (id, element_id, text_shadow_color, text_shadow_color_type, text_shadow_gradient_angle)
			VALUES (2, 1, '#abcdef', 'solid', 0)`,
		// Out-of-order sort_order proves the migration takes the first stop.
		`INSERT INTO gradient_stops (text_style_id, gradient_type, color, position, sort_order)
			VALUES (1, 'shadow', '#00ff00', 100, 1)`,
		`INSERT INTO gradient_stops (text_style_id, gradient_type, color, position, sort_order)
			VALUES (1, 'shadow', '#ff0000', 0, 0)`,
		`INSERT INTO gradient_stops (text_style_id, gradient_type, color, position, sort_order)
			VALUES (1, 'outline', '#0000ff', 0, 0)`,
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("seed legacy overlay schema (%s): %v", stmt, err)
		}
	}
}

// runMigrationTx applies a single migration function inside its own
// transaction, mirroring what RunMigrations does.
func runMigrationTx(t *testing.T, db *sql.DB, fn func(tx *sql.Tx) error) {
	t.Helper()
	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		t.Fatalf("migration: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}
}

// hasColumn reports whether a table carries a column, used to assert that the
// removal migrations really dropped them.
func hasColumn(t *testing.T, db *sql.DB, table, column string) bool {
	t.Helper()
	var n int
	err := db.QueryRow(
		`SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?`, table, column,
	).Scan(&n)
	if err != nil {
		t.Fatalf("pragma_table_info(%s): %v", table, err)
	}
	return n > 0
}

// TestMigrateDropTriggerExit verifies that migration 35 removes the dead
// trigger_exit column while leaving the rest of the row intact.
func TestMigrateDropTriggerExit(t *testing.T) {
	db := openRawTestDB(t)
	seedLegacyOverlaySchema(t, db)

	if !hasColumn(t, db, "overlay_elements", "trigger_exit") {
		t.Fatal("seed did not create trigger_exit")
	}

	runMigrationTx(t, db, migrateDropTriggerExit)

	if hasColumn(t, db, "overlay_elements", "trigger_exit") {
		t.Error("trigger_exit still present after migration")
	}
	var elemType string
	if err := db.QueryRow(`SELECT element_type FROM overlay_elements WHERE id = 1`).Scan(&elemType); err != nil {
		t.Fatalf("read overlay_elements: %v", err)
	}
	if elemType != "sprite" {
		t.Errorf("element_type = %q, want %q", elemType, "sprite")
	}
}

// TestMigrateDropTriggerExitIsIdempotent verifies that migration 35 is safe on
// a database that never had the column.
func TestMigrateDropTriggerExitIsIdempotent(t *testing.T) {
	db := openRawTestDB(t)
	seedLegacyOverlaySchema(t, db)

	runMigrationTx(t, db, migrateDropTriggerExit)
	runMigrationTx(t, db, migrateDropTriggerExit)

	if hasColumn(t, db, "overlay_elements", "trigger_exit") {
		t.Error("trigger_exit still present after migration")
	}
}

// TestMigrateDropShadowGradient verifies that migration 36 folds the first
// shadow stop into text_shadow_color, leaves a solid shadow alone, deletes only
// the shadow stops, and drops the three gradient columns.
func TestMigrateDropShadowGradient(t *testing.T) {
	db := openRawTestDB(t)
	seedLegacyOverlaySchema(t, db)

	runMigrationTx(t, db, migrateDropShadowGradient)

	var gradientShadowColor, solidShadowColor string
	if err := db.QueryRow(`SELECT text_shadow_color FROM text_styles WHERE id = 1`).Scan(&gradientShadowColor); err != nil {
		t.Fatalf("read style 1: %v", err)
	}
	if gradientShadowColor != "#ff0000" {
		t.Errorf("gradient shadow colour = %q, want %q (first stop)", gradientShadowColor, "#ff0000")
	}
	if err := db.QueryRow(`SELECT text_shadow_color FROM text_styles WHERE id = 2`).Scan(&solidShadowColor); err != nil {
		t.Fatalf("read style 2: %v", err)
	}
	if solidShadowColor != "#abcdef" {
		t.Errorf("solid shadow colour = %q, want it unchanged (%q)", solidShadowColor, "#abcdef")
	}

	var shadowStops, outlineStops int
	if err := db.QueryRow(`SELECT COUNT(*) FROM gradient_stops WHERE gradient_type = 'shadow'`).Scan(&shadowStops); err != nil {
		t.Fatalf("count shadow stops: %v", err)
	}
	if shadowStops != 0 {
		t.Errorf("shadow stops left = %d, want 0", shadowStops)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM gradient_stops WHERE gradient_type = 'outline'`).Scan(&outlineStops); err != nil {
		t.Fatalf("count outline stops: %v", err)
	}
	if outlineStops != 1 {
		t.Errorf("outline stops left = %d, want 1", outlineStops)
	}

	for _, col := range []string{"text_shadow_color_type", "text_shadow_gradient_angle"} {
		if hasColumn(t, db, "text_styles", col) {
			t.Errorf("column %q still present after migration", col)
		}
	}
}

// TestMigrateDropShadowGradientIsIdempotent verifies that migration 36 is a
// no-op once the columns are gone, which is also the fresh-database case.
func TestMigrateDropShadowGradientIsIdempotent(t *testing.T) {
	db := openRawTestDB(t)
	seedLegacyOverlaySchema(t, db)

	runMigrationTx(t, db, migrateDropShadowGradient)
	runMigrationTx(t, db, migrateDropShadowGradient)

	var color string
	if err := db.QueryRow(`SELECT text_shadow_color FROM text_styles WHERE id = 1`).Scan(&color); err != nil {
		t.Fatalf("read style 1: %v", err)
	}
	if color != "#ff0000" {
		t.Errorf("shadow colour = %q, want %q", color, "#ff0000")
	}
}

// TestMigration38AddsCatchMetaColumn verifies that migration 38 adds catch_meta
// to a pokemon table that predates it, that existing rows read as "nothing
// recorded", and that running it twice is harmless.
func TestMigration38AddsCatchMetaColumn(t *testing.T) {
	db := openRawTestDB(t)

	if _, err := db.Exec(`CREATE TABLE pokemon (id TEXT PRIMARY KEY, name TEXT NOT NULL)`); err != nil {
		t.Fatalf("create legacy pokemon table: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO pokemon (id, name) VALUES ('pk1', 'Karpador')`); err != nil {
		t.Fatalf("insert legacy row: %v", err)
	}
	if hasColumn(t, db, "pokemon", "catch_meta") {
		t.Fatal("seed already carries catch_meta")
	}

	runMigrationTx(t, db, migrateAddCatchMeta)
	runMigrationTx(t, db, migrateAddCatchMeta)

	if !hasColumn(t, db, "pokemon", "catch_meta") {
		t.Fatal("catch_meta missing after migration")
	}
	var stored string
	if err := db.QueryRow(`SELECT catch_meta FROM pokemon WHERE id = 'pk1'`).Scan(&stored); err != nil {
		t.Fatalf("read catch_meta: %v", err)
	}
	if stored != "" {
		t.Errorf("catch_meta of a legacy row = %q, want empty", stored)
	}
}

// TestMigration39AddsFormGenderColumn verifies that migration 39 adds the
// gender column to a pokedex_forms table that predates it, that existing
// rows read as "not gender-restricted", and that running it twice is harmless.
func TestMigration39AddsFormGenderColumn(t *testing.T) {
	db := openRawTestDB(t)

	if _, err := db.Exec(`CREATE TABLE pokedex_forms (
		id INTEGER PRIMARY KEY AUTOINCREMENT, species_id INTEGER NOT NULL, canonical TEXT NOT NULL UNIQUE
	)`); err != nil {
		t.Fatalf("create legacy pokedex_forms table: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO pokedex_forms (species_id, canonical) VALUES (668, 'pyroar-female')`); err != nil {
		t.Fatalf("insert legacy row: %v", err)
	}
	if hasColumn(t, db, "pokedex_forms", "gender") {
		t.Fatal("seed already carries gender")
	}

	runMigrationTx(t, db, migrateAddFormGender)
	runMigrationTx(t, db, migrateAddFormGender)

	if !hasColumn(t, db, "pokedex_forms", "gender") {
		t.Fatal("gender column missing after migration")
	}
	var gender string
	if err := db.QueryRow(`SELECT gender FROM pokedex_forms WHERE canonical = 'pyroar-female'`).Scan(&gender); err != nil {
		t.Fatalf("read gender: %v", err)
	}
	if gender != "" {
		t.Errorf("gender of a legacy row = %q, want empty", gender)
	}
}

// TestMigration41CreatesPokedexOverridesTable verifies that migration 41
// creates the pokedex_overrides table with its species index, and that
// running it twice against a database that already has the table is harmless.
func TestMigration41CreatesPokedexOverridesTable(t *testing.T) {
	db := openRawTestDB(t)

	runMigrationTx(t, db, migrateAddPokedexOverrides)
	runMigrationTx(t, db, migrateAddPokedexOverrides)

	var name string
	if err := db.QueryRow(
		`SELECT name FROM sqlite_master WHERE type='table' AND name='pokedex_overrides'`,
	).Scan(&name); err != nil {
		t.Fatalf("expected pokedex_overrides table to exist: %v", err)
	}

	// Verify the UNIQUE constraint is enforced by the upsert conflict target.
	if _, err := db.Exec(
		`INSERT INTO pokedex_overrides (species_id, form_canonical, gender, game, caught, seen, created_at, updated_at)
		 VALUES (25, '', '', '', 1, 0, 'now', 'now')`,
	); err != nil {
		t.Fatalf("insert into pokedex_overrides: %v", err)
	}
	if _, err := db.Exec(
		`INSERT INTO pokedex_overrides (species_id, form_canonical, gender, game, caught, seen, created_at, updated_at)
		 VALUES (25, '', '', '', 0, 1, 'now', 'now')`,
	); err == nil {
		t.Error("expected UNIQUE constraint violation on duplicate (species_id, form_canonical, gender, game)")
	}
}

func TestMigration47CreatesLivingDexAndBackfillsPokemon(t *testing.T) {
	db := openRawTestDB(t)
	if _, err := db.Exec(`CREATE TABLE pokemon (id TEXT PRIMARY KEY); INSERT INTO pokemon VALUES ('old-catch')`); err != nil {
		t.Fatalf("seed pokemon: %v", err)
	}

	runMigrationTx(t, db, migrateAddUserPokedexes)
	runMigrationTx(t, db, migrateAddUserPokedexes)

	var name string
	var showForms, memberships int
	if err := db.QueryRow(`SELECT name, show_forms FROM user_pokedexes WHERE id='default'`).Scan(&name, &showForms); err != nil {
		t.Fatalf("read Living Dex: %v", err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM pokedex_pokemon WHERE pokedex_id='default' AND pokemon_id='old-catch'`).Scan(&memberships); err != nil {
		t.Fatalf("read membership: %v", err)
	}
	if name != "Living Dex" || showForms != 1 || memberships != 1 {
		t.Fatalf("Living Dex = (%q,%d), memberships=%d", name, showForms, memberships)
	}
}

// TestMigration42AddsOverrideMetaColumn verifies that migration 42 adds the
// meta_json column to a pokedex_overrides table that predates it, that
// existing rows default to "{}" (nothing recorded), and that running it
// twice is harmless.
func TestMigration42AddsOverrideMetaColumn(t *testing.T) {
	db := openRawTestDB(t)

	runMigrationTx(t, db, migrateAddPokedexOverrides)
	if _, err := db.Exec(
		`INSERT INTO pokedex_overrides (species_id, form_canonical, gender, game, caught, seen, created_at, updated_at)
		 VALUES (25, '', '', '', 1, 0, 'now', 'now')`,
	); err != nil {
		t.Fatalf("insert legacy override row: %v", err)
	}
	if hasColumn(t, db, "pokedex_overrides", "meta_json") {
		t.Fatal("seed already carries meta_json")
	}

	runMigrationTx(t, db, migrateAddOverrideMeta)
	runMigrationTx(t, db, migrateAddOverrideMeta)

	if !hasColumn(t, db, "pokedex_overrides", "meta_json") {
		t.Fatal("meta_json missing after migration")
	}
	var metaJSON string
	if err := db.QueryRow(`SELECT meta_json FROM pokedex_overrides WHERE species_id = 25`).Scan(&metaJSON); err != nil {
		t.Fatalf("read meta_json: %v", err)
	}
	if metaJSON != "{}" {
		t.Errorf("meta_json of a legacy row = %q, want {}", metaJSON)
	}
}

// TestMigration43AddsFailedColumn verifies that migration 43 adds the failed
// column to a pokemon table that predates it, that existing rows default to
// "not failed", and that running it twice is harmless.
func TestMigration43AddsFailedColumn(t *testing.T) {
	db := openRawTestDB(t)

	if _, err := db.Exec(`CREATE TABLE pokemon (id TEXT PRIMARY KEY, name TEXT NOT NULL)`); err != nil {
		t.Fatalf("create legacy pokemon table: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO pokemon (id, name) VALUES ('pk1', 'Karpador')`); err != nil {
		t.Fatalf("insert legacy row: %v", err)
	}
	if hasColumn(t, db, "pokemon", "failed") {
		t.Fatal("seed already carries failed")
	}

	runMigrationTx(t, db, migrateAddFailed)
	runMigrationTx(t, db, migrateAddFailed)

	if !hasColumn(t, db, "pokemon", "failed") {
		t.Fatal("failed missing after migration")
	}
	var failed int
	if err := db.QueryRow(`SELECT failed FROM pokemon WHERE id = 'pk1'`).Scan(&failed); err != nil {
		t.Fatalf("read failed: %v", err)
	}
	if failed != 0 {
		t.Errorf("failed of a legacy row = %d, want 0", failed)
	}
}

// TestMigration44MovesGender verifies that legacy catch metadata is moved to
// the Pokemon column without losing the remaining metadata.
func TestMigration44MovesGender(t *testing.T) {
	db := openRawTestDB(t)
	if _, err := db.Exec(`CREATE TABLE pokemon (id TEXT PRIMARY KEY, gender TEXT NOT NULL DEFAULT '', catch_meta TEXT NOT NULL DEFAULT ''); CREATE TABLE phase_targets (pokemon_id TEXT); CREATE TABLE pokedex_species (id INTEGER PRIMARY KEY); CREATE TABLE pokedex_overrides (gender TEXT)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO pokemon (id, catch_meta) VALUES ('p1', '{"gender":"female","nature":"timid"}')`); err != nil {
		t.Fatal(err)
	}
	runMigrationTx(t, db, migrateGenderOwnership)
	var gender, meta string
	if err := db.QueryRow(`SELECT gender, catch_meta FROM pokemon WHERE id='p1'`).Scan(&gender, &meta); err != nil {
		t.Fatal(err)
	}
	if gender != "female" || meta != `{"nature":"timid"}` {
		t.Fatalf("gender/meta = %q/%q", gender, meta)
	}
}

// TestMigration52AddsShinyVariantColumn verifies that the shiny variant column
// is added to databases predating it, that rows written before the migration
// default to "no variant recorded", and that a repeated run is a no-op.
func TestMigration52AddsShinyVariantColumn(t *testing.T) {
	db := openRawTestDB(t)

	if _, err := db.Exec(`CREATE TABLE pokemon (id TEXT PRIMARY KEY, name TEXT NOT NULL)`); err != nil {
		t.Fatalf("create legacy pokemon table: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO pokemon (id, name) VALUES ('pk1', 'Karpador')`); err != nil {
		t.Fatalf("insert legacy row: %v", err)
	}
	if hasColumn(t, db, "pokemon", "shiny_variant") {
		t.Fatal("seed already carries shiny_variant")
	}

	runMigrationTx(t, db, migrateAddShinyVariant)
	runMigrationTx(t, db, migrateAddShinyVariant)

	if !hasColumn(t, db, "pokemon", "shiny_variant") {
		t.Fatal("shiny_variant missing after migration")
	}
	var variant string
	if err := db.QueryRow(`SELECT shiny_variant FROM pokemon WHERE id = 'pk1'`).Scan(&variant); err != nil {
		t.Fatalf("read shiny_variant: %v", err)
	}
	if variant != "" {
		t.Errorf("shiny_variant of a legacy row = %q, want %q", variant, "")
	}
}

// TestMigration53AddsPokedexSpecimenPhaseColumns verifies that the phase link
// columns are added to databases predating them, that rows written before the
// migration default to "not a phase", and that a repeated run is a no-op.
func TestMigration53AddsPokedexSpecimenPhaseColumns(t *testing.T) {
	db := openRawTestDB(t)

	if _, err := db.Exec(`CREATE TABLE pokedex_specimens (
		id INTEGER PRIMARY KEY AUTOINCREMENT, species_id INTEGER NOT NULL)`); err != nil {
		t.Fatalf("create legacy pokedex_specimens table: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO pokedex_specimens (species_id) VALUES (129)`); err != nil {
		t.Fatalf("insert legacy row: %v", err)
	}
	if hasColumn(t, db, "pokedex_specimens", "phase_of") {
		t.Fatal("seed already carries phase_of")
	}

	runMigrationTx(t, db, migrateAddPokedexSpecimenPhases)
	runMigrationTx(t, db, migrateAddPokedexSpecimenPhases)

	if !hasColumn(t, db, "pokedex_specimens", "phase_of") {
		t.Fatal("phase_of missing after migration")
	}
	if !hasColumn(t, db, "pokedex_specimens", "phase_number") {
		t.Fatal("phase_number missing after migration")
	}
	var phaseOf, phaseNumber int
	if err := db.QueryRow(
		`SELECT phase_of, phase_number FROM pokedex_specimens WHERE species_id = 129`,
	).Scan(&phaseOf, &phaseNumber); err != nil {
		t.Fatalf("read phase columns: %v", err)
	}
	if phaseOf != 0 || phaseNumber != 0 {
		t.Errorf("legacy row phase link = %d/%d, want 0/0", phaseOf, phaseNumber)
	}
}

// TestMigration54AddsEntrySourceColumn verifies that the entry source column is
// added to databases predating it, that rows written before the migration
// default to "tracked in this app", and that a repeated run is a no-op.
func TestMigration54AddsEntrySourceColumn(t *testing.T) {
	db := openRawTestDB(t)

	if _, err := db.Exec(`CREATE TABLE pokemon (id TEXT PRIMARY KEY, name TEXT NOT NULL)`); err != nil {
		t.Fatalf("create legacy pokemon table: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO pokemon (id, name) VALUES ('pk1', 'Karpador')`); err != nil {
		t.Fatalf("insert legacy row: %v", err)
	}
	if hasColumn(t, db, "pokemon", "entry_source") {
		t.Fatal("seed already carries entry_source")
	}

	runMigrationTx(t, db, migrateAddEntrySource)
	runMigrationTx(t, db, migrateAddEntrySource)

	if !hasColumn(t, db, "pokemon", "entry_source") {
		t.Fatal("entry_source missing after migration")
	}
	var source string
	if err := db.QueryRow(`SELECT entry_source FROM pokemon WHERE id = 'pk1'`).Scan(&source); err != nil {
		t.Fatalf("read entry_source: %v", err)
	}
	if source != "" {
		t.Errorf("entry_source of a legacy row = %q, want %q", source, "")
	}
}

// ---------------------------------------------------------------------------
// Migration 49: legacy caught overrides become specimens
// ---------------------------------------------------------------------------

// TestMigrateCaughtOverridesToSpecimens verifies that migration 49 still turns
// a legacy caught override into a specimen and clears the legacy flag. The
// specimen API is gone, but the migration keeps running on old databases, and
// migration 55 depends on the rows it produces.
func TestMigrateCaughtOverridesToSpecimens(t *testing.T) {
	db := openMigratedTestDB(t)

	if _, err := db.Exec(`INSERT INTO pokedex_overrides (pokedex_id,species_id,form_canonical,caught,seen,meta_json)
		VALUES ('default',37,'vulpix-alola',1,1,'{"nickname":"Snow"}')`); err != nil {
		t.Fatalf("seed override: %v", err)
	}

	runMigrationTx(t, db, migrateAddPokedexSpecimens)

	var speciesID int
	var formCanonical, metaJSON string
	var sourceOverrideID int64
	if err := db.QueryRow(
		`SELECT species_id, form_canonical, meta_json, source_override_id FROM pokedex_specimens`,
	).Scan(&speciesID, &formCanonical, &metaJSON, &sourceOverrideID); err != nil {
		t.Fatalf("read migrated specimen: %v", err)
	}
	if speciesID != 37 || formCanonical != "vulpix-alola" || metaJSON != `{"nickname":"Snow"}` {
		t.Fatalf("migrated specimen = %d/%q/%q", speciesID, formCanonical, metaJSON)
	}

	var caught, seen int
	if err := db.QueryRow(
		`SELECT caught, seen FROM pokedex_overrides WHERE id = ?`, sourceOverrideID,
	).Scan(&caught, &seen); err != nil {
		t.Fatalf("read legacy override: %v", err)
	}
	if caught != 0 || seen != 1 {
		t.Fatalf("legacy flags = %d/%d, want 0/1", caught, seen)
	}
}

// ---------------------------------------------------------------------------
// Migration 55: manual specimens become hunt entries
// ---------------------------------------------------------------------------

// openMigratedTestDB returns a fully migrated in-memory database with foreign
// key enforcement enabled, matching what Open hands the running application.
// Migration 55 needs it: pokedex_pokemon carries foreign keys, and INSERT OR
// IGNORE does not swallow a foreign key violation.
func openMigratedTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db := openRawTestDB(t)
	if _, err := db.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		t.Fatalf("enable foreign keys: %v", err)
	}
	if err := RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}
	return db
}

// specimenSeed is one pokedex_specimens row a migration 55 test starts from.
type specimenSeed struct {
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
}

// migratedPokemon mirrors every pokemon column migration 55 writes, so a test
// can compare a whole row at once instead of column by column.
type migratedPokemon struct {
	id                 string
	name               string
	baseName           string
	formName           string
	nickname           string
	title              string
	canonicalName      string
	gender             string
	spriteURL          string
	spriteType         string
	spriteStyle        string
	encounters         int
	step               int
	isActive           int
	createdAt          string
	language           string
	game               string
	completedAt        string
	overlayMode        string
	huntType           string
	shinyCharm         int
	shinyVariant       string
	entrySource        string
	timerStartedAt     sql.NullString
	timerAccumulatedMs int64
	huntMode           string
	groupID            string
	phaseOf            string
	phaseNumber        int
	sortOrder          int
	catchMeta          string
	failed             int
}

// migration55Seeds returns the specimens every migration 55 test starts from:
// a catch with a form, two of its phases, one without a game, one without a
// completion date, one whose species is unknown, and an orphaned phase whose
// parent was deleted.
func migration55Seeds() []specimenSeed {
	return []specimenSeed{
		{id: 1, pokedexID: "default", speciesID: 37, formCanonical: "vulpix-alola", gender: "female",
			game: "pokemon-sun", completedAt: "2020-01-02", huntType: "soft_reset", encounters: 8192,
			timerAccumulatedMs: 3_661_000, createdAt: "2019-12-24T18:00:00Z",
			metaJSON: `{"nickname":"Snow","shiny_variant":"square","hp":31,"evolutions":[{"canonical_name":"ninetales-alola"}]}`},
		{id: 2, pokedexID: "default", speciesID: 129, game: "pokemon-sun", completedAt: "2020-01-01",
			huntType: "soft_reset", encounters: 400, phaseOf: 1, phaseNumber: 1,
			createdAt: "2019-12-25T10:00:00Z", metaJSON: `{"nickname":"Karpi"}`},
		{id: 3, pokedexID: "default", speciesID: 129, game: "pokemon-sun", completedAt: "2020-01-02",
			huntType: "soft_reset", encounters: 900, phaseOf: 1, phaseNumber: 2,
			createdAt: "2019-12-26T10:00:00Z", metaJSON: `{}`},
		{id: 4, pokedexID: "ghost", speciesID: 25, completedAt: "2021-03-04", huntType: "random",
			encounters: 12, createdAt: "2021-03-01T08:00:00Z", metaJSON: `{"shiny_variant":"star"}`},
		{id: 5, pokedexID: "default", speciesID: 25, game: "pokemon-red",
			createdAt: "2019-05-06T07:08:09Z", metaJSON: `{"ribbons":[]}`},
		{id: 6, pokedexID: "default", speciesID: 999, game: "pokemon-red", completedAt: "2022-06-07",
			metaJSON: `not json at all`},
		{id: 7, pokedexID: "default", speciesID: 133, game: "pokemon-red", phaseOf: 42, phaseNumber: 3,
			metaJSON: `{}`},
	}
}

// seedSpecimens writes the given specimens with explicit ids so the phase links
// between them are stable.
func seedSpecimens(t *testing.T, db *sql.DB, seeds []specimenSeed) {
	t.Helper()
	// Migration 58 drops the table, so an already-migrated test database no
	// longer has it. Recreate the shape migration 52 introduced, which is what
	// migration 55 reads.
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS pokedex_specimens (
		id                 INTEGER PRIMARY KEY AUTOINCREMENT,
		pokedex_id         TEXT    NOT NULL DEFAULT 'default',
		species_id         INTEGER NOT NULL,
		form_canonical     TEXT    NOT NULL DEFAULT '',
		gender             TEXT    NOT NULL DEFAULT '',
		game               TEXT    NOT NULL DEFAULT '',
		completed_at       TEXT    NOT NULL DEFAULT '',
		hunt_type          TEXT    NOT NULL DEFAULT '',
		encounters         INTEGER NOT NULL DEFAULT 0,
		timer_accumulated_ms INTEGER NOT NULL DEFAULT 0,
		phase_of           INTEGER NOT NULL DEFAULT 0,
		phase_number       INTEGER NOT NULL DEFAULT 0,
		meta_json          TEXT    NOT NULL DEFAULT '{}',
		source_override_id INTEGER UNIQUE,
		created_at         TEXT    NOT NULL DEFAULT '',
		updated_at         TEXT    NOT NULL DEFAULT ''
	)`); err != nil {
		t.Fatalf("recreate pokedex_specimens: %v", err)
	}
	for _, s := range seeds {
		if _, err := db.Exec(`INSERT INTO pokedex_specimens
			(id, pokedex_id, species_id, form_canonical, gender, game, completed_at, hunt_type,
			 encounters, timer_accumulated_ms, phase_of, phase_number, meta_json, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')`,
			s.id, s.pokedexID, s.speciesID, s.formCanonical, s.gender, s.game, s.completedAt, s.huntType,
			s.encounters, s.timerAccumulatedMs, s.phaseOf, s.phaseNumber, s.metaJSON, s.createdAt); err != nil {
			t.Fatalf("seed specimen %d: %v", s.id, err)
		}
	}
}

// seedMigration55Pokedex fills the Pokédex name tables and picks German as the
// primary language, so the migrated names prove the localization path.
func seedMigration55Pokedex(t *testing.T, db *sql.DB) {
	t.Helper()
	species := []struct {
		id        int
		canonical string
		names     string
	}{
		{37, "vulpix", `{"en":"Vulpix"}`},
		{25, "pikachu", `{"en":"Pikachu","de":"Pikachu"}`},
		{129, "magikarp", `{"en":"Magikarp","de":"Karpador"}`},
		{133, "eevee", `{"en":"Eevee","de":"Evoli"}`},
	}
	for _, s := range species {
		if _, err := db.Exec(
			`INSERT INTO pokedex_species (id, canonical, names_json) VALUES (?, ?, ?)`, s.id, s.canonical, s.names,
		); err != nil {
			t.Fatalf("seed species %d: %v", s.id, err)
		}
	}
	if _, err := db.Exec(`INSERT INTO pokedex_forms (species_id, canonical, names_json, form_names_json)
		VALUES (37, 'vulpix-alola', '{"en":"Alolan Vulpix","de":"Alola-Vulpix"}', '{"en":"Alola","de":"Alola"}')`); err != nil {
		t.Fatalf("seed form: %v", err)
	}
	if _, err := db.Exec(
		`INSERT INTO settings_languages (language, sort_order) VALUES ('de', 0), ('en', 1)`,
	); err != nil {
		t.Fatalf("seed languages: %v", err)
	}
}

// readMigratedPokemon returns every migrated catch in the order the migration
// wrote it.
func readMigratedPokemon(t *testing.T, db *sql.DB) []migratedPokemon {
	t.Helper()
	rows, err := db.Query(`SELECT id, name, base_name, form_name, nickname, title, canonical_name, gender,
			sprite_url, sprite_type, sprite_style, encounters, step, is_active, created_at, language, game,
			completed_at, overlay_mode, hunt_type, shiny_charm, shiny_variant, entry_source, timer_started_at,
			timer_accumulated_ms, hunt_mode, group_id, phase_of, phase_number, sort_order, catch_meta, failed
		FROM pokemon WHERE entry_source = 'manual' ORDER BY sort_order`)
	if err != nil {
		t.Fatalf("read migrated pokemon: %v", err)
	}
	defer func() { _ = rows.Close() }()

	var result []migratedPokemon
	for rows.Next() {
		var p migratedPokemon
		if err := rows.Scan(&p.id, &p.name, &p.baseName, &p.formName, &p.nickname, &p.title, &p.canonicalName,
			&p.gender, &p.spriteURL, &p.spriteType, &p.spriteStyle, &p.encounters, &p.step, &p.isActive,
			&p.createdAt, &p.language, &p.game, &p.completedAt, &p.overlayMode, &p.huntType, &p.shinyCharm,
			&p.shinyVariant, &p.entrySource, &p.timerStartedAt, &p.timerAccumulatedMs, &p.huntMode, &p.groupID,
			&p.phaseOf, &p.phaseNumber, &p.sortOrder, &p.catchMeta, &p.failed); err != nil {
			t.Fatalf("scan migrated pokemon: %v", err)
		}
		result = append(result, p)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate migrated pokemon: %v", err)
	}
	return result
}

// localMidnight formats a date the way migration 55 stores a completion: local
// midnight in RFC3339, which is what the state loader can read back.
func localMidnight(t *testing.T, date string) string {
	t.Helper()
	parsed, err := time.ParseInLocation("2006-01-02", date, time.Local)
	if err != nil {
		t.Fatalf("parse %q: %v", date, err)
	}
	return parsed.Format(time.RFC3339)
}

// migration55Want builds the expected rows for the seeded specimens. ids holds
// the minted uuids in row order, because the migration cannot be asked for them
// beforehand.
func migration55Want(t *testing.T, ids []string) []migratedPokemon {
	t.Helper()
	base := migratedPokemon{
		spriteType: "shiny", overlayMode: "default", huntMode: "both", entrySource: "manual", language: "de",
	}
	rows := make([]migratedPokemon, 7)
	for i := range rows {
		rows[i] = base
		rows[i].id = ids[i]
		rows[i].sortOrder = i
	}

	rows[0].name, rows[0].baseName, rows[0].formName = "Alola-Vulpix", "Vulpix", "Alola"
	rows[0].canonicalName, rows[0].gender, rows[0].game = "vulpix-alola", "female", "pokemon-sun"
	rows[0].huntType, rows[0].encounters, rows[0].timerAccumulatedMs = "soft_reset", 8192, 3_661_000
	rows[0].createdAt, rows[0].completedAt = "2019-12-24T18:00:00Z", localMidnight(t, "2020-01-02")
	rows[0].nickname, rows[0].shinyVariant = "Snow", "square"
	rows[0].catchMeta = `{"hp":31,"ribbons":[],"evolutions":[{"canonical_name":"ninetales-alola"}]}`

	rows[1].name, rows[1].baseName, rows[1].canonicalName = "Karpador", "Karpador", "magikarp"
	rows[1].game, rows[1].huntType, rows[1].encounters = "pokemon-sun", "soft_reset", 400
	rows[1].createdAt, rows[1].completedAt = "2019-12-25T10:00:00Z", localMidnight(t, "2020-01-01")
	rows[1].nickname, rows[1].phaseOf, rows[1].phaseNumber = "Karpi", ids[0], 1

	rows[2].name, rows[2].baseName, rows[2].canonicalName = "Karpador", "Karpador", "magikarp"
	rows[2].game, rows[2].huntType, rows[2].encounters = "pokemon-sun", "soft_reset", 900
	rows[2].createdAt, rows[2].completedAt = "2019-12-26T10:00:00Z", localMidnight(t, "2020-01-02")
	rows[2].phaseOf, rows[2].phaseNumber = ids[0], 2

	rows[3].name, rows[3].baseName, rows[3].canonicalName = "Pikachu", "Pikachu", "pikachu"
	rows[3].huntType, rows[3].encounters, rows[3].shinyVariant = "random", 12, "star"
	rows[3].createdAt, rows[3].completedAt = "2021-03-01T08:00:00Z", localMidnight(t, "2021-03-04")

	rows[4].name, rows[4].baseName, rows[4].canonicalName = "Pikachu", "Pikachu", "pikachu"
	rows[4].game = "pokemon-red"
	// No completion date, so the specimen's own creation time stands in.
	rows[4].createdAt, rows[4].completedAt = "2019-05-06T07:08:09Z", "2019-05-06T07:08:09Z"

	rows[5].name, rows[5].game = "#999", "pokemon-red"
	// No usable creation time either, so the completion date stands in.
	rows[5].createdAt = localMidnight(t, "2022-06-07")
	rows[5].completedAt = rows[5].createdAt

	rows[6].name, rows[6].baseName, rows[6].canonicalName = "Evoli", "Evoli", "eevee"
	rows[6].game, rows[6].phaseNumber = "pokemon-red", 3
	// phaseOf, createdAt and completedAt are checked separately: the orphaned
	// parent link and both timestamps are generated, not derived from the seed.
	return rows
}

// snapshotSpecimens renders the whole pokedex_specimens table as text, so a test
// can prove the migration left its source data untouched.
func snapshotSpecimens(t *testing.T, db *sql.DB) string {
	t.Helper()
	rows, err := db.Query(`SELECT id, pokedex_id, species_id, form_canonical, gender, game, completed_at,
			hunt_type, encounters, timer_accumulated_ms, phase_of, phase_number, meta_json, created_at, updated_at
		FROM pokedex_specimens ORDER BY id`)
	if err != nil {
		t.Fatalf("snapshot specimens: %v", err)
	}
	defer func() { _ = rows.Close() }()

	var out strings.Builder
	for rows.Next() {
		cols := make([]any, 15)
		values := make([]sql.NullString, 15)
		for i := range values {
			cols[i] = &values[i]
		}
		if err := rows.Scan(cols...); err != nil {
			t.Fatalf("scan specimen snapshot: %v", err)
		}
		for _, v := range values {
			fmt.Fprintf(&out, "%q|", v.String)
		}
		out.WriteString("\n")
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate specimen snapshot: %v", err)
	}
	return out.String()
}

// assertRecent fails unless the timestamp is a readable RFC3339 value from the
// last minute, which is what the migration writes when a specimen carries
// neither a completion date nor a usable creation time.
func assertRecent(t *testing.T, label, value string) {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatalf("%s = %q, want an RFC3339 timestamp: %v", label, value, err)
	}
	if time.Since(parsed) > time.Minute || time.Since(parsed) < -time.Minute {
		t.Errorf("%s = %q, want a timestamp close to now", label, value)
	}
}

// assertMigratedRows compares the migrated rows against the expectation and
// resolves the three values the seed cannot predict: the generated parent link
// of the orphaned phase and its two generated timestamps.
func assertMigratedRows(t *testing.T, got []migratedPokemon, want []migratedPokemon) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("migrated %d rows, want %d", len(got), len(want))
	}
	minted := map[string]bool{}
	for _, row := range got {
		if row.id == "" || minted[row.id] {
			t.Fatalf("migrated id %q is empty or duplicated", row.id)
		}
		minted[row.id] = true
	}
	orphan := got[len(got)-1]
	if orphan.phaseOf == "" || minted[orphan.phaseOf] {
		t.Errorf("orphaned phase points at %q, want a uuid that matches no migrated catch", orphan.phaseOf)
	}
	assertRecent(t, "orphan created_at", orphan.createdAt)
	assertRecent(t, "orphan completed_at", orphan.completedAt)
	got[len(got)-1].phaseOf = ""
	got[len(got)-1].createdAt = ""
	got[len(got)-1].completedAt = ""

	for i := range got {
		if got[i] != want[i] {
			t.Errorf("migrated row %d\n got %+v\nwant %+v", i, got[i], want[i])
		}
	}
}

// assertPokedexMembership checks that every migrated catch joined the given
// Pokédex, including the one whose recorded Pokédex no longer exists.
func assertPokedexMembership(t *testing.T, db *sql.DB, ids []string, pokedexID string) {
	t.Helper()
	for _, id := range ids {
		var found string
		err := db.QueryRow(`SELECT pokedex_id FROM pokedex_pokemon WHERE pokemon_id = ?`, id).Scan(&found)
		if err != nil {
			t.Errorf("pokedex membership of %q: %v", id, err)
			continue
		}
		if found != pokedexID {
			t.Errorf("pokemon %q joined pokedex %q, want %q", id, found, pokedexID)
		}
	}
}

// TestMigration55MigratesSpecimensLosslessly verifies that every manual
// specimen becomes a completed hunt with all of its details, that phase links
// are remapped onto the minted ids, that nickname and shiny variant move into
// their own columns, that the source table is left untouched, and that a second
// run changes nothing.
func TestMigration55MigratesSpecimensLosslessly(t *testing.T) {
	db := openMigratedTestDB(t)
	seedMigration55Pokedex(t, db)
	seeds := migration55Seeds()
	seedSpecimens(t, db, seeds)
	before := snapshotSpecimens(t, db)

	runMigrationTx(t, db, migrateSpecimensToPokemon)

	got := readMigratedPokemon(t, db)
	if len(got) != len(seeds) {
		t.Fatalf("migrated %d rows, want %d", len(got), len(seeds))
	}
	ids := make([]string, len(got))
	for i, row := range got {
		ids[i] = row.id
	}
	assertPokedexMembership(t, db, ids, "default")
	var nulls int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM pokemon WHERE entry_source = 'manual' AND completed_at IS NULL`,
	).Scan(&nulls); err != nil {
		t.Fatalf("count open completions: %v", err)
	}
	if nulls != 0 {
		t.Errorf("%d migrated catches have no completion and read back as running hunts", nulls)
	}
	assertMigratedRows(t, got, migration55Want(t, ids))

	if after := snapshotSpecimens(t, db); after != before {
		t.Errorf("pokedex_specimens changed\n got %s\nwant %s", after, before)
	}

	runMigrationTx(t, db, migrateSpecimensToPokemon)
	second := readMigratedPokemon(t, db)
	if len(second) != len(got) {
		t.Fatalf("second run migrated %d rows in total, want %d", len(second), len(got))
	}
	for i := range second {
		if second[i].id != ids[i] {
			t.Errorf("row %d changed id on the second run: %q, want %q", i, second[i].id, ids[i])
		}
	}
}

// TestMigration55WithoutPokedexData migrates the same specimens on a database
// whose Pokédex sync never ran. Nothing resolves, so every catch keeps a
// "#<species id>" placeholder instead of being dropped.
func TestMigration55WithoutPokedexData(t *testing.T) {
	db := openMigratedTestDB(t)
	seeds := migration55Seeds()
	seedSpecimens(t, db, seeds)

	runMigrationTx(t, db, migrateSpecimensToPokemon)

	got := readMigratedPokemon(t, db)
	if len(got) != len(seeds) {
		t.Fatalf("migrated %d rows, want %d", len(got), len(seeds))
	}
	ids := make([]string, len(got))
	for i, row := range got {
		ids[i] = row.id
	}
	want := migration55Want(t, ids)
	for i := range want {
		want[i].name = fmt.Sprintf("#%d", seeds[i].speciesID)
		want[i].baseName, want[i].formName = "", ""
		want[i].canonicalName = seeds[i].formCanonical
		want[i].language = "en"
	}
	assertMigratedRows(t, got, want)
}

// TestMigration55WithoutPokedexesKeepsCatches verifies that a database whose
// user Pokédexes were all removed still gets its catches, just without a
// membership row: pokedex_pokemon has a foreign key, and a missing Pokédex must
// never cost the user the catch itself.
func TestMigration55WithoutPokedexesKeepsCatches(t *testing.T) {
	db := openMigratedTestDB(t)
	if _, err := db.Exec(`DELETE FROM user_pokedexes`); err != nil {
		t.Fatalf("drop user pokedexes: %v", err)
	}
	// An existing hunt also proves that the migrated rows are appended behind
	// whatever the user already has instead of fighting it for a position.
	if _, err := db.Exec(
		`INSERT INTO pokemon (id, name, sort_order) VALUES ('existing', 'Karpador', 9)`,
	); err != nil {
		t.Fatalf("seed existing hunt: %v", err)
	}
	seedSpecimens(t, db, migration55Seeds())

	runMigrationTx(t, db, migrateSpecimensToPokemon)

	migrated := readMigratedPokemon(t, db)
	if len(migrated) != 7 {
		t.Fatalf("migrated %d rows, want 7", len(migrated))
	}
	for i, row := range migrated {
		if row.sortOrder != 10+i {
			t.Errorf("migrated row %d has sort order %d, want %d", i, row.sortOrder, 10+i)
		}
	}
	var memberships int
	if err := db.QueryRow(`SELECT COUNT(*) FROM pokedex_pokemon`).Scan(&memberships); err != nil {
		t.Fatalf("count memberships: %v", err)
	}
	if memberships != 0 {
		t.Errorf("wrote %d pokedex memberships, want 0", memberships)
	}
}

// catchFacts is everything about a migrated catch that a full save and reload
// must preserve. The timestamps are reduced to instants because the saver
// rewrites them in UTC, which changes the text but not the fact.
type catchFacts struct {
	id                 string
	name               string
	baseName           string
	formName           string
	nickname           string
	canonicalName      string
	gender             string
	game               string
	huntType           string
	shinyVariant       string
	entrySource        string
	phaseOf            string
	phaseNumber        int
	encounters         int
	timerAccumulatedMs int64
	createdAt          int64
	completedAt        int64
	hasCompletion      bool
	catchMeta          string
	pokedexIDs         string
}

// catchFactsOf projects one loaded catch onto the values that must round-trip.
func catchFactsOf(p state.Pokemon) catchFacts {
	facts := catchFacts{
		id: p.ID, name: p.Name, baseName: p.BaseName, formName: p.FormName, nickname: p.Nickname,
		canonicalName: p.CanonicalName, gender: p.Gender, game: p.Game, huntType: p.HuntType,
		shinyVariant: p.ShinyVariant, entrySource: p.EntrySource, phaseOf: p.PhaseOf,
		phaseNumber: p.PhaseNumber, encounters: p.Encounters, timerAccumulatedMs: p.TimerAccumulatedMs,
		createdAt: p.CreatedAt.Unix(), catchMeta: marshalCatchMeta(p.Catch),
		pokedexIDs: strings.Join(p.PokedexIDs, ","),
	}
	if p.CompletedAt != nil {
		facts.hasCompletion = true
		facts.completedAt = p.CompletedAt.Unix()
	}
	return facts
}

// loadManualCatches reads the state through the normal loader and returns the
// migrated catches in load order.
func loadManualCatches(t *testing.T, d *DB) []catchFacts {
	t.Helper()
	st, err := d.LoadFullState()
	if err != nil {
		t.Fatalf("LoadFullState: %v", err)
	}
	var facts []catchFacts
	for _, p := range st.Pokemon {
		if p.EntrySource == "manual" {
			facts = append(facts, catchFactsOf(p))
		}
	}
	return facts
}

// TestMigration55SurvivesLoadState is the guard against a migrated row the
// state loader cannot read: a full save projects the pokemon table onto the
// in-memory state, so an unreadable timestamp or metadata blob silently
// rewrites, or drops, the user's catches on the first save after the upgrade.
func TestMigration55SurvivesLoadState(t *testing.T) {
	d := openInternalTestDB(t)
	// LoadFullState reports "no state at all" without an app_config row, so the
	// singleton the application writes on first start has to exist here too.
	if _, err := d.db.Exec(
		`INSERT INTO app_config (id, active_id, license_accepted) VALUES (1, '', 1)`,
	); err != nil {
		t.Fatalf("seed app_config: %v", err)
	}
	seedMigration55Pokedex(t, d.db)
	seeds := migration55Seeds()
	seedSpecimens(t, d.db, seeds)
	runMigrationTx(t, d.db, migrateSpecimensToPokemon)

	first := loadManualCatches(t, d)
	if len(first) != len(seeds) {
		t.Fatalf("loaded %d migrated catches, want %d", len(first), len(seeds))
	}
	for _, facts := range first {
		if !facts.hasCompletion {
			t.Fatalf("catch %q loads as a running hunt, so its completion did not survive", facts.name)
		}
		if facts.createdAt <= 0 {
			t.Fatalf("catch %q lost its creation time", facts.name)
		}
	}
	fallback, ok := findCatch(first, "#999")
	if !ok {
		t.Fatalf("the unresolved species is missing from the loaded state")
	}
	wantCompletion, err := time.ParseInLocation("2006-01-02", "2022-06-07", time.Local)
	if err != nil {
		t.Fatalf("parse expected completion: %v", err)
	}
	if fallback.completedAt != wantCompletion.Unix() {
		t.Errorf("unresolved catch completed at %d, want %d", fallback.completedAt, wantCompletion.Unix())
	}

	st, err := d.LoadFullState()
	if err != nil {
		t.Fatalf("LoadFullState: %v", err)
	}
	if err := d.SaveFullState(st); err != nil {
		t.Fatalf("SaveFullState: %v", err)
	}

	second := loadManualCatches(t, d)
	if len(second) != len(first) {
		t.Fatalf("%d migrated catches survived the save, want %d", len(second), len(first))
	}
	for i := range first {
		if first[i] != second[i] {
			t.Errorf("catch %d changed across a save\n got %+v\nwant %+v", i, second[i], first[i])
		}
	}
}

// findCatch returns the loaded catch with the given display name.
func findCatch(facts []catchFacts, name string) (catchFacts, bool) {
	for _, f := range facts {
		if f.name == name {
			return f, true
		}
	}
	return catchFacts{}, false
}
