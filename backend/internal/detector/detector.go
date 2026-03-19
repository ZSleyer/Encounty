package detector

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"log/slog"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// BroadcastFunc is called by a Detector to emit a WebSocket event to all clients.
// msgType is the event type string; payload is marshalled to JSON by the caller.
type BroadcastFunc func(msgType string, payload any)

// detectorPhase represents the current state-machine phase of a Detector.
type detectorPhase string

const (
	stateIdle        detectorPhase = "idle"
	stateMatchActive detectorPhase = "match_active"
	stateCooldown    detectorPhase = "cooldown"
)

// String returns the wire-format string for the phase.
func (p detectorPhase) String() string {
	return string(p)
}

// Default configuration values applied when cfg fields are zero.
const (
	defaultPollIntervalMs  = 50
	defaultPrecision       = 0.85
	defaultConsecutiveHits = 1
	defaultCooldownSec     = 8
	defaultChangeThreshold = 0.15
	defaultMinPollMs       = 30
	defaultMaxPollMs       = 500
)

// Detector runs the per-hunt auto-detection loop for a single Pokémon hunt.
type Detector struct {
	pokemonID string
	cfg       state.DetectorConfig
	stateMgr  *state.Manager
	broadcast BroadcastFunc
	configDir string

	// internal state machine
	phase       detectorPhase
	consecCount int
	prevAbove   bool // edge detection: only count on low→high transition
	prevFrame   image.Image // previous frame for delta-based adaptive polling
	lastFrame   image.Image // frame at match confirmation for change detection
	cooldownEnd time.Time

	// pollIntervalNs stores the current poll interval in nanoseconds.
	// Read and written atomically so the capture goroutine can observe
	// adaptive backoff changes made by the analysis goroutine without locks.
	pollIntervalNs atomic.Int64

	// templates are pre-loaded once on Run start; each bundles the decoded image
	// with its region metadata for region-scoped matching.
	templates []loadedTemplate

	// lang is the tesseract language code derived from the Pokémon's language field.
	lang string

	// lastBestScore tracks the most recent idle-phase confidence value
	lastBestScore float64
}

// newDetector creates a Detector from the given config. Templates are loaded lazily on first Run.
// The Pokémon's language field is resolved via mgr to derive the tesseract language code.
func newDetector(pokemonID string, cfg state.DetectorConfig, mgr *state.Manager, broadcast BroadcastFunc, configDir string) *Detector {
	lang := "eng"
	for _, p := range mgr.GetState().Pokemon {
		if p.ID == pokemonID {
			lang = LangToTesseract(p.Language)
			break
		}
	}
	return &Detector{
		pokemonID: pokemonID,
		cfg:       cfg,
		stateMgr:  mgr,
		broadcast: broadcast,
		configDir: configDir,
		phase:     stateIdle,
		lang:      lang,
	}
}

// loadTemplates decodes PNG template images from either in-memory BLOBs
// (ImageData) or the filesystem (ImagePath). In-memory data takes priority;
// relative filesystem paths are resolved against configDir/templates/pokemonID/.
// Templates that cannot be opened or decoded are silently skipped; their region
// metadata is preserved alongside the decoded image in a loadedTemplate.
func loadTemplates(templates []state.DetectorTemplate, configDir, pokemonID string) []loadedTemplate {
	var result []loadedTemplate
	for _, t := range templates {
		var img image.Image
		var err error

		if len(t.ImageData) > 0 {
			// Load from in-memory BLOB (DB-backed path).
			img, err = png.Decode(bytes.NewReader(t.ImageData))
			if err != nil {
				slog.Warn("Detector failed to decode in-memory template", "pokemon_id", pokemonID, "error", err)
				continue
			}
		} else if t.ImagePath != "" {
			// Legacy filesystem path.
			p := t.ImagePath
			var absPath string
			if filepath.IsAbs(p) {
				absPath = p
			} else {
				absPath = filepath.Join(configDir, "templates", pokemonID, p)
			}
			var f *os.File
			f, err = os.Open(absPath)
			if err != nil {
				slog.Warn("Detector skipping missing template", "pokemon_id", pokemonID, "path", absPath, "error", err)
				continue
			}
			img, err = png.Decode(f)
			_ = f.Close()
			if err != nil {
				slog.Warn("Detector failed to decode template", "pokemon_id", pokemonID, "path", absPath, "error", err)
				continue
			}
		} else {
			// No image source available; skip.
			continue
		}

		result = append(result, loadedTemplate{img: img, meta: t})
	}
	return result
}

// resolvedConfig holds resolved (defaulted) detection configuration values
// so they can be passed between helper methods without repeating zero-value checks.
type resolvedConfig struct {
	basePollNs      int64
	minPollNs       int64
	maxPollNs       int64
	precision       float64
	consecutiveHits int
	cooldownSec     int
	changeThreshold float64
}

// resolveConfig applies defaults for zero-valued configuration fields and returns
// a resolvedConfig with all values ready for use in the detection loop.
func (d *Detector) resolveConfig() resolvedConfig {
	var basePollNs int64
	if d.cfg.PollIntervalMs > 0 {
		basePollNs = int64(time.Duration(d.cfg.PollIntervalMs) * time.Millisecond)
	} else {
		basePollNs = int64(defaultPollIntervalMs * time.Millisecond)
	}

	minPollMs := d.cfg.MinPollMs
	if minPollMs == 0 {
		minPollMs = defaultMinPollMs
	}
	maxPollMs := d.cfg.MaxPollMs
	if maxPollMs == 0 {
		maxPollMs = defaultMaxPollMs
	}

	precision := d.cfg.Precision
	if precision == 0 {
		precision = defaultPrecision
	}
	consecutiveHits := d.cfg.ConsecutiveHits
	if consecutiveHits == 0 {
		consecutiveHits = defaultConsecutiveHits
	}
	cooldownSec := d.cfg.CooldownSec
	if cooldownSec == 0 {
		cooldownSec = defaultCooldownSec
	}
	changeThreshold := d.cfg.ChangeThreshold
	if changeThreshold == 0 {
		changeThreshold = defaultChangeThreshold
	}

	return resolvedConfig{
		basePollNs:      basePollNs,
		minPollNs:       int64(time.Duration(minPollMs) * time.Millisecond),
		maxPollNs:       int64(time.Duration(maxPollMs) * time.Millisecond),
		precision:       precision,
		consecutiveHits: consecutiveHits,
		cooldownSec:     cooldownSec,
		changeThreshold: changeThreshold,
	}
}

// captureFrames grabs screen frames at the current adaptive poll interval and
// sends them into ch. Frames are dropped (non-blocking send) when the analysis
// goroutine falls behind. The channel is closed when ctx is cancelled.
func (d *Detector) captureFrames(ctx context.Context, ch chan<- image.Image) {
	defer close(ch)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		frame, err := CaptureRegion(d.cfg.Region.X, d.cfg.Region.Y, d.cfg.Region.W, d.cfg.Region.H)
		if err != nil {
			slog.Debug("Detector capture failed", "pokemon_id", d.pokemonID, "error", err)
		} else {
			select {
			case ch <- frame:
			default:
			}
		}

		interval := time.Duration(d.pollIntervalNs.Load())
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}
	}
}

// processIdleFrame evaluates templates against a captured frame during the idle
// phase and transitions to stateMatchActive when enough consecutive hits are
// confirmed. It also adjusts the adaptive poll interval based on frame delta.
func (d *Detector) processIdleFrame(frame image.Image, rc resolvedConfig, frameDelta float64) time.Time {
	var bestScore float64
	for _, lt := range d.templates {
		score := MatchWithRegions(frame, lt, rc.precision, d.lang)
		if score > bestScore {
			bestScore = score
		}
	}
	d.lastBestScore = bestScore

	above := bestScore >= rc.precision

	if above && !d.prevAbove {
		d.consecCount = 1
	} else if above && d.prevAbove {
		d.consecCount++
	} else {
		d.consecCount = 0
	}
	d.prevAbove = above

	// Adaptive polling: fast when screen is active or near match, slow when static.
	var targetNs int64
	switch {
	case above || bestScore > 0.5:
		targetNs = rc.minPollNs
	case frameDelta > 0.05:
		targetNs = rc.minPollNs
	case frameDelta > 0.01:
		targetNs = rc.basePollNs
	default:
		targetNs = rc.maxPollNs
	}
	d.pollIntervalNs.Store(targetNs)

	if d.consecCount >= rc.consecutiveHits {
		d.stateMgr.Increment(d.pokemonID)
		d.stateMgr.AppendDetectionLog(d.pokemonID, bestScore)
		d.broadcast("detector_match", map[string]any{
			"pokemon_id": d.pokemonID,
			"confidence": bestScore,
		})
		d.lastFrame = frame
		d.phase = stateMatchActive
		d.consecCount = 0
		d.prevAbove = false
		return time.Now()
	}
	return time.Time{}
}

// processFrame runs one iteration of the idle/match/cooldown state machine on
// a captured frame and broadcasts the resulting status to all clients.
func (d *Detector) processFrame(frame image.Image, rc resolvedConfig, matchConfirmedAt time.Time) time.Time {
	var frameDelta float64
	if d.prevFrame != nil {
		frameDelta = PixelDelta(d.prevFrame, frame)
	}
	d.prevFrame = frame

	switch d.phase {
	case stateIdle:
		if t := d.processIdleFrame(frame, rc, frameDelta); !t.IsZero() {
			matchConfirmedAt = t
		}

	case stateMatchActive:
		delta := PixelDelta(d.lastFrame, frame)
		elapsed := time.Since(matchConfirmedAt)
		if delta >= rc.changeThreshold || elapsed >= time.Duration(rc.cooldownSec)*time.Second {
			d.cooldownEnd = time.Now().Add(time.Duration(rc.cooldownSec) * time.Second)
			d.phase = stateCooldown
		}

	case stateCooldown:
		if time.Now().After(d.cooldownEnd) {
			d.phase = stateIdle
			d.prevAbove = true
			d.pollIntervalNs.Store(rc.basePollNs)
		}
	}

	pollMs := time.Duration(d.pollIntervalNs.Load()).Milliseconds()
	d.broadcast("detector_status", map[string]any{
		"pokemon_id": d.pokemonID,
		"state":      d.phase.String(),
		"confidence": d.lastBestScore,
		"poll_ms":    pollMs,
	})

	return matchConfirmedAt
}

// Run executes the detection loop until ctx is cancelled. It should be called
// in its own goroutine. Internally it spawns a capture goroutine that feeds
// frames into a buffered channel, and an analysis goroutine that runs the
// idle/match/cooldown state machine on each received frame.
func (d *Detector) Run(ctx context.Context) {
	d.templates = loadTemplates(d.cfg.Templates, d.configDir, d.pokemonID)
	if len(d.templates) == 0 {
		slog.Warn("Detector has no templates loaded, stopping", "pokemon_id", d.pokemonID)
		return
	}

	rc := d.resolveConfig()
	d.pollIntervalNs.Store(rc.basePollNs)

	frames := make(chan image.Image, 3)
	go d.captureFrames(ctx, frames)

	matchConfirmedAt := time.Time{}
	for frame := range frames {
		matchConfirmedAt = d.processFrame(frame, rc, matchConfirmedAt)
	}
}
