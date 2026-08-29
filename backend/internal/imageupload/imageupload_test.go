// imageupload_test.go covers the rules every uploaded image goes through,
// whether it arrives as an overlay background or as a custom sprite.
package imageupload

import (
	"bytes"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"testing"
)

// solidImage builds an opaque image of the requested size.
func solidImage(w, h int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.Set(x, y, color.RGBA{R: 12, G: 34, B: 56, A: 255})
		}
	}
	return img
}

func encodePNG(t *testing.T, w, h int) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, solidImage(w, h)); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// TestProcessKeepsImagesBelowTheWidthLimit verifies that an ordinary image is
// stored byte for byte, without a needless decode-encode round trip.
func TestProcessKeepsImagesBelowTheWidthLimit(t *testing.T) {
	raw := encodePNG(t, 3000, 1200)

	got, err := Process(raw)
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if got.Mime != "image/png" {
		t.Errorf("mime = %q, want image/png", got.Mime)
	}
	if !bytes.Equal(got.Data, raw) {
		t.Error("an image under the width limit should be stored unchanged")
	}
}

// TestProcessDownscalesAbove4K verifies the only case that re-encodes a PNG.
func TestProcessDownscalesAbove4K(t *testing.T) {
	got, err := Process(encodePNG(t, 4200, 2100))
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	img, err := png.Decode(bytes.NewReader(got.Data))
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() != MaxWidth {
		t.Errorf("width = %d, want %d", img.Bounds().Dx(), MaxWidth)
	}
	// Aspect ratio preserved.
	if h := img.Bounds().Dy(); h != 1920 {
		t.Errorf("height = %d, want 1920", h)
	}
}

// TestProcessKeepsGIFUntouched is the reason animated sprites still animate:
// decoding and re-encoding a GIF through image.Decode keeps only its first
// frame.
func TestProcessKeepsGIFUntouched(t *testing.T) {
	var buf bytes.Buffer
	src := image.NewPaletted(image.Rect(0, 0, 8, 8), color.Palette{color.Black, color.White})
	if err := gif.EncodeAll(&buf, &gif.GIF{
		Image: []*image.Paletted{src, src},
		Delay: []int{10, 10},
	}); err != nil {
		t.Fatal(err)
	}
	raw := buf.Bytes()

	got, err := Process(raw)
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if got.Mime != "image/gif" {
		t.Errorf("mime = %q, want image/gif", got.Mime)
	}
	if !bytes.Equal(got.Data, raw) {
		t.Fatal("a GIF must be stored exactly as uploaded")
	}
	decoded, err := gif.DecodeAll(bytes.NewReader(got.Data))
	if err != nil {
		t.Fatal(err)
	}
	if len(decoded.Image) != 2 {
		t.Errorf("frames = %d, want the 2 that were uploaded", len(decoded.Image))
	}
}

// TestProcessReencodesJPEG verifies a scaled JPEG stays a JPEG rather than
// silently doubling in size as a PNG.
func TestProcessReencodesJPEG(t *testing.T) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, solidImage(4000, 1000), nil); err != nil {
		t.Fatal(err)
	}

	got, err := Process(buf.Bytes())
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if got.Mime != "image/jpeg" {
		t.Errorf("mime = %q, want image/jpeg", got.Mime)
	}
	img, err := jpeg.Decode(bytes.NewReader(got.Data))
	if err != nil {
		t.Fatalf("stored bytes are not a JPEG: %v", err)
	}
	if img.Bounds().Dx() != MaxWidth {
		t.Errorf("width = %d, want %d", img.Bounds().Dx(), MaxWidth)
	}
}

func TestProcessRejectsNonImages(t *testing.T) {
	for _, tc := range []struct {
		name string
		data []byte
	}{
		{"empty", nil},
		{"text", []byte("this is not an image")},
		{"truncated png", encodePNG(t, 10, 10)[:20]},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Process(tc.data); err == nil {
				t.Error("Process accepted something that is not an image")
			}
		})
	}
}

func TestExtension(t *testing.T) {
	for mime, want := range map[string]string{
		"image/png":  "png",
		"image/jpeg": "jpeg",
		"image/gif":  "gif",
		"image/webp": "png", // webp is re-encoded, so it never reaches storage
	} {
		if got := Extension(mime); got != want {
			t.Errorf("Extension(%q) = %q, want %q", mime, got, want)
		}
	}
}
