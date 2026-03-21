//go:build linux

// camera_linux.go implements camera enumeration and capture on Linux using
// the Video4Linux2 (V4L2) API via the go4vl library.
package detector

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/vladimirvivien/go4vl/device"
	"github.com/vladimirvivien/go4vl/v4l2"
)

// CameraInfo describes a V4L2 video capture device.
type CameraInfo struct {
	DevicePath string `json:"device_path"`
	Name       string `json:"name"`
	Driver     string `json:"driver"`
}

// ListCameras enumerates /dev/video* devices and returns those that support
// video capture. Devices that cannot be opened are silently skipped.
func ListCameras() []CameraInfo {
	matches, err := filepath.Glob("/dev/video*")
	if err != nil {
		slog.Debug("ListCameras glob failed", "error", err)
		return nil
	}

	var cameras []CameraInfo
	for _, devPath := range matches {
		info, err := os.Stat(devPath)
		if err != nil || info.IsDir() {
			continue
		}

		dev, err := device.Open(devPath)
		if err != nil {
			slog.Debug("ListCameras skipping device", "path", devPath, "error", err)
			continue
		}

		cap := dev.Capability()
		// Only include devices that support video capture.
		if cap.DeviceCapabilities&v4l2.CapVideoCapture == 0 {
			_ = dev.Close()
			continue
		}

		cameras = append(cameras, CameraInfo{
			DevicePath: devPath,
			Name:       strings.TrimRight(cap.Card, "\x00"),
			Driver:     strings.TrimRight(cap.Driver, "\x00"),
		})
		_ = dev.Close()
	}
	return cameras
}

// StartCameraCapture opens the V4L2 device at devicePath, configures it for
// MJPEG capture at the requested resolution, and starts streaming frames.
// It returns a channel that delivers decoded images, a stop function that
// closes the device and channel, and any initialisation error.
func StartCameraCapture(devicePath string, width, height int) (<-chan image.Image, func(), error) {
	dev, err := device.Open(devicePath,
		device.WithPixFormat(v4l2.PixFormat{
			Width:       uint32(width),
			Height:      uint32(height),
			PixelFormat: v4l2.PixelFmtMJPEG,
			Field:       v4l2.FieldNone,
		}),
	)
	if err != nil {
		return nil, nil, fmt.Errorf("open camera %s: %w", devicePath, err)
	}

	if err := dev.Start(context.Background()); err != nil {
		_ = dev.Close()
		return nil, nil, fmt.Errorf("start camera %s: %w", devicePath, err)
	}

	out := make(chan image.Image, 3)
	stopCh := make(chan struct{})

	go func() {
		defer close(out)
		for frame := range dev.GetFrames() {
			select {
			case <-stopCh:
				frame.Release()
				return
			default:
			}
			img, err := jpeg.Decode(bytes.NewReader(frame.Data))
			frame.Release()
			if err != nil {
				slog.Debug("Camera frame decode failed", "device", devicePath, "error", err)
				continue
			}
			select {
			case out <- img:
			default: // drop frame if consumer is behind
			}
		}
	}()

	stopOnce := false
	stop := func() {
		if !stopOnce {
			stopOnce = true
			close(stopCh)
			_ = dev.Close()
		}
	}
	return out, stop, nil
}
