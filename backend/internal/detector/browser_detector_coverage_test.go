package detector

import (
	"image/color"
	"testing"
	"time"
)

const fmtStateWantIdle = "State = %q, want idle"

// TestBrowserDetectorDefaultConsecutiveHitsAndCooldown exercises the SubmitFrame
// path where consecutiveHits and cooldownSec are both zero, triggering the
// default value assignments.
func TestBrowserDetectorDefaultConsecutiveHitsAndCooldown(t *testing.T) {
	bd := newTestBrowserDetector(t, 0, 0, 0) // all defaults
	noMatch := solidImage(200, 200, color.RGBA{128, 128, 128, 255})
	r := bd.SubmitFrame(noMatch)
	if r.State != "idle" {
		t.Errorf(fmtStateWantIdle, r.State)
	}
}

// TestBrowserDetectorCooldownStaysInCooldown exercises the cooldown path
// where time has NOT expired yet (stays in cooldown).
func TestBrowserDetectorCooldownStaysInCooldown(t *testing.T) {
	bd := newTestBrowserDetector(t, 0.5, 1, 10) // long cooldown

	noMatch := solidImage(200, 200, color.RGBA{128, 128, 128, 255})
	matchFrame := checkerImage(200, 200, 8, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255})

	// idle -> match_active
	bd.SubmitFrame(noMatch)
	bd.SubmitFrame(matchFrame)

	// match_active -> cooldown
	bd.SubmitFrame(matchFrame)

	// Cooldown not yet expired (10 seconds), should stay in cooldown.
	r := bd.SubmitFrame(matchFrame)
	if r.State != "cooldown" {
		t.Errorf("State = %q, want cooldown", r.State)
	}
}

// TestBrowserDetectorFullCycleWithDefaults runs through
// idle -> match_active -> cooldown -> idle using default config values.
func TestBrowserDetectorFullCycleWithDefaults(t *testing.T) {
	bd := newTestBrowserDetector(t, 0.5, 1, 1)

	noMatch := solidImage(200, 200, color.RGBA{128, 128, 128, 255})
	matchFrame := checkerImage(200, 200, 8, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255})

	// idle
	r := bd.SubmitFrame(noMatch)
	if r.State != "idle" {
		t.Errorf(fmtStateWantIdle, r.State)
	}

	// idle -> match_active
	r = bd.SubmitFrame(matchFrame)
	if r.State != "match_active" {
		t.Errorf("State = %q, want match_active", r.State)
	}

	// match_active -> cooldown
	r = bd.SubmitFrame(matchFrame)
	if r.State != "cooldown" {
		t.Errorf("State = %q, want cooldown", r.State)
	}

	// Force cooldown expiry.
	bd.mu.Lock()
	bd.cooldownEnd = time.Now().Add(-1 * time.Second)
	bd.mu.Unlock()

	// cooldown -> idle
	r = bd.SubmitFrame(noMatch)
	if r.State != "idle" {
		t.Errorf("State = %q, want idle after cooldown", r.State)
	}

	// After cooldown, prevAbove is set to true. Submit a non-matching frame
	// to transition prevAbove back to false.
	r = bd.SubmitFrame(noMatch)
	if r.State != "idle" {
		t.Errorf(fmtStateWantIdle, r.State)
	}

	// Now a matching frame should trigger again (low->high edge).
	r = bd.SubmitFrame(matchFrame)
	if !r.Incremented {
		t.Error("Should re-trigger after non-match gap")
	}
}
