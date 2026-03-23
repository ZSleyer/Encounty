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
// It consumes frames from a FrameSource and runs a unified state machine
// (idle → match_active → cooldown) regardless of the capture backend.
type Detector struct {
	pokemonID string
	cfg       state.DetectorConfig
	stateMgr  *state.Manager
	broadcast BroadcastFunc
	configDir string

	// internal state machine
	phase             detectorPhase
	consecCount       int
	prevAbove         bool        // edge detection: only count on low→high transition
	prevFrame         image.Image // previous frame for delta-based adaptive polling
	lastFrame         image.Image // frame at match confirmation for change detection
	cooldownEnd       time.Time
	cooldownStartTime time.Time // used for adaptive cooldown minimum elapsed check
	matchConfirmedAt  time.Time // when the current match was confirmed

	// pollIntervalNs stores the current poll interval in nanoseconds.
	// Read and written atomically so the capture goroutine can observe
	// adaptive backoff changes made by the analysis goroutine without locks.
	pollIntervalNs atomic.Int64

	// templates are pre-loaded once on Run start; each bundles the decoded image
	// with its region metadata for region-scoped matching.
	templates []loadedTemplate

	// lang is the tesseract language code derived from the Pokémon's language field.
	lang string

	// lastBestScore tracks the most recent confidence value.
	lastBestScore float64
}

// newDetector creates a Detector from the given config. Templates are loaded lazily on first Run.
// The Pokémon's language field is resolved via mgr to derive the tesseract language code.
func newDetector(pokemonID string, cfg state.DetectorConfig, mgr *state.Manager, broadcast BroadcastFunc, configDir string) *Detector {
	lang := "eng"
	if mgr != nil {
		for _, p := range mgr.GetState().Pokemon {
			if p.ID == pokemonID {
				lang = LangToTesseract(p.Language)
				break
			}
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
		if t.Enabled != nil && !*t.Enabled {
			continue
		}
		img := decodeTemplateImage(t, configDir, pokemonID)
		if img != nil {
			result = append(result, loadedTemplate{img: img, meta: t})
		}
	}
	return result
}

// decodeTemplateImage decodes a single template's PNG image from either
// in-memory BLOBs or the filesystem. Returns nil if the image cannot be loaded.
func decodeTemplateImage(t state.DetectorTemplate, configDir, pokemonID string) image.Image {
	if len(t.ImageData) > 0 {
		img, err := png.Decode(bytes.NewReader(t.ImageData))
		if err != nil {
			slog.Warn("Detector failed to decode in-memory template", "pokemon_id", pokemonID, "error", err)
			return nil
		}
		return img
	}
	if t.ImagePath == "" {
		return nil
	}
	absPath := t.ImagePath
	if !filepath.IsAbs(absPath) {
		absPath = filepath.Join(configDir, "templates", pokemonID, t.ImagePath)
	}
	f, err := os.Open(absPath)
	if err != nil {
		slog.Warn("Detector skipping missing template", "pokemon_id", pokemonID, "path", absPath, "error", err)
		return nil
	}
	img, err := png.Decode(f)
	_ = f.Close()
	if err != nil {
		slog.Warn("Detector failed to decode template", "pokemon_id", pokemonID, "path", absPath, "error", err)
		return nil
	}
	return img
}

// resolvedConfig holds resolved (defaulted) detection configuration values
// so they can be passed between helper methods without repeating zero-value checks.
type resolvedConfig struct {
	basePollNs          int64
	minPollNs           int64
	maxPollNs           int64
	precision           float64
	consecutiveHits     int
	cooldownSec         int
	changeThreshold     float64
	adaptiveCooldown    bool
	adaptiveCooldownMin int
	relativeRegions     bool
}

// resolveConfig applies defaults for zero-valued configuration fields and returns
// a resolvedConfig with all values ready for use in the detection loop.
func (d *Detector) resolveConfig() resolvedConfig {
	basePollNs := msToNs(intOrDefault(d.cfg.PollIntervalMs, defaultPollIntervalMs))
	minPollMs := intOrDefault(d.cfg.MinPollMs, defaultMinPollMs)
	maxPollMs := intOrDefault(d.cfg.MaxPollMs, defaultMaxPollMs)
	adaptiveCooldownMin := intOrDefault(d.cfg.AdaptiveCooldownMin, 3)

	return resolvedConfig{
		basePollNs:          basePollNs,
		minPollNs:           msToNs(minPollMs),
		maxPollNs:           msToNs(maxPollMs),
		precision:           floatOrDefault(d.cfg.Precision, defaultPrecision),
		consecutiveHits:     intOrDefault(d.cfg.ConsecutiveHits, defaultConsecutiveHits),
		cooldownSec:         intOrDefault(d.cfg.CooldownSec, defaultCooldownSec),
		changeThreshold:     floatOrDefault(d.cfg.ChangeThreshold, defaultChangeThreshold),
		adaptiveCooldown:    d.cfg.AdaptiveCooldown,
		adaptiveCooldownMin: adaptiveCooldownMin,
		relativeRegions:     d.cfg.RelativeRegions,
	}
}

// intOrDefault returns v if non-zero, otherwise def.
func intOrDefault(v, def int) int {
	if v != 0 {
		return v
	}
	return def
}

// floatOrDefault returns v if non-zero, otherwise def.
func floatOrDefault(v, def float64) float64 {
	if v != 0 {
		return v
	}
	return def
}

// msToNs converts a millisecond int to nanoseconds as int64.
func msToNs(ms int) int64 {
	return int64(time.Duration(ms) * time.Millisecond)
}

// bestTemplateScore evaluates all templates against a frame and returns the
// highest NCC score.
func (d *Detector) bestTemplateScore(frame image.Image, rc resolvedConfig) float64 {
	var best float64
	for _, lt := range d.templates {
		if s := MatchWithRegions(frame, lt, rc.precision, d.lang, rc.relativeRegions); s > best {
			best = s
		}
	}
	return best
}

// processIdleFrame evaluates templates against a captured frame during the idle
// phase and transitions to stateMatchActive when enough consecutive hits are
// confirmed. For non-browser sources it also adjusts the adaptive poll interval
// based on frame delta.
func (d *Detector) processIdleFrame(frame image.Image, rc resolvedConfig, frameDelta float64) {
	bestScore := d.bestTemplateScore(frame, rc)
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

	// Adaptive polling based on match score and frame delta.
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
		d.onMatchConfirmed(frame, bestScore, rc)
	}
}

// onMatchConfirmed handles the transition from idle to match_active after
// enough consecutive template hits. It increments the counter, logs the
// detection, and broadcasts a match event.
func (d *Detector) onMatchConfirmed(frame image.Image, bestScore float64, rc resolvedConfig) {
	if d.stateMgr != nil {
		d.stateMgr.Increment(d.pokemonID)
		d.stateMgr.AppendDetectionLog(d.pokemonID, bestScore)
	}
	d.broadcast("detector_match", map[string]any{
		"pokemon_id": d.pokemonID,
		"confidence": bestScore,
	})
	if frame != nil {
		d.lastFrame = frame
	}
	d.matchConfirmedAt = time.Now()
	d.cooldownEnd = time.Now().Add(time.Duration(rc.cooldownSec) * time.Second)
	d.cooldownStartTime = time.Now()
	d.phase = stateMatchActive
	d.consecCount = 0
	d.prevAbove = false
}

// processCooldownFrame checks whether the cooldown period has elapsed (either
// by time or adaptively by score drop) and transitions back to idle.
func (d *Detector) processCooldownFrame(frame image.Image, rc resolvedConfig) {
	if rc.adaptiveCooldown {
		bestScore := d.bestTemplateScore(frame, rc)
		d.lastBestScore = bestScore
		minElapsed := time.Since(d.cooldownStartTime) >= time.Duration(rc.adaptiveCooldownMin)*time.Second
		if minElapsed && bestScore < rc.precision {
			d.phase = stateIdle
			d.prevAbove = true
			d.consecCount = 0
			d.pollIntervalNs.Store(rc.basePollNs)
		}
		return
	}
	if time.Now().After(d.cooldownEnd) {
		d.phase = stateIdle
		d.prevAbove = true
		d.consecCount = 0
		d.pollIntervalNs.Store(rc.basePollNs)
	}
}

// processFrame runs one iteration of the idle/match/cooldown state machine on
// a captured frame and broadcasts the resulting status to all clients.
func (d *Detector) processFrame(frame image.Image, rc resolvedConfig) {
	var frameDelta float64
	if d.prevFrame != nil {
		frameDelta = PixelDelta(d.prevFrame, frame)
	}
	d.prevFrame = frame

	switch d.phase {
	case stateIdle:
		d.processIdleFrame(frame, rc, frameDelta)

	case stateMatchActive:
		delta := PixelDelta(d.lastFrame, frame)
		elapsed := time.Since(d.matchConfirmedAt)
		if delta >= rc.changeThreshold || elapsed >= time.Duration(rc.cooldownSec)*time.Second {
			d.cooldownEnd = time.Now().Add(time.Duration(rc.cooldownSec) * time.Second)
			d.cooldownStartTime = time.Now()
			d.phase = stateCooldown
		}

	case stateCooldown:
		d.processCooldownFrame(frame, rc)
	}

	pollMs := time.Duration(d.pollIntervalNs.Load()).Milliseconds()
	d.broadcast("detector_status", map[string]any{
		"pokemon_id": d.pokemonID,
		"state":      d.phase.String(),
		"confidence": d.lastBestScore,
		"poll_ms":    pollMs,
	})
}

// HasTemplates reports whether at least one template was loaded.
func (d *Detector) HasTemplates() bool {
	return len(d.templates) > 0
}

// Run executes the detection loop until ctx is cancelled. It should be called
// in its own goroutine. The source provides frames from any backend (screen,
// window, camera, or browser).
func (d *Detector) Run(ctx context.Context, source FrameSource) {
	d.templates = loadTemplates(d.cfg.Templates, d.configDir, d.pokemonID)
	if len(d.templates) == 0 {
		slog.Warn("Detector has no templates loaded, stopping", "pokemon_id", d.pokemonID)
		return
	}

	rc := d.resolveConfig()
	d.pollIntervalNs.Store(rc.basePollNs)

	// If the source supports adaptive polling, wire the poll interval.
	if ss, ok := source.(*ScreenFrameSource); ok {
		ss.PollIntervalNs.Store(rc.basePollNs)
	}

	for {
		frame, err := source.NextFrame(ctx)
		if err != nil {
			return
		}
		if frame == nil {
			continue
		}

		d.processFrame(frame, rc)

		// Propagate adaptive poll interval to the screen source.
		if ss, ok := source.(*ScreenFrameSource); ok {
			ss.PollIntervalNs.Store(d.pollIntervalNs.Load())
		}
	}
}

