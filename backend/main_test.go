package main

import (
	"os"
	"path/filepath"
	"testing"
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

// TestCleanupLegacyArtefacts verifies that the files superseded by the database
// are removed and that nothing else in the configuration directory is touched.
func TestCleanupLegacyArtefacts(t *testing.T) {
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

	cleanupLegacyArtefacts(dir)

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
	cleanupLegacyArtefacts(dir)
}
