// Package detector tests the HTTP handlers for detector lifecycle,
// configuration, template management, and browser-driven detection.
package detector

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/detector"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// Duplicated string literals extracted for SonarQube S1192 compliance.
const (
	msgWant200     = "status = %d, want 200"
	msgWant200Body = "status = %d, want 200, body = %s"
	msgWant400     = "status = %d, want 400"
	msgWant404     = "status = %d, want 404"
	msgWant405     = "status = %d, want 405"
	hdrContentType = "Content-Type"

	pathConfig             = "/api/detector/p1/config"
	pathTemplate0          = "/api/detector/p1/template/0"
	pathTemplateUpload     = "/api/detector/p1/template_upload"
	pathMatch              = "/api/detector/p1/match"
	pathExportTemplates    = "/api/detector/p1/export_templates"
	pathImportTemplatesTgt = "/api/detector/tgt/import_templates"
	pathImportFile         = "/api/detector/p1/import_templates_file"

	zipMetadataJSON = "metadata.json"
	zipTemplate0PNG = "template_0.png"

	metadataFile              = "metadata.json"
	wantBroadcast             = "expected BroadcastState to be called"
	wantZeroTemplatesFmt      = "templates count = %d, want 0"
	wantOneImportFmt          = "imported = %d, want 1"
	templatesZipFile          = "templates.zip"
	wantStatus204Fmt          = "status = %d, want 204"
	testDetectorTemplatesPath = "/api/detector/p1/templates"
)

// --- Mock types --------------------------------------------------------------

// mockDetectorDB implements DetectorStore with in-memory storage.
type mockDetectorDB struct {
	images map[int64][]byte
	nextID int64
	failOn string // "load", "save", "delete" to simulate errors
}

func newMockDetectorDB() *mockDetectorDB {
	return &mockDetectorDB{images: make(map[int64][]byte), nextID: 1}
}

// LoadTemplateImage returns stored image data or an error if not found.
func (m *mockDetectorDB) LoadTemplateImage(templateDBID int64) ([]byte, error) {
	if m.failOn == "load" {
		return nil, fmt.Errorf("mock load error")
	}
	data, ok := m.images[templateDBID]
	if !ok {
		return nil, fmt.Errorf("template %d not found", templateDBID)
	}
	return data, nil
}

// SaveTemplateImage stores image data and returns a new ID.
func (m *mockDetectorDB) SaveTemplateImage(pokemonID string, imageData []byte, sortOrder int) (int64, error) {
	if m.failOn == "save" {
		return 0, fmt.Errorf("mock save error")
	}
	id := m.nextID
	m.nextID++
	m.images[id] = imageData
	return id, nil
}

// DeleteTemplateImage removes stored image data.
func (m *mockDetectorDB) DeleteTemplateImage(templateDBID int64) error {
	if m.failOn == "delete" {
		return fmt.Errorf("mock delete error")
	}
	delete(m.images, templateDBID)
	return nil
}

// mockEncounterLogger records encounter log calls for verification.
type mockEncounterLogger struct {
	calls []encounterLogCall
}

// encounterLogCall records a single LogEncounter invocation.
type encounterLogCall struct {
	PokemonID   string
	PokemonName string
	Delta       int
	CountAfter  int
	Source      string
}

// LogEncounter stores the call for later inspection.
func (m *mockEncounterLogger) LogEncounter(pokemonID, pokemonName string, delta, countAfter int, source string) error {
	m.calls = append(m.calls, encounterLogCall{
		PokemonID: pokemonID, PokemonName: pokemonName,
		Delta: delta, CountAfter: countAfter, Source: source,
	})
	return nil
}

// testDeps implements the Deps interface for isolated handler testing.
type testDeps struct {
	stateMgr        *state.Manager
	detectorMgr     *detector.Manager
	detectorDB      *mockDetectorDB
	encounterLogger *mockEncounterLogger
	configDir       string
	broadcasts      []broadcastCall
	stateBroadcN    int
}

// broadcastCall records a Broadcast invocation.
type broadcastCall struct {
	MsgType string
	Payload any
}

func (d *testDeps) StateManager() *state.Manager             { return d.stateMgr }
func (d *testDeps) DetectorMgr() *detector.Manager           { return d.detectorMgr }
func (d *testDeps) DetectorDB() DetectorStore                { return d.detectorDB }
func (d *testDeps) DetectorEncounterLogger() EncounterLogger { return d.encounterLogger }
func (d *testDeps) ConfigDir() string                        { return d.configDir }
func (d *testDeps) BroadcastState()                          { d.stateBroadcN++ }
func (d *testDeps) Broadcast(msgType string, payload any) {
	d.broadcasts = append(d.broadcasts, broadcastCall{MsgType: msgType, Payload: payload})
}

// --- Helpers -----------------------------------------------------------------

// newTestMux creates a test HTTP mux with detector routes, a real state
// manager, and a mock detector DB.
func newTestMux(t *testing.T) (*http.ServeMux, *testDeps) {
	t.Helper()
	dir := t.TempDir()
	sm := state.NewManager(dir)
	db := newMockDetectorDB()
	mgr := detector.NewManager(sm, dir)

	deps := &testDeps{
		stateMgr:        sm,
		detectorMgr:     mgr,
		detectorDB:      db,
		encounterLogger: &mockEncounterLogger{},
		configDir:       dir,
	}
	mux := http.NewServeMux()
	RegisterRoutes(mux, deps)
	return mux, deps
}

// addTestPokemon adds a Pokemon with the given ID and name to the state.
func addTestPokemon(t *testing.T, deps *testDeps, id, name string) {
	t.Helper()
	deps.stateMgr.AddPokemon(state.Pokemon{
		ID:        id,
		Name:      name,
		CreatedAt: time.Now(),
	})
}

// addTestPokemonWithConfig adds a Pokemon with a pre-set detector config.
func addTestPokemonWithConfig(t *testing.T, deps *testDeps, id, name string, cfg *state.DetectorConfig) {
	t.Helper()
	addTestPokemon(t, deps, id, name)
	deps.stateMgr.SetDetectorConfig(id, cfg)
}

// makePNGBytes creates a minimal valid PNG image and returns its bytes.
func makePNGBytes(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	for x := range 4 {
		for y := range 4 {
			img.Set(x, y, color.RGBA{R: 255, G: 0, B: 0, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// jsonBody marshals v as JSON and returns a reader.
func jsonBody(t *testing.T, v any) *bytes.Buffer {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return bytes.NewBuffer(data)
}

// decodeJSON reads the response body into v.
func decodeJSON(t *testing.T, body io.Reader, v any) {
	t.Helper()
	if err := json.NewDecoder(body).Decode(v); err != nil {
		t.Fatalf("failed to decode JSON: %v", err)
	}
}

// --- Dispatch 404 paths ------------------------------------------------------

func TestDispatchMissingAction(t *testing.T) {
	mux, _ := newTestMux(t)

	// Only an ID, no action segment
	req := httptest.NewRequest(http.MethodGet, "/api/detector/p1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(msgWant404, w.Code)
	}
}

func TestDispatchUnknownAction(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, "/api/detector/p1/nonexistent", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(msgWant404, w.Code)
	}
}

func TestDispatchTemplateMissingIndex(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, "/api/detector/p1/template", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(msgWant404, w.Code)
	}
}

// --- Config GET / POST -------------------------------------------------------

func TestConfigGetNoPokemon(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, "/api/detector/nonexistent/config", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(msgWant404, w.Code)
	}
}

func TestConfigGetNoConfig(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodGet, pathConfig, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200, w.Code)
	}

	var cfg state.DetectorConfig
	decodeJSON(t, w.Body, &cfg)
	// Zero-value config should be returned
	if cfg.Enabled {
		t.Error("expected Enabled to be false for missing config")
	}
}

func TestConfigGetWithConfig(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemonWithConfig(t, deps, "p1", "Pikachu", &state.DetectorConfig{
		Enabled:    true,
		SourceType: "screen_region",
		Precision:  0.9,
	})

	req := httptest.NewRequest(http.MethodGet, pathConfig, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200, w.Code)
	}

	var cfg state.DetectorConfig
	decodeJSON(t, w.Body, &cfg)
	if !cfg.Enabled {
		t.Error("expected Enabled=true")
	}
	if cfg.Precision != 0.9 {
		t.Errorf("Precision = %f, want 0.9", cfg.Precision)
	}
}

func TestConfigPostSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	body := jsonBody(t, state.DetectorConfig{
		Enabled:    true,
		SourceType: "window",
		Precision:  0.85,
	})

	req := httptest.NewRequest(http.MethodPost, pathConfig, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200Body, w.Code, w.Body.String())
	}

	// Verify config was set
	st := deps.stateMgr.GetState()
	p := findPokemon(st, "p1")
	if p == nil || p.DetectorConfig == nil {
		t.Fatal("pokemon or config nil after POST")
	}
	if !p.DetectorConfig.Enabled {
		t.Error("Enabled should be true")
	}
	if p.DetectorConfig.SourceType != "window" {
		t.Errorf("SourceType = %q, want window", p.DetectorConfig.SourceType)
	}
	if deps.stateBroadcN == 0 {
		t.Error(wantBroadcast)
	}
}

func TestConfigPostNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	body := jsonBody(t, state.DetectorConfig{Enabled: true})
	req := httptest.NewRequest(http.MethodPost, "/api/detector/missing/config", body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(msgWant404, w.Code)
	}
}

func TestConfigPostInvalidPollIntervals(t *testing.T) {
	cases := []struct {
		name string
		cfg  state.DetectorConfig
	}{
		{"min greater than max", state.DetectorConfig{MinPollMs: 500, MaxPollMs: 200, PollIntervalMs: 300}},
		{"base below min", state.DetectorConfig{MinPollMs: 300, MaxPollMs: 1000, PollIntervalMs: 100}},
		{"base above max", state.DetectorConfig{MinPollMs: 50, MaxPollMs: 200, PollIntervalMs: 500}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mux, deps := newTestMux(t)
			addTestPokemon(t, deps, "p1", "Pikachu")

			req := httptest.NewRequest(http.MethodPost, pathConfig, jsonBody(t, tc.cfg))
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, req)

			if w.Code != http.StatusBadRequest {
				t.Fatalf("want 400, got %d body=%s", w.Code, w.Body.String())
			}
			if !strings.Contains(w.Body.String(), "poll") {
				t.Errorf("error body should mention 'poll', got %s", w.Body.String())
			}
		})
	}
}

func TestConfigPostInvalidJSON(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodPost, pathConfig, bytes.NewBufferString("{invalid"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(msgWant400, w.Code)
	}
}

func TestConfigMethodNotAllowed(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodDelete, pathConfig, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(msgWant405, w.Code)
	}
}

// --- Template GET / DELETE / PATCH -------------------------------------------

func TestTemplateGetFromDB(t *testing.T) {
	mux, deps := newTestMux(t)
	pngData := makePNGBytes(t)

	// Store a template image in the mock DB
	dbID, err := deps.detectorDB.SaveTemplateImage("p1", pngData, 0)
	if err != nil {
		t.Fatal(err)
	}

	addTestPokemonWithConfig(t, deps, "p1", "Pikachu", &state.DetectorConfig{
		Templates: []state.DetectorTemplate{
			{TemplateDBID: dbID, Regions: []state.MatchedRegion{{Type: "image"}}},
		},
	})

	req := httptest.NewRequest(http.MethodGet, pathTemplate0, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200Body, w.Code, w.Body.String())
	}

	ct := w.Header().Get(hdrContentType)
	if ct != "image/png" {
		t.Errorf("Content-Type = %q, want image/png", ct)
	}
	if w.Body.Len() == 0 {
		t.Error("expected non-empty body")
	}
}

func TestTemplateGetNoImageData(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemonWithConfig(t, deps, "p1", "Pikachu", &state.DetectorConfig{
		Templates: []state.DetectorTemplate{
			{Regions: []state.MatchedRegion{{Type: "image"}}},
		},
	})

	req := httptest.NewRequest(http.MethodGet, pathTemplate0, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(msgWant404, w.Code)
	}
}

func TestTemplateGetInvalidIndex(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemonWithConfig(t, deps, "p1", "Pikachu", &state.DetectorConfig{
		Templates: []state.DetectorTemplate{
			{TemplateDBID: 1},
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/detector/p1/template/abc", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(msgWant400, w.Code)
	}
}

func TestTemplateGetOutOfRange(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemonWithConfig(t, deps, "p1", "Pikachu", &state.DetectorConfig{
		Templates: []state.DetectorTemplate{
			{TemplateDBID: 1},
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/detector/p1/template/5", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(msgWant404, w.Code)
	}
}

func TestTemplateGetNoPokemon(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, "/api/detector/missing/template/0", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(msgWant404, w.Code)
	}
}

func TestTemplateGetNoConfig(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodGet, pathTemplate0, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	// Pokemon has no DetectorConfig, so it returns 404
	if w.Code != http.StatusNotFound {
		t.Errorf(msgWant404, w.Code)
	}
}

func TestTemplateDelete(t *testing.T) {
	mux, deps := newTestMux(t)
	pngData := makePNGBytes(t)
	dbID, _ := deps.detectorDB.SaveTemplateImage("p1", pngData, 0)

	addTestPokemonWithConfig(t, deps, "p1", "Pikachu", &state.DetectorConfig{
		Templates: []state.DetectorTemplate{
			{TemplateDBID: dbID, Regions: []state.MatchedRegion{{Type: "image"}}},
		},
	})

	req := httptest.NewRequest(http.MethodDelete, pathTemplate0, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200, w.Code)
	}

	// Verify template was removed from config
	st := deps.stateMgr.GetState()
	p := findPokemon(st, "p1")
	if p == nil || p.DetectorConfig == nil {
		t.Fatal("pokemon or config nil after DELETE")
	}
	if len(p.DetectorConfig.Templates) != 0 {
		t.Errorf(wantZeroTemplatesFmt, len(p.DetectorConfig.Templates))
	}

	// Verify image was deleted from DB
	if _, ok := deps.detectorDB.images[dbID]; ok {
		t.Error("expected template image to be deleted from DB")
	}

	if deps.stateBroadcN == 0 {
		t.Error(wantBroadcast)
	}
}

func TestTemplatePatchRegions(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemonWithConfig(t, deps, "p1", "Pikachu", &state.DetectorConfig{
		Templates: []state.DetectorTemplate{
			{TemplateDBID: 1, Regions: []state.MatchedRegion{{Type: "image"}}},
		},
	})

	body := jsonBody(t, map[string]any{
		"regions": []state.MatchedRegion{
			{Type: "image", Rect: state.DetectorRect{X: 10, Y: 20, W: 100, H: 200}},
			{Type: "text", ExpectedText: "Pikachu"},
		},
	})

	req := httptest.NewRequest(http.MethodPatch, pathTemplate0, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200Body, w.Code, w.Body.String())
	}

	st := deps.stateMgr.GetState()
	p := findPokemon(st, "p1")
	if len(p.DetectorConfig.Templates[0].Regions) != 2 {
		t.Errorf("regions count = %d, want 2", len(p.DetectorConfig.Templates[0].Regions))
	}
}

func TestTemplatePatchEnabled(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemonWithConfig(t, deps, "p1", "Pikachu", &state.DetectorConfig{
		Templates: []state.DetectorTemplate{
			{TemplateDBID: 1},
		},
	})

	enabled := false
	body := jsonBody(t, map[string]any{"enabled": enabled})
	req := httptest.NewRequest(http.MethodPatch, pathTemplate0, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200, w.Code)
	}

	st := deps.stateMgr.GetState()
	p := findPokemon(st, "p1")
	if p.DetectorConfig.Templates[0].Enabled == nil || *p.DetectorConfig.Templates[0].Enabled {
		t.Error("expected Enabled to be false after PATCH")
	}
}

func TestTemplatePatchInvalidJSON(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemonWithConfig(t, deps, "p1", "Pikachu", &state.DetectorConfig{
		Templates: []state.DetectorTemplate{{TemplateDBID: 1}},
	})

	req := httptest.NewRequest(http.MethodPatch, pathTemplate0, bytes.NewBufferString("{bad"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(msgWant400, w.Code)
	}
}

func TestTemplateMethodNotAllowed(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemonWithConfig(t, deps, "p1", "Pikachu", &state.DetectorConfig{
		Templates: []state.DetectorTemplate{{TemplateDBID: 1}},
	})

	req := httptest.NewRequest(http.MethodPost, pathTemplate0, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(msgWant405, w.Code)
	}
}

func TestTemplateGetDBError(t *testing.T) {
	mux, deps := newTestMux(t)
	deps.detectorDB.failOn = "load"
	addTestPokemonWithConfig(t, deps, "p1", "Pikachu", &state.DetectorConfig{
		Templates: []state.DetectorTemplate{
			{TemplateDBID: 99, Regions: []state.MatchedRegion{{Type: "image"}}},
		},
	})

	req := httptest.NewRequest(http.MethodGet, pathTemplate0, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", w.Code)
	}
}

// --- Template Upload ---------------------------------------------------------

func TestTemplateUploadSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	pngData := makePNGBytes(t)
	b64 := base64.StdEncoding.EncodeToString(pngData)
	body := jsonBody(t, map[string]any{
		"imageBase64": b64,
		"regions":     []state.MatchedRegion{{Type: "image"}},
	})

	req := httptest.NewRequest(http.MethodPost, pathTemplateUpload, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200Body, w.Code, w.Body.String())
	}

	var resp templateUploadResponse
	decodeJSON(t, w.Body, &resp)
	if resp.Index != 0 {
		t.Errorf("index = %d, want 0", resp.Index)
	}
	if resp.TemplateDBID == 0 {
		t.Error("expected non-zero TemplateDBID")
	}

	// Verify config was updated
	st := deps.stateMgr.GetState()
	p := findPokemon(st, "p1")
	if p.DetectorConfig == nil || len(p.DetectorConfig.Templates) != 1 {
		t.Fatal("expected 1 template after upload")
	}
}

func TestTemplateUploadWithDataURLPrefix(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	pngData := makePNGBytes(t)
	b64 := "data:image/png;base64," + base64.StdEncoding.EncodeToString(pngData)
	body := jsonBody(t, map[string]any{
		"imageBase64": b64,
	})

	req := httptest.NewRequest(http.MethodPost, pathTemplateUpload, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200Body, w.Code, w.Body.String())
	}
}

func TestTemplateUploadNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	body := jsonBody(t, map[string]string{"imageBase64": "aaa"})
	req := httptest.NewRequest(http.MethodPost, "/api/detector/missing/template_upload", body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(msgWant404, w.Code)
	}
}

func TestTemplateUploadInvalidBase64(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	body := jsonBody(t, map[string]string{"imageBase64": "!!!invalid!!!"})
	req := httptest.NewRequest(http.MethodPost, pathTemplateUpload, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(msgWant400, w.Code)
	}
}

func TestTemplateUploadInvalidImage(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	b64 := base64.StdEncoding.EncodeToString([]byte("not an image"))
	body := jsonBody(t, map[string]string{"imageBase64": b64})
	req := httptest.NewRequest(http.MethodPost, pathTemplateUpload, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(msgWant400, w.Code)
	}
}

func TestTemplateUploadMethodNotAllowed(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, pathTemplateUpload, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(msgWant405, w.Code)
	}
}

func TestTemplateUploadDBSaveError(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")
	deps.detectorDB.failOn = "save"

	pngData := makePNGBytes(t)
	b64 := base64.StdEncoding.EncodeToString(pngData)
	body := jsonBody(t, map[string]any{"imageBase64": b64})

	req := httptest.NewRequest(http.MethodPost, pathTemplateUpload, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", w.Code)
	}
}

func TestTemplateUploadBadJSON(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodPost, pathTemplateUpload,
		bytes.NewBufferString("not json"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(msgWant400, w.Code)
	}
}

// --- Match Submit ------------------------------------------------------------

func TestMatchSubmitSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	body := jsonBody(t, matchSubmitRequest{Score: 0.95, FrameDelta: 0.1})
	req := httptest.NewRequest(http.MethodPost, pathMatch, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200Body, w.Code, w.Body.String())
	}

	var resp matchSubmitResponse
	decodeJSON(t, w.Body, &resp)
	if !resp.Matched {
		t.Error("expected Matched=true")
	}
	if resp.Confidence != 0.95 {
		t.Errorf("Confidence = %f, want 0.95", resp.Confidence)
	}

	// Verify encounter was incremented
	st := deps.stateMgr.GetState()
	p := findPokemon(st, "p1")
	if p.Encounters != 1 {
		t.Errorf("encounters = %d, want 1", p.Encounters)
	}

	// Verify detector_match was broadcast
	found := false
	for _, bc := range deps.broadcasts {
		if bc.MsgType == "detector_match" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected detector_match broadcast")
	}

	// Verify encounter was logged
	if len(deps.encounterLogger.calls) != 1 {
		t.Fatalf("encounterLogger calls = %d, want 1", len(deps.encounterLogger.calls))
	}
	if deps.encounterLogger.calls[0].Source != "detector" {
		t.Errorf("source = %q, want detector", deps.encounterLogger.calls[0].Source)
	}
}

func TestMatchSubmitNoPokemon(t *testing.T) {
	mux, _ := newTestMux(t)

	body := jsonBody(t, matchSubmitRequest{Score: 0.5})
	req := httptest.NewRequest(http.MethodPost, "/api/detector/missing/match", body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(msgWant404, w.Code)
	}
}

func TestMatchSubmitInvalidJSON(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, pathMatch,
		bytes.NewBufferString("{bad"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(msgWant400, w.Code)
	}
}

func TestMatchSubmitMethodNotAllowed(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, pathMatch, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(msgWant405, w.Code)
	}
}

// --- Export Templates --------------------------------------------------------

func TestExportTemplatesSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	pngData := makePNGBytes(t)
	dbID, _ := deps.detectorDB.SaveTemplateImage("p1", pngData, 0)

	addTestPokemonWithConfig(t, deps, "p1", "Pikachu", &state.DetectorConfig{
		Templates: []state.DetectorTemplate{
			{
				TemplateDBID: dbID,
				Regions:      []state.MatchedRegion{{Type: "image", Rect: state.DetectorRect{X: 0, Y: 0, W: 4, H: 4}}},
			},
		},
	})

	req := httptest.NewRequest(http.MethodGet, pathExportTemplates, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200Body, w.Code, w.Body.String())
	}

	ct := w.Header().Get(hdrContentType)
	if ct != "application/zip" {
		t.Errorf("Content-Type = %q, want application/zip", ct)
	}

	// Verify the ZIP is valid and contains metadata.json + a PNG
	zr, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil {
		t.Fatalf("invalid ZIP: %v", err)
	}

	names := make(map[string]bool)
	for _, f := range zr.File {
		names[f.Name] = true
	}
	if !names[zipMetadataJSON] {
		t.Error("metadata.json missing from export ZIP")
	}
	if !names[zipTemplate0PNG] {
		t.Error("template_0.png missing from export ZIP")
	}
}

func TestExportTemplatesNoPokemon(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, "/api/detector/missing/export_templates", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(msgWant404, w.Code)
	}
}

func TestExportTemplatesNoConfig(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodGet, pathExportTemplates, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(msgWant404, w.Code)
	}
}

func TestExportTemplatesMethodNotAllowed(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodPost, pathExportTemplates, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(msgWant405, w.Code)
	}
}

// --- Import Templates (from another Pokemon) ---------------------------------

func TestImportTemplatesSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	pngData := makePNGBytes(t)
	dbID, _ := deps.detectorDB.SaveTemplateImage("src", pngData, 0)

	// Source Pokemon with a template
	addTestPokemonWithConfig(t, deps, "src", "Charmander", &state.DetectorConfig{
		Templates: []state.DetectorTemplate{
			{TemplateDBID: dbID, Regions: []state.MatchedRegion{{Type: "image"}}},
		},
	})

	// Target Pokemon with no templates
	addTestPokemon(t, deps, "tgt", "Pikachu")

	body := jsonBody(t, importTemplatesRequest{SourcePokemonID: "src"})
	req := httptest.NewRequest(http.MethodPost, pathImportTemplatesTgt, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200Body, w.Code, w.Body.String())
	}

	var resp importResponse
	decodeJSON(t, w.Body, &resp)
	if resp.Imported != 1 {
		t.Errorf(wantOneImportFmt, resp.Imported)
	}

	// Verify template was copied to the target
	st := deps.stateMgr.GetState()
	p := findPokemon(st, "tgt")
	if p.DetectorConfig == nil || len(p.DetectorConfig.Templates) != 1 {
		t.Fatal("expected 1 template on target after import")
	}
}

func TestImportTemplatesTargetNotFound(t *testing.T) {
	mux, _ := newTestMux(t)

	body := jsonBody(t, importTemplatesRequest{SourcePokemonID: "src"})
	req := httptest.NewRequest(http.MethodPost, "/api/detector/missing/import_templates", body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(msgWant404, w.Code)
	}
}

func TestImportTemplatesSourceNoTemplates(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "src", "Charmander")
	addTestPokemon(t, deps, "tgt", "Pikachu")

	body := jsonBody(t, importTemplatesRequest{SourcePokemonID: "src"})
	req := httptest.NewRequest(http.MethodPost, pathImportTemplatesTgt, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(msgWant400, w.Code)
	}
}

func TestImportTemplatesMethodNotAllowed(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, "/api/detector/p1/import_templates", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(msgWant405, w.Code)
	}
}

func TestImportTemplatesInvalidJSON(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "tgt", "Pikachu")

	req := httptest.NewRequest(http.MethodPost, pathImportTemplatesTgt,
		bytes.NewBufferString("{bad"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(msgWant400, w.Code)
	}
}

// --- Import Templates from File (ZIP) ----------------------------------------

func TestImportTemplatesFileSuccess(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	pngData := makePNGBytes(t)

	// Build a valid ZIP with metadata.json and a template PNG
	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)

	meta := []templateImportMeta{
		{
			Filename: zipTemplate0PNG,
			Regions:  []state.MatchedRegion{{Type: "image", Rect: state.DetectorRect{W: 4, H: 4}}},
		},
	}
	metaJSON, _ := json.Marshal(meta)
	fw, _ := zw.Create(zipMetadataJSON)
	_, _ = fw.Write(metaJSON)
	fw2, _ := zw.Create(zipTemplate0PNG)
	_, _ = fw2.Write(pngData)
	_ = zw.Close()

	// Build multipart form
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	ff, _ := mw.CreateFormFile("file", "templates.encounty-templates")
	_, _ = ff.Write(zipBuf.Bytes())
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, pathImportFile, &body)
	req.Header.Set(hdrContentType, mw.FormDataContentType())
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200Body, w.Code, w.Body.String())
	}

	var resp importResponse
	decodeJSON(t, w.Body, &resp)
	if resp.Imported != 1 {
		t.Errorf(wantOneImportFmt, resp.Imported)
	}
}

func TestImportTemplatesFileNoPokemon(t *testing.T) {
	mux, _ := newTestMux(t)

	pngData := makePNGBytes(t)
	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	meta := []templateImportMeta{{Filename: zipTemplate0PNG}}
	metaJSON, _ := json.Marshal(meta)
	fw, _ := zw.Create(zipMetadataJSON)
	_, _ = fw.Write(metaJSON)
	fw2, _ := zw.Create(zipTemplate0PNG)
	_, _ = fw2.Write(pngData)
	_ = zw.Close()

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	ff, _ := mw.CreateFormFile("file", templatesZipFile)
	_, _ = ff.Write(zipBuf.Bytes())
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/detector/missing/import_templates_file", &body)
	req.Header.Set(hdrContentType, mw.FormDataContentType())
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf(msgWant404, w.Code)
	}
}

func TestImportTemplatesFileNoFile(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodPost, pathImportFile,
		bytes.NewBufferString(""))
	req.Header.Set(hdrContentType, "multipart/form-data; boundary=xxx")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(msgWant400, w.Code)
	}
}

func TestImportTemplatesFileNoMetadata(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	// ZIP without metadata.json
	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	fw, _ := zw.Create("other.txt")
	_, _ = fw.Write([]byte("no metadata"))
	_ = zw.Close()

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	ff, _ := mw.CreateFormFile("file", templatesZipFile)
	_, _ = ff.Write(zipBuf.Bytes())
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, pathImportFile, &body)
	req.Header.Set(hdrContentType, mw.FormDataContentType())
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(msgWant400, w.Code)
	}
}

func TestImportTemplatesFileMethodNotAllowed(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, pathImportFile, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(msgWant405, w.Code)
	}
}

// --- downscaleImage ----------------------------------------------------------

func TestDownscaleImageNoOp(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 800, 600))
	result := downscaleImage(img, 1920)
	if result.Bounds().Dx() != 800 {
		t.Errorf("width = %d, want 800 (should not be scaled)", result.Bounds().Dx())
	}
}

func TestDownscaleImageScales(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 3840, 2160))
	result := downscaleImage(img, 1920)
	if result.Bounds().Dx() != 1920 {
		t.Errorf("width = %d, want 1920", result.Bounds().Dx())
	}
	// Aspect ratio should be preserved: 2160 * 1920 / 3840 = 1080
	if result.Bounds().Dy() != 1080 {
		t.Errorf("height = %d, want 1080", result.Bounds().Dy())
	}
}

// --- findPokemon helper ------------------------------------------------------

func TestFindPokemonFound(t *testing.T) {
	st := state.AppState{
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Pikachu"},
			{ID: "p2", Name: "Charmander"},
		},
	}
	p := findPokemon(st, "p2")
	if p == nil {
		t.Fatal("expected to find p2")
	}
	if p.Name != "Charmander" {
		t.Errorf("name = %q, want Charmander", p.Name)
	}
}

func TestFindPokemonNotFound(t *testing.T) {
	st := state.AppState{
		Pokemon: []state.Pokemon{{ID: "p1", Name: "Pikachu"}},
	}
	p := findPokemon(st, "missing")
	if p != nil {
		t.Error("expected nil for missing pokemon")
	}
}

// --- Clear Detection Log -----------------------------------------------------

func TestClearDetectionLog(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	// Append some detection log entries
	deps.stateMgr.AppendDetectionLog("p1", 0.8)
	deps.stateMgr.AppendDetectionLog("p1", 0.9)

	req := httptest.NewRequest(http.MethodDelete, "/api/detector/p1/detection_log", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf(wantStatus204Fmt, w.Code)
	}

	if deps.stateBroadcN == 0 {
		t.Error(wantBroadcast)
	}
}

func TestClearDetectionLogMethodNotAllowed(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, "/api/detector/p1/detection_log", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(msgWant405, w.Code)
	}
}

// --- Clear All Templates -----------------------------------------------------

func TestClearAllTemplates(t *testing.T) {
	mux, deps := newTestMux(t)
	pngData := makePNGBytes(t)
	dbID, _ := deps.detectorDB.SaveTemplateImage("p1", pngData, 0)

	addTestPokemonWithConfig(t, deps, "p1", "Pikachu", &state.DetectorConfig{
		Templates: []state.DetectorTemplate{
			{TemplateDBID: dbID, Regions: []state.MatchedRegion{{Type: "image"}}},
		},
	})

	req := httptest.NewRequest(http.MethodDelete, testDetectorTemplatesPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf(wantStatus204Fmt, w.Code)
	}

	// Verify templates cleared
	st := deps.stateMgr.GetState()
	p := findPokemon(st, "p1")
	if p != nil && p.DetectorConfig != nil && len(p.DetectorConfig.Templates) != 0 {
		t.Errorf(wantZeroTemplatesFmt, len(p.DetectorConfig.Templates))
	}
}

func TestClearAllTemplatesNoConfig(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodDelete, testDetectorTemplatesPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	// Should succeed gracefully even with no config
	if w.Code != http.StatusNoContent {
		t.Errorf(wantStatus204Fmt, w.Code)
	}
}

func TestClearAllTemplatesNoPokemon(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodDelete, "/api/detector/missing/templates", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	// No pokemon found, should return 204 gracefully
	if w.Code != http.StatusNoContent {
		t.Errorf(wantStatus204Fmt, w.Code)
	}
}

func TestClearAllTemplatesMethodNotAllowed(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, testDetectorTemplatesPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(msgWant405, w.Code)
	}
}

// --- Export Templates edge cases ---------------------------------------------

func TestExportTemplatesEmpty(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemonWithConfig(t, deps, "p1", "Pikachu", &state.DetectorConfig{
		Templates: []state.DetectorTemplate{},
	})

	req := httptest.NewRequest(http.MethodGet, pathExportTemplates, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200Body, w.Code, w.Body.String())
	}

	// Should still be a valid ZIP, just with only metadata.json
	ct := w.Header().Get(hdrContentType)
	if ct != "application/zip" {
		t.Errorf("Content-Type = %q, want application/zip", ct)
	}
}

// --- Import Templates File edge cases ----------------------------------------

func TestImportTemplatesFileInvalidZip(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	// Upload non-zip data
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	ff, _ := mw.CreateFormFile("file", "bad.zip")
	_, _ = ff.Write([]byte("not a zip file"))
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, pathImportFile, &body)
	req.Header.Set(hdrContentType, mw.FormDataContentType())
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(msgWant400, w.Code)
	}
}

func TestImportTemplatesFileEmptyMetadata(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	// ZIP with metadata.json containing empty array
	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	fw, _ := zw.Create(metadataFile)
	_, _ = fw.Write([]byte("[]"))
	_ = zw.Close()

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	ff, _ := mw.CreateFormFile("file", templatesZipFile)
	_, _ = ff.Write(zipBuf.Bytes())
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, pathImportFile, &body)
	req.Header.Set(hdrContentType, mw.FormDataContentType())
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(msgWant400, w.Code)
	}
}

func TestImportTemplatesFileInvalidMetadataJSON(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	// ZIP with invalid JSON in metadata.json
	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	fw, _ := zw.Create(metadataFile)
	_, _ = fw.Write([]byte("{not valid json"))
	_ = zw.Close()

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	ff, _ := mw.CreateFormFile("file", templatesZipFile)
	_, _ = ff.Write(zipBuf.Bytes())
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, pathImportFile, &body)
	req.Header.Set(hdrContentType, mw.FormDataContentType())
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(msgWant400, w.Code)
	}
}

// --- Import Templates with specific indices ----------------------------------

func TestImportTemplatesWithIndices(t *testing.T) {
	mux, deps := newTestMux(t)
	pngData := makePNGBytes(t)
	dbID1, _ := deps.detectorDB.SaveTemplateImage("src", pngData, 0)
	dbID2, _ := deps.detectorDB.SaveTemplateImage("src", pngData, 1)

	// Source Pokemon with two templates
	addTestPokemonWithConfig(t, deps, "src", "Charmander", &state.DetectorConfig{
		Templates: []state.DetectorTemplate{
			{TemplateDBID: dbID1, Name: "Template 1", Regions: []state.MatchedRegion{{Type: "image"}}},
			{TemplateDBID: dbID2, Name: "Template 2", Regions: []state.MatchedRegion{{Type: "image"}}},
		},
	})

	// Target Pokemon
	addTestPokemon(t, deps, "tgt", "Pikachu")

	// Import only the second template (index 1)
	body := jsonBody(t, importTemplatesRequest{
		SourcePokemonID: "src",
		TemplateIndices: []int{1},
	})
	req := httptest.NewRequest(http.MethodPost, pathImportTemplatesTgt, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200Body, w.Code, w.Body.String())
	}

	var resp importResponse
	decodeJSON(t, w.Body, &resp)
	if resp.Imported != 1 {
		t.Errorf(wantOneImportFmt, resp.Imported)
	}
}

// --- logEncounter edge cases -------------------------------------------------

// nilLoggerDeps wraps testDeps but returns a true nil EncounterLogger interface.
type nilLoggerDeps struct {
	*testDeps
}

func (d *nilLoggerDeps) DetectorEncounterLogger() EncounterLogger { return nil }

func TestLogEncounterNilLogger(t *testing.T) {
	_, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	// Wrap deps to return a true nil interface for EncounterLogger
	nilDeps := &nilLoggerDeps{testDeps: deps}
	mux2 := http.NewServeMux()
	RegisterRoutes(mux2, nilDeps)

	body := jsonBody(t, matchSubmitRequest{Score: 0.95, FrameDelta: 0.1})
	req := httptest.NewRequest(http.MethodPost, pathMatch, body)
	w := httptest.NewRecorder()
	mux2.ServeHTTP(w, req)

	// Should succeed without panic even with nil logger
	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200Body, w.Code, w.Body.String())
	}
}

// --- Template PATCH with name ------------------------------------------------

func TestTemplatePatchName(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemonWithConfig(t, deps, "p1", "Pikachu", &state.DetectorConfig{
		Templates: []state.DetectorTemplate{
			{TemplateDBID: 1, Name: "Old Name"},
		},
	})

	body := jsonBody(t, map[string]any{"name": "New Name"})
	req := httptest.NewRequest(http.MethodPatch, pathTemplate0, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200, w.Code)
	}

	st := deps.stateMgr.GetState()
	p := findPokemon(st, "p1")
	if p.DetectorConfig.Templates[0].Name != "New Name" {
		t.Errorf("name = %q, want 'New Name'", p.DetectorConfig.Templates[0].Name)
	}
}

// --- Template PATCH enabling single-active -----------------------------------

func TestTemplatePatchEnableSingleActive(t *testing.T) {
	mux, deps := newTestMux(t)
	tr := true
	addTestPokemonWithConfig(t, deps, "p1", "Pikachu", &state.DetectorConfig{
		Templates: []state.DetectorTemplate{
			{TemplateDBID: 1, Enabled: &tr},
			{TemplateDBID: 2, Enabled: &tr},
		},
	})

	// Enable template 1 (index 1) — should disable template 0
	body := jsonBody(t, map[string]any{"enabled": true})
	req := httptest.NewRequest(http.MethodPatch, "/api/detector/p1/template/1", body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200, w.Code)
	}

	st := deps.stateMgr.GetState()
	p := findPokemon(st, "p1")
	if p.DetectorConfig.Templates[0].Enabled == nil || *p.DetectorConfig.Templates[0].Enabled {
		t.Error("expected template 0 to be disabled after enabling template 1")
	}
	if p.DetectorConfig.Templates[1].Enabled == nil || !*p.DetectorConfig.Templates[1].Enabled {
		t.Error("expected template 1 to be enabled")
	}
}

// --- Template Upload with name -----------------------------------------------

func TestTemplateUploadWithName(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	pngData := makePNGBytes(t)
	b64 := base64.StdEncoding.EncodeToString(pngData)
	body := jsonBody(t, map[string]any{
		"imageBase64": b64,
		"regions":     []state.MatchedRegion{{Type: "image"}},
		"name":        "Custom Name",
	})

	req := httptest.NewRequest(http.MethodPost, pathTemplateUpload, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200Body, w.Code, w.Body.String())
	}

	st := deps.stateMgr.GetState()
	p := findPokemon(st, "p1")
	if p.DetectorConfig.Templates[0].Name != "Custom Name" {
		t.Errorf("name = %q, want 'Custom Name'", p.DetectorConfig.Templates[0].Name)
	}
}

// --- filterSourceTemplates ---------------------------------------------------

func TestFilterSourceTemplatesAll(t *testing.T) {
	templates := []state.DetectorTemplate{
		{Name: "A"},
		{Name: "B"},
		{Name: "C"},
	}
	result := filterSourceTemplates(templates, nil)
	if len(result) != 3 {
		t.Errorf("len = %d, want 3 (empty indices returns all)", len(result))
	}
}

func TestFilterSourceTemplatesSubset(t *testing.T) {
	templates := []state.DetectorTemplate{
		{Name: "A"},
		{Name: "B"},
		{Name: "C"},
	}
	result := filterSourceTemplates(templates, []int{0, 2})
	if len(result) != 2 {
		t.Fatalf("len = %d, want 2", len(result))
	}
	if result[0].Name != "A" {
		t.Errorf("result[0].Name = %q, want A", result[0].Name)
	}
	if result[1].Name != "C" {
		t.Errorf("result[1].Name = %q, want C", result[1].Name)
	}
}

func TestFilterSourceTemplatesOutOfRange(t *testing.T) {
	templates := []state.DetectorTemplate{
		{Name: "A"},
	}
	result := filterSourceTemplates(templates, []int{-1, 5, 100})
	if len(result) != 0 {
		t.Errorf("len = %d, want 0 (all indices out of range)", len(result))
	}
}

// --- activateFirstTemplate ---------------------------------------------------

func TestActivateFirstTemplateEmpty(t *testing.T) {
	// Should not panic on empty slice
	activateFirstTemplate(nil)
	activateFirstTemplate([]state.DetectorTemplate{})
}

func TestActivateFirstTemplateMultiple(t *testing.T) {
	templates := []state.DetectorTemplate{
		{Name: "A"},
		{Name: "B"},
		{Name: "C"},
	}
	activateFirstTemplate(templates)

	if templates[0].Enabled == nil || !*templates[0].Enabled {
		t.Error("expected first template to be enabled")
	}
	for i := 1; i < len(templates); i++ {
		if templates[i].Enabled == nil || *templates[i].Enabled {
			t.Errorf("expected template %d to be disabled", i)
		}
	}
}

// --- Template Delete with filesystem path ------------------------------------

func TestTemplateDeleteWithImagePath(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemonWithConfig(t, deps, "p1", "Pikachu", &state.DetectorConfig{
		Templates: []state.DetectorTemplate{
			{ImagePath: "template_0.png", Regions: []state.MatchedRegion{{Type: "image"}}},
		},
	})

	req := httptest.NewRequest(http.MethodDelete, pathTemplate0, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200, w.Code)
	}

	st := deps.stateMgr.GetState()
	p := findPokemon(st, "p1")
	if p.DetectorConfig != nil && len(p.DetectorConfig.Templates) != 0 {
		t.Errorf(wantZeroTemplatesFmt, len(p.DetectorConfig.Templates))
	}
}
