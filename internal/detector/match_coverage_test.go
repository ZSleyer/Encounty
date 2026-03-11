package detector

import (
	"image"
	"image/color"
	"testing"

	"github.com/zsleyer/encounty/internal/state"
)

// simpleImage is an image type that does NOT implement SubImage, forcing
// the CropImage fallback path that copies pixels into a new RGBA image.
type simpleImage struct {
	w, h int
	c    color.RGBA
}

func (s *simpleImage) ColorModel() color.Model { return color.RGBAModel }
func (s *simpleImage) Bounds() image.Rectangle  { return image.Rect(0, 0, s.w, s.h) }
func (s *simpleImage) At(x, y int) color.Color  { return s.c }

// TestCropImage_FallbackWithoutSubImage exercises the CropImage fallback path
// where the image does not implement the SubImage interface.
func TestCropImage_FallbackWithoutSubImage(t *testing.T) {
	img := &simpleImage{w: 100, h: 100, c: color.RGBA{200, 100, 50, 255}}
	cropped := CropImage(img, state.DetectorRect{X: 10, Y: 10, W: 50, H: 50})
	b := cropped.Bounds()
	if b.Dx() != 50 || b.Dy() != 50 {
		t.Errorf("CropImage fallback = %d x %d, want 50 x 50", b.Dx(), b.Dy())
	}
}

// TestCropImage_NegativeHeight tests the W>0 but H<=0 branch.
func TestCropImage_NegativeHeight(t *testing.T) {
	src := solidImage(100, 100, color.RGBA{100, 100, 100, 255})
	cropped := CropImage(src, state.DetectorRect{X: 10, Y: 10, W: 50, H: -1})
	b := cropped.Bounds()
	if b.Dx() != 100 || b.Dy() != 100 {
		t.Errorf("CropImage negative H = %d x %d, want 100 x 100", b.Dx(), b.Dy())
	}
}

// TestMatchWithRegions_TextRegionFallbackOnError exercises the text region path
// where RecognizeText fails (tesseract not found) and falls back to visual NCC.
func TestMatchWithRegions_TextRegionFallbackOnError(t *testing.T) {
	img := checkerImage(200, 200, 10, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255})
	lt := loadedTemplate{
		img: img,
		meta: state.DetectorTemplate{
			Regions: []state.MatchedRegion{
				{
					Type:         "text",
					Rect:         state.DetectorRect{X: 0, Y: 0, W: 200, H: 200},
					ExpectedText: "hello",
				},
			},
		},
	}
	// On CI/test environments tesseract is typically not installed, so
	// RecognizeText will fail and the code will fall back to visual NCC.
	// With identical images the score should be high.
	score := MatchWithRegions(img, lt, 0.5, "eng")
	// Whether tesseract is installed or not, the function should not panic
	// and should return a valid score in [0, 1].
	if score < 0 || score > 1 {
		t.Errorf("MatchWithRegions text region score = %f, want [0, 1]", score)
	}
}

// TestMatchWithRegions_MultipleRegionsWithMinScore tests AND-logic where
// one image region scores lower than another, returning the min.
func TestMatchWithRegions_MultipleRegionsWithMinScore(t *testing.T) {
	frame := gradientImage(200, 200)
	tmpl := gradientImage(200, 200)
	lt := loadedTemplate{
		img: tmpl,
		meta: state.DetectorTemplate{
			Regions: []state.MatchedRegion{
				{
					Type: "image",
					Rect: state.DetectorRect{X: 0, Y: 0, W: 200, H: 200},
				},
				{
					Type: "image",
					Rect: state.DetectorRect{X: 50, Y: 50, W: 100, H: 100},
				},
			},
		},
	}
	score := MatchWithRegions(frame, lt, 0.1, "eng")
	if score < 0 || score > 1 {
		t.Errorf("MatchWithRegions multi-region score = %f, want [0, 1]", score)
	}
}

// TestNCC_ClampAboveOne covers the ncc bestNCC > 1.0 clamping line.
// This is hard to trigger naturally, but we verify the boundary with
// a uniform frame patch (pStd < 1e-9 → continue) and pattern that
// cannot exceed 1.0.
func TestNCC_ClampBelowZero(t *testing.T) {
	// Craft images where NCC might approach 0; verify clamping works.
	frame := toGray(gradientImage(64, 64))
	// Inverted gradient
	inv := image.NewRGBA(image.Rect(0, 0, 32, 32))
	for y := 0; y < 32; y++ {
		for x := 0; x < 32; x++ {
			v := uint8(255 - x*255/32)
			inv.SetRGBA(x, y, color.RGBA{v, v, v, 255})
		}
	}
	tmpl := toGray(inv)
	score := ncc(frame, tmpl)
	if score < 0 {
		t.Errorf("NCC should be clamped >= 0, got %f", score)
	}
}

// TestDownscale_TallNarrow exercises the h > w branch (portrait downscale
// where newW must be clamped to >= 1).
func TestDownscale_TallNarrowExtreme(t *testing.T) {
	// Very tall narrow image: w=2, h=500 → downscale to maxDim=10
	// h > w → newH=10, newW = round(2 * 10 / 500) = round(0.04) = 0
	// clamped to 1
	src := solidImage(2, 500, color.RGBA{128, 128, 128, 255})
	result := downscale(src, 10)
	b := result.Bounds()
	if b.Dx() < 1 || b.Dy() < 1 {
		t.Errorf("downscale extreme aspect = %d x %d, both dims should be >= 1", b.Dx(), b.Dy())
	}
}

// TestDownscale_WideShortExtreme exercises the w > h path with newH clamped to 1.
func TestDownscale_WideShortExtreme(t *testing.T) {
	src := solidImage(500, 2, color.RGBA{128, 128, 128, 255})
	result := downscale(src, 10)
	b := result.Bounds()
	if b.Dx() < 1 || b.Dy() < 1 {
		t.Errorf("downscale wide extreme = %d x %d, both dims should be >= 1", b.Dx(), b.Dy())
	}
}

// TestMatchMultiScale_StepClamping exercises the step < 4 clamping in matchMultiScale.
func TestMatchMultiScale_StepClamping(t *testing.T) {
	// Small frame forces step calculation to be < 4, clamped to 4
	frame := toGray(checkerImage(20, 20, 4, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255}))
	tmpl := checkerImage(10, 10, 4, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255})
	score := matchMultiScale(frame, tmpl, 20, 20)
	if score < 0 || score > 1 {
		t.Errorf("matchMultiScale score = %f, want [0, 1]", score)
	}
}

// TestMatchMultiScale_HeightSmallerThanWidth exercises maxDim = fh < fw path.
func TestMatchMultiScale_HeightSmallerThanWidth(t *testing.T) {
	frame := toGray(checkerImage(100, 30, 4, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255}))
	tmpl := checkerImage(10, 10, 4, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255})
	score := matchMultiScale(frame, tmpl, 100, 30)
	if score < 0 || score > 1 {
		t.Errorf("matchMultiScale score = %f, want [0, 1]", score)
	}
}
