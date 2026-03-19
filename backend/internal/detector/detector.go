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
			f.Close()
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

// Run executes the detection loop until ctx is cancelled. It should be called
// in its own goroutine. Internally it spawns a capture goroutine that feeds
// frames into a buffered channel, and an analysis goroutine that runs the
// idle/match/cooldown state machine on each received frame.
func (d *Detector) Run(ctx context.Context) {
	// Load templates.
	d.templates = loadTemplates(d.cfg.Templates, d.configDir, d.pokemonID)
	if len(d.templates) == 0 {
		slog.Warn("Detector has no templates loaded, stopping", "pokemon_id", d.pokemonID)
		return
	}

	// Resolve poll interval and store atomically (nanoseconds).
	var basePollNs int64
	if d.cfg.PollIntervalMs > 0 {
		basePollNs = int64(time.Duration(d.cfg.PollIntervalMs) * time.Millisecond)
	} else {
		basePollNs = int64(defaultPollIntervalMs * time.Millisecond)
	}
	d.pollIntervalNs.Store(basePollNs)
	// Adaptive polling bounds: fast when screen is active, slow when static.
	minPollMs := d.cfg.MinPollMs
	if minPollMs == 0 {
		minPollMs = defaultMinPollMs
	}
	maxPollMs := d.cfg.MaxPollMs
	if maxPollMs == 0 {
		maxPollMs = defaultMaxPollMs
	}
	minPollNs := int64(time.Duration(minPollMs) * time.Millisecond)
	maxPollNs := int64(time.Duration(maxPollMs) * time.Millisecond)

	// Apply defaults for zero-valued thresholds.
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

	// Buffered channel decouples capture from analysis; capacity 3 lets the
	// capture goroutine stay ahead without blocking when analysis is slow.
	frames := make(chan image.Image, 3)

	// Capture goroutine: grabs frames at the current poll interval rate and
	// sends them into the channel. Uses non-blocking send so frames are
	// dropped when analysis falls behind.
	go func() {
		defer close(frames)
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
				// Non-blocking send: drop the frame if the analysis goroutine
				// has not consumed earlier frames yet.
				select {
				case frames <- frame:
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
	}()

	// Analysis goroutine (runs on the caller's goroutine): reads frames from
	// the channel and executes the existing state machine logic.
	matchConfirmedAt := time.Time{}

	for frame := range frames {
		// Compute frame delta for adaptive polling (how much did the screen change?)
		var frameDelta float64
		if d.prevFrame != nil {
			frameDelta = PixelDelta(d.prevFrame, frame)
		}
		d.prevFrame = frame

		switch d.phase {
		case stateIdle:
			var bestScore float64
			for _, lt := range d.templates {
				score := MatchWithRegions(frame, lt, precision, d.lang)
				if score > bestScore {
					bestScore = score
				}
			}
			d.lastBestScore = bestScore

			above := bestScore >= precision

			// Edge detection: only start counting consecutive hits after
			// a low→high transition to prevent re-triggering on sustained matches.
			if above && !d.prevAbove {
				d.consecCount = 1
			} else if above && d.prevAbove {
				d.consecCount++
			} else {
				d.consecCount = 0
			}
			d.prevAbove = above

			// Adaptive polling based on frame delta:
			//   Static screen (delta < 1%)  → slow down to save CPU
			//   Some activity (1-5%)         → base polling rate
			//   High activity (> 5%)         → fastest polling to catch brief events
			var targetNs int64
			switch {
			case above || bestScore > 0.5:
				// Near or at match — always poll fast
				targetNs = minPollNs
			case frameDelta > 0.05:
				// Lots of screen change — something is happening, poll fast
				targetNs = minPollNs
			case frameDelta > 0.01:
				// Moderate change — use base rate
				targetNs = basePollNs
			default:
				// Static screen — slow down
				targetNs = maxPollNs
			}
			d.pollIntervalNs.Store(targetNs)

			if d.consecCount >= consecutiveHits {
				d.stateMgr.Increment(d.pokemonID)
				d.stateMgr.AppendDetectionLog(d.pokemonID, bestScore)
				d.broadcast("detector_match", map[string]any{
					"pokemon_id": d.pokemonID,
					"confidence": bestScore,
				})
				d.lastFrame = frame
				matchConfirmedAt = time.Now()
				d.phase = stateMatchActive
				d.consecCount = 0
				d.prevAbove = false
			}

		case stateMatchActive:
			delta := PixelDelta(d.lastFrame, frame)
			elapsed := time.Since(matchConfirmedAt)
			if delta >= changeThreshold || elapsed >= time.Duration(cooldownSec)*time.Second {
				d.cooldownEnd = time.Now().Add(time.Duration(cooldownSec) * time.Second)
				d.phase = stateCooldown
			}

		case stateCooldown:
			if time.Now().After(d.cooldownEnd) {
				d.phase = stateIdle
				d.prevAbove = true // assume still matching after cooldown to prevent re-trigger
				d.pollIntervalNs.Store(basePollNs)
			}
		}

		// Emit status after each analyzed frame.
		pollMs := time.Duration(d.pollIntervalNs.Load()).Milliseconds()
		d.broadcast("detector_status", map[string]any{
			"pokemon_id": d.pokemonID,
			"state":      d.phase.String(),
			"confidence": d.lastBestScore,
			"poll_ms":    pollMs,
		})
	}
}
