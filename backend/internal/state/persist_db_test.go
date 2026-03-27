// persist_db_test.go exercises the database-backed Save/Load paths in the
// state package. It uses an external test package to avoid an import cycle
// between state and database.
package state_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/state"
)

const (
	hotkeyCtrl1 = "Ctrl+1"
	hotkeyCtrl4 = "Ctrl+4"
	fmtSave     = "Save: %v"
	fmtLoad     = "Load: %v"
)

// openTestDB creates a fresh SQLite database in dir and registers cleanup.
func openTestDB(t *testing.T, dir string) *database.DB {
	t.Helper()
	db, err := database.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("database.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// makePokemon builds a minimal Pokemon value for testing.
func makePokemon(id, name string) state.Pokemon {
	return state.Pokemon{
		ID:        id,
		Name:      name,
		CreatedAt: time.Now(),
	}
}

// TestSaveAndLoadWithDB verifies that Save persists state to the normalized DB
// and Load reconstructs it faithfully in a fresh Manager.
func TestSaveAndLoadWithDB(t *testing.T) {
	dbDir := t.TempDir()
	db := openTestDB(t, dbDir)

	m := state.NewManager(t.TempDir())
	m.SetDB(db)

	m.AddPokemon(makePokemon("pk1", "Ralts"))
	m.AddPokemon(makePokemon("pk2", "Eevee"))
	m.Increment("pk1")
	m.Increment("pk1")
	m.Increment("pk1")
	m.SetActive("pk2")
	m.UpdateSettings(state.Settings{
		OutputEnabled: true,
		OutputDir:     "/custom/out",
		AutoSave:      true,
		Languages:     []string{"en", "ja"},
		CrispSprites:  true,
	})
	m.UpdateHotkeys(state.HotkeyMap{
		Increment:   hotkeyCtrl1,
		Decrement:   "Ctrl+2",
		Reset:       "Ctrl+3",
		NextPokemon: hotkeyCtrl4,
	})

	if err := m.Save(); err != nil {
		t.Fatalf(fmtSave, err)
	}

	// Load into a completely new Manager wired to the same DB.
	m2 := state.NewManager(t.TempDir())
	m2.SetDB(db)
	if err := m2.Load(); err != nil {
		t.Fatalf(fmtLoad, err)
	}

	st := m2.GetState()

	if st.ActiveID != "pk2" {
		t.Errorf("ActiveID = %q, want %q", st.ActiveID, "pk2")
	}
	if len(st.Pokemon) != 2 {
		t.Fatalf("Pokemon count = %d, want 2", len(st.Pokemon))
	}
	if st.Pokemon[0].Name != "Ralts" {
		t.Errorf("Pokemon[0].Name = %q, want %q", st.Pokemon[0].Name, "Ralts")
	}
	if st.Pokemon[0].Encounters != 3 {
		t.Errorf("Pokemon[0].Encounters = %d, want 3", st.Pokemon[0].Encounters)
	}
	if st.Pokemon[1].Name != "Eevee" {
		t.Errorf("Pokemon[1].Name = %q, want %q", st.Pokemon[1].Name, "Eevee")
	}
	if !st.Settings.OutputEnabled {
		t.Error("OutputEnabled should be true")
	}
	if st.Hotkeys.Increment != hotkeyCtrl1 {
		t.Errorf("Hotkeys.Increment = %q, want %q", st.Hotkeys.Increment, hotkeyCtrl1)
	}
	if st.Hotkeys.NextPokemon != hotkeyCtrl4 {
		t.Errorf("Hotkeys.NextPokemon = %q, want %q", st.Hotkeys.NextPokemon, hotkeyCtrl4)
	}
	if len(st.Settings.Languages) != 2 || st.Settings.Languages[0] != "en" || st.Settings.Languages[1] != "ja" {
		t.Errorf("Languages = %v, want [en ja]", st.Settings.Languages)
	}
}

// TestLoadPrefersDBOverJSON ensures that when both a JSON file and a DB with
// normalized state exist, the DB version takes precedence.
func TestLoadPrefersDBOverJSON(t *testing.T) {
	configDir := t.TempDir()

	// Step 1: Write JSON state to disk (no DB).
	jsonMgr := state.NewManager(configDir)
	jsonMgr.AddPokemon(makePokemon("json1", "Bulbasaur"))
	if err := jsonMgr.Save(); err != nil {
		t.Fatalf("JSON Save: %v", err)
	}

	// Step 2: Create a DB and save different state.
	db := openTestDB(t, configDir)
	dbMgr := state.NewManager(configDir)
	dbMgr.SetDB(db)
	dbMgr.AddPokemon(makePokemon("db1", "Charmander"))
	if err := dbMgr.Save(); err != nil {
		t.Fatalf("DB Save: %v", err)
	}

	// Step 3: Load with DB wired — should get DB version.
	loadMgr := state.NewManager(configDir)
	loadMgr.SetDB(db)
	if err := loadMgr.Load(); err != nil {
		t.Fatalf(fmtLoad, err)
	}

	st := loadMgr.GetState()
	if len(st.Pokemon) != 1 {
		t.Fatalf("Pokemon count = %d, want 1", len(st.Pokemon))
	}
	if st.Pokemon[0].Name != "Charmander" {
		t.Errorf("Pokemon[0].Name = %q, want %q (DB version)", st.Pokemon[0].Name, "Charmander")
	}
}

// TestLoadFallsBackToLegacyBlob ensures that when only the legacy JSON blob
// (app_state table) is present and no normalized state exists, Load reads
// from the legacy blob.
func TestLoadFallsBackToLegacyBlob(t *testing.T) {
	dbDir := t.TempDir()
	db := openTestDB(t, dbDir)

	// Manually insert a legacy JSON blob into the app_state table.
	legacyState := state.AppState{
		ActiveID: "leg1",
		Pokemon: []state.Pokemon{
			{ID: "leg1", Name: "Squirtle", Encounters: 42, CreatedAt: time.Now(), OverlayMode: "default"},
		},
		Sessions: []state.Session{},
		Hotkeys:  state.HotkeyMap{Increment: "F5", Decrement: "F6", Reset: "F7", NextPokemon: "F8"},
		Settings: state.Settings{
			Languages:   []string{"de"},
			Overlay:     state.OverlaySettings{BackgroundAnimation: "none"},
		},
	}
	data, err := json.Marshal(legacyState)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	if err := db.SaveAppState(data); err != nil {
		t.Fatalf("SaveAppState: %v", err)
	}

	// Confirm normalized state is NOT present.
	if db.HasState() {
		t.Fatal("HasState should be false before normalized save")
	}

	m := state.NewManager(t.TempDir())
	m.SetDB(db)
	if err := m.Load(); err != nil {
		t.Fatalf(fmtLoad, err)
	}

	st := m.GetState()
	if len(st.Pokemon) != 1 {
		t.Fatalf("Pokemon count = %d, want 1", len(st.Pokemon))
	}
	if st.Pokemon[0].Name != "Squirtle" {
		t.Errorf("Pokemon[0].Name = %q, want %q", st.Pokemon[0].Name, "Squirtle")
	}
	if st.Pokemon[0].Encounters != 42 {
		t.Errorf("Encounters = %d, want 42", st.Pokemon[0].Encounters)
	}
	if st.Hotkeys.Increment != "F5" {
		t.Errorf("Hotkeys.Increment = %q, want %q", st.Hotkeys.Increment, "F5")
	}
}

// TestReloadNotifiesListeners verifies that Reload triggers OnChange callbacks.
func TestReloadNotifiesListeners(t *testing.T) {
	dbDir := t.TempDir()
	db := openTestDB(t, dbDir)

	m := state.NewManager(t.TempDir())
	m.SetDB(db)
	m.AddPokemon(makePokemon("r1", "Gengar"))

	if err := m.Save(); err != nil {
		t.Fatalf(fmtSave, err)
	}

	var called atomic.Int32
	m.OnChange(func(_ state.AppState) {
		called.Add(1)
	})

	if err := m.Reload(); err != nil {
		t.Fatalf("Reload: %v", err)
	}

	// notify() dispatches callbacks in goroutines; give them a moment to run.
	time.Sleep(50 * time.Millisecond)

	if called.Load() == 0 {
		t.Error("OnChange listener was not called after Reload")
	}
}

// TestSaveAndLoadWithDBPreservesOverlayJSON ensures the JSON file on disk is
// NOT the source when a DB is present, even if the JSON file also exists.
// This is a complementary check to TestLoadPrefersDBOverJSON that also verifies
// the JSON file is left untouched by the DB-backed Save.
func TestSaveWithDBDoesNotWriteJSON(t *testing.T) {
	configDir := t.TempDir()
	db := openTestDB(t, configDir)

	m := state.NewManager(configDir)
	m.SetDB(db)
	m.AddPokemon(makePokemon("nj1", "Mudkip"))

	if err := m.Save(); err != nil {
		t.Fatalf(fmtSave, err)
	}

	// The JSON file should NOT exist because the DB path was used.
	jsonPath := filepath.Join(configDir, "state.json")
	if _, err := os.Stat(jsonPath); err == nil {
		t.Error("state.json should not be written when DB is wired")
	}
}
