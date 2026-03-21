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
	for _, table := range []string{"encounter_events", "pokemon", "settings", "detector_configs"} {
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
