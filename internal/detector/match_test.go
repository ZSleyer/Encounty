package detector

import (
	"image"
	"image/color"
	"testing"

	"github.com/zsleyer/encounty/internal/state"
)

// solidImage creates a uniform RGBA image filled with the given color.
func solidImage(w, h int, c color.RGBA) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetRGBA(x, y, c)
		}
	}
	return img
}

// checkerImage creates a checkerboard pattern with two alternating colors.
// The tile size determines the size of each square.
func checkerImage(w, h, tileSize int, c1, c2 color.RGBA) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if ((x/tileSize)+(y/tileSize))%2 == 0 {
				img.SetRGBA(x, y, c1)
			} else {
				img.SetRGBA(x, y, c2)
			}
		}
	}
	return img
}

// gradientImage creates a horizontal gradient from black to white.
func gradientImage(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			v := uint8(x * 255 / w)
			img.SetRGBA(x, y, color.RGBA{v, v, v, 255})
		}
	}
	return img
}

func TestToGray(t *testing.T) {
	tests := []struct {
		name   string
		img    image.Image
		wantW  int
		wantH  int
	}{
		{
			name:  "solid white",
			img:   solidImage(10, 10, color.RGBA{255, 255, 255, 255}),
			wantW: 10,
			wantH: 10,
		},
		{
			name:  "single pixel",
			img:   solidImage(1, 1, color.RGBA{128, 128, 128, 255}),
			wantW: 1,
			wantH: 1,
		},
		{
			name:  "subimage preserves dimensions",
			img:   solidImage(100, 100, color.RGBA{200, 200, 200, 255}).SubImage(image.Rect(10, 10, 30, 30)),
			wantW: 20,
			wantH: 20,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gray := toGray(tt.img)
			b := gray.Bounds()
			if b.Min.X != 0 || b.Min.Y != 0 {
				t.Errorf("toGray bounds should start at (0,0), got (%d,%d)", b.Min.X, b.Min.Y)
			}
			if b.Dx() != tt.wantW || b.Dy() != tt.wantH {
				t.Errorf("toGray size = (%d,%d), want (%d,%d)", b.Dx(), b.Dy(), tt.wantW, tt.wantH)
			}
		})
	}
}

func TestDownscale(t *testing.T) {
	tests := []struct {
		name   string
		w, h   int
		maxDim int
		wantW  int
		wantH  int
	}{
		{
			name:   "already fits",
			w:      100,
			h:      50,
			maxDim: 200,
			wantW:  100,
			wantH:  50,
		},
		{
			name:   "landscape downscale",
			w:      400,
			h:      200,
			maxDim: 100,
			wantW:  100,
			wantH:  50,
		},
		{
			name:   "portrait downscale",
			w:      200,
			h:      400,
			maxDim: 100,
			wantW:  50,
			wantH:  100,
		},
		{
			name:   "square downscale",
			w:      500,
			h:      500,
			maxDim: 50,
			wantW:  50,
			wantH:  50,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			src := solidImage(tt.w, tt.h, color.RGBA{128, 128, 128, 255})
			result := downscale(src, tt.maxDim)
			b := result.Bounds()
			if b.Dx() != tt.wantW || b.Dy() != tt.wantH {
				t.Errorf("downscale(%d×%d, %d) = %d×%d, want %d×%d",
					tt.w, tt.h, tt.maxDim, b.Dx(), b.Dy(), tt.wantW, tt.wantH)
			}
		})
	}
}

func TestNCC_IdenticalImages(t *testing.T) {
	// NCC of an image with itself should be very close to 1.0
	img := checkerImage(64, 64, 8, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255})
	gray := toGray(img)
	score := ncc(gray, gray)
	if score < 0.99 {
		t.Errorf("NCC of identical images = %f, want >= 0.99", score)
	}
}

func TestNCC_DifferentImages(t *testing.T) {
	// NCC of very different patterns should be low
	frame := toGray(checkerImage(64, 64, 8, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255}))
	tmpl := toGray(gradientImage(32, 32))
	score := ncc(frame, tmpl)
	if score > 0.5 {
		t.Errorf("NCC of different images = %f, want < 0.5", score)
	}
}

func TestNCC_TemplateLargerThanFrame(t *testing.T) {
	frame := toGray(solidImage(10, 10, color.RGBA{128, 128, 128, 255}))
	tmpl := toGray(solidImage(20, 20, color.RGBA{128, 128, 128, 255}))
	score := ncc(frame, tmpl)
	if score != 0.0 {
		t.Errorf("NCC with oversized template = %f, want 0.0", score)
	}
}

func TestNCC_UniformTemplate(t *testing.T) {
	// Uniform template has zero std dev, NCC should return 0
	frame := toGray(gradientImage(64, 64))
	tmpl := toGray(solidImage(10, 10, color.RGBA{128, 128, 128, 255}))
	score := ncc(frame, tmpl)
	if score != 0.0 {
		t.Errorf("NCC with uniform template = %f, want 0.0", score)
	}
}

func TestNCC_TinyTemplate(t *testing.T) {
	// Templates smaller than 4×4 should return 0
	frame := toGray(gradientImage(64, 64))
	tmpl := toGray(solidImage(3, 3, color.RGBA{100, 100, 100, 255}))
	score := ncc(frame, tmpl)
	if score != 0.0 {
		t.Errorf("NCC with tiny template = %f, want 0.0", score)
	}
}

func TestNCC_TemplateInFrame(t *testing.T) {
	// Embed a recognizable pattern inside a larger frame.
	// The template should be found with a high score.
	frame := image.NewRGBA(image.Rect(0, 0, 80, 80))
	// Fill with gray background
	for y := 0; y < 80; y++ {
		for x := 0; x < 80; x++ {
			frame.SetRGBA(x, y, color.RGBA{128, 128, 128, 255})
		}
	}
	// Paint a checkerboard patch at (20,20)-(52,52)
	for y := 20; y < 52; y++ {
		for x := 20; x < 52; x++ {
			if ((x-20)/4+(y-20)/4)%2 == 0 {
				frame.SetRGBA(x, y, color.RGBA{0, 0, 0, 255})
			} else {
				frame.SetRGBA(x, y, color.RGBA{255, 255, 255, 255})
			}
		}
	}
	// The template is just the checkerboard patch
	tmpl := checkerImage(32, 32, 4, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255})

	frameGray := toGray(frame)
	tmplGray := toGray(tmpl)
	score := ncc(frameGray, tmplGray)
	if score < 0.95 {
		t.Errorf("NCC of embedded template = %f, want >= 0.95", score)
	}
}

func TestMatch_LargeTemplate(t *testing.T) {
	// Large template path (> 128px): both are downscaled
	frame := gradientImage(640, 480)
	score := Match(frame, frame, 320)
	if score < 0.95 {
		t.Errorf("Match identical large image = %f, want >= 0.95", score)
	}
}

func TestMatch_SmallTemplate(t *testing.T) {
	// Small template (≤128px): multi-scale matching is used
	frame := checkerImage(200, 200, 10, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255})
	tmpl := checkerImage(64, 64, 10, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255})
	score := Match(frame, tmpl, 320)
	// Multi-scale should find a reasonable match for the same pattern
	if score < 0.5 {
		t.Errorf("Match small template = %f, want >= 0.5", score)
	}
}

func TestCropImage(t *testing.T) {
	tests := []struct {
		name   string
		imgW   int
		imgH   int
		rect   state.DetectorRect
		wantW  int
		wantH  int
	}{
		{
			name:  "valid crop",
			imgW:  100,
			imgH:  100,
			rect:  state.DetectorRect{X: 10, Y: 10, W: 50, H: 50},
			wantW: 50,
			wantH: 50,
		},
		{
			name:  "zero rect returns original",
			imgW:  100,
			imgH:  100,
			rect:  state.DetectorRect{X: 0, Y: 0, W: 0, H: 0},
			wantW: 100,
			wantH: 100,
		},
		{
			name:  "negative dimensions returns original",
			imgW:  100,
			imgH:  100,
			rect:  state.DetectorRect{X: 10, Y: 10, W: -5, H: 20},
			wantW: 100,
			wantH: 100,
		},
		{
			name:  "crop clamped to image bounds",
			imgW:  100,
			imgH:  100,
			rect:  state.DetectorRect{X: 80, Y: 80, W: 50, H: 50},
			wantW: 20,
			wantH: 20,
		},
		{
			name:  "crop entirely outside image returns original",
			imgW:  100,
			imgH:  100,
			rect:  state.DetectorRect{X: 200, Y: 200, W: 50, H: 50},
			wantW: 100,
			wantH: 100,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			src := solidImage(tt.imgW, tt.imgH, color.RGBA{100, 100, 100, 255})
			cropped := CropImage(src, tt.rect)
			b := cropped.Bounds()
			gotW, gotH := b.Dx(), b.Dy()
			if gotW != tt.wantW || gotH != tt.wantH {
				t.Errorf("CropImage(%d×%d, %+v) = %d×%d, want %d×%d",
					tt.imgW, tt.imgH, tt.rect, gotW, gotH, tt.wantW, tt.wantH)
			}
		})
	}
}

func TestMatchWithRegions_NoRegions(t *testing.T) {
	// When there are no regions, it should fall back to whole-image Match
	frame := checkerImage(200, 200, 10, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255})
	lt := loadedTemplate{
		img:  frame,
		meta: state.DetectorTemplate{},
	}
	score := MatchWithRegions(frame, lt, 0.5, "eng")
	if score < 0.9 {
		t.Errorf("MatchWithRegions with no regions and identical image = %f, want >= 0.9", score)
	}
}

func TestMatchWithRegions_ImageRegion(t *testing.T) {
	// Create frame and template that are identical, with a single image region.
	// The region crop is 100×100 which is under 128px, triggering multi-scale
	// matching. The score may be lower than 1.0 due to downscale artifacts,
	// but should still be well above a random mismatch.
	img := checkerImage(200, 200, 10, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255})
	lt := loadedTemplate{
		img: img,
		meta: state.DetectorTemplate{
			Regions: []state.MatchedRegion{
				{
					Type: "image",
					Rect: state.DetectorRect{X: 10, Y: 10, W: 100, H: 100},
				},
			},
		},
	}
	score := MatchWithRegions(img, lt, 0.5, "eng")
	if score < 0.6 {
		t.Errorf("MatchWithRegions identical image region = %f, want >= 0.6", score)
	}
}

func TestMatchWithRegions_EarlyExit(t *testing.T) {
	// First region should fail, causing early exit with score below precision
	frame := gradientImage(200, 200)
	tmpl := checkerImage(200, 200, 10, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255})
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
					Rect: state.DetectorRect{X: 0, Y: 0, W: 100, H: 100},
				},
			},
		},
	}
	score := MatchWithRegions(frame, lt, 0.95, "eng")
	if score >= 0.95 {
		t.Errorf("MatchWithRegions should exit early below precision, got %f", score)
	}
}

func TestMatchWithRegions_UnknownType(t *testing.T) {
	// Regions with unknown type should be skipped, falling back to whole-image
	frame := checkerImage(200, 200, 10, color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255})
	lt := loadedTemplate{
		img: frame,
		meta: state.DetectorTemplate{
			Regions: []state.MatchedRegion{
				{
					Type: "unknown_type",
					Rect: state.DetectorRect{X: 0, Y: 0, W: 100, H: 100},
				},
			},
		},
	}
	// All regions are unknown, evaluated == 0, falls back to Match
	score := MatchWithRegions(frame, lt, 0.5, "eng")
	if score < 0.9 {
		t.Errorf("MatchWithRegions with unknown regions should fall back to Match, got %f", score)
	}
}
