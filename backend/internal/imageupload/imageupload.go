// Package imageupload holds the rules every user-supplied image goes through,
// whether it arrives as an overlay background or as a custom Pokémon sprite.
// Both used to bring their own limits, which meant a photo that was fine as a
// background was rejected as a sprite for no reason a user could see.
package imageupload

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"

	"github.com/zsleyer/encounty/backend/internal/imagelimit"

	_ "image/gif"  // register the GIF decoder for DetectContentType and decoding
	_ "image/jpeg" // register the JPEG decoder
	_ "image/png"  // register the PNG decoder

	_ "golang.org/x/image/webp" // register the WebP decoder
)

const (
	// MaxBytes bounds an upload. Backgrounds arrive base64-encoded inside a
	// JSON body, so the image itself may be roughly a quarter smaller than
	// this; sprites are sent raw and may use it in full.
	MaxBytes = 30 << 20

	// MaxWidth is the width above which an image is scaled down. It sits at 4K
	// so a wallpaper keeps its detail on a 4K capture, while a photo straight
	// out of a camera does not land in the database at its original size.
	MaxWidth = 3840
)

// Result is a picture that passed the checks, ready to be stored.
type Result struct {
	// Data holds the bytes to store, re-encoded when the image was scaled down
	// or arrived in a format that is not kept as-is.
	Data []byte
	// Mime is the type to serve the stored bytes with.
	Mime string
}

// Process validates raw and returns what should be stored.
//
// An animated GIF is passed through untouched: decoding and re-encoding one
// keeps only its first frame, and an animated sprite is a feature rather than
// an accident. Every other format is decoded (which enforces the pixel ceiling
// from the header before any allocation), scaled down when wider than MaxWidth,
// and encoded as PNG or JPEG. WebP has no encoder in the standard library and
// becomes PNG.
func Process(raw []byte) (Result, error) {
	if len(raw) == 0 {
		return Result{}, fmt.Errorf("empty image")
	}

	format, err := imagelimit.CheckConfig(raw, imagelimit.MaxPixels)
	if err != nil {
		return Result{}, fmt.Errorf("unsupported or oversized image")
	}

	switch format {
	case "png", "jpeg", "webp", "gif":
	default:
		return Result{}, fmt.Errorf("unsupported format: %s", format)
	}

	if format == "gif" {
		return Result{Data: raw, Mime: "image/gif"}, nil
	}

	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return Result{}, fmt.Errorf("unsupported or invalid image data")
	}

	// Untouched when it is small enough and already in a format we store.
	scaled := img
	if img.Bounds().Dx() > MaxWidth {
		scaled = downscale(img, MaxWidth)
	} else if format != "webp" {
		return Result{Data: raw, Mime: "image/" + format}, nil
	}

	var buf bytes.Buffer
	if format == "jpeg" {
		if err := jpeg.Encode(&buf, scaled, &jpeg.Options{Quality: 90}); err != nil {
			return Result{}, fmt.Errorf("encode failed")
		}
		return Result{Data: buf.Bytes(), Mime: "image/jpeg"}, nil
	}
	if err := png.Encode(&buf, scaled); err != nil {
		return Result{}, fmt.Errorf("encode failed")
	}
	return Result{Data: buf.Bytes(), Mime: "image/png"}, nil
}

// Extension returns the file extension matching a mime type from Process. The
// stored name keeps carrying one because it is the key the overlay settings
// reference and what the editor shows.
func Extension(mime string) string {
	switch mime {
	case "image/jpeg":
		return "jpeg"
	case "image/gif":
		return "gif"
	default:
		return "png"
	}
}

// downscale resizes an image to maxWidth, preserving aspect ratio. Nearest
// neighbor: the input is a photo or a wallpaper being shrunk, where the
// difference to a filtered resize is not worth the dependency.
func downscale(src image.Image, maxWidth int) image.Image {
	bounds := src.Bounds()
	srcW := bounds.Dx()
	srcH := bounds.Dy()
	ratio := float64(maxWidth) / float64(srcW)
	dstW := maxWidth
	dstH := int(float64(srcH) * ratio)

	dst := image.NewRGBA(image.Rect(0, 0, dstW, dstH))
	for y := range dstH {
		for x := range dstW {
			srcX := int(float64(x) / ratio)
			srcY := int(float64(y) / ratio)
			if srcX >= srcW {
				srcX = srcW - 1
			}
			if srcY >= srcH {
				srcY = srcH - 1
			}
			dst.Set(x, y, src.At(bounds.Min.X+srcX, bounds.Min.Y+srcY))
		}
	}
	return dst
}
