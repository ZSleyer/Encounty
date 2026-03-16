package state

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSaveLoadRoundtrip(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir)
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.Increment("p1")
	m.Increment("p1")
	m.UpdateSettings(Settings{
		OutputEnabled: true,
		OutputDir:     "/tmp/out",
		BrowserPort:   9999,
	})

	if err := m.Save(); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	// Load into a new manager
	m2 := NewManager(dir)
	if err := m2.Load(); err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	st := m2.GetState()
	if len(st.Pokemon) != 1 {
		t.Fatalf("Pokemon length = %d, want 1", len(st.Pokemon))
	}
	if st.Pokemon[0].Name != "Pikachu" {
		t.Errorf("Name = %q, want %q", st.Pokemon[0].Name, "Pikachu")
	}
	if st.Pokemon[0].Encounters != 2 {
		t.Errorf("Encounters = %d, want 2", st.Pokemon[0].Encounters)
	}
	if !st.Settings.OutputEnabled {
		t.Error("OutputEnabled should be true")
	}
	if st.Settings.BrowserPort != 9999 {
		t.Errorf("BrowserPort = %d, want 9999", st.Settings.BrowserPort)
	}
	// DataPath should be updated to configDir on load
	if st.DataPath != dir {
		t.Errorf("DataPath = %q, want %q", st.DataPath, dir)
	}
}

func TestLoadNonexistentFile(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir)

	// Loading from a directory with no state.json should not error
	if err := m.Load(); err != nil {
		t.Fatalf("Load should not error for nonexistent file, got: %v", err)
	}

	// Defaults should be preserved
	st := m.GetState()
	if st.Hotkeys.Increment != "F1" {
		t.Errorf("Hotkeys.Increment = %q, want default %q", st.Hotkeys.Increment, "F1")
	}
}

func TestLoadInvalidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "state.json")
	if err := os.WriteFile(path, []byte("not valid json{{{"), 0644); err != nil {
		t.Fatal(err)
	}

	m := NewManager(dir)
	err := m.Load()
	if err == nil {
		t.Fatal("Load should return an error for invalid JSON")
	}
}

func TestLoadMigrationDefaults(t *testing.T) {
	dir := t.TempDir()
	// Write a minimal valid JSON that lacks BackgroundAnimation and OutputDir
	path := filepath.Join(dir, "state.json")
	data := []byte(`{"pokemon":[],"sessions":[],"hotkeys":{"increment":"F1","decrement":"F2","reset":"F3","next_pokemon":"F4"},"settings":{"output_dir":"","overlay":{"background_animation":""}}}`)
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}

	m := NewManager(dir)
	if err := m.Load(); err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	st := m.GetState()
	if st.Settings.OutputDir == "" {
		t.Error("OutputDir should be set to default after migration")
	}
	if st.Settings.Overlay.BackgroundAnimation != "none" {
		t.Errorf("BackgroundAnimation = %q, want %q", st.Settings.Overlay.BackgroundAnimation, "none")
	}
}
