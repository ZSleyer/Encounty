package state

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

const stateJSONFile = "state.json"

// fakeStore is an in-memory StateStore used to observe which persistence path
// flushSave selects (fast counter update vs full save) without a real database.
type fakeStore struct {
	fullSaves    int
	counterCalls int
	lastCounters []PokemonCounters
}

func (f *fakeStore) SaveFullState(*AppState) error     { f.fullSaves++; return nil }
func (f *fakeStore) LoadFullState() (*AppState, error) { return nil, nil }
func (f *fakeStore) HasState() bool                    { return false }
func (f *fakeStore) UpdatePokemonCounters(c []PokemonCounters) error {
	f.counterCalls++
	f.lastCounters = c
	return nil
}
func (f *fakeStore) SaveTemplateImage(string, []byte, int) (int64, error) { return 0, nil }
func (f *fakeStore) LoadTemplateImage(int64) ([]byte, error)              { return nil, nil }
func (f *fakeStore) DeleteTemplateImage(int64) error                      { return nil }
func (f *fakeStore) LoadAppState() ([]byte, error)                        { return nil, nil }
func (f *fakeStore) HasAppState() bool                                    { return false }

// TestFlushSaveRouting verifies that a counter-only mutation flushes through the
// fast UpdatePokemonCounters path, while a structural mutation forces a full
// SaveFullState.
func TestFlushSaveRouting(t *testing.T) {
	f := &fakeStore{}
	m := NewManager(t.TempDir())
	m.SetDB(f)

	// AddPokemon is structural; flush it to establish a clean baseline.
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	if err := m.flushSave(); err != nil {
		t.Fatalf("flushSave (structural add): %v", err)
	}
	if f.fullSaves != 1 || f.counterCalls != 0 {
		t.Fatalf("after add: fullSaves=%d counterCalls=%d, want 1/0", f.fullSaves, f.counterCalls)
	}

	// A counter-only increment must take the fast path.
	m.Increment("p1")
	if err := m.flushSave(); err != nil {
		t.Fatalf("flushSave (counter): %v", err)
	}
	if f.counterCalls != 1 {
		t.Fatalf("counterCalls = %d, want 1", f.counterCalls)
	}
	if f.fullSaves != 1 {
		t.Errorf("fullSaves = %d, want 1 (increment must not trigger full save)", f.fullSaves)
	}
	if len(f.lastCounters) != 1 || f.lastCounters[0].ID != "p1" || f.lastCounters[0].Encounters != 1 {
		t.Errorf("lastCounters = %+v, want [{p1 enc=1}]", f.lastCounters)
	}

	// A structural change (rename) must force a full save even though a counter
	// change may also be pending.
	m.Increment("p1")
	m.UpdatePokemon("p1", Pokemon{Name: "Raichu"})
	if err := m.flushSave(); err != nil {
		t.Fatalf("flushSave (structural update): %v", err)
	}
	if f.fullSaves != 2 {
		t.Errorf("fullSaves = %d, want 2 (structural update forces full save)", f.fullSaves)
	}
	if f.counterCalls != 1 {
		t.Errorf("counterCalls = %d, want 1 (structural pending suppresses fast path)", f.counterCalls)
	}
}

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
			OutputDir: "/some/dir",
			Languages: []string{"en"},
			Overlay:   OverlaySettings{BackgroundAnimation: "none"},
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
}
