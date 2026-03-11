package detector

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/zsleyer/encounty/internal/state"
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

	broadcast := func(msgType string, payload any) {}
	mgr := NewManager(stateMgr, broadcast, tmpDir)
	return mgr, pokemonID
}

// writeTemplateFile creates a minimal PNG template file in the expected
// directory structure and returns a DetectorConfig referencing it.
func writeTemplateFile(t *testing.T, tmpDir, pokemonID string) state.DetectorConfig {
	t.Helper()
	tmplDir := filepath.Join(tmpDir, "templates", pokemonID)
	if err := os.MkdirAll(tmplDir, 0o755); err != nil {
		t.Fatal(err)
	}
	tmplPath := filepath.Join(tmplDir, "test.png")
	f, err := os.Create(tmplPath)
	if err != nil {
		t.Fatal(err)
	}
	img := image.NewRGBA(image.Rect(0, 0, 32, 32))
	for y := 0; y < 32; y++ {
		for x := 0; x < 32; x++ {
			if (x/4+y/4)%2 == 0 {
				img.SetRGBA(x, y, color.RGBA{0, 0, 0, 255})
			} else {
				img.SetRGBA(x, y, color.RGBA{255, 255, 255, 255})
			}
		}
	}
	if err := png.Encode(f, img); err != nil {
		f.Close()
		t.Fatal(err)
	}
	f.Close()

	return state.DetectorConfig{
		Enabled:    true,
		SourceType: "screen_region",
		Templates: []state.DetectorTemplate{
			{ImagePath: "test.png"},
		},
		Precision:       0.85,
		ConsecutiveHits: 1,
		CooldownSec:     1,
	}
}

func TestManager_StartStop(t *testing.T) {
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

func TestManager_StopIdempotent(t *testing.T) {
	mgr, pokemonID := setupTestManager(t)

	// Stopping a detector that was never started should not panic
	mgr.Stop(pokemonID)
	mgr.Stop(pokemonID)
	if mgr.IsRunning(pokemonID) {
		t.Error("IsRunning() = true after Stop on non-running detector")
	}
}

func TestManager_StartReplacesExisting(t *testing.T) {
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

func TestManager_StopAll(t *testing.T) {
	tmpDir := t.TempDir()
	stateMgr := state.NewManager(tmpDir)

	stateMgr.AddPokemon(state.Pokemon{ID: "p1", Name: "A", Language: "en"})
	stateMgr.AddPokemon(state.Pokemon{ID: "p2", Name: "B", Language: "en"})

	broadcast := func(msgType string, payload any) {}
	mgr := NewManager(stateMgr, broadcast, tmpDir)

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

func TestManager_RunningIDs(t *testing.T) {
	tmpDir := t.TempDir()
	stateMgr := state.NewManager(tmpDir)

	stateMgr.AddPokemon(state.Pokemon{ID: "p1", Name: "A", Language: "en"})
	stateMgr.AddPokemon(state.Pokemon{ID: "p2", Name: "B", Language: "en"})

	broadcast := func(msgType string, payload any) {}
	mgr := NewManager(stateMgr, broadcast, tmpDir)

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

func TestManager_GetOrCreateBrowserDetector(t *testing.T) {
	mgr, pokemonID := setupTestManager(t)
	tmpDir := mgr.configDir

	cfg := writeTemplateFile(t, tmpDir, pokemonID)

	bd1 := mgr.GetOrCreateBrowserDetector(pokemonID, cfg)
	if bd1 == nil {
		t.Fatal("GetOrCreateBrowserDetector returned nil")
	}

	// Calling again with the same ID should return the same instance
	bd2 := mgr.GetOrCreateBrowserDetector(pokemonID, cfg)
	if bd1 != bd2 {
		t.Error("GetOrCreateBrowserDetector returned different instance for same ID")
	}

	if !mgr.IsBrowserRunning(pokemonID) {
		t.Error("IsBrowserRunning() = false after GetOrCreateBrowserDetector")
	}
}

func TestManager_ResetBrowserDetector(t *testing.T) {
	mgr, pokemonID := setupTestManager(t)
	tmpDir := mgr.configDir

	cfg := writeTemplateFile(t, tmpDir, pokemonID)

	bd1 := mgr.GetOrCreateBrowserDetector(pokemonID, cfg)
	bd2 := mgr.ResetBrowserDetector(pokemonID, cfg)

	if bd1 == bd2 {
		t.Error("ResetBrowserDetector should return a new instance")
	}
	if !mgr.IsBrowserRunning(pokemonID) {
		t.Error("IsBrowserRunning() = false after ResetBrowserDetector")
	}
}

func TestManager_StopRemovesBrowserDetector(t *testing.T) {
	mgr, pokemonID := setupTestManager(t)
	cfg := state.DetectorConfig{Enabled: true}

	_ = mgr.GetOrCreateBrowserDetector(pokemonID, cfg)
	if !mgr.IsBrowserRunning(pokemonID) {
		t.Fatal("IsBrowserRunning should be true")
	}

	mgr.Stop(pokemonID)
	if mgr.IsBrowserRunning(pokemonID) {
		t.Error("IsBrowserRunning() = true after Stop, want false")
	}
}

func TestManager_SetBroadcast(t *testing.T) {
	mgr, _ := setupTestManager(t)
	called := false
	mgr.SetBroadcast(func(msgType string, payload any) {
		called = true
	})
	// Verify the broadcast was replaced by invoking it through the manager
	mgr.broadcast("test", nil)
	if !called {
		t.Error("SetBroadcast did not replace the broadcast function")
	}
}
