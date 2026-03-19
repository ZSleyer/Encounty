package state

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

const stateJSONFile = "state.json"

// TestSaveLoadRoundtrip exercises JSON-only persistence (no DB wired).
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

// TestLoadNonexistentFile ensures Load does not error when no state file exists.
func TestLoadNonexistentFile(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir)

	if err := m.Load(); err != nil {
		t.Fatalf("Load should not error for nonexistent file, got: %v", err)
	}

	st := m.GetState()
	if st.Hotkeys.Increment != "F1" {
		t.Errorf("Hotkeys.Increment = %q, want default %q", st.Hotkeys.Increment, "F1")
	}
}

// TestLoadInvalidJSON ensures Load returns an error for malformed JSON.
func TestLoadInvalidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, stateJSONFile)
	if err := os.WriteFile(path, []byte("not valid json{{{"), 0644); err != nil {
		t.Fatal(err)
	}

	m := NewManager(dir)
	err := m.Load()
	if err == nil {
		t.Fatal("Load should return an error for invalid JSON")
	}
}

// TestLoadMigrationDefaults verifies that migration fills in missing defaults.
func TestLoadMigrationDefaults(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, stateJSONFile)
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

// TestSaveWithoutDBWritesJSON confirms that Save writes a state.json file
// when no database is wired.
func TestSaveWithoutDBWritesJSON(t *testing.T) {
	configDir := t.TempDir()
	m := NewManager(configDir)
	m.AddPokemon(makePokemon("j1", "Pikachu"))
	m.Increment("j1")
	m.Increment("j1")

	if err := m.Save(); err != nil {
		t.Fatalf("Save: %v", err)
	}

	path := filepath.Join(configDir, stateJSONFile)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("state.json not found: %v", err)
	}

	var loaded AppState
	if err := json.Unmarshal(data, &loaded); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if len(loaded.Pokemon) != 1 {
		t.Fatalf("Pokemon count = %d, want 1", len(loaded.Pokemon))
	}
	if loaded.Pokemon[0].Name != "Pikachu" {
		t.Errorf("Name = %q, want %q", loaded.Pokemon[0].Name, "Pikachu")
	}
	if loaded.Pokemon[0].Encounters != 2 {
		t.Errorf("Encounters = %d, want 2", loaded.Pokemon[0].Encounters)
	}
}

// TestLoadFallsBackToJSONFile verifies that when no DB is wired, Load reads
// state from the state.json file on disk.
func TestLoadFallsBackToJSONFile(t *testing.T) {
	configDir := t.TempDir()

	fileState := AppState{
		ActiveID: "f1",
		Pokemon: []Pokemon{
			{ID: "f1", Name: "Jigglypuff", Encounters: 10, OverlayMode: "default"},
		},
		Sessions: []Session{},
		Hotkeys:  HotkeyMap{Increment: "F9", Decrement: "F10", Reset: "F11", NextPokemon: "F12"},
		Settings: Settings{
			BrowserPort: 5555,
			OutputDir:   "/some/dir",
			Languages:   []string{"en"},
			Overlay:     OverlaySettings{BackgroundAnimation: "none"},
		},
	}
	data, err := json.MarshalIndent(fileState, "", "  ")
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	if err := os.WriteFile(filepath.Join(configDir, stateJSONFile), data, 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	m := NewManager(configDir)
	if err := m.Load(); err != nil {
		t.Fatalf("Load: %v", err)
	}

	st := m.GetState()
	if len(st.Pokemon) != 1 {
		t.Fatalf("Pokemon count = %d, want 1", len(st.Pokemon))
	}
	if st.Pokemon[0].Name != "Jigglypuff" {
		t.Errorf("Pokemon[0].Name = %q, want %q", st.Pokemon[0].Name, "Jigglypuff")
	}
	if st.Hotkeys.Increment != "F9" {
		t.Errorf("Hotkeys.Increment = %q, want %q", st.Hotkeys.Increment, "F9")
	}
	if st.Settings.BrowserPort != 5555 {
		t.Errorf("BrowserPort = %d, want 5555", st.Settings.BrowserPort)
	}
}
