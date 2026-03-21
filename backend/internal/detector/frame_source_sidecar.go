// frame_source_sidecar.go provides a match-result source backed by the
// capture sidecar. Instead of delivering raw frames, it delivers pre-computed
// NCC scores so the Go detector can skip image processing entirely.
package detector

import (
	"context"
	"fmt"
)

// SidecarMatchResult holds a pre-computed match result from the sidecar.
type SidecarMatchResult struct {
	// BestScore is the highest NCC score across all templates (0.0-1.0).
	BestScore float64
	// FrameDelta is the pixel-delta fraction between this frame and the previous one.
	FrameDelta float64
}

// SidecarMatchSource receives match results from the sidecar's detection
// pipeline. Unlike FrameSource, it delivers pre-computed scores rather than
// raw frames, eliminating the need for Go-side NCC computation.
type SidecarMatchSource struct {
	resultCh chan SidecarMatchResult
	doneCh   chan struct{}
}

// NewSidecarMatchSource creates a SidecarMatchSource with the given buffer size.
func NewSidecarMatchSource(bufSize int) *SidecarMatchSource {
	return &SidecarMatchSource{
		resultCh: make(chan SidecarMatchResult, bufSize),
		doneCh:   make(chan struct{}),
	}
}

// Submit pushes a match result into the source. Non-blocking; drops if full.
func (s *SidecarMatchSource) Submit(result SidecarMatchResult) {
	select {
	case s.resultCh <- result:
	default:
	}
}

// NextResult blocks until a result is available or ctx is cancelled.
func (s *SidecarMatchSource) NextResult(ctx context.Context) (SidecarMatchResult, error) {
	select {
	case r, ok := <-s.resultCh:
		if !ok {
			return SidecarMatchResult{}, fmt.Errorf("sidecar match source closed")
		}
		return r, nil
	case <-s.doneCh:
		return SidecarMatchResult{}, fmt.Errorf("sidecar match source closed")
	case <-ctx.Done():
		return SidecarMatchResult{}, ctx.Err()
	}
}

// Close releases resources and unblocks any pending NextResult calls.
func (s *SidecarMatchSource) Close() {
	select {
	case <-s.doneCh:
	default:
		close(s.doneCh)
	}
}
