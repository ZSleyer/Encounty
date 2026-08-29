// Package backgrounds tests the background image upload, serve, and delete handlers.
package backgrounds

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Duplicated test literals (S1192).
const (
	uploadPath         = "/api/backgrounds/upload"
	testBackgroundPath = "/api/backgrounds/test.png"
	fmtStatusWant200   = "status = %d, want 200; body = %s"
	fmtStatusWant400   = "status = %d, want 400"
	wantStatus405Fmt   = "status = %d, want 405"
)

// memStore is an in-memory BackgroundStore, standing in for the database.
type memStore struct {
	data map[string][]byte
	mime map[string]string
}

func newMemStore() *memStore {
	return &memStore{data: map[string][]byte{}, mime: map[string]string{}}
}

func (m *memStore) SaveBackground(filename string, data []byte, mime string) error {
	m.data[filename] = data
	m.mime[filename] = mime
	return nil
}

func (m *memStore) LoadBackground(filename string) ([]byte, string, error) {
	data, ok := m.data[filename]
	if !ok {
		return nil, "", errNotStored
	}
	return data, m.mime[filename], nil
}

func (m *memStore) DeleteBackground(filename string) error {
	delete(m.data, filename)
	delete(m.mime, filename)
	return nil
}

var errNotStored = errors.New("not stored")

// testDeps implements the Deps interface for testing. A nil store stands for a
// backend running without a database.
type testDeps struct {
	store *memStore
}

func (d *testDeps) BackgroundsDB() BackgroundStore {
	if d.store == nil {
		return nil
	}
	return d.store
}

// newTestMux creates a test HTTP mux with the backgrounds routes registered.
func newTestMux(t *testing.T) (*http.ServeMux, *testDeps) {
	t.Helper()
	deps := &testDeps{store: newMemStore()}
	mux := http.NewServeMux()
	RegisterRoutes(mux, deps)
	return mux, deps
}

// makePNGBase64 creates a minimal valid PNG image encoded as base64.
func makePNGBase64(t *testing.T, width, height int) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := range height {
		for x := range width {
			img.Set(x, y, color.RGBA{R: 255, G: 0, B: 0, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

func TestUploadValidPNG(t *testing.T) {
	mux, deps := newTestMux(t)
	b64 := makePNGBase64(t, 100, 50)
	body := `{"image_base64":"` + b64 + `"}`

	req := httptest.NewRequest(http.MethodPost, uploadPath, strings.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code, w.Body.String())
	}

	var resp filenameResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Filename == "" {
		t.Error("expected non-empty filename in response")
	}
	if !strings.HasSuffix(resp.Filename, ".png") {
		t.Errorf("filename %q does not end with .png", resp.Filename)
	}

	if _, ok := deps.store.data[resp.Filename]; !ok {
		t.Errorf("uploaded image %q not found in the store", resp.Filename)
	}
}

func TestUploadWithDataURIPrefix(t *testing.T) {
	mux, _ := newTestMux(t)
	b64 := makePNGBase64(t, 50, 50)
	body := `{"image_base64":"data:image/png;base64,` + b64 + `"}`

	req := httptest.NewRequest(http.MethodPost, uploadPath, strings.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code, w.Body.String())
	}
}

func TestUploadDownscalesLargeImage(t *testing.T) {
	mux, deps := newTestMux(t)
	b64 := makePNGBase64(t, 4200, 2100)
	body := `{"image_base64":"` + b64 + `"}`

	req := httptest.NewRequest(http.MethodPost, uploadPath, strings.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code, w.Body.String())
	}

	var resp filenameResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}

	img, err := png.Decode(bytes.NewReader(deps.store.data[resp.Filename]))
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() != 3840 {
		t.Errorf("width = %d, want 3840 (downscaled)", img.Bounds().Dx())
	}
}

func TestUploadMissingBase64Field(t *testing.T) {
	mux, _ := newTestMux(t)
	body := `{"image_base64":""}`

	req := httptest.NewRequest(http.MethodPost, uploadPath, strings.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(fmtStatusWant400, w.Code)
	}
}

func TestUploadInvalidJSON(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, uploadPath, strings.NewReader("{bad"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(fmtStatusWant400, w.Code)
	}
}

func TestUploadInvalidBase64(t *testing.T) {
	mux, _ := newTestMux(t)
	body := `{"image_base64":"not-valid-base64!!!"}`

	req := httptest.NewRequest(http.MethodPost, uploadPath, strings.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(fmtStatusWant400, w.Code)
	}
}

func TestUploadUnsupportedImageFormat(t *testing.T) {
	mux, _ := newTestMux(t)
	// Valid base64 but not a valid image
	b64 := base64.StdEncoding.EncodeToString([]byte("this is not an image"))
	body := `{"image_base64":"` + b64 + `"}`

	req := httptest.NewRequest(http.MethodPost, uploadPath, strings.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(fmtStatusWant400, w.Code)
	}
}

func TestUploadMethodNotAllowed(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, uploadPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(wantStatus405Fmt, w.Code)
	}
}

func TestServeBackground(t *testing.T) {
	mux, deps := newTestMux(t)

	if err := deps.store.SaveBackground("test.png", []byte("fake-image-data"), "image/png"); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, testBackgroundPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if w.Header().Get("Cache-Control") == "" {
		t.Error("expected Cache-Control header")
	}
	if got := w.Header().Get("Content-Type"); got != "image/png" {
		t.Errorf("Content-Type = %q, want image/png", got)
	}
	if w.Body.String() != "fake-image-data" {
		t.Errorf("body = %q, want the stored bytes", w.Body.String())
	}
}

// TestServeBackgroundWithoutDatabase verifies that a backend without a database
// answers 404 instead of panicking on a nil store.
func TestServeBackgroundWithoutDatabase(t *testing.T) {
	deps := &testDeps{}
	mux := http.NewServeMux()
	RegisterRoutes(mux, deps)

	req := httptest.NewRequest(http.MethodGet, testBackgroundPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", w.Code)
	}
}

// TestUploadWithoutDatabase verifies that an upload fails loudly rather than
// dropping the image somewhere nothing reads it back.
func TestUploadWithoutDatabase(t *testing.T) {
	deps := &testDeps{}
	mux := http.NewServeMux()
	RegisterRoutes(mux, deps)

	body := `{"image_base64":"` + makePNGBase64(t, 10, 10) + `"}`
	req := httptest.NewRequest(http.MethodPost, uploadPath, strings.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", w.Code)
	}
}

func TestServeBackgroundNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, "/api/backgrounds/nonexistent.png", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", w.Code)
	}
}

func TestServeBackgroundInvalidFilename(t *testing.T) {
	mux, _ := newTestMux(t)

	tests := []struct {
		name string
		path string
	}{
		{"empty filename", "/api/backgrounds/"},
		{"path traversal", "/api/backgrounds/..%2F..%2Fetc%2Fpasswd"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, req)

			// Empty filename and path traversal should both return 400
			if w.Code != http.StatusBadRequest {
				t.Errorf(fmtStatusWant400, w.Code)
			}
		})
	}
}

func TestServeMethodNotAllowed(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPut, testBackgroundPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(wantStatus405Fmt, w.Code)
	}
}

func TestDeleteBackground(t *testing.T) {
	mux, deps := newTestMux(t)

	if err := deps.store.SaveBackground("deleteme.png", []byte("data"), "image/png"); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/backgrounds/deleteme.png", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("status = %d, want 204", w.Code)
	}
	if _, ok := deps.store.data["deleteme.png"]; ok {
		t.Error("expected the image to be gone from the store")
	}
}

func TestDeleteBackgroundNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	// Deleting a non-existent file should still return 204 (idempotent)
	req := httptest.NewRequest(http.MethodDelete, "/api/backgrounds/nope.png", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("status = %d, want 204", w.Code)
	}
}

func TestDeleteBackgroundInvalidFilename(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodDelete, "/api/backgrounds/", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(fmtStatusWant400, w.Code)
	}
}

// --- Delete with path traversal attempt --------------------------------------

func TestDeleteBackgroundPathTraversal(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodDelete, "/api/backgrounds/..%2F..%2Fetc%2Fpasswd", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(fmtStatusWant400, w.Code)
	}
}

func TestDeleteBackgroundSlashInFilename(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodDelete, "/api/backgrounds/sub/file.png", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	// The path contains a slash, so it should be rejected as invalid
	if w.Code != http.StatusBadRequest {
		t.Errorf(fmtStatusWant400, w.Code)
	}
}

// --- Serve with method check (handleBackgroundServe path) --------------------

func TestServeBackgroundMethodNotAllowedInner(t *testing.T) {
	mux, deps := newTestMux(t)

	if err := deps.store.SaveBackground("test.png", []byte("data"), "image/png"); err != nil {
		t.Fatal(err)
	}

	// PATCH is not handled by the route dispatcher
	req := httptest.NewRequest(http.MethodPatch, testBackgroundPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(wantStatus405Fmt, w.Code)
	}
}

// --- Upload with JPEG image --------------------------------------------------

func TestUploadValidJPEG(t *testing.T) {
	mux, _ := newTestMux(t)

	// Create a valid JPEG encoded as base64
	img := image.NewRGBA(image.Rect(0, 0, 50, 50))
	for y := range 50 {
		for x := range 50 {
			img.Set(x, y, color.RGBA{R: 0, G: 255, B: 0, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	b64 := base64.StdEncoding.EncodeToString(buf.Bytes())
	body := `{"image_base64":"` + b64 + `"}`

	req := httptest.NewRequest(http.MethodPost, uploadPath, strings.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, w.Code, w.Body.String())
	}

	var resp filenameResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(resp.Filename, ".jpeg") {
		t.Errorf("filename %q should end with .jpeg", resp.Filename)
	}
}
