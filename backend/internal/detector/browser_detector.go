// browser_detector.go provides a per-hunt state machine for browser-sourced
// detection scores.
//
// Unlike the goroutine-based [Detector] which polls the screen itself, the
// BrowserDetector is driven by external score submissions via
// [BrowserDetector.SubmitScore]. The caller (an HTTP handler) POSTs a
// pre-computed NCC score from the browser's WebGPU engine; this method runs
// the idle/match/cooldown state machine and returns a result that the handler
// can broadcast and persist.
//
// The state machine uses edge detection: a match only triggers when the score
// transitions from below the precision threshold to above it (i.e. a new
// encounter appears on screen). Sustained high scores do not re-trigger.
package detector

import (
	"log/slog"
	"sync"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// BrowserMatchResult is returned by [BrowserDetector.SubmitScore].
type BrowserMatchResult struct {
	// State is the post-submission state: "idle", "match_active", or "cooldown".
	State string `json:"state"`
	// Confidence is the score that was submitted (0.0-1.0).
	Confidence float64 `json:"confidence"`
	// Matched is true when this submission caused the encounter counter to tick.
	Matched bool `json:"matched"`
	// PollMs is the suggested poll interval for adaptive polling feedback.
	PollMs int `json:"poll_ms"`
}

// BrowserDetector manages the detection state machine for one Pokemon hunt
// when scores are delivered from a browser WebGPU engine. It is safe for
// concurrent use.
type BrowserDetector struct {
	mu                sync.Mutex
	phase             detectorPhase
	consecCount       int
	cooldownEnd       time.Time
	cooldownStartTime time.Time
	lastBestScore     float64

	// prevAbove tracks whether the previous submission scored above precision.
	// Used for edge detection: we only start counting consecutive hits after
	// a low-to-high transition (new encounter appeared).
	prevAbove bool

	// cfg is a snapshot of the detection configuration for this session.
	cfg state.DetectorConfig
}

// NewBrowserDetector creates a BrowserDetector with the given detection config.
func NewBrowserDetector(cfg state.DetectorConfig) *BrowserDetector {
	return &BrowserDetector{
		phase: stateIdle,
		cfg:   cfg,
	}
}

// SubmitScore runs one iteration of the detection state machine against a
// pre-computed NCC score from the browser's WebGPU engine. bestScore is the
// highest NCC score across all templates (0.0-1.0); frameDelta is the
// pixel-delta fraction between the current and previous frame (0.0-1.0).
// It is safe to call from multiple goroutines.
func (bd *BrowserDetector) SubmitScore(bestScore, frameDelta float64) BrowserMatchResult {
	bd.mu.Lock()
	defer bd.mu.Unlock()

	precision := floatOrDefault(bd.cfg.Precision, defaultPrecision)
	consecutiveHits := intOrDefault(bd.cfg.ConsecutiveHits, defaultConsecutiveHits)
	cooldownSec := intOrDefault(bd.cfg.CooldownSec, defaultCooldownSec)
	adaptiveCooldownMin := intOrDefault(bd.cfg.AdaptiveCooldownMin, 3)
	basePollMs := intOrDefault(bd.cfg.PollIntervalMs, defaultPollIntervalMs)
	minPollMs := intOrDefault(bd.cfg.MinPollMs, defaultMinPollMs)
	maxPollMs := intOrDefault(bd.cfg.MaxPollMs, defaultMaxPollMs)

	matched := false
	var pollMs int

	switch bd.phase {
	case stateIdle:
		matched, pollMs = bd.processIdleScore(bestScore, frameDelta, precision, consecutiveHits, cooldownSec, basePollMs, minPollMs, maxPollMs)

	case stateMatchActive:
		// Transition immediately to cooldown on the next submission.
		bd.phase = stateCooldown
		bd.cooldownEnd = time.Now().Add(time.Duration(cooldownSec) * time.Second)
		bd.cooldownStartTime = time.Now()
		pollMs = basePollMs

	case stateCooldown:
		pollMs = bd.processCooldownScore(bestScore, precision, adaptiveCooldownMin, basePollMs)
	}

	bd.lastBestScore = bestScore

	return BrowserMatchResult{
		State:      bd.phase.String(),
		Confidence: bestScore,
		Matched:    matched,
		PollMs:     pollMs,
	}
}

// processIdleScore evaluates a score during the idle phase and transitions to
// stateMatchActive when enough consecutive hits are confirmed. Returns whether
// a match was confirmed and the suggested poll interval in milliseconds.
func (bd *BrowserDetector) processIdleScore(bestScore, frameDelta, precision float64, consecutiveHits, cooldownSec, basePollMs, minPollMs, maxPollMs int) (bool, int) {
	above := bestScore >= precision

	if above && !bd.prevAbove {
		bd.consecCount = 1
	} else if above && bd.prevAbove {
		bd.consecCount++
	} else {
		bd.consecCount = 0
	}
	bd.prevAbove = above

	// Adaptive polling: suggest faster polling when activity is detected.
	var pollMs int
	switch {
	case above || bestScore > 0.5:
		pollMs = minPollMs
	case frameDelta > 0.05:
		pollMs = minPollMs
	case frameDelta > 0.01:
		pollMs = basePollMs
	default:
		pollMs = maxPollMs
	}

	if bd.consecCount >= consecutiveHits {
		bd.consecCount = 0
		bd.prevAbove = false
		bd.cooldownEnd = time.Now().Add(time.Duration(cooldownSec) * time.Second)
		bd.cooldownStartTime = time.Now()
		bd.phase = stateMatchActive
		slog.Debug("Browser detector match confirmed", "cooldown_sec", cooldownSec)
		return true, pollMs
	}

	return false, pollMs
}

// processCooldownScore checks whether the cooldown period has elapsed and
// transitions back to idle. Returns the suggested poll interval.
func (bd *BrowserDetector) processCooldownScore(bestScore, precision float64, adaptiveCooldownMin, basePollMs int) int {
	if bd.cfg.AdaptiveCooldown {
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

	return basePollMs
}

// UpdateConfig replaces the detection configuration. This allows tuning
// precision, cooldown, and other parameters without recreating the detector.
func (bd *BrowserDetector) UpdateConfig(cfg state.DetectorConfig) {
	bd.mu.Lock()
	defer bd.mu.Unlock()
	bd.cfg = cfg
}
