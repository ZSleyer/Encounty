package detector

import (
	"testing"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// TestPokemonLangFound tests pokemonLang when the pokemon exists with a
// known language code.
func TestPokemonLangFound(t *testing.T) {
	tmpDir := t.TempDir()
	stateMgr := state.NewManager(tmpDir)
	stateMgr.AddPokemon(state.Pokemon{ID: "p1", Name: "Pikachu", Language: "de"})

	broadcast := func(msgType string, payload any) { // no-op broadcast for test
	}
	mgr := NewManager(stateMgr, broadcast, tmpDir, nil)

	lang := mgr.pokemonLang("p1")
	if lang != "deu" {
		t.Errorf("pokemonLang(p1) = %q, want deu", lang)
	}
}

// TestPokemonLangNotFound tests pokemonLang when the pokemon ID does not
// exist, which should fall back to "eng".
func TestPokemonLangNotFound(t *testing.T) {
	tmpDir := t.TempDir()
	stateMgr := state.NewManager(tmpDir)
	stateMgr.AddPokemon(state.Pokemon{ID: "p1", Name: "Pikachu", Language: "de"})

	broadcast := func(msgType string, payload any) { // no-op broadcast for test
	}
	mgr := NewManager(stateMgr, broadcast, tmpDir, nil)

	lang := mgr.pokemonLang("nonexistent")
	if lang != "eng" {
		t.Errorf("pokemonLang(nonexistent) = %q, want eng", lang)
	}
}

// TestStopAllWithMultipleDetectors tests StopAll when multiple running
// detectors are present.
func TestStopAllWithMultipleDetectors(t *testing.T) {
	tmpDir := t.TempDir()
	stateMgr := state.NewManager(tmpDir)
	stateMgr.AddPokemon(state.Pokemon{ID: "p1", Name: "A", Language: "en"})
	stateMgr.AddPokemon(state.Pokemon{ID: "p2", Name: "B", Language: "en"})

	broadcast := func(msgType string, payload any) { // no-op: tests don't need broadcast
	}
	mgr := NewManager(stateMgr, broadcast, tmpDir, nil)

	_ = mgr.Start("p1", state.DetectorConfig{Enabled: true})
	_ = mgr.Start("p2", state.DetectorConfig{Enabled: true})

	if !mgr.IsRunning("p1") {
		t.Fatal("p1 should be running")
	}
	if !mgr.IsRunning("p2") {
		t.Fatal("p2 should be running")
	}

	mgr.StopAll()

	if mgr.IsRunning("p1") {
		t.Error("p1 still running after StopAll")
	}
	if mgr.IsRunning("p2") {
		t.Error("p2 still running after StopAll")
	}
}
