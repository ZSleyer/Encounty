// frame_source_browser.go implements FrameSource for browser-submitted frames.
// Frames are pushed externally (via HTTP POST or WebSocket) and consumed by
// the detection loop through the standard NextFrame interface.
package detector

import (
	"context"
	"image"
)

// BrowserFrameSource receives frames pushed from external sources (WebSocket
// binary messages or HTTP uploads) and delivers them to the detector loop.
type BrowserFrameSource struct {
	frames chan image.Image
}

// NewBrowserFrameSource creates a source with the given buffer size.
func NewBrowserFrameSource(bufSize int) *BrowserFrameSource {
	return &BrowserFrameSource{frames: make(chan image.Image, bufSize)}
}

// Submit pushes a frame into the source. Non-blocking; drops if full.
func (s *BrowserFrameSource) Submit(frame image.Image) {
	select {
	case s.frames <- frame:
	default: // drop frame if consumer is behind
	}
}

// NextFrame blocks until a frame is available or ctx is done.
func (s *BrowserFrameSource) NextFrame(ctx context.Context) (image.Image, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case frame, ok := <-s.frames:
		if !ok {
			return nil, context.Canceled
		}
		return frame, nil
	}
}

// Close closes the frame channel.
func (s *BrowserFrameSource) Close() {
	close(s.frames)
}
