package database

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

// TestSnapshotIncludesUncheckpointedWrites is the regression test for backups
// that came out empty: in WAL mode the main database file lags behind, so a
// snapshot has to come from the connection rather than from the file.
func TestSnapshotIncludesUncheckpointedWrites(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "encounty.db")

	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer func() { _ = db.Close() }()

	if _, err := db.db.Exec(`CREATE TABLE snap_probe (name TEXT)`); err != nil {
		t.Fatalf("create table: %v", err)
	}
	if _, err := db.db.Exec(`INSERT INTO snap_probe (name) VALUES ('Glurak'), ('Pikachu')`); err != nil {
		t.Fatalf("insert: %v", err)
	}

	// Guard the premise: without this the test would pass even if the file copy
	// happened to be current, and would stop covering the actual bug.
	wal, err := os.Stat(dbPath + "-wal")
	if err != nil || wal.Size() == 0 {
		t.Fatalf("expected a non-empty write-ahead log, got %v", err)
	}

	snapshotPath := filepath.Join(dir, "snapshot.db")
	if err := db.Snapshot(snapshotPath); err != nil {
		t.Fatalf("Snapshot() error = %v", err)
	}

	snap, err := sql.Open("sqlite", snapshotPath)
	if err != nil {
		t.Fatalf("open snapshot: %v", err)
	}
	defer func() { _ = snap.Close() }()

	var got int
	if err := snap.QueryRow(`SELECT count(*) FROM snap_probe`).Scan(&got); err != nil {
		t.Fatalf("query snapshot: %v", err)
	}
	if got != 2 {
		t.Errorf("rows in snapshot = %d, want 2", got)
	}
}

// TestSnapshotRejectsOccupiedDestination pins the reason callers must hand
// Snapshot a fresh path: it refuses to write over an existing database rather
// than silently replacing one.
func TestSnapshotRejectsOccupiedDestination(t *testing.T) {
	dir := t.TempDir()
	db, err := Open(filepath.Join(dir, "encounty.db"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer func() { _ = db.Close() }()

	taken := filepath.Join(dir, "taken.db")
	if err := db.Snapshot(taken); err != nil {
		t.Fatalf("first Snapshot() error = %v", err)
	}
	if err := db.Snapshot(taken); err == nil {
		t.Error("second Snapshot() error = nil, want a refusal to overwrite")
	}
}

// TestCloseCheckpointsWAL verifies that the main database file is current once
// Close returns, which is what makes the file safe to copy or move afterwards.
func TestCloseCheckpointsWAL(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "encounty.db")

	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	if _, err := db.db.Exec(`CREATE TABLE probe (name TEXT); INSERT INTO probe VALUES ('Glurak')`); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	// Read the file on its own: renaming the sidecars away first means only a
	// checkpointed main file can still answer the query.
	copyPath := filepath.Join(dir, "copy.db")
	raw, err := os.ReadFile(dbPath)
	if err != nil {
		t.Fatalf("read db: %v", err)
	}
	if err := os.WriteFile(copyPath, raw, 0644); err != nil {
		t.Fatalf("write copy: %v", err)
	}

	plain, err := sql.Open("sqlite", copyPath)
	if err != nil {
		t.Fatalf("open copy: %v", err)
	}
	defer func() { _ = plain.Close() }()

	var name string
	if err := plain.QueryRow(`SELECT name FROM probe`).Scan(&name); err != nil {
		t.Fatalf("query copy: %v", err)
	}
	if name != "Glurak" {
		t.Errorf("name = %q, want %q", name, "Glurak")
	}
}
