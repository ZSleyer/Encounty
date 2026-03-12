package detector

import (
	"image"
	"image/color"
	stdDraw "image/draw"
	"math"

	xdraw "golang.org/x/image/draw"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// loadedTemplate pairs a decoded template image with its configuration
// metadata, preserving the Regions array for region-scoped matching.
type loadedTemplate struct {
	img  image.Image
	meta state.DetectorTemplate
}

// CropImage returns the sub-image of img defined by r (pixel coordinates
// relative to the image origin). If r is zero-valued or falls outside the
// image bounds it returns img unchanged.
func CropImage(img image.Image, r state.DetectorRect) image.Image {
	b := img.Bounds()
	if r.W <= 0 || r.H <= 0 {
		return img
	}
	rect := image.Rect(
		b.Min.X+r.X, b.Min.Y+r.Y,
		b.Min.X+r.X+r.W, b.Min.Y+r.Y+r.H,
	)
	rect = rect.Intersect(b)
	if rect.Empty() {
		return img
	}
	type subImager interface {
		SubImage(image.Rectangle) image.Image
	}
	if si, ok := img.(subImager); ok {
		return si.SubImage(rect)
	}
	// Fallback: copy pixels into a new RGBA image.
	dst := image.NewRGBA(image.Rect(0, 0, rect.Dx(), rect.Dy()))
	stdDraw.Draw(dst, dst.Bounds(), img, rect.Min, stdDraw.Src)
	return dst
}

// MatchWithRegions evaluates frame against lt using region-scoped matching
// when regions are defined, falling back to whole-image NCC otherwise.
//
// For each MatchedRegion of type "image", NCC is computed between the
// corresponding crop of frame and the crop of lt.img. For type "text", the
// crop of frame is passed to RecognizeText and compared to ExpectedText; if
// tesseract is unavailable the text region scores 0 and the function returns
// immediately. All regions must individually score at or above precision
// (AND-logic). The returned value is the minimum region score, clamped to
// [0, 1]. When Regions is empty, the legacy whole-image Match is used.
func MatchWithRegions(frame image.Image, lt loadedTemplate, precision float64, lang string) float64 {
	if len(lt.meta.Regions) == 0 {
		return Match(frame, lt.img, 0)
	}

	minScore := 1.0
	evaluated := 0
	for _, region := range lt.meta.Regions {
		var score float64
		switch region.Type {
		case "image":
			frameCrop := CropImage(frame, region.Rect)
			tmplCrop := CropImage(lt.img, region.Rect)
			score = Match(frameCrop, tmplCrop, 0)
			evaluated++
		case "text":
			frameCrop := CropImage(frame, region.Rect)
			recognized, err := RecognizeText(frameCrop, lang)
			if err != nil {
				// Tesseract unavailable — fall back to visual comparison
				// of the text region. The template crop contains the exact
				// pixels of the expected text, so NCC works as a visual
				// fingerprint without needing OCR.
				tmplCrop := CropImage(lt.img, region.Rect)
				score = Match(frameCrop, tmplCrop, 0)
				evaluated++
				break
			}
			if TextMatches(recognized, region.ExpectedText) {
				score = 1.0
			} else {
				score = 0.0
			}
			evaluated++
		default:
			continue
		}
		if score < minScore {
			minScore = score
		}
		if minScore < precision {
			return minScore
		}
	}
	if evaluated == 0 {
		return Match(frame, lt.img, 0)
	}
	return minScore
}

// Match computes the best normalized cross-correlation score between frame and
// template. For small templates (≤128px, e.g. sprites) it uses multi-scale
// matching: the frame is downscaled once, then the template is tried at several
// sizes to account for unknown in-game scale. For larger templates (frame crops)
// both are downscaled to maxDim as before. Returns a value in [0.0, 1.0].
func Match(frame, tmpl image.Image, maxDim int) float64 {
	if maxDim <= 0 {
		maxDim = 320
	}

	frameGray := toGray(downscale(frame, maxDim))
	fw := frameGray.Bounds().Dx()
	fh := frameGray.Bounds().Dy()

	tb := tmpl.Bounds()
	tw, th := tb.Dx(), tb.Dy()

	// Decide whether to use multi-scale matching.
	// Small templates (sprites) need it because we don't know their on-screen size.
	if tw <= 128 && th <= 128 {
		return matchMultiScale(frameGray, tmpl, fw, fh)
	}

	// Large template (frame crop): downscale to maxDim like the frame.
	tmplGray := toGray(downscale(tmpl, maxDim))
	return ncc(frameGray, tmplGray)
}

// matchMultiScale tries the template at multiple sizes against the already-
// downscaled frame and returns the best NCC score. This handles sprites that
// appear at an unknown scale in the game capture.
func matchMultiScale(frameGray *image.Gray, tmpl image.Image, fw, fh int) float64 {
	best := 0.0
	minDim := 12
	maxDim := fw
	if fh < maxDim {
		maxDim = fh
	}
	// Step through template sizes from minDim to ~half the frame.
	// Coarse steps keep it fast (roughly 8-12 iterations).
	step := (maxDim - minDim) / 12
	if step < 4 {
		step = 4
	}
	for targetDim := minDim; targetDim <= maxDim; targetDim += step {
		tmplGray := toGray(downscale(tmpl, targetDim))
		s := ncc(frameGray, tmplGray)
		if s > best {
			best = s
		}
	}
	return best
}

// ncc computes the best normalized cross-correlation score of tmplGray sliding
// over frameGray. Returns 0.0 if the template is larger than the frame or if
// either image is degenerate.
func ncc(frameGray, tmplGray *image.Gray) float64 {
	fw := frameGray.Bounds().Dx()
	fh := frameGray.Bounds().Dy()
	tw := tmplGray.Bounds().Dx()
	th := tmplGray.Bounds().Dy()

	if tw > fw || th > fh || tw < 4 || th < 4 {
		return 0.0
	}

	// Compute template mean and std-dev.
	var tmplSum float64
	n := tw * th
	tmplPix := make([]float64, n)
	for y := 0; y < th; y++ {
		for x := 0; x < tw; x++ {
			v := float64(tmplGray.GrayAt(x, y).Y)
			tmplPix[y*tw+x] = v
			tmplSum += v
		}
	}
	tmplMean := tmplSum / float64(n)

	var tmplVar float64
	for _, v := range tmplPix {
		d := v - tmplMean
		tmplVar += d * d
	}
	tmplStd := math.Sqrt(tmplVar / float64(n))
	if tmplStd < 1e-9 {
		return 0.0
	}

	// Build integral image (II) and integral-squared image (II2) for frame.
	ii := make([]float64, (fw+1)*(fh+1))
	ii2 := make([]float64, (fw+1)*(fh+1))
	stride := fw + 1

	for y := 1; y <= fh; y++ {
		for x := 1; x <= fw; x++ {
			v := float64(frameGray.GrayAt(x-1, y-1).Y)
			ii[y*stride+x] = v + ii[(y-1)*stride+x] + ii[y*stride+(x-1)] - ii[(y-1)*stride+(x-1)]
			ii2[y*stride+x] = v*v + ii2[(y-1)*stride+x] + ii2[y*stride+(x-1)] - ii2[(y-1)*stride+(x-1)]
		}
	}

	rectSum := func(table []float64, x1, y1, x2, y2 int) float64 {
		return table[y2*stride+x2] - table[y1*stride+x2] - table[y2*stride+x1] + table[y1*stride+x1]
	}

	bestNCC := 0.0

	for fy := 0; fy <= fh-th; fy++ {
		for fx := 0; fx <= fw-tw; fx++ {
			pSum := rectSum(ii, fx, fy, fx+tw, fy+th)
			pSum2 := rectSum(ii2, fx, fy, fx+tw, fy+th)
			pMean := pSum / float64(n)
			pVar := pSum2/float64(n) - pMean*pMean
			if pVar < 0 {
				pVar = 0
			}
			pStd := math.Sqrt(pVar)
			if pStd < 1e-9 {
				continue
			}

			var cc float64
			for ty := 0; ty < th; ty++ {
				for tx := 0; tx < tw; tx++ {
					fv := float64(frameGray.GrayAt(fx+tx, fy+ty).Y) - pMean
					tv := tmplPix[ty*tw+tx] - tmplMean
					cc += fv * tv
				}
			}

			val := cc / (float64(n) * pStd * tmplStd)
			if val > bestNCC {
				bestNCC = val
			}
		}
	}

	if bestNCC > 1.0 {
		bestNCC = 1.0
	}
	if bestNCC < 0.0 {
		bestNCC = 0.0
	}
	return bestNCC
}

// downscale resizes img so that its longest dimension is at most maxDim,
// preserving aspect ratio. Returns img unchanged if it already fits.
func downscale(img image.Image, maxDim int) image.Image {
	b := img.Bounds()
	w := b.Dx()
	h := b.Dy()
	if w <= maxDim && h <= maxDim {
		return img
	}

	var newW, newH int
	if w >= h {
		newW = maxDim
		newH = int(math.Round(float64(h) * float64(maxDim) / float64(w)))
	} else {
		newH = maxDim
		newW = int(math.Round(float64(w) * float64(maxDim) / float64(h)))
	}
	if newW < 1 {
		newW = 1
	}
	if newH < 1 {
		newH = 1
	}

	dst := image.NewRGBA(image.Rect(0, 0, newW, newH))
	xdraw.BiLinear.Scale(dst, dst.Bounds(), img, b, xdraw.Over, nil)
	return dst
}

// toGray converts any image to an 8-bit grayscale image with bounds
// normalized to start at (0,0). This is critical for SubImage inputs
// (from CropImage) which retain the parent image's coordinate offset.
func toGray(img image.Image) *image.Gray {
	b := img.Bounds()
	gray := image.NewGray(image.Rect(0, 0, b.Dx(), b.Dy()))
	for y := 0; y < b.Dy(); y++ {
		for x := 0; x < b.Dx(); x++ {
			gray.Set(x, y, color.GrayModel.Convert(img.At(b.Min.X+x, b.Min.Y+y)))
		}
	}
	return gray
}
