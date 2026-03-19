package state

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

const (
	linkedP1       = "linked:p1"
	linkedP2       = "linked:p2"
	fmtOverlayMode = "OverlayMode = %q, want %q"
	errUpdateFalse = "UpdatePokemon returned false"
	extStateJSON   = "state.json"
)

// --- AddSession ---

func TestAddSession(t *testing.T) {
	m := NewManager(t.TempDir())

	sess := Session{
		ID:         "s1",
		StartedAt:  time.Now(),
		PokemonID:  "p1",
		Encounters: 0,
	}
	m.AddSession(sess)

	st := m.GetState()
	if len(st.Sessions) != 1 {
		t.Fatalf("Sessions length = %d, want 1", len(st.Sessions))
	}
	if st.Sessions[0].ID != "s1" {
		t.Errorf("Session ID = %q, want %q", st.Sessions[0].ID, "s1")
	}
	if st.Sessions[0].PokemonID != "p1" {
		t.Errorf("Session PokemonID = %q, want %q", st.Sessions[0].PokemonID, "p1")
	}
}

func TestAddSessionMultiple(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddSession(Session{ID: "s1", PokemonID: "p1"})
	m.AddSession(Session{ID: "s2", PokemonID: "p2"})

	st := m.GetState()
	if len(st.Sessions) != 2 {
		t.Fatalf("Sessions length = %d, want 2", len(st.Sessions))
	}
}

// --- EndSession ---

func TestEndSession(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddSession(Session{ID: "s1", StartedAt: time.Now(), PokemonID: "p1"})

	m.EndSession("s1")

	st := m.GetState()
	if st.Sessions[0].EndedAt == nil {
		t.Fatal("EndedAt should be set after ending session")
	}
}

func TestEndSessionNotFound(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddSession(Session{ID: "s1", StartedAt: time.Now(), PokemonID: "p1"})

	// Ending a nonexistent session should not panic
	m.EndSession("nonexistent")

	st := m.GetState()
	if st.Sessions[0].EndedAt != nil {
		t.Error("EndedAt should remain nil for unmatched session")
	}
}

func TestEndSessionAlreadyEnded(t *testing.T) {
	m := NewManager(t.TempDir())
	ended := time.Now().Add(-time.Hour)
	m.AddSession(Session{ID: "s1", StartedAt: time.Now().Add(-2 * time.Hour), EndedAt: &ended, PokemonID: "p1"})

	// Ending an already-ended session should be a no-op
	m.EndSession("s1")

	st := m.GetState()
	if !st.Sessions[0].EndedAt.Equal(ended) {
		t.Error("EndedAt should not change for already-ended session")
	}
}

// --- ResolveOverlay ---

func TestResolveOverlayDefault(t *testing.T) {
	m := NewManager(t.TempDir())
	p := makePokemon("p1", "Pikachu")
	p.OverlayMode = "default"
	m.AddPokemon(p)

	overlay := m.ResolveOverlay("p1")
	defaultOverlay := m.GetState().Settings.Overlay
	if overlay.CanvasWidth != defaultOverlay.CanvasWidth {
		t.Errorf("CanvasWidth = %d, want %d (default)", overlay.CanvasWidth, defaultOverlay.CanvasWidth)
	}
}

func TestResolveOverlayCustom(t *testing.T) {
	m := NewManager(t.TempDir())
	customOverlay := OverlaySettings{CanvasWidth: 1920, CanvasHeight: 1080}
	p := makePokemon("p1", "Pikachu")
	p.OverlayMode = "custom"
	p.Overlay = &customOverlay
	m.AddPokemon(p)

	overlay := m.ResolveOverlay("p1")
	if overlay.CanvasWidth != 1920 {
		t.Errorf("CanvasWidth = %d, want 1920 (custom)", overlay.CanvasWidth)
	}
	if overlay.CanvasHeight != 1080 {
		t.Errorf("CanvasHeight = %d, want 1080 (custom)", overlay.CanvasHeight)
	}
}

func TestResolveOverlayLinked(t *testing.T) {
	m := NewManager(t.TempDir())
	customOverlay := OverlaySettings{CanvasWidth: 500, CanvasHeight: 300}
	p1 := makePokemon("p1", "Pikachu")
	p1.OverlayMode = "custom"
	p1.Overlay = &customOverlay
	m.AddPokemon(p1)

	p2 := makePokemon("p2", "Charmander")
	p2.OverlayMode = linkedP1
	m.AddPokemon(p2)

	overlay := m.ResolveOverlay("p2")
	if overlay.CanvasWidth != 500 {
		t.Errorf("CanvasWidth = %d, want 500 (linked to p1 custom)", overlay.CanvasWidth)
	}
}

func TestResolveOverlayLinkedCycle(t *testing.T) {
	m := NewManager(t.TempDir())

	p1 := makePokemon("p1", "Pikachu")
	p1.OverlayMode = linkedP2
	m.AddPokemon(p1)

	p2 := makePokemon("p2", "Charmander")
	p2.OverlayMode = linkedP1
	m.AddPokemon(p2)

	// Should not infinite-loop; returns default overlay
	overlay := m.ResolveOverlay("p1")
	defaultOverlay := m.GetState().Settings.Overlay
	if overlay.CanvasWidth != defaultOverlay.CanvasWidth {
		t.Errorf("CanvasWidth = %d, want %d (default due to cycle)", overlay.CanvasWidth, defaultOverlay.CanvasWidth)
	}
}

func TestResolveOverlayLinkedToDefault(t *testing.T) {
	m := NewManager(t.TempDir())

	p1 := makePokemon("p1", "Pikachu")
	p1.OverlayMode = "default"
	m.AddPokemon(p1)

	p2 := makePokemon("p2", "Charmander")
	p2.OverlayMode = linkedP1
	m.AddPokemon(p2)

	// p2 links to p1, which uses default
	overlay := m.ResolveOverlay("p2")
	defaultOverlay := m.GetState().Settings.Overlay
	if overlay.CanvasWidth != defaultOverlay.CanvasWidth {
		t.Errorf("CanvasWidth = %d, want %d", overlay.CanvasWidth, defaultOverlay.CanvasWidth)
	}
}

func TestResolveOverlayNonexistentPokemon(t *testing.T) {
	m := NewManager(t.TempDir())

	// Resolving overlay for a nonexistent pokemon returns default
	overlay := m.ResolveOverlay("nonexistent")
	defaultOverlay := m.GetState().Settings.Overlay
	if overlay.CanvasWidth != defaultOverlay.CanvasWidth {
		t.Errorf("CanvasWidth = %d, want %d (default for nonexistent)", overlay.CanvasWidth, defaultOverlay.CanvasWidth)
	}
}

func TestResolveOverlayCustomNilOverlay(t *testing.T) {
	m := NewManager(t.TempDir())

	// Custom mode but nil Overlay pointer falls back to default
	p := makePokemon("p1", "Pikachu")
	p.OverlayMode = "custom"
	p.Overlay = nil
	m.AddPokemon(p)

	overlay := m.ResolveOverlay("p1")
	defaultOverlay := m.GetState().Settings.Overlay
	if overlay.CanvasWidth != defaultOverlay.CanvasWidth {
		t.Errorf("CanvasWidth = %d, want %d (default due to nil overlay)", overlay.CanvasWidth, defaultOverlay.CanvasWidth)
	}
}

// --- UnlinkOverlay ---

func TestUnlinkOverlayDefault(t *testing.T) {
	m := NewManager(t.TempDir())
	p := makePokemon("p1", "Pikachu")
	p.OverlayMode = "default"
	m.AddPokemon(p)

	ok := m.UnlinkOverlay("p1")
	if !ok {
		t.Fatal("UnlinkOverlay returned false")
	}

	st := m.GetState()
	if st.Pokemon[0].OverlayMode != "custom" {
		t.Errorf(fmtOverlayMode, st.Pokemon[0].OverlayMode, "custom")
	}
	if st.Pokemon[0].Overlay == nil {
		t.Error("Overlay should be set after unlink")
	}
	// The unlocked overlay should match the default
	defaultOverlay := st.Settings.Overlay
	if st.Pokemon[0].Overlay.CanvasWidth != defaultOverlay.CanvasWidth {
		t.Errorf("Overlay canvas width mismatch after unlink")
	}
}

func TestUnlinkOverlayLinked(t *testing.T) {
	m := NewManager(t.TempDir())

	customOverlay := OverlaySettings{CanvasWidth: 640, CanvasHeight: 480}
	p1 := makePokemon("p1", "Pikachu")
	p1.OverlayMode = "custom"
	p1.Overlay = &customOverlay
	m.AddPokemon(p1)

	p2 := makePokemon("p2", "Charmander")
	p2.OverlayMode = linkedP1
	m.AddPokemon(p2)

	ok := m.UnlinkOverlay("p2")
	if !ok {
		t.Fatal("UnlinkOverlay returned false")
	}

	st := m.GetState()
	if st.Pokemon[1].OverlayMode != "custom" {
		t.Errorf(fmtOverlayMode, st.Pokemon[1].OverlayMode, "custom")
	}
	if st.Pokemon[1].Overlay == nil {
		t.Fatal("Overlay should be set after unlink")
	}
	if st.Pokemon[1].Overlay.CanvasWidth != 640 {
		t.Errorf("Overlay CanvasWidth = %d, want 640 (copied from linked)", st.Pokemon[1].Overlay.CanvasWidth)
	}
}

func TestUnlinkOverlayNotFound(t *testing.T) {
	m := NewManager(t.TempDir())
	ok := m.UnlinkOverlay("nonexistent")
	if ok {
		t.Error("UnlinkOverlay returned true for nonexistent pokemon")
	}
}

// --- UpdatePokemon extended paths ---

func TestUpdatePokemonOverlayMode(t *testing.T) {
	m := NewManager(t.TempDir())
	p := makePokemon("p1", "Pikachu")
	p.OverlayMode = "default"
	m.AddPokemon(p)

	// Switch to linked mode
	ok := m.UpdatePokemon("p1", Pokemon{OverlayMode: linkedP2})
	if !ok {
		t.Fatal(errUpdateFalse)
	}
	st := m.GetState()
	if st.Pokemon[0].OverlayMode != linkedP2 {
		t.Errorf(fmtOverlayMode, st.Pokemon[0].OverlayMode, linkedP2)
	}
	// Non-custom mode should clear overlay
	if st.Pokemon[0].Overlay != nil {
		t.Error("Overlay should be nil when switching to non-custom mode")
	}
}

func TestUpdatePokemonOverlayModeCustom(t *testing.T) {
	m := NewManager(t.TempDir())
	p := makePokemon("p1", "Pikachu")
	m.AddPokemon(p)

	customOverlay := &OverlaySettings{CanvasWidth: 1000}
	ok := m.UpdatePokemon("p1", Pokemon{OverlayMode: "custom", Overlay: customOverlay})
	if !ok {
		t.Fatal(errUpdateFalse)
	}
	st := m.GetState()
	if st.Pokemon[0].OverlayMode != "custom" {
		t.Errorf(fmtOverlayMode, st.Pokemon[0].OverlayMode, "custom")
	}
	// Note: the code sets overlay first from update.Overlay, but then
	// if OverlayMode != "custom", it clears. For "custom" it stays.
	// Actually the code sets Overlay from update first, then overwrites
	// with nil if not custom. For custom it does NOT clear.
}

func TestUpdatePokemonOverlayField(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	customOverlay := &OverlaySettings{CanvasWidth: 1234}
	ok := m.UpdatePokemon("p1", Pokemon{Overlay: customOverlay})
	if !ok {
		t.Fatal(errUpdateFalse)
	}
	st := m.GetState()
	if st.Pokemon[0].Overlay == nil {
		t.Fatal("Overlay should be set")
	}
	if st.Pokemon[0].Overlay.CanvasWidth != 1234 {
		t.Errorf("Overlay CanvasWidth = %d, want 1234", st.Pokemon[0].Overlay.CanvasWidth)
	}
}

func TestUpdatePokemonClearOverlay(t *testing.T) {
	m := NewManager(t.TempDir())
	p := makePokemon("p1", "Pikachu")
	p.Overlay = &OverlaySettings{CanvasWidth: 999}
	m.AddPokemon(p)

	// Pass nil Overlay to clear it
	ok := m.UpdatePokemon("p1", Pokemon{Name: "Raichu"})
	if !ok {
		t.Fatal(errUpdateFalse)
	}
	st := m.GetState()
	if st.Pokemon[0].Overlay != nil {
		t.Error("Overlay should be cleared when update.Overlay is nil")
	}
}

func TestUpdatePokemonLanguageAndGame(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	ok := m.UpdatePokemon("p1", Pokemon{Language: "en", Game: "red"})
	if !ok {
		t.Fatal(errUpdateFalse)
	}
	st := m.GetState()
	if st.Pokemon[0].Language != "en" {
		t.Errorf("Language = %q, want %q", st.Pokemon[0].Language, "en")
	}
	if st.Pokemon[0].Game != "red" {
		t.Errorf("Game = %q, want %q", st.Pokemon[0].Game, "red")
	}
}

func TestUpdatePokemonSpriteStyle(t *testing.T) {
	m := NewManager(t.TempDir())
	p := makePokemon("p1", "Pikachu")
	p.SpriteStyle = "classic"
	m.AddPokemon(p)

	// Update SpriteStyle to empty (clearing it)
	ok := m.UpdatePokemon("p1", Pokemon{Name: "Pikachu", SpriteStyle: ""})
	if !ok {
		t.Fatal(errUpdateFalse)
	}
	st := m.GetState()
	if st.Pokemon[0].SpriteStyle != "" {
		t.Errorf("SpriteStyle = %q, want empty (cleared)", st.Pokemon[0].SpriteStyle)
	}
}

// --- DeletePokemon extended ---

func TestDeletePokemonResetsLinkedOverlays(t *testing.T) {
	m := NewManager(t.TempDir())

	p1 := makePokemon("p1", "Pikachu")
	p1.OverlayMode = "custom"
	m.AddPokemon(p1)

	p2 := makePokemon("p2", "Charmander")
	p2.OverlayMode = linkedP1
	m.AddPokemon(p2)

	p3 := makePokemon("p3", "Bulbasaur")
	p3.OverlayMode = linkedP1
	m.AddPokemon(p3)

	ok := m.DeletePokemon("p1")
	if !ok {
		t.Fatal("DeletePokemon returned false")
	}

	st := m.GetState()
	// p2 and p3 should have been reset to "default" mode
	for _, p := range st.Pokemon {
		if p.OverlayMode != "default" {
			t.Errorf("Pokemon %q OverlayMode = %q, want %q after deleting linked target", p.ID, p.OverlayMode, "default")
		}
	}
}

func TestDeleteLastPokemonClearsActive(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	m.DeletePokemon("p1")

	st := m.GetState()
	if st.ActiveID != "" {
		t.Errorf("ActiveID = %q, want empty after deleting last pokemon", st.ActiveID)
	}
	if len(st.Pokemon) != 0 {
		t.Errorf("Pokemon length = %d, want 0", len(st.Pokemon))
	}
}

func TestDeleteNonActivePokemon(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.AddPokemon(makePokemon("p2", "Charmander"))

	// Delete non-active pokemon
	m.DeletePokemon("p2")

	st := m.GetState()
	if st.ActiveID != "p1" {
		t.Errorf("ActiveID = %q, want %q (should not change)", st.ActiveID, "p1")
	}
	if len(st.Pokemon) != 1 {
		t.Errorf("Pokemon length = %d, want 1", len(st.Pokemon))
	}
}

// --- Reload ---

func TestReload(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir)
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.Increment("p1")
	if err := m.Save(); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	// Create a new manager and reload
	m2 := NewManager(dir)
	notified := make(chan struct{}, 1)
	m2.OnChange(func(st AppState) {
		select {
		case notified <- struct{}{}:
		default:
		}
	})

	if err := m2.Reload(); err != nil {
		t.Fatalf("Reload failed: %v", err)
	}

	st := m2.GetState()
	if len(st.Pokemon) != 1 {
		t.Fatalf("Pokemon length = %d, want 1 after reload", len(st.Pokemon))
	}
	if st.Pokemon[0].Encounters != 1 {
		t.Errorf("Encounters = %d, want 1 after reload", st.Pokemon[0].Encounters)
	}

	// Verify notification was sent
	select {
	case <-notified:
		// ok
	case <-time.After(time.Second):
		t.Error("OnChange callback was not called after Reload")
	}
}

func TestReloadNonexistentFile(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir)

	// Reload from dir with no state.json should not error
	if err := m.Reload(); err != nil {
		t.Fatalf("Reload should not error for nonexistent file, got: %v", err)
	}
}

// --- ScheduleSave ---

func TestScheduleSave(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir)
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	m.ScheduleSave()

	// Wait for the debounce timer to fire (500ms + margin)
	time.Sleep(700 * time.Millisecond)

	path := filepath.Join(dir, extStateJSON)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("state.json should exist after ScheduleSave: %v", err)
	}

	var st AppState
	if err := json.Unmarshal(data, &st); err != nil {
		t.Fatalf("unmarshal saved state: %v", err)
	}
	if len(st.Pokemon) != 1 {
		t.Errorf("saved Pokemon length = %d, want 1", len(st.Pokemon))
	}
}

func TestScheduleSaveDebounce(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir)
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	// Call ScheduleSave multiple times rapidly
	m.ScheduleSave()
	m.ScheduleSave()
	m.ScheduleSave()

	// Wait for the debounce
	time.Sleep(700 * time.Millisecond)

	path := filepath.Join(dir, extStateJSON)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("state.json should exist: %v", err)
	}
}

// --- Save error path ---

func TestSaveReadOnlyDir(t *testing.T) {
	// Use a path under /dev/null that cannot be created as a directory
	m := NewManager("/dev/null/impossible")
	err := m.Save()
	if err == nil {
		t.Error("Save should return error for unwritable directory")
	}
}

// --- Load migration: overlay_mode from presence of overlay ---

func TestLoadMigrationOverlayMode(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, extStateJSON)

	// A pokemon with overlay set but no overlay_mode should get "custom"
	// A pokemon without overlay should get "default"
	data := []byte(`{
		"pokemon":[
			{"id":"p1","name":"With Overlay","overlay":{"canvas_width":100},"overlay_mode":""},
			{"id":"p2","name":"Without Overlay","overlay_mode":""}
		],
		"sessions":[],
		"hotkeys":{"increment":"F1","decrement":"F2","reset":"F3","next_pokemon":"F4"},
		"settings":{"overlay":{"background_animation":"none"}}
	}`)
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}

	m := NewManager(dir)
	if err := m.Load(); err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	st := m.GetState()
	if st.Pokemon[0].OverlayMode != "custom" {
		t.Errorf("Pokemon with overlay: OverlayMode = %q, want %q", st.Pokemon[0].OverlayMode, "custom")
	}
	if st.Pokemon[1].OverlayMode != "default" {
		t.Errorf("Pokemon without overlay: OverlayMode = %q, want %q", st.Pokemon[1].OverlayMode, "default")
	}
}
