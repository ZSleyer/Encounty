// frame_source.go defines the FrameSource interface that abstracts frame
// acquisition for the detection pipeline. All capture backends implement
// this interface so the detector loop is source-agnostic.
package detector

import (
	"context"
	"image"
)

// FrameSource abstracts frame acquisition for the detection pipeline.
type FrameSource interface {
	// NextFrame blocks until a frame is available or the context is cancelled.
	NextFrame(ctx context.Context) (image.Image, error)
	// Close releases any resources held by the source.
	Close()
}
