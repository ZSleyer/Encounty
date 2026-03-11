package detector

import (
	"image"
	"image/color"
	"math"
	"testing"
)

func TestPixelDelta(t *testing.T) {
	tests := []struct {
		name    string
		a       image.Image
		b       image.Image
		wantMin float64
		wantMax float64
	}{
		{
			name:    "identical images yield zero delta",
			a:       solidImage(100, 100, color.RGBA{128, 128, 128, 255}),
			b:       solidImage(100, 100, color.RGBA{128, 128, 128, 255}),
			wantMin: 0.0,
			wantMax: 0.001,
		},
		{
			name:    "black vs white yields maximum delta",
			a:       solidImage(100, 100, color.RGBA{0, 0, 0, 255}),
			b:       solidImage(100, 100, color.RGBA{255, 255, 255, 255}),
			wantMin: 0.99,
			wantMax: 1.0,
		},
		{
			name:    "half-brightness difference",
			a:       solidImage(100, 100, color.RGBA{0, 0, 0, 255}),
			b:       solidImage(100, 100, color.RGBA{128, 128, 128, 255}),
			wantMin: 0.40,
			wantMax: 0.55,
		},
		{
			name:    "different sizes yield delta of 1.0",
			a:       solidImage(100, 100, color.RGBA{128, 128, 128, 255}),
			b:       solidImage(200, 100, color.RGBA{128, 128, 128, 255}),
			wantMin: 1.0,
			wantMax: 1.0,
		},
		{
			name:    "small identical images",
			a:       solidImage(4, 4, color.RGBA{50, 50, 50, 255}),
			b:       solidImage(4, 4, color.RGBA{50, 50, 50, 255}),
			wantMin: 0.0,
			wantMax: 0.001,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			delta := PixelDelta(tt.a, tt.b)
			if delta < tt.wantMin || delta > tt.wantMax {
				t.Errorf("PixelDelta() = %f, want in [%f, %f]", delta, tt.wantMin, tt.wantMax)
			}
		})
	}
}

func TestPixelDelta_EmptyImages(t *testing.T) {
	// An image with zero area should return 0.0 (n == 0 guard)
	a := image.NewRGBA(image.Rect(0, 0, 0, 0))
	b := image.NewRGBA(image.Rect(0, 0, 0, 0))
	delta := PixelDelta(a, b)
	if delta != 0.0 {
		t.Errorf("PixelDelta of empty images = %f, want 0.0", delta)
	}
}

func TestPixelDelta_Symmetry(t *testing.T) {
	a := gradientImage(100, 100)
	b := solidImage(100, 100, color.RGBA{128, 128, 128, 255})
	dAB := PixelDelta(a, b)
	dBA := PixelDelta(b, a)
	if math.Abs(dAB-dBA) > 0.001 {
		t.Errorf("PixelDelta not symmetric: d(a,b)=%f, d(b,a)=%f", dAB, dBA)
	}
}
