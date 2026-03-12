package detector

import (
	"image"
	"math"
)

const dedupMaxDim = 64

// PixelDelta returns the mean absolute difference between corresponding pixels
// of images a and b, expressed as a fraction of the full [0, 255] range.
// Both images are downscaled to at most 64×64 before comparison for speed.
// Returns a value in [0.0, 1.0]; higher means more change between frames.
func PixelDelta(a, b image.Image) float64 {
	aScaled := toGray(downscale(a, dedupMaxDim))
	bScaled := toGray(downscale(b, dedupMaxDim))

	ab := aScaled.Bounds()
	bb := bScaled.Bounds()

	if ab.Dx() != bb.Dx() || ab.Dy() != bb.Dy() {
		return 1.0
	}

	w := ab.Dx()
	h := ab.Dy()
	n := w * h
	if n == 0 {
		return 0.0
	}

	var sum float64
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			av := float64(aScaled.GrayAt(ab.Min.X+x, ab.Min.Y+y).Y)
			bv := float64(bScaled.GrayAt(bb.Min.X+x, bb.Min.Y+y).Y)
			sum += math.Abs(av - bv)
		}
	}

	return sum / (float64(n) * 255.0)
}
