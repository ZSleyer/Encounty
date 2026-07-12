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
// maps unknown values to the default acid.
func TestMigrationRemapAccentColorPresets(t *testing.T) {
	cases := []struct {
		old  string
		want string
	}{
		{"blue", "acid"},
		{"green", "acid"},
		{"purple", "violet"},
		{"pink", "crimson"},
		{"orange", "crimson"},
		{"cyan", "cyan"},
		{"unknown", "acid"},
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
