package detector

import (
	"context"
	"image"
	"image/png"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/zsleyer/encounty/internal/state"
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
	defaultPollIntervalMs  = 500
	defaultPrecision       = 0.85
	defaultConsecutiveHits = 2
	defaultCooldownSec     = 8
	defaultChangeThreshold = 0.15
)

// Detector runs the per-hunt auto-detection loop for a single Pokémon hunt.
type Detector struct {
	pokemonID string
	cfg       state.DetectorConfig
	stateMgr  *state.Manager
	broadcast BroadcastFunc
	configDir string

	// internal state machine
	phase        detectorPhase
	consecCount  int
	lastFrame    image.Image
	cooldownEnd  time.Time
	pollInterval time.Duration

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

// loadTemplates opens and decodes the PNG template images listed in templates.
// Relative paths are resolved against configDir/templates/pokemonID/.
// Templates that cannot be opened or decoded are silently skipped; their region
// metadata is preserved alongside the decoded image in a loadedTemplate.
func loadTemplates(templates []state.DetectorTemplate, configDir, pokemonID string) []loadedTemplate {
	var result []loadedTemplate
	for _, t := range templates {
		p := t.ImagePath
		var absPath string
		if filepath.IsAbs(p) {
			absPath = p
		} else {
			absPath = filepath.Join(configDir, "templates", pokemonID, p)
		}
		f, err := os.Open(absPath)
		if err != nil {
			log.Printf("detector[%s]: skipping missing template %q: %v", pokemonID, absPath, err)
			continue
		}
		img, err := png.Decode(f)
		f.Close()
		if err != nil {
			log.Printf("detector[%s]: failed to decode template %q: %v", pokemonID, absPath, err)
			continue
		}
		result = append(result, loadedTemplate{img: img, meta: t})
	}
	return result
}

// Run executes the detection loop until ctx is cancelled. It should be called in its own goroutine.
func (d *Detector) Run(ctx context.Context) {
	// Load templates.
	d.templates = loadTemplates(d.cfg.Templates, d.configDir, d.pokemonID)
	if len(d.templates) == 0 {
		log.Printf("detector[%s]: no templates loaded; stopping", d.pokemonID)
		return
	}

	// Resolve poll interval.
	if d.cfg.PollIntervalMs > 0 {
		d.pollInterval = time.Duration(d.cfg.PollIntervalMs) * time.Millisecond
	} else {
		d.pollInterval = defaultPollIntervalMs * time.Millisecond
	}
	basePollInterval := d.pollInterval
	maxPollInterval := basePollInterval * 2

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

	// idleNoMatchCount tracks consecutive polls with score == 0 for adaptive backoff.
	idleNoMatchCount := 0
	matchConfirmedAt := time.Time{}

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		frame, err := CaptureRegion(d.cfg.Region.X, d.cfg.Region.Y, d.cfg.Region.W, d.cfg.Region.H)
		if err != nil {
			log.Printf("detector[%s]: capture failed: %v", d.pokemonID, err)
		} else {
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

				if bestScore >= precision {
					d.consecCount++
					idleNoMatchCount = 0
					// Reset adaptive interval on any strong signal.
					if d.pollInterval != basePollInterval {
						d.pollInterval = basePollInterval
					}
				} else {
					d.consecCount = 0
					if bestScore > 0.5 {
						idleNoMatchCount = 0
						if d.pollInterval != basePollInterval {
							d.pollInterval = basePollInterval
						}
					} else {
						idleNoMatchCount++
						// Adaptive backoff: if 30+ consecutive polls have no signal, double interval.
						if idleNoMatchCount >= 30 && d.pollInterval < maxPollInterval {
							d.pollInterval = d.pollInterval * 2
							if d.pollInterval > maxPollInterval {
								d.pollInterval = maxPollInterval
							}
						}
					}
				}

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
					d.pollInterval = basePollInterval
					idleNoMatchCount = 0
				}
			}
		}

		// Emit status after each poll.
		d.broadcast("detector_status", map[string]any{
			"pokemon_id": d.pokemonID,
			"state":      d.phase.String(),
			"confidence": d.lastBestScore,
			"poll_ms":    d.pollInterval.Milliseconds(),
		})

		select {
		case <-ctx.Done():
			return
		case <-time.After(d.pollInterval):
		}
	}
}
