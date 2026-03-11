package detector

import (
	"testing"

	"github.com/zsleyer/encounty/internal/state"
)

// TestPokemonLang_Found tests pokemonLang when the pokemon exists with a
// known language code.
func TestPokemonLang_Found(t *testing.T) {
	tmpDir := t.TempDir()
	stateMgr := state.NewManager(tmpDir)
	stateMgr.AddPokemon(state.Pokemon{ID: "p1", Name: "Pikachu", Language: "de"})

	broadcast := func(msgType string, payload any) {}
	mgr := NewManager(stateMgr, broadcast, tmpDir)

	lang := mgr.pokemonLang("p1")
	if lang != "deu" {
		t.Errorf("pokemonLang(p1) = %q, want deu", lang)
	}
}

// TestPokemonLang_NotFound tests pokemonLang when the pokemon ID does not
// exist, which should fall back to "eng".
func TestPokemonLang_NotFound(t *testing.T) {
	tmpDir := t.TempDir()
	stateMgr := state.NewManager(tmpDir)
	stateMgr.AddPokemon(state.Pokemon{ID: "p1", Name: "Pikachu", Language: "de"})

	broadcast := func(msgType string, payload any) {}
	mgr := NewManager(stateMgr, broadcast, tmpDir)

	lang := mgr.pokemonLang("nonexistent")
	if lang != "eng" {
		t.Errorf("pokemonLang(nonexistent) = %q, want eng", lang)
	}
}

// TestStopAll_WithBrowserDetectors tests StopAll when both running detectors
// and browser detectors are present.
func TestStopAll_WithBrowserDetectors(t *testing.T) {
	tmpDir := t.TempDir()
	stateMgr := state.NewManager(tmpDir)
	stateMgr.AddPokemon(state.Pokemon{ID: "p1", Name: "A", Language: "en"})
	stateMgr.AddPokemon(state.Pokemon{ID: "p2", Name: "B", Language: "en"})

	broadcast := func(msgType string, payload any) {}
	mgr := NewManager(stateMgr, broadcast, tmpDir)

	// Start goroutine detectors
	_ = mgr.Start("p1", state.DetectorConfig{Enabled: true})

	// Create browser detectors
	_ = mgr.GetOrCreateBrowserDetector("p2", state.DetectorConfig{Enabled: true})

	if !mgr.IsRunning("p1") {
		t.Fatal("p1 should be running")
	}
	if !mgr.IsBrowserRunning("p2") {
		t.Fatal("p2 browser detector should exist")
	}

	mgr.StopAll()

	if mgr.IsRunning("p1") {
		t.Error("p1 still running after StopAll")
	}
	if mgr.IsBrowserRunning("p2") {
		t.Error("p2 browser detector still exists after StopAll")
	}
}
