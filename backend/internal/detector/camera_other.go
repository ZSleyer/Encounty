//go:build !linux

// camera_other.go provides stub implementations for camera enumeration and
// capture on non-Linux platforms. Native V4L2 camera access is Linux-only.
package detector

import (
	"fmt"
	"image"
)

// CameraInfo describes a V4L2 video capture device.
// On non-Linux platforms this type is defined but ListCameras always returns nil.
type CameraInfo struct {
	DevicePath string `json:"device_path"`
	Name       string `json:"name"`
	Driver     string `json:"driver"`
}

// ListCameras is a stub that returns nil on non-Linux platforms.
func ListCameras() []CameraInfo { return nil }

// StartCameraCapture is a stub that returns an error on non-Linux platforms.
func StartCameraCapture(devicePath string, width, height int) (<-chan image.Image, func(), error) {
	return nil, nil, fmt.Errorf("camera capture not supported on this platform")
}
