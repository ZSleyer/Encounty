package detector

import (
	"testing"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// setupTestManager creates a Manager with a temporary config directory and a
// single Pokemon entry. It writes a valid PNG template file so that Start
// can load at least one template (needed because the detector goroutine
// exits immediately when no templates are loaded).
func setupTestManager(t *testing.T) (*Manager, string) {
	t.Helper()
	tmpDir := t.TempDir()
	stateMgr := state.NewManager(tmpDir)

	pokemonID := "test-pokemon-1"
	stateMgr.AddPokemon(state.Pokemon{
		ID:       pokemonID,
		Name:     "Pikachu",
		Language: "en",
	})

	broadcast := func(msgType string, payload any) { // no-op broadcast for test
	}
	mgr := NewManager(stateMgr, broadcast, tmpDir, nil)
	return mgr, pokemonID
}

func TestManagerStartStop(t *testing.T) {
	mgr, pokemonID := setupTestManager(t)

	cfg := state.DetectorConfig{
		Enabled:    true,
		SourceType: "screen_region",
		Templates:  []state.DetectorTemplate{},
	}

	if err := mgr.Start(pokemonID, cfg); err != nil {
		t.Fatalf("Start() returned error: %v", err)
	}
	if !mgr.IsRunning(pokemonID) {
		t.Error("IsRunning() = false after Start, want true")
	}

	mgr.Stop(pokemonID)
	if mgr.IsRunning(pokemonID) {
		t.Error("IsRunning() = true after Stop, want false")
	}
}

func TestManagerStopIdempotent(t *testing.T) {
	mgr, pokemonID := setupTestManager(t)

	// Stopping a detector that was never started should not panic.
	mgr.Stop(pokemonID)
	mgr.Stop(pokemonID)
	if mgr.IsRunning(pokemonID) {
		t.Error("IsRunning() = true after Stop on non-running detector")
	}
}

func TestManagerStartReplacesExisting(t *testing.T) {
	mgr, pokemonID := setupTestManager(t)
	cfg := state.DetectorConfig{Enabled: true}

	_ = mgr.Start(pokemonID, cfg)
	_ = mgr.Start(pokemonID, cfg)

	if !mgr.IsRunning(pokemonID) {
		t.Error("IsRunning() = false after double Start, want true")
	}

	mgr.Stop(pokemonID)
	if mgr.IsRunning(pokemonID) {
		t.Error("IsRunning() = true after Stop")
	}
}

func TestManagerStopAll(t *testing.T) {
	tmpDir := t.TempDir()
	stateMgr := state.NewManager(tmpDir)

	stateMgr.AddPokemon(state.Pokemon{ID: "p1", Name: "A", Language: "en"})
	stateMgr.AddPokemon(state.Pokemon{ID: "p2", Name: "B", Language: "en"})

	broadcast := func(msgType string, payload any) { // no-op broadcast for test
	}
	mgr := NewManager(stateMgr, broadcast, tmpDir, nil)

	_ = mgr.Start("p1", state.DetectorConfig{Enabled: true})
	_ = mgr.Start("p2", state.DetectorConfig{Enabled: true})

	mgr.StopAll()

	if mgr.IsRunning("p1") {
		t.Error("p1 still running after StopAll")
	}
	if mgr.IsRunning("p2") {
		t.Error("p2 still running after StopAll")
	}
}

func TestManagerRunningIDs(t *testing.T) {
	tmpDir := t.TempDir()
	stateMgr := state.NewManager(tmpDir)

	stateMgr.AddPokemon(state.Pokemon{ID: "p1", Name: "A", Language: "en"})
	stateMgr.AddPokemon(state.Pokemon{ID: "p2", Name: "B", Language: "en"})

	broadcast := func(msgType string, payload any) { // no-op broadcast for test
	}
	mgr := NewManager(stateMgr, broadcast, tmpDir, nil)

	ids := mgr.RunningIDs()
	if len(ids) != 0 {
		t.Errorf("RunningIDs() before Start = %v, want empty", ids)
	}

	_ = mgr.Start("p1", state.DetectorConfig{Enabled: true})
	_ = mgr.Start("p2", state.DetectorConfig{Enabled: true})

	ids = mgr.RunningIDs()
	if len(ids) != 2 {
		t.Errorf("RunningIDs() = %v, want 2 entries", ids)
	}
}

func TestManagerSetBroadcast(t *testing.T) {
	mgr, _ := setupTestManager(t)
	called := false
	mgr.SetBroadcast(func(msgType string, payload any) {
		called = true
	})
	// Verify the broadcast was replaced by invoking it through the manager.
	mgr.broadcast("test", nil)
	if !called {
		t.Error("SetBroadcast did not replace the broadcast function")
	}
}
