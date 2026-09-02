// Package backgrounds provides HTTP handlers for uploading, serving and
// deleting custom overlay background images. They are stored in the database
// alongside detector templates and uploaded sprites, so a backup carries them
// and relocating the database takes them along.
package backgrounds

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/imageupload"
)

// BackgroundStore is the database access the handlers need, kept as an
// interface so this package does not depend on the concrete database type.
type BackgroundStore interface {
	SaveBackground(filename string, data []byte, mime string) error
	LoadBackground(filename string) ([]byte, string, error)
	DeleteBackground(filename string) error
}

// Deps declares the capabilities the backgrounds handlers need from the
// application layer, keeping this package decoupled from the server package.
type Deps interface {
	// BackgroundsDB returns the store, or nil when no database is open.
	BackgroundsDB() BackgroundStore
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

// handleBackgroundUpload accepts a JSON body with a base64-encoded image and
// saves it to the backgrounds directory. It validates the image format
// (PNG/JPEG/WebP) and downscales images wider than 1920px.
//
// @Summary      Upload a background image
// @Tags         backgrounds
// @Accept       json
// @Produce      json
// @Param        body body backgroundUploadRequest true "Base64-encoded image"
// @Success      200 {object} filenameResponse
// @Failure      400 {object} httputil.ErrResp
// @Failure      413 {object} httputil.ErrResp
// @Failure      500 {object} httputil.ErrResp
// @Failure      503 {object} httputil.ErrResp
// @Router       /backgrounds/upload [post]
func (h *handler) handleBackgroundUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	db := h.deps.BackgroundsDB()
	if db == nil {
		httputil.WriteError(w, http.StatusServiceUnavailable, "no database available to store the image")
		return
	}

	httputil.LimitBody(w, r, imageupload.MaxBytes)

	var body backgroundUploadRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httputil.WriteBodyError(w, err, "invalid JSON")
		return
	}
	if body.ImageBase64 == "" {
		httputil.WriteError(w, http.StatusBadRequest, "image_base64 required")
		return
	}

	// Strip optional data-URI prefix
	data := body.ImageBase64
	if idx := strings.Index(data, ","); idx >= 0 {
		data = data[idx+1:]
	}

	raw, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		httputil.WriteError(w, http.StatusBadRequest, "invalid base64")
		return
	}

	processed, err := imageupload.Process(raw)
	if err != nil {
		httputil.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	filename := "bg_" + strconv.FormatInt(time.Now().UnixMilli(), 10) + "." + imageupload.Extension(processed.Mime)
	if err := db.SaveBackground(filename, processed.Data, processed.Mime); err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, "save failed")
		return
	}

	httputil.WriteJSON(w, http.StatusOK, filenameResponse{Filename: filename})
}

// handleBackgroundServe serves a background image file by filename.
//
// @Summary      Serve a background image
// @Tags         backgrounds
// @Param        filename path string true "Image filename"
// swag stamps a response with the @Produce list in force when it parses that
// line, and offers no per-response content type, so the JSON failures are
// declared before @Produce switches to the image types of the success.
// @Produce      json
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Produce      image/png,image/jpeg
// @Success      200 {file} binary
// @Router       /backgrounds/{filename} [get]
func (h *handler) handleBackgroundServe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	filename := strings.TrimPrefix(r.URL.Path, apiPrefix)
	if !validFilename(filename) {
		httputil.WriteError(w, http.StatusBadRequest, "invalid filename")
		return
	}

	db := h.deps.BackgroundsDB()
	if db == nil {
		httputil.WriteError(w, http.StatusNotFound, "background not found")
		return
	}
	data, mime, err := db.LoadBackground(filename)
	if err != nil {
		httputil.WriteError(w, http.StatusNotFound, "background not found")
		return
	}

	// The name carries the upload timestamp and its content never changes, so
	// the answer can be cached without a revalidation round trip.
	w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	_, _ = w.Write(data)
}

// handleBackgroundDelete removes a background image file.
//
// @Summary      Delete a background image
// @Tags         backgrounds
// @Produce      json
// @Param        filename path string true "Image filename"
// @Success      204
// @Failure      400 {object} httputil.ErrResp
// @Failure      500 {object} httputil.ErrResp
// @Router       /backgrounds/{filename} [delete]
func (h *handler) handleBackgroundDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	filename := strings.TrimPrefix(r.URL.Path, apiPrefix)
	if !validFilename(filename) {
		httputil.WriteError(w, http.StatusBadRequest, "invalid filename")
		return
	}

	if db := h.deps.BackgroundsDB(); db != nil {
		if err := db.DeleteBackground(filename); err != nil {
			httputil.WriteError(w, http.StatusInternalServerError, "delete failed")
			return
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

// validFilename keeps the key space clean. Nothing reaches the filesystem any
// more, but a name with a separator in it could only ever be a mistake or an
// attempt at one.
func validFilename(name string) bool {
	return name != "" && !strings.Contains(name, "..") && !strings.Contains(name, "/")
}
