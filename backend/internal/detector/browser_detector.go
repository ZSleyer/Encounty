// browser_detector.go — per-hunt state machine for browser-sourced frames.
//
// Unlike the goroutine-based [Detector] which polls the screen itself, the
// BrowserDetector is driven by external frame submissions via
// [BrowserDetector.SubmitFrame]. The caller (an HTTP handler) POSTs a decoded
// JPEG frame; this method runs the idle/match/cooldown state machine and
// returns a result that the handler can broadcast and persist.
//
// The state machine uses edge detection: a match only triggers when the score
// transitions from below the precision threshold to above it (i.e. a new
// encounter appears on screen). Sustained high scores do not re-trigger.
package detector

import (
	"image"
	"log/slog"
	"sync"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// BrowserMatchResult is returned by [BrowserDetector.SubmitFrame].
type BrowserMatchResult struct {
	// State is the post-frame state: "idle", "match_active", or "cooldown".
	State string
	// Confidence is the best NCC score seen in the current frame (0.0–1.0).
	Confidence float64
	// Incremented is true when this frame caused the encounter counter to tick.
	Incremented bool
}

// BrowserDetector manages the detection state machine for one Pokémon hunt
// when frames are delivered from a browser source (camera or display capture).
// It is safe for concurrent use.
type BrowserDetector struct {
	mu                sync.Mutex
	phase             detectorPhase
	consecCount       int
	cooldownEnd       time.Time
	cooldownStartTime time.Time
	lastBestScore     float64

	// prevAbove tracks whether the previous frame scored above precision.
	// Used for edge detection: we only start counting consecutive hits after
	// a low→high transition (new encounter appeared).
	prevAbove bool

	// templates are loaded once on construction; each bundles the image with
	// its region metadata for region-scoped matching.
	templates []loadedTemplate

	// lang is the tesseract language code used for text-region OCR.
	lang string

	// Configuration snapshot used during the current session.
	cfg state.DetectorConfig
}

// newBrowserDetector creates a BrowserDetector with pre-loaded templates.
// lang is the tesseract language code for text-region OCR (e.g. "deu", "eng").
// Templates that cannot be opened or decoded are silently skipped.
func newBrowserDetector(cfg state.DetectorConfig, configDir, pokemonID, lang string) *BrowserDetector {
	if lang == "" {
		lang = "eng"
	}
	bd := &BrowserDetector{
		phase: stateIdle,
		cfg:   cfg,
		lang:  lang,
	}
	bd.templates = loadTemplates(cfg.Templates, configDir, pokemonID)
	return bd
}

// HasTemplates reports whether at least one template was loaded.
func (bd *BrowserDetector) HasTemplates() bool {
	return len(bd.templates) > 0
}

// processIdleFrame evaluates templates against a captured frame and updates
// the consecutive-hit counter. Returns the best score and whether the counter
// was incremented (match confirmed).
func (bd *BrowserDetector) processIdleFrame(frame image.Image, precision float64, consecutiveHits, cooldownSec int) (float64, bool) {
	var bestScore float64
	for _, lt := range bd.templates {
		if s := MatchWithRegions(frame, lt, precision, bd.lang); s > bestScore {
			bestScore = s
		}
	}

	above := bestScore >= precision

	if above && !bd.prevAbove {
		bd.consecCount = 1
	} else if above && bd.prevAbove {
		bd.consecCount++
	} else {
		bd.consecCount = 0
	}
	bd.prevAbove = above

	if bd.consecCount >= consecutiveHits {
		bd.consecCount = 0
		bd.prevAbove = false
		bd.cooldownEnd = time.Now().Add(time.Duration(cooldownSec) * time.Second)
		bd.cooldownStartTime = time.Now()
		bd.phase = stateMatchActive
		slog.Debug("Detector match confirmed", "cooldown_sec", cooldownSec)
		return bestScore, true
	}
	return bestScore, false
}

func (bd *BrowserDetector) processCooldownFrame(frame image.Image, precision float64, adaptiveCooldownMin int) float64 {
	var bestScore float64
	if bd.cfg.AdaptiveCooldown {
		for _, lt := range bd.templates {
			score := MatchWithRegions(frame, lt, precision, bd.lang)
			if score > bestScore {
				bestScore = score
			}
		}
		bd.lastBestScore = bestScore
		minElapsed := time.Since(bd.cooldownStartTime) >= time.Duration(adaptiveCooldownMin)*time.Second
		if minElapsed && bestScore < precision {
			bd.phase = stateIdle
			bd.prevAbove = true
			bd.consecCount = 0
		}
	} else if time.Now().After(bd.cooldownEnd) {
		bd.phase = stateIdle
		bd.prevAbove = true
		bd.consecCount = 0
	}
	return bestScore
}

// SubmitFrame runs one iteration of the detection state machine against frame.
// It is safe to call from multiple goroutines.
func (bd *BrowserDetector) SubmitFrame(frame image.Image) BrowserMatchResult {
	bd.mu.Lock()
	defer bd.mu.Unlock()

	precision := bd.cfg.Precision
	if precision == 0 {
		precision = defaultPrecision
	}
	consecutiveHits := bd.cfg.ConsecutiveHits
	if consecutiveHits == 0 {
		consecutiveHits = 1
	}
	cooldownSec := bd.cfg.CooldownSec
	if cooldownSec == 0 {
		cooldownSec = defaultCooldownSec
	}
	adaptiveCooldownMin := bd.cfg.AdaptiveCooldownMin
	if adaptiveCooldownMin == 0 {
		adaptiveCooldownMin = 3
	}

	var bestScore float64
	incremented := false

	switch bd.phase {
	case stateIdle:
		bestScore, incremented = bd.processIdleFrame(frame, precision, consecutiveHits, cooldownSec)

	case stateMatchActive:
		bd.phase = stateCooldown

	case stateCooldown:
		bestScore = bd.processCooldownFrame(frame, precision, adaptiveCooldownMin)
	}

	return BrowserMatchResult{
		State:       bd.phase.String(),
		Confidence:  bestScore,
		Incremented: incremented,
	}
}
