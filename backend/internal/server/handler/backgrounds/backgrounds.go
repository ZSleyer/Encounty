// Package backgrounds provides HTTP handlers for uploading, serving and
// deleting custom overlay background images. Images are stored in
// <configDir>/backgrounds/.
package backgrounds

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/zsleyer/encounty/backend/internal/httputil"

	_ "golang.org/x/image/webp"
)

// Deps declares the capabilities the backgrounds handlers need from the
// application layer, keeping this package decoupled from the server package.
type Deps interface {
	ConfigDir() string
}

// backgroundUploadRequest is the body for POST /api/backgrounds/upload.
type backgroundUploadRequest struct {
	ImageBase64 string `json:"image_base64"`
}

// filenameResponse returns an uploaded file's name.
type filenameResponse struct {
	Filename string `json:"filename"`
}

const apiPrefix = "/api/backgrounds/"

type handler struct {
	deps Deps
}

// RegisterRoutes wires the /api/backgrounds/* routes onto mux.
func RegisterRoutes(mux *http.ServeMux, d Deps) {
	h := &handler{deps: d}
	mux.HandleFunc("/api/backgrounds/upload", h.handleBackgroundUpload)
	mux.HandleFunc(apiPrefix, func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.handleBackgroundServe(w, r)
		case http.MethodDelete:
			h.handleBackgroundDelete(w, r)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})
}

// backgroundsDir returns the path to the backgrounds directory, creating it if
// needed.
func (h *handler) backgroundsDir() (string, error) {
	dir := filepath.Join(h.deps.ConfigDir(), "backgrounds")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("create backgrounds dir: %w", err)
	}
	return dir, nil
}

// handleBackgroundUpload accepts a JSON body with a base64-encoded image and
// saves it to the backgrounds directory. It validates the image format
// (PNG/JPEG/WebP) and downscales images wider than 1920px.
//
// @Summary      Upload a background image
// @Tags         backgrounds
// @Accept       json
// @Produce      json
// @Param        body body BackgroundUploadRequest true "Base64-encoded image"
// @Success      200 {object} FilenameResponse
// @Failure      400 {string} string
// @Failure      500 {string} string
// @Router       /backgrounds/upload [post]
func (h *handler) handleBackgroundUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var body backgroundUploadRequest
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

	dir, err := h.backgroundsDir()
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
	defer func() { _ = f.Close() }()

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
	httputil.WriteJSON(w, http.StatusOK, filenameResponse{Filename: filename})
}

// handleBackgroundServe serves a background image file by filename.
//
// @Summary      Serve a background image
// @Tags         backgrounds
// @Produce      image/png,image/jpeg
// @Param        filename path string true "Image filename"
// @Success      200 {file} binary
// @Failure      400 {string} string
// @Failure      404 {string} string
// @Router       /backgrounds/{filename} [get]
func (h *handler) handleBackgroundServe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	filename := strings.TrimPrefix(r.URL.Path, apiPrefix)
	if filename == "" || strings.Contains(filename, "..") || strings.Contains(filename, "/") {
		http.Error(w, "invalid filename", http.StatusBadRequest)
		return
	}

	dir, err := h.backgroundsDir()
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
//
// @Summary      Delete a background image
// @Tags         backgrounds
// @Param        filename path string true "Image filename"
// @Success      204
// @Failure      400 {string} string
// @Failure      500 {string} string
// @Router       /backgrounds/{filename} [delete]
func (h *handler) handleBackgroundDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	filename := strings.TrimPrefix(r.URL.Path, apiPrefix)
	if filename == "" || strings.Contains(filename, "..") || strings.Contains(filename, "/") {
		http.Error(w, "invalid filename", http.StatusBadRequest)
		return
	}

	dir, err := h.backgroundsDir()
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
