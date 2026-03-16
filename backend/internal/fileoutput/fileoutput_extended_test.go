package fileoutput

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// TestWriteFileErrorPath exercises the error branch in writeFile by
// attempting to write to a path that cannot be created.
func TestWriteFileErrorPath(t *testing.T) {
	w := New("/dev/null", true)

	// Writing to /dev/null (a file, not a directory) should fail
	// for sub-files, but the Write method catches the error in writeFile
	// and logs it instead of panicking.
	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Pikachu", Encounters: 5, CreatedAt: time.Now()},
		},
	}

	// /dev/null is a file, not a dir, so MkdirAll will fail.
	// This covers the MkdirAll error path in Write().
	w.Write(st)
}

// TestWriteToReadOnlyFile tests that writeFile handles permission errors
// gracefully (logs instead of panicking).
func TestWriteToUnwritablePath(t *testing.T) {
	dir := t.TempDir()
	w := New(dir, true)

	// Create a sub-directory where a file should be, making the write fail
	filePath := filepath.Join(dir, "encounters.txt")
	if err := os.MkdirAll(filePath, 0755); err != nil {
		t.Fatalf("setup: %v", err)
	}

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Pikachu", Encounters: 5, CreatedAt: time.Now()},
		},
	}

	// Should not panic; writeFile logs the error
	w.Write(st)
}

// TestWriteMultiplePokemon ensures the "encounters_today" total is correct
// when there are multiple pokemon.
func TestWriteMultiplePokemon(t *testing.T) {
	dir := t.TempDir()
	w := New(dir, true)

	now := time.Now()
	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Pikachu", Encounters: 10, CreatedAt: now, IsActive: true},
			{ID: "p2", Name: "Charmander", Encounters: 20, CreatedAt: now},
		},
	}

	w.Write(st)

	data, err := os.ReadFile(filepath.Join(dir, "encounters_today.txt"))
	if err != nil {
		t.Fatalf("reading encounters_today.txt: %v", err)
	}
	// All encounters summed
	if string(data) != "30" {
		t.Errorf("encounters_today.txt = %q, want %q", string(data), "30")
	}

	// Active pokemon encounters
	data, err = os.ReadFile(filepath.Join(dir, "encounters.txt"))
	if err != nil {
		t.Fatalf("reading encounters.txt: %v", err)
	}
	if string(data) != "10" {
		t.Errorf("encounters.txt = %q, want %q", string(data), "10")
	}
}
