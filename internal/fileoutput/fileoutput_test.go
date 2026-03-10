package fileoutput

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/zsleyer/encounty/internal/state"
)

func TestWriteWithActivePokemon(t *testing.T) {
	dir := t.TempDir()
	w := New(dir, true)

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{
				ID:         "p1",
				Name:       "Pikachu",
				Encounters: 42,
				CreatedAt:  time.Now(),
			},
		},
	}

	w.Write(st)

	// Check encounters.txt
	data, err := os.ReadFile(filepath.Join(dir, "encounters.txt"))
	if err != nil {
		t.Fatalf("reading encounters.txt: %v", err)
	}
	if string(data) != "42" {
		t.Errorf("encounters.txt = %q, want %q", string(data), "42")
	}

	// Check pokemon_name.txt
	data, err = os.ReadFile(filepath.Join(dir, "pokemon_name.txt"))
	if err != nil {
		t.Fatalf("reading pokemon_name.txt: %v", err)
	}
	if string(data) != "Pikachu" {
		t.Errorf("pokemon_name.txt = %q, want %q", string(data), "Pikachu")
	}

	// Check encounters_label.txt
	data, err = os.ReadFile(filepath.Join(dir, "encounters_label.txt"))
	if err != nil {
		t.Fatalf("reading encounters_label.txt: %v", err)
	}
	want := "Pikachu: 42 Encounters"
	if string(data) != want {
		t.Errorf("encounters_label.txt = %q, want %q", string(data), want)
	}

	// Check session_duration.txt exists
	if _, err := os.Stat(filepath.Join(dir, "session_duration.txt")); err != nil {
		t.Errorf("session_duration.txt should exist: %v", err)
	}

	// Check encounters_today.txt exists
	if _, err := os.Stat(filepath.Join(dir, "encounters_today.txt")); err != nil {
		t.Errorf("encounters_today.txt should exist: %v", err)
	}
}

func TestWriteWithNoActivePokemon(t *testing.T) {
	dir := t.TempDir()
	w := New(dir, true)

	st := state.AppState{
		ActiveID: "nonexistent",
		Pokemon:  []state.Pokemon{},
	}

	w.Write(st)

	data, err := os.ReadFile(filepath.Join(dir, "encounters.txt"))
	if err != nil {
		t.Fatalf("reading encounters.txt: %v", err)
	}
	if string(data) != "0" {
		t.Errorf("encounters.txt = %q, want %q", string(data), "0")
	}

	data, err = os.ReadFile(filepath.Join(dir, "pokemon_name.txt"))
	if err != nil {
		t.Fatalf("reading pokemon_name.txt: %v", err)
	}
	if string(data) != "—" {
		t.Errorf("pokemon_name.txt = %q, want %q", string(data), "—")
	}
}

func TestWriteWhenDisabled(t *testing.T) {
	dir := t.TempDir()
	w := New(dir, false)

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Pikachu", Encounters: 10, CreatedAt: time.Now()},
		},
	}

	w.Write(st)

	// Files should not be created
	if _, err := os.Stat(filepath.Join(dir, "encounters.txt")); !os.IsNotExist(err) {
		t.Error("encounters.txt should not exist when output is disabled")
	}
}

func TestSetConfig(t *testing.T) {
	dir1 := t.TempDir()
	dir2 := t.TempDir()

	w := New(dir1, false)

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Pikachu", Encounters: 5, CreatedAt: time.Now()},
		},
	}

	// Initially disabled, should not write
	w.Write(st)
	if _, err := os.Stat(filepath.Join(dir1, "encounters.txt")); !os.IsNotExist(err) {
		t.Error("should not write when disabled")
	}

	// Enable and change directory
	w.SetConfig(dir2, true)
	w.Write(st)

	data, err := os.ReadFile(filepath.Join(dir2, "encounters.txt"))
	if err != nil {
		t.Fatalf("reading encounters.txt: %v", err)
	}
	if string(data) != "5" {
		t.Errorf("encounters.txt = %q, want %q", string(data), "5")
	}

	// dir1 should still be empty
	if _, err := os.Stat(filepath.Join(dir1, "encounters.txt")); !os.IsNotExist(err) {
		t.Error("old directory should not have files")
	}
}

func TestWriteEmptyDir(t *testing.T) {
	w := New("", true)

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Pikachu", Encounters: 5, CreatedAt: time.Now()},
		},
	}

	// Should be a no-op, not panic
	w.Write(st)
}
