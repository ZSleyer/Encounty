package detector

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

const testPokemonID = "pokemon-1"

// newTestBrowserDetector creates a Detector configured for browser sources
// with a single template loaded from a synthetic checkerboard PNG written
// to tmpDir.
func newTestBrowserDetector(t *testing.T, precision float64, consecutiveHits, cooldownSec int) *Detector {
	t.Helper()
	tmpDir := t.TempDir()
	pokemonID := "test-pokemon"

	// Write a checkerboard template.
	tmplDir := filepath.Join(tmpDir, "templates", pokemonID)
	if err := os.MkdirAll(tmplDir, 0o755); err != nil {
		t.Fatal(err)
	}
	tmplPath := filepath.Join(tmplDir, "tmpl.png")
	tmplImg := checkerImage(64, 64, 8, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255})
	f, err := os.Create(tmplPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, tmplImg); err != nil {
		_ = f.Close()
		t.Fatal(err)
	}
	_ = f.Close()

	cfg := state.DetectorConfig{
		Enabled:         true,
		SourceType:      "browser_camera",
		Precision:       precision,
		ConsecutiveHits: consecutiveHits,
		CooldownSec:     cooldownSec,
		Templates: []state.DetectorTemplate{
			{ImagePath: "tmpl.png"},
		},
	}

	broadcast := func(msgType string, payload any) {} // no-op broadcast for test
	d := newDetector(pokemonID, cfg, nil, broadcast, tmpDir)
	d.templates = loadTemplates(cfg.Templates, tmpDir, pokemonID)
	return d
}

func TestBrowserDetectorHasTemplates(t *testing.T) {
	bd := newTestBrowserDetector(t, 0.85, 1, 1)
	if !bd.HasTemplates() {
		t.Error("HasTemplates() = false, want true")
	}
}

func TestBrowserDetectorNoTemplates(t *testing.T) {
	cfg := state.DetectorConfig{Enabled: true, SourceType: "browser_camera"}
	broadcast := func(msgType string, payload any) {}
	bd := newDetector("nonexistent", cfg, nil, broadcast, t.TempDir())
	bd.templates = loadTemplates(cfg.Templates, t.TempDir(), "nonexistent")
	if bd.HasTemplates() {
		t.Error("HasTemplates() = true for detector with no template files")
	}
}

func TestBrowserDetectorIdleWithNoMatch(t *testing.T) {
	bd := newTestBrowserDetector(t, 0.85, 1, 1)

	// Submit a blank frame that should not match the checkerboard template.
	frame := solidImage(200, 200, color.RGBA{128, 128, 128, 255})
	result := bd.SubmitFrame(frame)

	if result.State != "idle" {
		t.Errorf("State = %q, want idle", result.State)
	}
	if result.Incremented {
		t.Error("Incremented = true on non-matching frame")
	}
}

func TestBrowserDetectorMatchTransition(t *testing.T) {
	bd := newTestBrowserDetector(t, 0.5, 1, 1)

	// The template is a checkerboard; submitting a matching frame should trigger.
	matchFrame := checkerImage(200, 200, 8, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255})

	// First: submit a non-matching frame to establish "prevAbove = false".
	noMatchFrame := solidImage(200, 200, color.RGBA{128, 128, 128, 255})
	bd.SubmitFrame(noMatchFrame)

	// Now submit the matching frame — should trigger increment on low→high transition.
	result := bd.SubmitFrame(matchFrame)
	if !result.Incremented {
		t.Error("Incremented = false on matching frame after non-matching frame")
	}
	if result.State != "match_active" {
		t.Errorf("State = %q, want match_active", result.State)
	}
}

func TestBrowserDetectorCooldownTransition(t *testing.T) {
	bd := newTestBrowserDetector(t, 0.5, 1, 1)

	noMatchFrame := solidImage(200, 200, color.RGBA{128, 128, 128, 255})
	matchFrame := checkerImage(200, 200, 8, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255})

	// Establish non-matching baseline.
	bd.SubmitFrame(noMatchFrame)

	// Trigger match.
	result := bd.SubmitFrame(matchFrame)
	if result.State != "match_active" {
		t.Fatalf("Expected match_active, got %q", result.State)
	}

	// Next frame transitions to cooldown (browser sources transition immediately).
	result = bd.SubmitFrame(matchFrame)
	if result.State != "cooldown" {
		t.Errorf("State = %q, want cooldown", result.State)
	}
	if result.Incremented {
		t.Error("Incremented should be false during cooldown transition")
	}
}

func TestBrowserDetectorCooldownToIdle(t *testing.T) {
	bd := newTestBrowserDetector(t, 0.5, 1, 0) // cooldownSec=0, uses default (8)

	// Override to a very short cooldown for testing.
	bd.mu.Lock()
	bd.cfg.CooldownSec = 1
	bd.mu.Unlock()

	noMatchFrame := solidImage(200, 200, color.RGBA{128, 128, 128, 255})
	matchFrame := checkerImage(200, 200, 8, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255})

	// Drive through idle→match→cooldown.
	bd.SubmitFrame(noMatchFrame)
	bd.SubmitFrame(matchFrame) // match_active
	bd.SubmitFrame(matchFrame) // cooldown

	// Force cooldown to be expired.
	bd.mu.Lock()
	bd.cooldownEnd = time.Now().Add(-1 * time.Second)
	bd.mu.Unlock()

	// Next frame should return to idle.
	result := bd.SubmitFrame(noMatchFrame)
	if result.State != "idle" {
		t.Errorf("State = %q after cooldown expired, want idle", result.State)
	}
}

func TestBrowserDetectorEdgeDetectionPreventsRetrigger(t *testing.T) {
	bd := newTestBrowserDetector(t, 0.5, 3, 1)

	noMatchFrame := solidImage(200, 200, color.RGBA{128, 128, 128, 255})
	matchFrame := checkerImage(200, 200, 8, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255})

	// Establish non-matching baseline.
	bd.SubmitFrame(noMatchFrame)

	// Trigger: 3 consecutive matching frames from a low→high edge.
	bd.SubmitFrame(matchFrame)
	bd.SubmitFrame(matchFrame)
	r := bd.SubmitFrame(matchFrame)
	if !r.Incremented {
		t.Fatal("First match should increment after 3 consecutive hits")
	}

	// match_active→cooldown.
	bd.SubmitFrame(matchFrame)

	// Force cooldown to expire.
	bd.mu.Lock()
	bd.cooldownEnd = time.Now().Add(-1 * time.Second)
	bd.mu.Unlock()

	// cooldown→idle: prevAbove is set to true, consecCount is 0.
	// Next matching frame: above=true, prevAbove=true -> consecCount becomes 1.
	// This is NOT enough for consecutiveHits=3, so no re-trigger.
	r2 := bd.SubmitFrame(matchFrame)
	if r2.Incremented {
		t.Error("Should not re-trigger with only 1 sustained hit (need 3)")
	}

	// Second sustained frame: consecCount becomes 2, still not enough.
	r3 := bd.SubmitFrame(matchFrame)
	if r3.Incremented {
		t.Error("Should not re-trigger with only 2 sustained hits (need 3)")
	}
}

func TestBrowserDetectorConsecutiveHitsRequired(t *testing.T) {
	bd := newTestBrowserDetector(t, 0.5, 3, 1)

	noMatchFrame := solidImage(200, 200, color.RGBA{128, 128, 128, 255})
	matchFrame := checkerImage(200, 200, 8, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255})

	// Establish non-matching baseline.
	bd.SubmitFrame(noMatchFrame)

	// First matching frame — should not trigger yet (need 3 consecutive).
	r := bd.SubmitFrame(matchFrame)
	if r.Incremented {
		t.Error("Should not increment after only 1 consecutive hit (need 3)")
	}

	// Second consecutive match.
	r = bd.SubmitFrame(matchFrame)
	if r.Incremented {
		t.Error("Should not increment after only 2 consecutive hits (need 3)")
	}

	// Third consecutive match — should trigger.
	r = bd.SubmitFrame(matchFrame)
	if !r.Incremented {
		t.Error("Should increment after 3 consecutive hits")
	}
	if r.State != "match_active" {
		t.Errorf("State = %q, want match_active", r.State)
	}
}

func TestBrowserDetectorConsecutiveHitsResetOnMiss(t *testing.T) {
	bd := newTestBrowserDetector(t, 0.5, 3, 1)

	noMatchFrame := solidImage(200, 200, color.RGBA{128, 128, 128, 255})
	matchFrame := checkerImage(200, 200, 8, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255})

	// Establish non-matching baseline.
	bd.SubmitFrame(noMatchFrame)

	// Two consecutive matches.
	bd.SubmitFrame(matchFrame)
	bd.SubmitFrame(matchFrame)

	// Interrupt with non-matching frame — resets counter.
	bd.SubmitFrame(noMatchFrame)

	// Start matching again — counter should restart from 1.
	bd.SubmitFrame(matchFrame)
	r := bd.SubmitFrame(matchFrame)
	if r.Incremented {
		t.Error("Should not increment — counter was reset by the non-matching frame")
	}
}

func TestBrowserDetectorDefaultLanguage(t *testing.T) {
	cfg := state.DetectorConfig{Enabled: true, SourceType: "browser_camera"}
	broadcast := func(msgType string, payload any) {}
	bd := newDetector("test", cfg, nil, broadcast, t.TempDir())
	if bd.lang != "eng" {
		t.Errorf("lang = %q, want eng for empty input", bd.lang)
	}
}

func TestBrowserDetectorInitialState(t *testing.T) {
	bd := newTestBrowserDetector(t, 0.85, 1, 1)

	// Verify initial state without submitting any frames.
	bd.mu.Lock()
	defer bd.mu.Unlock()

	if bd.phase != stateIdle {
		t.Errorf("initial phase = %q, want idle", bd.phase)
	}
	if bd.consecCount != 0 {
		t.Errorf("initial consecCount = %d, want 0", bd.consecCount)
	}
	if bd.prevAbove {
		t.Error("initial prevAbove = true, want false")
	}
}

func TestBrowserDetectorConfidenceReturned(t *testing.T) {
	bd := newTestBrowserDetector(t, 0.5, 1, 1)

	// Non-matching frame should return low confidence.
	noMatch := solidImage(200, 200, color.RGBA{128, 128, 128, 255})
	r := bd.SubmitFrame(noMatch)
	if r.Confidence >= 0.5 {
		t.Errorf("Confidence = %f for non-matching frame, want < 0.5", r.Confidence)
	}
}

func TestLoadTemplatesMissingFile(t *testing.T) {
	tmpDir := t.TempDir()
	templates := []state.DetectorTemplate{
		{ImagePath: "nonexistent.png"},
	}
	loaded := loadTemplates(templates, tmpDir, testPokemonID)
	if len(loaded) != 0 {
		t.Errorf("loadTemplates with missing file returned %d templates, want 0", len(loaded))
	}
}

func TestLoadTemplatesValidFile(t *testing.T) {
	tmpDir := t.TempDir()
	pokemonID := testPokemonID
	tmplDir := filepath.Join(tmpDir, "templates", pokemonID)
	if err := os.MkdirAll(tmplDir, 0o755); err != nil {
		t.Fatal(err)
	}

	img := image.NewRGBA(image.Rect(0, 0, 16, 16))
	f, err := os.Create(filepath.Join(tmplDir, "test.png"))
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		_ = f.Close()
		t.Fatal(err)
	}
	_ = f.Close()

	templates := []state.DetectorTemplate{
		{ImagePath: "test.png"},
	}
	loaded := loadTemplates(templates, tmpDir, pokemonID)
	if len(loaded) != 1 {
		t.Fatalf("loadTemplates returned %d templates, want 1", len(loaded))
	}
	b := loaded[0].img.Bounds()
	if b.Dx() != 16 || b.Dy() != 16 {
		t.Errorf("loaded template size = %d×%d, want 16×16", b.Dx(), b.Dy())
	}
}

func TestLoadTemplatesAbsolutePath(t *testing.T) {
	tmpDir := t.TempDir()
	absPath := filepath.Join(tmpDir, "absolute.png")

	img := image.NewRGBA(image.Rect(0, 0, 8, 8))
	f, err := os.Create(absPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		_ = f.Close()
		t.Fatal(err)
	}
	_ = f.Close()

	templates := []state.DetectorTemplate{
		{ImagePath: absPath},
	}
	loaded := loadTemplates(templates, tmpDir, "ignored")
	if len(loaded) != 1 {
		t.Fatalf("loadTemplates with absolute path returned %d templates, want 1", len(loaded))
	}
}

func TestLoadTemplatesInvalidPNG(t *testing.T) {
	tmpDir := t.TempDir()
	pokemonID := testPokemonID
	tmplDir := filepath.Join(tmpDir, "templates", pokemonID)
	if err := os.MkdirAll(tmplDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// Write garbage data as a PNG file.
	if err := os.WriteFile(filepath.Join(tmplDir, "bad.png"), []byte("not a png"), 0o644); err != nil {
		t.Fatal(err)
	}

	templates := []state.DetectorTemplate{
		{ImagePath: "bad.png"},
	}
	loaded := loadTemplates(templates, tmpDir, pokemonID)
	if len(loaded) != 0 {
		t.Errorf("loadTemplates with invalid PNG returned %d templates, want 0", len(loaded))
	}
}
