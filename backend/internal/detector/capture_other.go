//go:build !windows

// capture_other.go provides stub implementations for window enumeration and
// capture on non-Windows platforms. Native window capture requires the Win32 API.
package detector

import (
	"fmt"
	"image"
)

// WindowInfo describes a visible, titled top-level window.
// On non-Windows platforms this type is defined but ListWindows always returns nil.
type WindowInfo struct {
	HWND  uintptr `json:"hwnd"`
	Title string  `json:"title"`
	Class string  `json:"class"`
	W     int     `json:"w"`
	H     int     `json:"h"`
}

// ListWindows is a stub that returns nil on non-Windows platforms.
func ListWindows() []WindowInfo { return nil }

// CaptureWindow is a stub that returns an error on non-Windows platforms.
func CaptureWindow(hwnd uintptr) (image.Image, error) {
	return nil, fmt.Errorf("window capture not supported on this platform")
}
