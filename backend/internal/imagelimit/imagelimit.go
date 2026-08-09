// Package imagelimit decodes images with an upper bound on their pixel count.
//
// A byte limit on the upload does not bound the decode: image formats store
// dimensions in the header, so a few kilobytes can declare 64000x64000 and cost
// gigabytes of RGBA buffer the moment image.Decode runs. Reading the header
// first with image.DecodeConfig is cheap and rejects that before any pixel is
// allocated.
//
// Format decoders are registered by the importing packages via the usual blank
// imports; the image registry is process-wide.
package imagelimit

import (
	"bytes"
	"fmt"
	"image"
)

// MaxPixels is the default ceiling, generous enough for an 8K wallpaper
// (33 megapixels) while rejecting decompression bombs.
const MaxPixels = 50_000_000

// Decode decodes data, rejecting images whose pixel count exceeds maxPixels.
// It returns the decoded image and the format name reported by the decoder.
func Decode(data []byte, maxPixels int64) (image.Image, string, error) {
	format, err := CheckConfig(data, maxPixels)
	if err != nil {
		return nil, "", err
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", err
	}
	return img, format, nil
}

// CheckConfig reads only the image header and reports its format, failing if
// the declared dimensions exceed maxPixels. Use it when the pixels are not
// needed, for example to validate an image before storing it verbatim.
func CheckConfig(data []byte, maxPixels int64) (string, error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return "", fmt.Errorf("image has invalid dimensions %dx%d", cfg.Width, cfg.Height)
	}
	// int64 so the multiplication cannot overflow on 32-bit builds.
	if pixels := int64(cfg.Width) * int64(cfg.Height); pixels > maxPixels {
		return "", fmt.Errorf("image is %dx%d (%d pixels), limit is %d", cfg.Width, cfg.Height, pixels, maxPixels)
	}
	return format, nil
}
