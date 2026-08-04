// migrations_test.go verifies the versioned migration system: fresh databases
// get all migrations, already-migrated databases skip completed ones, failures
// roll back cleanly, and the tracking table records versions correctly.
package database

import (
	"database/sql"
	"fmt"
	"testing"
	"time"
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
	for _, table := range []string{"encounter_events", "pokemon", "settings", "detector_configs", "capture_resolutions"} {
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
