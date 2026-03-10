package detector

import (
	"image"

	"github.com/kbinani/screenshot"
)

// WindowInfo describes a visible, titled top-level window.
type WindowInfo struct {
	Title  string `json:"title"`
	X      int    `json:"x"`
	Y      int    `json:"y"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

// CaptureRegion captures the screen area defined by x, y, w, h (in screen pixels)
// and returns it as an image.Image.
// On Linux this uses the X11 display; on Windows it uses the GDI BitBlt API.
func CaptureRegion(x, y, w, h int) (image.Image, error) {
	return screenshot.CaptureRect(image.Rect(x, y, x+w, y+h))
}

// ListWindows returns the visible, titled top-level windows on the current desktop.
// Per-platform window enumeration is not yet implemented; this always returns an
// empty slice and will be filled in a later checkpoint.
func ListWindows() []WindowInfo {
	return []WindowInfo{}
}
