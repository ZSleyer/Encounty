// Package server — background_api.go provides HTTP handlers for uploading,
// serving and deleting custom overlay background images. Images are stored
// in ~/.config/encounty/backgrounds/.
package server

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg"
	"image/jpeg"
	"image/png"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "golang.org/x/image/webp"
)

// backgroundsDir returns the path to the backgrounds directory, creating it if
// needed.
func (s *Server) backgroundsDir() (string, error) {
	dir := filepath.Join(s.state.GetConfigDir(), "backgrounds")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("create backgrounds dir: %w", err)
	}
	return dir, nil
}

// handleBackgroundUpload accepts a JSON body with a base64-encoded image and
// saves it to the backgrounds directory. It validates the image format
// (PNG/JPEG/WebP) and downscales images wider than 1920px.
func (s *Server) handleBackgroundUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		ImageBase64 string `json:"image_base64"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if body.ImageBase64 == "" {
		http.Error(w, "image_base64 required", http.StatusBadRequest)
		return
	}

	// Strip optional data-URI prefix
	data := body.ImageBase64
	if idx := strings.Index(data, ","); idx >= 0 {
		data = data[idx+1:]
	}

	raw, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		http.Error(w, "invalid base64", http.StatusBadRequest)
		return
	}

	// Decode to validate + detect format
	img, format, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		http.Error(w, "unsupported image format", http.StatusBadRequest)
		return
	}

	// Only allow png, jpeg, webp
	switch format {
	case "png", "jpeg", "webp":
	default:
		http.Error(w, "unsupported format: "+format, http.StatusBadRequest)
		return
	}

	// Downscale if wider than 1920px
	bounds := img.Bounds()
	if bounds.Dx() > 1920 {
		img = downscale(img, 1920)
	}

	dir, err := s.backgroundsDir()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Determine output extension — webp is re-encoded as png
	ext := format
	if ext == "webp" {
		ext = "png"
	}

	filename := fmt.Sprintf("bg_%d.%s", time.Now().UnixMilli(), ext)
	path := filepath.Join(dir, filename)

	f, err := os.Create(path)
	if err != nil {
		http.Error(w, "save failed", http.StatusInternalServerError)
		return
	}
	defer f.Close()

	switch ext {
	case "png":
		err = png.Encode(f, img)
	case "jpeg":
		err = jpeg.Encode(f, img, &jpeg.Options{Quality: 90})
	}
	if err != nil {
		http.Error(w, "encode failed", http.StatusInternalServerError)
		return
	}

	slog.Info("Background uploaded", "filename", filename)
	writeJSON(w, http.StatusOK, map[string]string{"filename": filename})
}

// handleBackgroundServe serves a background image file by filename.
func (s *Server) handleBackgroundServe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	filename := strings.TrimPrefix(r.URL.Path, "/api/backgrounds/")
	if filename == "" || strings.Contains(filename, "..") || strings.Contains(filename, "/") {
		http.Error(w, "invalid filename", http.StatusBadRequest)
		return
	}

	dir, err := s.backgroundsDir()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	path := filepath.Join(dir, filename)
	if _, err := os.Stat(path); os.IsNotExist(err) {
		http.NotFound(w, r)
		return
	}

	// Set cache headers
	w.Header().Set("Cache-Control", "public, max-age=86400")
	http.ServeFile(w, r, path)
}

// handleBackgroundDelete removes a background image file.
func (s *Server) handleBackgroundDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	filename := strings.TrimPrefix(r.URL.Path, "/api/backgrounds/")
	if filename == "" || strings.Contains(filename, "..") || strings.Contains(filename, "/") {
		http.Error(w, "invalid filename", http.StatusBadRequest)
		return
	}

	dir, err := s.backgroundsDir()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	path := filepath.Join(dir, filename)
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		http.Error(w, "delete failed", http.StatusInternalServerError)
		return
	}

	slog.Info("Background deleted", "filename", filename)
	w.WriteHeader(http.StatusNoContent)
}

// downscale resizes an image to maxWidth, preserving aspect ratio.
func downscale(src image.Image, maxWidth int) image.Image {
	bounds := src.Bounds()
	srcW := bounds.Dx()
	srcH := bounds.Dy()
	ratio := float64(maxWidth) / float64(srcW)
	dstW := maxWidth
	dstH := int(float64(srcH) * ratio)

	dst := image.NewRGBA(image.Rect(0, 0, dstW, dstH))
	for y := 0; y < dstH; y++ {
		for x := 0; x < dstW; x++ {
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
