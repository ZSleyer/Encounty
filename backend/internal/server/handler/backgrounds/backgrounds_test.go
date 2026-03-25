// Package backgrounds tests the background image upload, serve, and delete handlers.
package backgrounds

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Duplicated test literals (S1192).
const (
	uploadPath       = "/api/backgrounds/upload"
	fmtStatusWant200 = "status = %d, want 200; body = %s"
	fmtStatusWant400 = "status = %d, want 400"
)

// testDeps implements the Deps interface for testing.
type testDeps struct {
	configDir string
}

func (d *testDeps) ConfigDir() string { return d.configDir }

// newTestMux creates a test HTTP mux with the backgrounds routes registered.
func newTestMux(t *testing.T) (*http.ServeMux, *testDeps) {
	t.Helper()
	dir := t.TempDir()
	deps := &testDeps{configDir: dir}
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

	// Verify file exists on disk
	path := filepath.Join(deps.configDir, "backgrounds", resp.Filename)
	if _, err := os.Stat(path); err != nil {
		t.Errorf("uploaded file not found at %s: %v", path, err)
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
	b64 := makePNGBase64(t, 2400, 1200)
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

	// Decode the saved file and verify it was downscaled
	path := filepath.Join(deps.configDir, "backgrounds", resp.Filename)
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()

	img, err := png.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() != 1920 {
		t.Errorf("width = %d, want 1920 (downscaled)", img.Bounds().Dx())
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
		t.Errorf("status = %d, want 405", w.Code)
	}
}

func TestServeBackground(t *testing.T) {
	mux, deps := newTestMux(t)

	// Pre-create a background file
	bgDir := filepath.Join(deps.configDir, "backgrounds")
	if err := os.MkdirAll(bgDir, 0755); err != nil {
		t.Fatal(err)
	}
	testFile := filepath.Join(bgDir, "test.png")
	if err := os.WriteFile(testFile, []byte("fake-image-data"), 0644); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/backgrounds/test.png", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if w.Header().Get("Cache-Control") == "" {
		t.Error("expected Cache-Control header")
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

	req := httptest.NewRequest(http.MethodPut, "/api/backgrounds/test.png", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", w.Code)
	}
}

func TestDeleteBackground(t *testing.T) {
	mux, deps := newTestMux(t)

	// Pre-create a background file
	bgDir := filepath.Join(deps.configDir, "backgrounds")
	if err := os.MkdirAll(bgDir, 0755); err != nil {
		t.Fatal(err)
	}
	testFile := filepath.Join(bgDir, "deleteme.png")
	if err := os.WriteFile(testFile, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/backgrounds/deleteme.png", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("status = %d, want 204", w.Code)
	}

	// Verify file was removed
	if _, err := os.Stat(testFile); !os.IsNotExist(err) {
		t.Error("expected file to be deleted")
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
