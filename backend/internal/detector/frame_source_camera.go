// frame_source_camera.go implements FrameSource for V4L2 camera capture on
// Linux (with stubs on other platforms). It wraps StartCameraCapture and
// reads from the camera's frame channel.
package detector

import (
	"context"
	"image"
	"sync"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// CameraFrameSource reads frames from a V4L2 camera device.
type CameraFrameSource struct {
	frames <-chan image.Image
	stop   func()
	once   sync.Once
}

// NewCameraFrameSource opens the camera described by cfg and starts streaming.
// The device path is taken from cfg.WindowTitle; resolution from cfg.Region.W/H.
func NewCameraFrameSource(cfg state.DetectorConfig) (*CameraFrameSource, error) {
	frames, stop, err := StartCameraCapture(cfg.WindowTitle, cfg.Region.W, cfg.Region.H)
	if err != nil {
		return nil, err
	}
	return &CameraFrameSource{
		frames: frames,
		stop:   stop,
	}, nil
}

// NextFrame blocks until the camera delivers a frame or ctx is cancelled.
func (c *CameraFrameSource) NextFrame(ctx context.Context) (image.Image, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case frame, ok := <-c.frames:
		if !ok {
			return nil, context.Canceled
		}
		return frame, nil
	}
}

// Close stops the camera device. Safe to call multiple times.
func (c *CameraFrameSource) Close() {
	c.once.Do(func() {
		if c.stop != nil {
			c.stop()
		}
	})
}
