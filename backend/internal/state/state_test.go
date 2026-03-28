package state

import (
	"sync"
	"testing"
	"time"
)

const (
	testConfigDir  = "/tmp/test-config"
	fmtActiveIDWant = "ActiveID = %q, want %q"
)

func TestNewManagerDefaults(t *testing.T) {
	m := NewManager(testConfigDir)
	st := m.GetState()

	if st.DataPath != testConfigDir {
		t.Errorf("DataPath = %q, want %q", st.DataPath, testConfigDir)
	}
	if len(st.Pokemon) != 0 {
		t.Errorf("Pokemon length = %d, want 0", len(st.Pokemon))
	}
	if len(st.Sessions) != 0 {
		t.Errorf("Sessions length = %d, want 0", len(st.Sessions))
	}
	if st.Hotkeys.Increment != "F1" {
		t.Errorf("Hotkeys.Increment = %q, want %q", st.Hotkeys.Increment, "F1")
	}
	if st.Hotkeys.Decrement != "F2" {
		t.Errorf("Hotkeys.Decrement = %q, want %q", st.Hotkeys.Decrement, "F2")
	}
	if st.Hotkeys.Reset != "F3" {
		t.Errorf("Hotkeys.Reset = %q, want %q", st.Hotkeys.Reset, "F3")
	}
	if st.Hotkeys.NextPokemon != "F4" {
		t.Errorf("Hotkeys.NextPokemon = %q, want %q", st.Hotkeys.NextPokemon, "F4")
	}
	if st.Settings.OutputEnabled {
		t.Error("OutputEnabled should be false by default")
	}
	if st.Settings.Overlay.CanvasWidth != 800 {
		t.Errorf("CanvasWidth = %d, want 800", st.Settings.Overlay.CanvasWidth)
	}
}

func makePokemon(id, name string) Pokemon {
	return Pokemon{
		ID:        id,
		Name:      name,
		CreatedAt: time.Now(),
	}
}

func TestAddPokemonSingle(t *testing.T) {
	m := NewManager(t.TempDir())
	p := makePokemon("p1", "Pikachu")
	m.AddPokemon(p)

	st := m.GetState()
	if len(st.Pokemon) != 1 {
		t.Fatalf("Pokemon length = %d, want 1", len(st.Pokemon))
	}
	if st.ActiveID != "p1" {
		t.Errorf(fmtActiveIDWant, st.ActiveID, "p1")
	}
	if !st.Pokemon[0].IsActive {
		t.Error("first pokemon should be active")
	}
}

func TestAddPokemonMultiple(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.AddPokemon(makePokemon("p2", "Charmander"))

	st := m.GetState()
	if len(st.Pokemon) != 2 {
		t.Fatalf("Pokemon length = %d, want 2", len(st.Pokemon))
	}
	// First added should remain active
	if st.ActiveID != "p1" {
		t.Errorf(fmtActiveIDWant, st.ActiveID, "p1")
	}
}

func TestUpdatePokemonFound(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	ok := m.UpdatePokemon("p1", Pokemon{Name: "Raichu", SpriteURL: "http://example.com/raichu.png"})
	if !ok {
		t.Fatal("UpdatePokemon returned false, want true")
	}
	st := m.GetState()
	if st.Pokemon[0].Name != "Raichu" {
		t.Errorf("Name = %q, want %q", st.Pokemon[0].Name, "Raichu")
	}
	if st.Pokemon[0].SpriteURL != "http://example.com/raichu.png" {
		t.Errorf("SpriteURL not updated")
	}
}

func TestUpdatePokemonNotFound(t *testing.T) {
	m := NewManager(t.TempDir())
	ok := m.UpdatePokemon("nonexistent", Pokemon{Name: "Raichu"})
	if ok {
		t.Error("UpdatePokemon returned true for nonexistent id")
	}
}

func TestUpdatePokemonEmptyNamePreserved(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	// Update with empty name should not overwrite
	m.UpdatePokemon("p1", Pokemon{SpriteURL: "http://example.com/new.png"})
	st := m.GetState()
	if st.Pokemon[0].Name != "Pikachu" {
		t.Errorf("Name = %q, want %q (should be preserved)", st.Pokemon[0].Name, "Pikachu")
	}
}

func TestDeletePokemonFound(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.AddPokemon(makePokemon("p2", "Charmander"))

	ok := m.DeletePokemon("p2")
	if !ok {
		t.Fatal("DeletePokemon returned false")
	}
	st := m.GetState()
	if len(st.Pokemon) != 1 {
		t.Fatalf("Pokemon length = %d, want 1", len(st.Pokemon))
	}
}

func TestDeletePokemonNotFound(t *testing.T) {
	m := NewManager(t.TempDir())
	ok := m.DeletePokemon("nonexistent")
	if ok {
		t.Error("DeletePokemon returned true for nonexistent id")
	}
}

func TestDeleteActivePokemonReassigns(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.AddPokemon(makePokemon("p2", "Charmander"))

	m.DeletePokemon("p1")
	st := m.GetState()
	if st.ActiveID != "p2" {
		t.Errorf("ActiveID = %q, want %q after deleting active", st.ActiveID, "p2")
	}
	if !st.Pokemon[0].IsActive {
		t.Error("reassigned pokemon should have IsActive = true")
	}
}

func TestIncrementDecrement(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	count, ok := m.Increment("p1")
	if !ok || count != 1 {
		t.Errorf("Increment: count=%d ok=%v, want 1/true", count, ok)
	}

	count, ok = m.Increment("p1")
	if !ok || count != 2 {
		t.Errorf("Increment: count=%d ok=%v, want 2/true", count, ok)
	}

	count, ok = m.Decrement("p1")
	if !ok || count != 1 {
		t.Errorf("Decrement: count=%d ok=%v, want 1/true", count, ok)
	}
}

func TestDecrementFloorsAtZero(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	count, ok := m.Decrement("p1")
	if !ok || count != 0 {
		t.Errorf("Decrement at zero: count=%d ok=%v, want 0/true", count, ok)
	}
}

func TestIncrementNotFound(t *testing.T) {
	m := NewManager(t.TempDir())
	_, ok := m.Increment("nonexistent")
	if ok {
		t.Error("Increment returned ok=true for nonexistent id")
	}
}

func TestDecrementNotFound(t *testing.T) {
	m := NewManager(t.TempDir())
	_, ok := m.Decrement("nonexistent")
	if ok {
		t.Error("Decrement returned ok=true for nonexistent id")
	}
}

func TestReset(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.Increment("p1")
	m.Increment("p1")

	ok := m.Reset("p1")
	if !ok {
		t.Fatal("Reset returned false")
	}
	st := m.GetState()
	if st.Pokemon[0].Encounters != 0 {
		t.Errorf("Encounters = %d, want 0 after reset", st.Pokemon[0].Encounters)
	}
}

func TestResetNotFound(t *testing.T) {
	m := NewManager(t.TempDir())
	ok := m.Reset("nonexistent")
	if ok {
		t.Error("Reset returned true for nonexistent id")
	}
}

func TestSetActiveValid(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.AddPokemon(makePokemon("p2", "Charmander"))

	ok := m.SetActive("p2")
	if !ok {
		t.Fatal("SetActive returned false")
	}
	st := m.GetState()
	if st.ActiveID != "p2" {
		t.Errorf(fmtActiveIDWant, st.ActiveID, "p2")
	}
	if st.Pokemon[0].IsActive {
		t.Error("p1 should not be active")
	}
	if !st.Pokemon[1].IsActive {
		t.Error("p2 should be active")
	}
}

func TestSetActiveInvalid(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	ok := m.SetActive("nonexistent")
	if ok {
		t.Error("SetActive returned true for nonexistent id")
	}
	st := m.GetState()
	if st.ActiveID != "p1" {
		t.Errorf("ActiveID should remain %q, got %q", "p1", st.ActiveID)
	}
}

func TestNextPokemon(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.AddPokemon(makePokemon("p2", "Charmander"))
	m.AddPokemon(makePokemon("p3", "Bulbasaur"))

	// p1 is active, next should be p2
	m.NextPokemon()
	st := m.GetState()
	if st.ActiveID != "p2" {
		t.Errorf(fmtActiveIDWant, st.ActiveID, "p2")
	}

	// Next should be p3
	m.NextPokemon()
	st = m.GetState()
	if st.ActiveID != "p3" {
		t.Errorf(fmtActiveIDWant, st.ActiveID, "p3")
	}
}

func TestNextPokemonWraps(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.AddPokemon(makePokemon("p2", "Charmander"))

	m.NextPokemon() // p1 -> p2
	m.NextPokemon() // p2 -> p1 (wrap)
	st := m.GetState()
	if st.ActiveID != "p1" {
		t.Errorf("ActiveID = %q, want %q after wrap", st.ActiveID, "p1")
	}
}

func TestNextPokemonEmpty(t *testing.T) {
	m := NewManager(t.TempDir())
	m.NextPokemon() // should not panic
}

func TestCompletePokemon(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	ok := m.CompletePokemon("p1")
	if !ok {
		t.Fatal("CompletePokemon returned false")
	}
	st := m.GetState()
	if st.Pokemon[0].CompletedAt == nil {
		t.Error("CompletedAt should be set")
	}
}

func TestCompletePokemonNotFound(t *testing.T) {
	m := NewManager(t.TempDir())
	ok := m.CompletePokemon("nonexistent")
	if ok {
		t.Error("CompletePokemon returned true for nonexistent id")
	}
}

func TestUncompletePokemon(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.CompletePokemon("p1")
	m.UncompletePokemon("p1")

	st := m.GetState()
	if st.Pokemon[0].CompletedAt != nil {
		t.Error("CompletedAt should be nil after uncomplete")
	}
}

func TestUncompletePokemonNotFound(t *testing.T) {
	m := NewManager(t.TempDir())
	ok := m.UncompletePokemon("nonexistent")
	if ok {
		t.Error("UncompletePokemon returned true for nonexistent id")
	}
}

func TestUpdateSettings(t *testing.T) {
	m := NewManager(t.TempDir())
	s := Settings{
		OutputEnabled: true,
		OutputDir:     "/tmp/output",
	}
	m.UpdateSettings(s)

	st := m.GetState()
	if !st.Settings.OutputEnabled {
		t.Error("OutputEnabled should be true")
	}
}

func TestUpdateHotkeys(t *testing.T) {
	m := NewManager(t.TempDir())
	h := HotkeyMap{
		Increment:   "F5",
		Decrement:   "F6",
		Reset:       "F7",
		NextPokemon: "F8",
	}
	m.UpdateHotkeys(h)

	st := m.GetState()
	if st.Hotkeys.Increment != "F5" {
		t.Errorf("Increment = %q, want %q", st.Hotkeys.Increment, "F5")
	}
}

func TestUpdateSingleHotkey(t *testing.T) {
	m := NewManager(t.TempDir())

	tests := []struct {
		action string
		key    string
		want   bool
	}{
		{"increment", "F5", true},
		{"decrement", "F6", true},
		{"reset", "F7", true},
		{"next_pokemon", "F8", true},
		{"invalid_action", "F9", false},
	}

	for _, tt := range tests {
		t.Run(tt.action, func(t *testing.T) {
			ok := m.UpdateSingleHotkey(tt.action, tt.key)
			if ok != tt.want {
				t.Errorf("UpdateSingleHotkey(%q, %q) = %v, want %v", tt.action, tt.key, ok, tt.want)
			}
		})
	}

	st := m.GetState()
	if st.Hotkeys.Increment != "F5" {
		t.Errorf("Increment = %q, want %q", st.Hotkeys.Increment, "F5")
	}
}

func TestSetDetectorConfig(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	cfg := &DetectorConfig{Enabled: true, Precision: 0.9}
	ok := m.SetDetectorConfig("p1", cfg)
	if !ok {
		t.Fatal("SetDetectorConfig returned false")
	}
	st := m.GetState()
	if st.Pokemon[0].DetectorConfig == nil {
		t.Fatal("DetectorConfig should be set")
	}
	if st.Pokemon[0].DetectorConfig.Precision != 0.9 {
		t.Errorf("Precision = %f, want 0.9", st.Pokemon[0].DetectorConfig.Precision)
	}
}

func TestSetDetectorConfigNotFound(t *testing.T) {
	m := NewManager(t.TempDir())
	ok := m.SetDetectorConfig("nonexistent", &DetectorConfig{})
	if ok {
		t.Error("SetDetectorConfig returned true for nonexistent id")
	}
}

func TestSetDetectorConfigNil(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.SetDetectorConfig("p1", &DetectorConfig{Enabled: true})
	m.SetDetectorConfig("p1", nil)

	st := m.GetState()
	if st.Pokemon[0].DetectorConfig != nil {
		t.Error("DetectorConfig should be nil after setting nil")
	}
}

func TestAppendDetectionLog(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.SetDetectorConfig("p1", &DetectorConfig{Enabled: true})

	m.AppendDetectionLog("p1", 0.95)
	st := m.GetState()
	if len(st.Pokemon[0].DetectorConfig.DetectionLog) != 1 {
		t.Fatalf("DetectionLog length = %d, want 1", len(st.Pokemon[0].DetectorConfig.DetectionLog))
	}
	if st.Pokemon[0].DetectorConfig.DetectionLog[0].Confidence != 0.95 {
		t.Errorf("Confidence = %f, want 0.95", st.Pokemon[0].DetectorConfig.DetectionLog[0].Confidence)
	}
}

func TestAppendDetectionLogMaxEntries(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.SetDetectorConfig("p1", &DetectorConfig{Enabled: true})

	// Add more than maxDetectionLog entries
	for i := range maxDetectionLog + 5 {
		m.AppendDetectionLog("p1", float64(i))
	}

	st := m.GetState()
	logLen := len(st.Pokemon[0].DetectorConfig.DetectionLog)
	if logLen != maxDetectionLog {
		t.Errorf("DetectionLog length = %d, want %d", logLen, maxDetectionLog)
	}
	// The oldest entries should have been dropped
	first := st.Pokemon[0].DetectorConfig.DetectionLog[0].Confidence
	if first != 5.0 {
		t.Errorf("first entry confidence = %f, want 5.0 (oldest should be dropped)", first)
	}
}

func TestAppendDetectionLogNoConfig(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	// No detector config set; should be a no-op, not panic
	m.AppendDetectionLog("p1", 0.95)
}

func TestOnChangeNotification(t *testing.T) {
	m := NewManager(t.TempDir())

	var mu sync.Mutex
	callCount := 0
	m.OnChange(func(st AppState) {
		mu.Lock()
		callCount++
		mu.Unlock()
	})

	m.AddPokemon(makePokemon("p1", "Pikachu"))

	// Give goroutine time to fire
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	if callCount == 0 {
		t.Error("OnChange callback was not called after AddPokemon")
	}
	mu.Unlock()
}

func TestGetActivePokemon(t *testing.T) {
	m := NewManager(t.TempDir())

	// No pokemon
	if p := m.GetActivePokemon(); p != nil {
		t.Error("GetActivePokemon should return nil when no pokemon exist")
	}

	m.AddPokemon(makePokemon("p1", "Pikachu"))
	p := m.GetActivePokemon()
	if p == nil {
		t.Fatal("GetActivePokemon should return non-nil")
	}
	if p.ID != "p1" {
		t.Errorf("GetActivePokemon ID = %q, want %q", p.ID, "p1")
	}
}

func TestGetConfigDir(t *testing.T) {
	dir := "/tmp/test-config-dir"
	m := NewManager(dir)
	if m.GetConfigDir() != dir {
		t.Errorf("GetConfigDir = %q, want %q", m.GetConfigDir(), dir)
	}
}
