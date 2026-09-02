package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/state"
)

func TestFormatVersionDisplay(t *testing.T) {
	tests := []struct {
		name string
		ver  string
		cmt  string
		want string
	}{
		{
			name: "release version",
			ver:  "v0.3",
			cmt:  "abc1234",
			want: "v0.3-abc1234",
		},
		{
			name: "dev version",
			ver:  "dev",
			cmt:  "abc1234",
			want: "dev-abc1234",
		},
		{
			name: "empty commit",
			ver:  "v1.0.0",
			cmt:  "",
			want: "v1.0.0-",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := formatVersionDisplay(tt.ver, tt.cmt)
			if got != tt.want {
				t.Errorf("formatVersionDisplay(%q, %q) = %q, want %q",
					tt.ver, tt.cmt, got, tt.want)
			}
		})
	}
}

// TestCleanupLegacyArtifacts verifies that the files superseded by the database
// are removed and that nothing else in the configuration directory is touched.
func TestCleanupLegacyArtifacts(t *testing.T) {
	dir := t.TempDir()

	legacy := []string{"state.json", "pokemon.json"}
	for _, name := range legacy {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("{}"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(dir, "templates", "p1"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "templates", "p1", "template_0.png"), []byte("png"), 0644); err != nil {
		t.Fatal(err)
	}

	// Everything that has to survive: the live database, its record, caches and
	// user uploads.
	keep := []string{"encounty.db", "db-location.json"}
	for _, name := range keep {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"sprite-cache", "backgrounds"} {
		if err := os.MkdirAll(filepath.Join(dir, name), 0755); err != nil {
			t.Fatal(err)
		}
	}

	cleanupLegacyArtifacts(dir)

	for _, name := range append(legacy, "templates") {
		if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
			t.Errorf("%s survived the cleanup (err = %v)", name, err)
		}
	}
	for _, name := range append(keep, "sprite-cache", "backgrounds") {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Errorf("%s was removed: %v", name, err)
		}
	}

	// Running again on a clean directory is a no-op, not an error.
	cleanupLegacyArtifacts(dir)
}

// TestImportBackgrounds verifies that background images move into the database
// and that a file is only removed once it is stored.
func TestImportBackgrounds(t *testing.T) {
	dir := t.TempDir()
	bgDir := filepath.Join(dir, "backgrounds")
	if err := os.MkdirAll(bgDir, 0755); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{
		"bg_1.png":  "first",
		"bg_2.jpeg": "second",
	} {
		if err := os.WriteFile(filepath.Join(bgDir, name), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}

	db, err := database.Open(filepath.Join(t.TempDir(), "encounty.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	// An overlay referencing one of them, so the orphan sweep keeps it.
	st := state.AppState{}
	st.Settings.Overlay.BackgroundImage = "bg_1.png"
	if err := db.SaveFullState(&st); err != nil {
		t.Fatal(err)
	}

	importBackgrounds(dir, db)
	sweepOrphanBackgrounds(db)

	data, mime, err := db.LoadBackground("bg_1.png")
	if err != nil || string(data) != "first" {
		t.Fatalf("bg_1.png not imported: %q, %v", string(data), err)
	}
	if mime != "image/png" {
		t.Errorf("mime = %q, want image/png", mime)
	}
	// bg_2.jpeg is unreferenced, so the sweep removes it right after the import.
	if db.HasBackground("bg_2.jpeg") {
		t.Error("an unreferenced image survived the import")
	}
	if _, err := os.Stat(bgDir); !os.IsNotExist(err) {
		t.Errorf("the backgrounds directory was left behind (err = %v)", err)
	}
}

// TestImportBackgroundsKeepsUnreadableFiles verifies that a file that cannot be
// read stays on disk instead of being lost.
func TestImportBackgroundsKeepsUnreadableFiles(t *testing.T) {
	dir := t.TempDir()
	bgDir := filepath.Join(dir, "backgrounds")
	if err := os.MkdirAll(bgDir, 0755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(bgDir, "bg_locked.png")
	if err := os.WriteFile(path, []byte("data"), 0000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(path, 0644) })

	db, err := database.Open(filepath.Join(t.TempDir(), "encounty.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	importBackgrounds(dir, db)

	if _, err := os.Stat(path); err != nil {
		t.Errorf("an unreadable image was removed anyway: %v", err)
	}
	if db.HasBackground("bg_locked.png") {
		t.Error("an unreadable image was recorded as imported")
	}
}

// TestSweepOrphanBackgroundsSpareAFreshInstall verifies the guard that keeps a
// fresh installation from deleting the images it has just imported: without
// state in the database nothing can reference anything yet.
func TestSweepOrphanBackgroundsSparesAFreshInstall(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "encounty.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if err := db.SaveBackground("bg_1.png", []byte("data"), "image/png"); err != nil {
		t.Fatal(err)
	}

	sweepOrphanBackgrounds(db)

	if !db.HasBackground("bg_1.png") {
		t.Error("the sweep removed an image although the database carries no state yet")
	}
}
