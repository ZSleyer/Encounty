// frame_source_screen.go implements FrameSource for screen-region and window
// capture. It polls the screen at an adaptive interval and delivers frames to
// the detection loop.
package detector

import (
	"context"
	"image"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// ScreenFrameSource captures frames from a screen region or a named window.
// The poll interval is adjustable via the PollIntervalNs atomic so the
// detection loop can implement adaptive backoff.
type ScreenFrameSource struct {
	cfg            state.DetectorConfig
	PollIntervalNs atomic.Int64
	pokemonID      string // used only for debug logging
}

// NewScreenFrameSource creates a FrameSource that polls a screen region or
// window at the interval stored in PollIntervalNs.
func NewScreenFrameSource(cfg state.DetectorConfig, pokemonID string) *ScreenFrameSource {
	return &ScreenFrameSource{
		cfg:       cfg,
		pokemonID: pokemonID,
	}
}

// NextFrame captures a single frame from the configured screen region or
// window. It sleeps for the current adaptive poll interval before each
// capture. Returns context.Canceled when ctx is done.
func (s *ScreenFrameSource) NextFrame(ctx context.Context) (image.Image, error) {
	// Sleep for the adaptive interval first (except on the very first call
	// the interval will be zero until the detector sets it).
	interval := time.Duration(s.PollIntervalNs.Load())
	if interval > 0 {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(interval):
		}
	}

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}

	if s.cfg.SourceType == "window" && s.cfg.WindowTitle != "" {
		return s.captureWindow(ctx)
	}
	return s.captureRegion()
}

// Close is a no-op for screen capture; the context cancellation in NextFrame
// is sufficient.
func (s *ScreenFrameSource) Close() {}

// captureRegion grabs the configured screen rectangle.
func (s *ScreenFrameSource) captureRegion() (image.Image, error) {
	frame, err := CaptureRegion(s.cfg.Region.X, s.cfg.Region.Y, s.cfg.Region.W, s.cfg.Region.H)
	if err != nil {
		slog.Debug("ScreenFrameSource capture failed", "pokemon_id", s.pokemonID, "error", err)
		return nil, err
	}
	return frame, nil
}

// captureWindow finds the target window by title and captures its contents.
func (s *ScreenFrameSource) captureWindow(_ context.Context) (image.Image, error) {
	hwnd := findWindowByTitleLower(s.cfg.WindowTitle)
	if hwnd == 0 {
		slog.Debug("ScreenFrameSource window not found", "pokemon_id", s.pokemonID, "title", s.cfg.WindowTitle)
		return nil, nil
	}
	frame, err := CaptureWindow(hwnd)
	if err != nil {
		slog.Debug("ScreenFrameSource window capture failed", "pokemon_id", s.pokemonID, "error", err)
		return nil, err
	}
	return frame, nil
}

// findWindowByTitleLower searches available windows for one whose title
// contains the given substring (case-insensitive). Returns 0 if not found.
func findWindowByTitleLower(title string) uintptr {
	lower := strings.ToLower(title)
	for _, w := range ListWindows() {
		if strings.Contains(strings.ToLower(w.Title), lower) {
			return w.HWND
		}
	}
	return 0
}
