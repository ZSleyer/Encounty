// dblocation_test.go covers the record that tells the backend where the
// database lives, and the startup resolution built on top of it.
package state

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDBDirRoundTrip(t *testing.T) {
	configDir := t.TempDir()
	dbDir := t.TempDir()

	if got, err := ReadDBDir(configDir); err != nil || got != "" {
		t.Fatalf("ReadDBDir on a fresh config dir = %q, %v; want \"\", nil", got, err)
	}
	if err := WriteDBDir(configDir, dbDir); err != nil {
		t.Fatalf("WriteDBDir: %v", err)
	}
	got, err := ReadDBDir(configDir)
	if err != nil {
		t.Fatalf("ReadDBDir: %v", err)
	}
	if got != dbDir {
		t.Errorf("ReadDBDir = %q, want %q", got, dbDir)
	}
	// No temporary file may survive the atomic write.
	if _, err := os.Stat(filepath.Join(configDir, dbLocationFile+".tmp")); !os.IsNotExist(err) {
		t.Errorf("temporary record left behind (err = %v)", err)
	}

	if err := ClearDBDir(configDir); err != nil {
		t.Fatalf("ClearDBDir: %v", err)
	}
	if got, err := ReadDBDir(configDir); err != nil || got != "" {
		t.Errorf("after ClearDBDir: %q, %v; want \"\", nil", got, err)
	}
	// Clearing a record that is not there is not an error.
	if err := ClearDBDir(configDir); err != nil {
		t.Errorf("ClearDBDir on a missing record: %v", err)
	}
}

// TestReadDBDirMalformed verifies that a corrupt record is reported rather than
// silently treated as "never relocated", which would open an empty database at
// the default location while the real one sits elsewhere.
func TestReadDBDirMalformed(t *testing.T) {
	configDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(configDir, dbLocationFile), []byte("{not json"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadDBDir(configDir); err == nil {
		t.Error("ReadDBDir accepted a malformed record")
	}
}

func TestResolveDBDir(t *testing.T) {
	t.Run("no record falls back to the config dir", func(t *testing.T) {
		configDir := t.TempDir()
		if got := ResolveDBDir(configDir); got != configDir {
			t.Errorf("ResolveDBDir = %q, want %q", got, configDir)
		}
	})

	t.Run("a recorded directory wins", func(t *testing.T) {
		configDir := t.TempDir()
		dbDir := t.TempDir()
		if err := WriteDBDir(configDir, dbDir); err != nil {
			t.Fatal(err)
		}
		if got := ResolveDBDir(configDir); got != dbDir {
			t.Errorf("ResolveDBDir = %q, want %q", got, dbDir)
		}
	})

	t.Run("an unavailable directory falls back but keeps the record", func(t *testing.T) {
		configDir := t.TempDir()
		gone := filepath.Join(t.TempDir(), "unplugged")
		if err := WriteDBDir(configDir, gone); err != nil {
			t.Fatal(err)
		}
		if got := ResolveDBDir(configDir); got != configDir {
			t.Errorf("ResolveDBDir = %q, want the fallback %q", got, configDir)
		}
		// The record survives, so the database returns to its chosen home once
		// the drive is mounted again.
		if got, _ := ReadDBDir(configDir); got != gone {
			t.Errorf("record = %q, want it kept as %q", got, gone)
		}
	})

	t.Run("no chain: a record inside the target is never followed", func(t *testing.T) {
		configDir := t.TempDir()
		dbDir := t.TempDir()
		other := t.TempDir()
		if err := WriteDBDir(configDir, dbDir); err != nil {
			t.Fatal(err)
		}
		if err := WriteDBDir(dbDir, other); err != nil {
			t.Fatal(err)
		}
		if got := ResolveDBDir(configDir); got != dbDir {
			t.Errorf("ResolveDBDir = %q, want %q (one hop only)", got, dbDir)
		}
	})
}

// TestSetDBDirDrivesDataPath verifies that the state snapshot reports the live
// database directory, which is what the Settings UI shows.
func TestSetDBDirDrivesDataPath(t *testing.T) {
	configDir := t.TempDir()
	dbDir := t.TempDir()
	m := NewManager(configDir)

	if got := m.GetState().DataPath; got != configDir {
		t.Errorf("initial DataPath = %q, want %q", got, configDir)
	}
	m.SetDBDir(dbDir)
	if got := m.GetDBDir(); got != dbDir {
		t.Errorf("GetDBDir = %q, want %q", got, dbDir)
	}
	if got := m.GetState().DataPath; got != dbDir {
		t.Errorf("DataPath = %q, want %q", got, dbDir)
	}
	if got := m.GetConfigDir(); got != configDir {
		t.Errorf("GetConfigDir = %q, want it unchanged at %q", got, configDir)
	}
}

// TestOutputDirFollowsDBDir verifies that the default OBS output folder is
// derived from the database directory, so it moves along with the database.
func TestOutputDirFollowsDBDir(t *testing.T) {
	configDir := t.TempDir()
	dbDir := t.TempDir()

	m := NewManager(configDir)
	m.SetDBDir(dbDir)
	m.UpdateSettings(Settings{})
	m.applyMigrations()

	want := filepath.Join(dbDir, "output")
	if got := m.GetState().Settings.OutputDir; got != want {
		t.Errorf("OutputDir = %q, want %q", got, want)
	}

	custom := filepath.Join(t.TempDir(), "obs")
	m.SetOutputDir(custom)
	if got := m.GetState().Settings.OutputDir; got != custom {
		t.Errorf("SetOutputDir left %q, want %q", got, custom)
	}
}
