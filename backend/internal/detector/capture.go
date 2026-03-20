package detector

import (
	"image"

	"github.com/kbinani/screenshot"
)

// CaptureRegion captures the screen area defined by x, y, w, h (in screen pixels)
// and returns it as an image.Image.
// On Linux this uses the X11 display; on Windows it uses the GDI BitBlt API.
func CaptureRegion(x, y, w, h int) (image.Image, error) {
	return screenshot.CaptureRect(image.Rect(x, y, x+w, y+h))
}
