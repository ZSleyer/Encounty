// state_coverage_test.go adds tests for functions not yet covered by the
// existing test suite: timers, step-based increments, detection log clearing,
// template clearing, SetEncounters, AcceptLicense, SetConfigDir, copyDir,
// DefaultDetectorConfig, LoadFromJSON, and applyBasicFields edge cases.
package state

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Timer operations
// ---------------------------------------------------------------------------

func TestStartTimer(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	ok := m.StartTimer("p1")
	if !ok {
		t.Fatal("StartTimer returned false")
	}
	st := m.GetState()
	if st.Pokemon[0].TimerStartedAt == nil {
		t.Error("TimerStartedAt should be set after StartTimer")
	}
}

func TestStartTimerAlreadyRunning(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.StartTimer("p1")

	first := m.GetState().Pokemon[0].TimerStartedAt

	// Starting again should be a no-op (keep the original start time)
	ok := m.StartTimer("p1")
	if !ok {
		t.Fatal("StartTimer returned false for already-running timer")
	}
	second := m.GetState().Pokemon[0].TimerStartedAt
	if !first.Equal(*second) {
		t.Error("TimerStartedAt should not change when timer is already running")
	}
}

func TestStartTimerNotFound(t *testing.T) {
	m := NewManager(t.TempDir())
	ok := m.StartTimer("nonexistent")
	if ok {
		t.Error("StartTimer returned true for nonexistent id")
	}
}

func TestStopTimer(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.StartTimer("p1")

	// Let a small amount of time pass so accumulated > 0
	time.Sleep(10 * time.Millisecond)

	ok := m.StopTimer("p1")
	if !ok {
		t.Fatal("StopTimer returned false")
	}
	st := m.GetState()
	if st.Pokemon[0].TimerStartedAt != nil {
		t.Error("TimerStartedAt should be nil after StopTimer")
	}
	if st.Pokemon[0].TimerAccumulatedMs <= 0 {
		t.Error("TimerAccumulatedMs should be > 0 after running timer")
	}
}

func TestStopTimerNotRunning(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	// Stopping a timer that was never started should still return true (found)
	ok := m.StopTimer("p1")
	if !ok {
		t.Fatal("StopTimer returned false")
	}
	st := m.GetState()
	if st.Pokemon[0].TimerAccumulatedMs != 0 {
		t.Errorf("TimerAccumulatedMs = %d, want 0 (timer was not running)", st.Pokemon[0].TimerAccumulatedMs)
	}
}

func TestStopTimerNotFound(t *testing.T) {
	m := NewManager(t.TempDir())
	ok := m.StopTimer("nonexistent")
	if ok {
		t.Error("StopTimer returned true for nonexistent id")
	}
}

func TestStopAllTimers(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.AddPokemon(makePokemon("p2", "Charmander"))
	m.StartTimer("p1")
	m.StartTimer("p2")

	time.Sleep(10 * time.Millisecond)

	m.StopAllTimers()

	st := m.GetState()
	for _, p := range st.Pokemon {
		if p.TimerStartedAt != nil {
			t.Errorf("Pokemon %q TimerStartedAt should be nil after StopAllTimers", p.ID)
		}
		if p.TimerAccumulatedMs <= 0 {
			t.Errorf("Pokemon %q TimerAccumulatedMs should be > 0", p.ID)
		}
	}
}

func TestStopAllTimersNoneRunning(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	// Should not panic when no timers are running
	m.StopAllTimers()

	st := m.GetState()
	if st.Pokemon[0].TimerAccumulatedMs != 0 {
		t.Errorf("TimerAccumulatedMs = %d, want 0", st.Pokemon[0].TimerAccumulatedMs)
	}
}

func TestResetTimer(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.StartTimer("p1")
	time.Sleep(10 * time.Millisecond)
	m.StopTimer("p1")

	ok := m.ResetTimer("p1")
	if !ok {
		t.Fatal("ResetTimer returned false")
	}
	st := m.GetState()
	if st.Pokemon[0].TimerStartedAt != nil {
		t.Error("TimerStartedAt should be nil after ResetTimer")
	}
	if st.Pokemon[0].TimerAccumulatedMs != 0 {
		t.Errorf("TimerAccumulatedMs = %d, want 0 after ResetTimer", st.Pokemon[0].TimerAccumulatedMs)
	}
}

func TestResetTimerNotFound(t *testing.T) {
	m := NewManager(t.TempDir())
	ok := m.ResetTimer("nonexistent")
	if ok {
		t.Error("ResetTimer returned true for nonexistent id")
	}
}

// ---------------------------------------------------------------------------
// Step-based increment/decrement
// ---------------------------------------------------------------------------

func TestIncrementWithStep(t *testing.T) {
	m := NewManager(t.TempDir())
	p := makePokemon("p1", "Pikachu")
	p.Step = 5
	m.AddPokemon(p)

	count, ok := m.Increment("p1")
	if !ok {
		t.Fatal("Increment returned false")
	}
	if count != 5 {
		t.Errorf("count = %d, want 5 (step=5)", count)
	}

	count, _ = m.Increment("p1")
	if count != 10 {
		t.Errorf("count = %d, want 10 after second increment", count)
	}
}

func TestDecrementWithStep(t *testing.T) {
	m := NewManager(t.TempDir())
	p := makePokemon("p1", "Pikachu")
	p.Step = 5
	p.Encounters = 20
	m.AddPokemon(p)

	count, ok := m.Decrement("p1")
	if !ok {
		t.Fatal("Decrement returned false")
	}
	if count != 15 {
		t.Errorf("count = %d, want 15 (20-5)", count)
	}
}

func TestDecrementWithStepFloorsAtZero(t *testing.T) {
	m := NewManager(t.TempDir())
	p := makePokemon("p1", "Pikachu")
	p.Step = 5
	p.Encounters = 3
	m.AddPokemon(p)

	count, ok := m.Decrement("p1")
	if !ok {
		t.Fatal("Decrement returned false")
	}
	if count != 0 {
		t.Errorf("count = %d, want 0 (encounters=3 < step=5 should floor)", count)
	}
}

// ---------------------------------------------------------------------------
// SetEncounters
// ---------------------------------------------------------------------------

func TestSetEncounters(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	count, ok := m.SetEncounters("p1", 42)
	if !ok {
		t.Fatal("SetEncounters returned false")
	}
	if count != 42 {
		t.Errorf("count = %d, want 42", count)
	}
	st := m.GetState()
	if st.Pokemon[0].Encounters != 42 {
		t.Errorf("Encounters = %d, want 42", st.Pokemon[0].Encounters)
	}
}

func TestSetEncountersNegative(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	count, ok := m.SetEncounters("p1", -10)
	if !ok {
		t.Fatal("SetEncounters returned false")
	}
	if count != 0 {
		t.Errorf("count = %d, want 0 (negative should floor at 0)", count)
	}
}

func TestSetEncountersNotFound(t *testing.T) {
	m := NewManager(t.TempDir())
	_, ok := m.SetEncounters("nonexistent", 10)
	if ok {
		t.Error("SetEncounters returned true for nonexistent id")
	}
}

// ---------------------------------------------------------------------------
// Detection log and template clearing
// ---------------------------------------------------------------------------

func TestClearDetectionLog(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.SetDetectorConfig("p1", &DetectorConfig{Enabled: true})
	m.AppendDetectionLog("p1", 0.9)
	m.AppendDetectionLog("p1", 0.85)

	m.ClearDetectionLog("p1")

	st := m.GetState()
	if len(st.Pokemon[0].DetectorConfig.DetectionLog) != 0 {
		t.Errorf("DetectionLog length = %d, want 0 after clear", len(st.Pokemon[0].DetectorConfig.DetectionLog))
	}
}

func TestClearDetectionLogNoConfig(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	// No detector config — should not panic
	m.ClearDetectionLog("p1")
}

func TestClearDetectionLogNotFound(t *testing.T) {
	m := NewManager(t.TempDir())

	// Nonexistent pokemon — should not panic
	m.ClearDetectionLog("nonexistent")
}

func TestClearAllTemplates(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	cfg := &DetectorConfig{
		Enabled:   true,
		Templates: []DetectorTemplate{{Name: "t1"}, {Name: "t2"}},
	}
	m.SetDetectorConfig("p1", cfg)

	m.ClearAllTemplates("p1")

	st := m.GetState()
	if len(st.Pokemon[0].DetectorConfig.Templates) != 0 {
		t.Errorf("Templates length = %d, want 0 after clear", len(st.Pokemon[0].DetectorConfig.Templates))
	}
}

func TestClearAllTemplatesNoConfig(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	// No detector config — should not panic
	m.ClearAllTemplates("p1")
}

func TestClearAllTemplatesNotFound(t *testing.T) {
	m := NewManager(t.TempDir())

	// Nonexistent pokemon — should not panic
	m.ClearAllTemplates("nonexistent")
}

// ---------------------------------------------------------------------------
// DefaultDetectorConfig
// ---------------------------------------------------------------------------

func TestDefaultDetectorConfig(t *testing.T) {
	cfg := DefaultDetectorConfig()
	if cfg == nil {
		t.Fatal("DefaultDetectorConfig returned nil")
	}
	if cfg.Precision != 0.55 {
		t.Errorf("Precision = %f, want 0.55", cfg.Precision)
	}
	if cfg.ConsecutiveHits != 1 {
		t.Errorf("ConsecutiveHits = %d, want 1", cfg.ConsecutiveHits)
	}
	if cfg.CooldownSec != 5 {
		t.Errorf("CooldownSec = %d, want 5", cfg.CooldownSec)
	}
	if cfg.PollIntervalMs != 200 {
		t.Errorf("PollIntervalMs = %d, want 200", cfg.PollIntervalMs)
	}
	if cfg.MinPollMs != 50 {
		t.Errorf("MinPollMs = %d, want 50", cfg.MinPollMs)
	}
	if cfg.MaxPollMs != 2000 {
		t.Errorf("MaxPollMs = %d, want 2000", cfg.MaxPollMs)
	}
	if cfg.ChangeThreshold != 0.15 {
		t.Errorf("ChangeThreshold = %f, want 0.15", cfg.ChangeThreshold)
	}
	if cfg.AdaptiveCooldownMin != 3 {
		t.Errorf("AdaptiveCooldownMin = %d, want 3", cfg.AdaptiveCooldownMin)
	}
}

// ---------------------------------------------------------------------------
// AcceptLicense
// ---------------------------------------------------------------------------

func TestAcceptLicense(t *testing.T) {
	m := NewManager(t.TempDir())

	st := m.GetState()
	if st.LicenseAccepted {
		t.Error("LicenseAccepted should be false by default")
	}

	m.AcceptLicense()

	st = m.GetState()
	if !st.LicenseAccepted {
		t.Error("LicenseAccepted should be true after AcceptLicense")
	}
}

// ---------------------------------------------------------------------------
// SetConfigDir and copyDir
// ---------------------------------------------------------------------------

func TestSetConfigDir(t *testing.T) {
	oldDir := t.TempDir()
	newDir := t.TempDir()

	m := NewManager(oldDir)
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	// Create a file in the old dir to verify it gets copied
	if err := os.WriteFile(filepath.Join(oldDir, "test.txt"), []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := m.SetConfigDir(newDir); err != nil {
		t.Fatalf("SetConfigDir failed: %v", err)
	}

	if m.GetConfigDir() != newDir {
		t.Errorf("GetConfigDir = %q, want %q", m.GetConfigDir(), newDir)
	}

	st := m.GetState()
	if st.DataPath != newDir {
		t.Errorf("DataPath = %q, want %q", st.DataPath, newDir)
	}
	if st.Settings.ConfigPath != newDir {
		t.Errorf("Settings.ConfigPath = %q, want %q", st.Settings.ConfigPath, newDir)
	}

	// Verify the file was copied
	data, err := os.ReadFile(filepath.Join(newDir, "test.txt"))
	if err != nil {
		t.Fatalf("copied file not found: %v", err)
	}
	if string(data) != "hello" {
		t.Errorf("copied file content = %q, want %q", string(data), "hello")
	}

	// Verify a pointer state.json was left at the old directory and that
	// loading it reports the relocated ConfigPath.
	if _, err := os.Stat(filepath.Join(oldDir, "state.json")); err != nil {
		t.Fatalf("pointer state.json not found at old dir: %v", err)
	}
	pointerMgr := NewManager(oldDir)
	if err := pointerMgr.LoadFromJSON(); err != nil {
		t.Fatalf("loading pointer state.json failed: %v", err)
	}
	if got := pointerMgr.GetState().Settings.ConfigPath; got != newDir {
		t.Errorf("pointer Settings.ConfigPath = %q, want %q", got, newDir)
	}
}

func TestSetConfigDirWritesPointer(t *testing.T) {
	oldDir := t.TempDir()
	newDir := t.TempDir()

	m := NewManager(oldDir)
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.UpdateSettings(Settings{Languages: []string{"en"}})

	if err := m.SetConfigDir(newDir); err != nil {
		t.Fatalf("SetConfigDir failed: %v", err)
	}

	pointerPath := filepath.Join(oldDir, "state.json")
	raw, err := os.ReadFile(pointerPath)
	if err != nil {
		t.Fatalf("pointer state.json not found: %v", err)
	}

	var parsed AppState
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("pointer state.json is not valid JSON: %v", err)
	}
	if parsed.Settings.ConfigPath != newDir {
		t.Errorf("pointer Settings.ConfigPath = %q, want %q", parsed.Settings.ConfigPath, newDir)
	}

	// A fresh manager rooted at the old dir should pick up the redirect.
	fresh := NewManager(oldDir)
	if err := fresh.LoadFromJSON(); err != nil {
		t.Fatalf("fresh LoadFromJSON failed: %v", err)
	}
	if got := fresh.GetState().Settings.ConfigPath; got != newDir {
		t.Errorf("fresh Settings.ConfigPath = %q, want %q", got, newDir)
	}
}

func TestSetConfigDirCopiesSubdirectories(t *testing.T) {
	oldDir := t.TempDir()
	newDir := t.TempDir()

	m := NewManager(oldDir)

	// Create a subdirectory with a file
	subDir := filepath.Join(oldDir, "templates")
	if err := os.MkdirAll(subDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(subDir, "tmpl.png"), []byte("imagedata"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := m.SetConfigDir(newDir); err != nil {
		t.Fatalf("SetConfigDir failed: %v", err)
	}

	// Verify subdirectory and file were copied
	data, err := os.ReadFile(filepath.Join(newDir, "templates", "tmpl.png"))
	if err != nil {
		t.Fatalf("copied subdirectory file not found: %v", err)
	}
	if string(data) != "imagedata" {
		t.Errorf("copied file content = %q, want %q", string(data), "imagedata")
	}
}

func TestSetConfigDirInvalidPath(t *testing.T) {
	m := NewManager(t.TempDir())
	err := m.SetConfigDir("/dev/null/impossible/path")
	if err == nil {
		t.Error("SetConfigDir should return error for invalid path")
	}
}

func TestCopyDir(t *testing.T) {
	src := t.TempDir()
	dst := t.TempDir()

	// Create a nested structure
	if err := os.MkdirAll(filepath.Join(src, "sub", "deep"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "root.txt"), []byte("root"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "sub", "mid.txt"), []byte("mid"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "sub", "deep", "leaf.txt"), []byte("leaf"), 0644); err != nil {
		t.Fatal(err)
	}

	copyDir(src, dst)

	// Verify all files were copied
	cases := []struct {
		path string
		want string
	}{
		{filepath.Join(dst, "root.txt"), "root"},
		{filepath.Join(dst, "sub", "mid.txt"), "mid"},
		{filepath.Join(dst, "sub", "deep", "leaf.txt"), "leaf"},
	}
	for _, tc := range cases {
		data, err := os.ReadFile(tc.path)
		if err != nil {
			t.Errorf("file %q not found: %v", tc.path, err)
			continue
		}
		if string(data) != tc.want {
			t.Errorf("file %q content = %q, want %q", tc.path, string(data), tc.want)
		}
	}
}

func TestCopyDirNonexistentSource(t *testing.T) {
	dst := t.TempDir()
	// Should not panic when source does not exist
	copyDir("/nonexistent/path", dst)
}

// ---------------------------------------------------------------------------
// LoadFromJSON (public wrapper)
// ---------------------------------------------------------------------------

func TestLoadFromJSON(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir)
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	if err := m.Save(); err != nil {
		t.Fatalf("Save: %v", err)
	}

	m2 := NewManager(dir)
	if err := m2.LoadFromJSON(); err != nil {
		t.Fatalf("LoadFromJSON: %v", err)
	}

	st := m2.GetState()
	if len(st.Pokemon) != 1 {
		t.Fatalf("Pokemon count = %d, want 1", len(st.Pokemon))
	}
	if st.Pokemon[0].Name != "Pikachu" {
		t.Errorf("Name = %q, want %q", st.Pokemon[0].Name, "Pikachu")
	}
}

func TestLoadFromJSONNonexistent(t *testing.T) {
	m := NewManager(t.TempDir())
	// No state.json — should return nil (no error)
	if err := m.LoadFromJSON(); err != nil {
		t.Fatalf("LoadFromJSON should not error for nonexistent file: %v", err)
	}
}

// ---------------------------------------------------------------------------
// applyBasicFields edge cases (HuntType update via UpdatePokemon)
// ---------------------------------------------------------------------------

const errUpdatePokemonFalse = "UpdatePokemon returned false"

func TestUpdatePokemonHuntMode(t *testing.T) {
	m := NewManager(t.TempDir())
	p := makePokemon("p1", "Pikachu")
	p.HuntMode = "both"
	m.AddPokemon(p)

	ok := m.UpdatePokemon("p1", Pokemon{HuntMode: "detector"})
	if !ok {
		t.Fatal(errUpdatePokemonFalse)
	}
	st := m.GetState()
	if st.Pokemon[0].HuntMode != "detector" {
		t.Errorf("HuntMode = %q, want %q", st.Pokemon[0].HuntMode, "detector")
	}

	// Clearing HuntMode to empty
	m.UpdatePokemon("p1", Pokemon{HuntMode: ""})
	st = m.GetState()
	if st.Pokemon[0].HuntMode != "" {
		t.Errorf("HuntMode = %q, want empty (cleared)", st.Pokemon[0].HuntMode)
	}
}

func TestUpdatePokemonHuntType(t *testing.T) {
	m := NewManager(t.TempDir())
	p := makePokemon("p1", "Pikachu")
	p.HuntType = "encounter"
	m.AddPokemon(p)

	ok := m.UpdatePokemon("p1", Pokemon{HuntType: "soft_reset"})
	if !ok {
		t.Fatal(errUpdatePokemonFalse)
	}
	st := m.GetState()
	if st.Pokemon[0].HuntType != "soft_reset" {
		t.Errorf("HuntType = %q, want %q", st.Pokemon[0].HuntType, "soft_reset")
	}

	// Empty HuntType in update should preserve the existing value
	m.UpdatePokemon("p1", Pokemon{Name: "Raichu"})
	st = m.GetState()
	if st.Pokemon[0].HuntType != "soft_reset" {
		t.Errorf("HuntType = %q, want preserved %q", st.Pokemon[0].HuntType, "soft_reset")
	}
}

func TestUpdatePokemonStep(t *testing.T) {
	m := NewManager(t.TempDir())
	p := makePokemon("p1", "Pikachu")
	p.Step = 3
	m.AddPokemon(p)

	// Update step to 0 (should be allowed — means default of 1)
	ok := m.UpdatePokemon("p1", Pokemon{Name: "Pikachu", Step: 0})
	if !ok {
		t.Fatal(errUpdatePokemonFalse)
	}
	st := m.GetState()
	if st.Pokemon[0].Step != 0 {
		t.Errorf("Step = %d, want 0 (cleared)", st.Pokemon[0].Step)
	}

	// Update step to 10
	m.UpdatePokemon("p1", Pokemon{Name: "Pikachu", Step: 10})
	st = m.GetState()
	if st.Pokemon[0].Step != 10 {
		t.Errorf("Step = %d, want 10", st.Pokemon[0].Step)
	}
}

// ---------------------------------------------------------------------------
// applyBasicFields: SpriteType branch
// ---------------------------------------------------------------------------

func TestUpdatePokemonSpriteType(t *testing.T) {
	m := NewManager(t.TempDir())
	p := makePokemon("p1", "Pikachu")
	p.SpriteType = "normal"
	m.AddPokemon(p)

	ok := m.UpdatePokemon("p1", Pokemon{SpriteType: "shiny"})
	if !ok {
		t.Fatal(errUpdatePokemonFalse)
	}
	st := m.GetState()
	if st.Pokemon[0].SpriteType != "shiny" {
		t.Errorf("SpriteType = %q, want %q", st.Pokemon[0].SpriteType, "shiny")
	}

	// Empty SpriteType should not overwrite
	m.UpdatePokemon("p1", Pokemon{Name: "Pikachu"})
	st = m.GetState()
	if st.Pokemon[0].SpriteType != "shiny" {
		t.Errorf("SpriteType = %q, want %q (should be preserved)", st.Pokemon[0].SpriteType, "shiny")
	}
}

func TestUpdatePokemonCanonicalName(t *testing.T) {
	m := NewManager(t.TempDir())
	p := makePokemon("p1", "Pikachu")
	p.CanonicalName = "pikachu"
	m.AddPokemon(p)

	m.UpdatePokemon("p1", Pokemon{CanonicalName: "raichu"})
	st := m.GetState()
	if st.Pokemon[0].CanonicalName != "raichu" {
		t.Errorf("CanonicalName = %q, want %q", st.Pokemon[0].CanonicalName, "raichu")
	}

	// Empty CanonicalName should not overwrite
	m.UpdatePokemon("p1", Pokemon{Name: "Raichu"})
	st = m.GetState()
	if st.Pokemon[0].CanonicalName != "raichu" {
		t.Errorf("CanonicalName = %q, want %q (should be preserved)", st.Pokemon[0].CanonicalName, "raichu")
	}
}

// ---------------------------------------------------------------------------
// applyBasicFields: ShinyCharm (bool zero-value is a valid state)
// ---------------------------------------------------------------------------

func TestUpdatePokemonShinyCharm(t *testing.T) {
	m := NewManager(t.TempDir())
	p := makePokemon("p1", "Pikachu")
	p.ShinyCharm = false
	m.AddPokemon(p)

	// Enable ShinyCharm
	ok := m.UpdatePokemon("p1", Pokemon{ShinyCharm: true})
	if !ok {
		t.Fatal(errUpdatePokemonFalse)
	}
	st := m.GetState()
	if !st.Pokemon[0].ShinyCharm {
		t.Error("ShinyCharm should be true after enabling")
	}

	// Disable ShinyCharm (bool zero-value must still be applied)
	ok = m.UpdatePokemon("p1", Pokemon{ShinyCharm: false})
	if !ok {
		t.Fatal(errUpdatePokemonFalse)
	}
	st = m.GetState()
	if st.Pokemon[0].ShinyCharm {
		t.Error("ShinyCharm should be false after disabling")
	}
}

// ---------------------------------------------------------------------------
// Timer accumulation across start/stop cycles
// ---------------------------------------------------------------------------

func TestTimerAccumulates(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	// First cycle
	m.StartTimer("p1")
	time.Sleep(10 * time.Millisecond)
	m.StopTimer("p1")
	first := m.GetState().Pokemon[0].TimerAccumulatedMs

	// Second cycle should add to the accumulated value
	m.StartTimer("p1")
	time.Sleep(10 * time.Millisecond)
	m.StopTimer("p1")
	second := m.GetState().Pokemon[0].TimerAccumulatedMs

	if second <= first {
		t.Errorf("accumulated after 2 cycles (%d) should be > after 1 cycle (%d)", second, first)
	}
}
