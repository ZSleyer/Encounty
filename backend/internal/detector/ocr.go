// ocr.go — optical character recognition via the external tesseract binary.
//
// RecognizeText saves an image to a temp file, invokes the tesseract process,
// and returns the recognised text string. No CGO is required; the binary is
// located through PATH. Callers should check for ErrTesseractNotFound and
// treat text regions as unmatched when tesseract is unavailable.
package detector

import (
	"errors"
	"image"
	"image/png"
	"os"
	"os/exec"
	"strings"
	"unicode/utf8"

	xdraw "golang.org/x/image/draw"
)

// ErrTesseractNotFound is returned by RecognizeText when the tesseract binary
// is not found in PATH.
var ErrTesseractNotFound = errors.New("tesseract not found in PATH")

// RecognizeText extracts text from img using the tesseract OCR binary.
// lang is an ISO 639-2 tesseract language code (e.g. "deu", "eng").
// Pass an empty string to default to "eng".
//
// The image is upscaled 3× with nearest-neighbour interpolation before OCR to
// improve recognition of small pixel-art fonts common in retro Pokémon games.
func RecognizeText(img image.Image, lang string) (string, error) {
	if lang == "" {
		lang = "eng"
	}

	if _, err := exec.LookPath("tesseract"); err != nil {
		return "", ErrTesseractNotFound
	}

	// Upscale 3× to help tesseract handle small pixel-art fonts.
	upscaled := upscale3x(img)

	f, err := os.CreateTemp("", "encounty-ocr-*.png")
	if err != nil {
		return "", err
	}
	tmpPath := f.Name()
	defer func() { _ = os.Remove(tmpPath) }()

	if err := png.Encode(f, upscaled); err != nil {
		_ = f.Close()
		return "", err
	}
	_ = f.Close()

	// psm 6: assume a single uniform block of text — works well for dialog boxes.
	out, err := exec.Command("tesseract", tmpPath, "stdout", "-l", lang, "--psm", "6").Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// TextMatches reports whether recognized loosely matches expected.
// Comparison is case-insensitive. Returns true when either string contains the
// other, or when the Levenshtein distance is within 20 % of the expected
// string's rune count (minimum tolerance: 2).
func TextMatches(recognized, expected string) bool {
	r := strings.ToLower(strings.TrimSpace(recognized))
	e := strings.ToLower(strings.TrimSpace(expected))
	if r == "" || e == "" {
		return false
	}
	if strings.Contains(r, e) || strings.Contains(e, r) {
		return true
	}
	maxDist := utf8.RuneCountInString(e) / 5
	if maxDist < 2 {
		maxDist = 2
	}
	return levenshtein(r, e) <= maxDist
}

// LangToTesseract converts an ISO 639-1 language code to the corresponding
// tesseract language data name. Returns "eng" for unrecognised codes.
func LangToTesseract(lang string) string {
	switch lang {
	case "de":
		return "deu"
	case "fr":
		return "fra"
	case "es":
		return "spa"
	case "it":
		return "ita"
	case "ja":
		return "jpn"
	case "ko":
		return "kor"
	case "zh-hans", "zh-hant":
		return "chi_sim"
	default:
		return "eng"
	}
}

// upscale3x returns img scaled to three times its original size using
// nearest-neighbour interpolation, which preserves the sharp edges of
// pixel-art and bitmap fonts.
func upscale3x(img image.Image) image.Image {
	b := img.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dx()*3, b.Dy()*3))
	xdraw.NearestNeighbor.Scale(dst, dst.Bounds(), img, b, xdraw.Over, nil)
	return dst
}

// levenshtein returns the edit distance between strings a and b.
func levenshtein(a, b string) int {
	ra := []rune(a)
	rb := []rune(b)
	la, lb := len(ra), len(rb)
	if la == 0 {
		return lb
	}
	if lb == 0 {
		return la
	}
	prev := make([]int, lb+1)
	curr := make([]int, lb+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= la; i++ {
		curr[0] = i
		for j := 1; j <= lb; j++ {
			cost := 1
			if ra[i-1] == rb[j-1] {
				cost = 0
			}
			curr[j] = minInt(prev[j]+1, minInt(curr[j-1]+1, prev[j-1]+cost))
		}
		prev, curr = curr, prev
	}
	return prev[lb]
}

// minInt returns the smaller of a and b.
func minInt(a, b int) int {
	if b < a {
		return b
	}
	return a
}
