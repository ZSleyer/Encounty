package imagelimit

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

// pngBytes encodes a w*h PNG. Uniform color keeps the encoded size small even
// for large dimensions, which is exactly the decompression-bomb shape.
func pngBytes(t *testing.T, w, h int) []byte {
	t.Helper()

	img := image.NewGray(image.Rect(0, 0, w, h))
	for i := range img.Pix {
		img.Pix[i] = color.Gray{Y: 0}.Y
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode: %v", err)
	}
	return buf.Bytes()
}

// TestDecodeWithinLimit verifies that a normal image decodes unchanged.
func TestDecodeWithinLimit(t *testing.T) {
	data := pngBytes(t, 64, 32)

	img, format, err := Decode(data, MaxPixels)
	if err != nil {
		t.Fatalf("Decode() error = %v, want nil", err)
	}
	if format != "png" {
		t.Errorf("format = %q, want \"png\"", format)
	}
	if got := img.Bounds().Dx(); got != 64 {
		t.Errorf("width = %d, want 64", got)
	}
}

// TestDecodeRejectsOversized verifies that the pixel ceiling is enforced from
// the header, before the pixel buffer is allocated.
func TestDecodeRejectsOversized(t *testing.T) {
	data := pngBytes(t, 2000, 2000)

	if _, _, err := Decode(data, 1_000_000); err == nil {
		t.Error("Decode() error = nil, want a pixel limit error")
	}
	if _, err := CheckConfig(data, 1_000_000); err == nil {
		t.Error("CheckConfig() error = nil, want a pixel limit error")
	}
	if _, err := CheckConfig(data, 4_000_000); err != nil {
		t.Errorf("CheckConfig() error = %v, want nil at the exact limit", err)
	}
}

// TestCheckConfigRejectsGarbage verifies that non-image input fails.
func TestCheckConfigRejectsGarbage(t *testing.T) {
	if _, err := CheckConfig([]byte("not an image"), MaxPixels); err == nil {
		t.Error("CheckConfig() error = nil, want a decode error")
	}
}
