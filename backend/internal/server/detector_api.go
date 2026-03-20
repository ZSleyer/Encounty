// detector_api.go — HTTP handlers for the /api/detector/* endpoint group.
// These handlers manage per-hunt auto-detection configuration, template capture,
// and start/stop control for the detector goroutine manager.
package server

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"encoding/base64"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/kbinani/screenshot"
	"github.com/zsleyer/encounty/backend/internal/detector"
	"github.com/zsleyer/encounty/backend/internal/state"
	"golang.org/x/image/draw"
)

// handleDetectorScreenshot captures the primary monitor, downscales to a max
// width of 1920 px, and returns the result as a JPEG image.
// GET /api/detector/screenshot
//
// @Summary      Capture primary monitor screenshot
// @Tags         detector
// @Produce      jpeg
// @Success      200 {file} binary
// @Failure      500 {object} errResp
// @Router       /detector/screenshot [get]
func (s *Server) handleDetectorScreenshot(w http.ResponseWriter, r *http.Request) {
	bounds := screenshot.GetDisplayBounds(0)
	img, err := screenshot.CaptureRect(bounds)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
		return
	}

	out := downscaleImage(img, 1920)

	w.Header().Set("Content-Type", "image/jpeg")
	if err := jpeg.Encode(w, out, &jpeg.Options{Quality: 75}); err != nil {
		// Headers already sent; nothing useful to do.
		return
	}
}

// detectorStatusEntry reports whether a single detector is running.
type detectorStatusEntry struct {
	PokemonID string `json:"pokemon_id"`
	Running   bool   `json:"running"`
}

// handleDetectorStatus returns a JSON array of all running detector IDs.
// GET /api/detector/status
//
// @Summary      List running detector IDs
// @Tags         detector
// @Produce      json
// @Success      200 {array} detectorStatusEntry
// @Router       /detector/status [get]
func (s *Server) handleDetectorStatus(w http.ResponseWriter, r *http.Request) {
	entries := []detectorStatusEntry{}
	if s.detectorMgr != nil {
		for _, id := range s.detectorMgr.RunningIDs() {
			entries = append(entries, detectorStatusEntry{PokemonID: id, Running: true})
		}
	}
	writeJSON(w, http.StatusOK, entries)
}

// handleListWindows returns a JSON array of visible top-level windows.
// GET /api/detector/windows
//
// @Summary      List visible top-level windows
// @Tags         detector
// @Produce      json
// @Success      200 {array} object
// @Router       /detector/windows [get]
func (s *Server) handleListWindows(w http.ResponseWriter, _ *http.Request) {
	windows := detector.ListWindows()
	if windows == nil {
		windows = []detector.WindowInfo{}
	}
	writeJSON(w, http.StatusOK, windows)
}

// handleListCameras returns a JSON array of available V4L2 video capture devices.
// GET /api/detector/cameras
//
// @Summary      List available video capture devices
// @Tags         detector
// @Produce      json
// @Success      200 {array} detector.CameraInfo
// @Router       /detector/cameras [get]
func (s *Server) handleListCameras(w http.ResponseWriter, _ *http.Request) {
	cameras := detector.ListCameras()
	if cameras == nil {
		cameras = []detector.CameraInfo{}
	}
	writeJSON(w, http.StatusOK, cameras)
}

// handleDetectorDispatch parses the path and dispatches to the appropriate
// per-Pokémon sub-handler. Expected path shapes:
//
//	/api/detector/{id}/config
//	/api/detector/{id}/template/{n}
//	/api/detector/{id}/template_upload
//	/api/detector/{id}/sprite_template
//	/api/detector/{id}/start
//	/api/detector/{id}/stop
//	/api/detector/{id}/match_frame
func (s *Server) handleDetectorDispatch(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/detector/")
	parts := strings.SplitN(rest, "/", 3)

	if len(parts) < 2 {
		w.WriteHeader(http.StatusNotFound)
		return
	}

	id := parts[0]
	action := parts[1]

	switch action {
	case "config":
		s.handleDetectorConfig(w, r, id)
	case "template":
		if len(parts) == 3 {
			s.handleDetectorTemplateN(w, r, id, parts[2])
		} else {
			w.WriteHeader(http.StatusNotFound)
		}
	case "template_upload":
		s.handleDetectorTemplateUpload(w, r, id)
	case "sprite_template":
		s.handleDetectorSpriteTemplate(w, r, id)
	case "start":
		s.handleDetectorStart(w, r, id)
	case "stop":
		s.handleDetectorStop(w, r, id)
	case "match_frame":
		s.handleMatchFrame(w, r, id)
	case "export_templates":
		s.handleExportTemplates(w, r, id)
	case "import_templates_file":
		s.handleImportTemplatesFile(w, r, id)
	case "import_templates":
		s.handleImportTemplates(w, r, id)
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

// handleDetectorConfig reads or replaces the DetectorConfig for a single hunt.
// GET  /api/detector/{id}/config — returns the current config (empty struct if nil).
// POST /api/detector/{id}/config — replaces the config with the request body.
//
// @Summary      Get or set detector config for a Pokemon
// @Tags         detector
// @Accept       json
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Success      200 {object} state.DetectorConfig
// @Failure      400 {object} errResp
// @Failure      404 {object} errResp
// @Router       /detector/{id}/config [get]
// @Router       /detector/{id}/config [post]
func (s *Server) handleDetectorConfig(w http.ResponseWriter, r *http.Request, id string) {
	st := s.state.GetState()
	pokemon := findPokemon(st, id)
	if pokemon == nil {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}

	switch r.Method {
	case http.MethodGet:
		cfg := state.DetectorConfig{}
		if pokemon.DetectorConfig != nil {
			cfg = *pokemon.DetectorConfig
		}
		writeJSON(w, http.StatusOK, cfg)

	case http.MethodPost:
		var cfg state.DetectorConfig
		if err := readJSON(r, &cfg); err != nil {
			writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
			return
		}
		if !s.state.SetDetectorConfig(id, &cfg) {
			writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
			return
		}
		s.state.ScheduleSave()
		s.broadcastState()
		writeJSON(w, http.StatusOK, OKResponse{OK: true})

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// handleDetectorTemplateN serves a template image (GET), deletes it (DELETE),
// or updates its regions (PATCH).
// GET    /api/detector/{id}/template/{n}
// DELETE /api/detector/{id}/template/{n}
// PATCH  /api/detector/{id}/template/{n}
//
// @Summary      Get, delete or update a detector template
// @Tags         detector
// @Param        id path string true "Pokemon ID"
// @Param        n path int true "Template index"
// @Success      200 {file} binary
// @Failure      400 {object} errResp
// @Failure      404 {object} errResp
// @Router       /detector/{id}/template/{n} [get]
// @Router       /detector/{id}/template/{n} [delete]
// @Router       /detector/{id}/template/{n} [patch]
func (s *Server) handleDetectorTemplateN(w http.ResponseWriter, r *http.Request, id, nStr string) {
	switch r.Method {
	case http.MethodGet, http.MethodDelete, http.MethodPatch:
		// handled below
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	n, err := strconv.Atoi(nStr)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{"invalid template index"})
		return
	}

	st := s.state.GetState()
	pokemon := findPokemon(st, id)
	if pokemon == nil || pokemon.DetectorConfig == nil {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}

	cfg := *pokemon.DetectorConfig
	if n < 0 || n >= len(cfg.Templates) {
		writeJSON(w, http.StatusNotFound, errResp{"template index out of range"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		s.handleTemplateGet(w, r, id, cfg.Templates[n])
	case http.MethodDelete:
		s.handleTemplateDelete(w, id, n, cfg)
	case http.MethodPatch:
		s.handleTemplatePatch(w, r, id, n, pokemon)
	}
}

// handleTemplateGet serves a single template image from the DB or filesystem.
func (s *Server) handleTemplateGet(w http.ResponseWriter, r *http.Request, id string, tmpl state.DetectorTemplate) {
	w.Header().Set("Cache-Control", "no-cache")
	if tmpl.TemplateDBID > 0 && s.db != nil {
		data, err := s.db.LoadTemplateImage(tmpl.TemplateDBID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		_, _ = w.Write(data)
	} else if tmpl.ImagePath != "" {
		absPath := filepath.Join(s.state.GetConfigDir(), "templates", id, tmpl.ImagePath)
		http.ServeFile(w, r, absPath)
	} else {
		writeJSON(w, http.StatusNotFound, errResp{"no image data available"})
	}
}

// handleTemplateDelete removes a template from storage and the config.
func (s *Server) handleTemplateDelete(w http.ResponseWriter, id string, n int, cfg state.DetectorConfig) {
	tmpl := cfg.Templates[n]
	if tmpl.TemplateDBID > 0 && s.db != nil {
		_ = s.db.DeleteTemplateImage(tmpl.TemplateDBID)
	} else if tmpl.ImagePath != "" {
		absPath := filepath.Join(s.state.GetConfigDir(), "templates", id, tmpl.ImagePath)
		_ = os.Remove(absPath)
	}
	cfg.Templates = append(cfg.Templates[:n], cfg.Templates[n+1:]...)
	s.state.SetDetectorConfig(id, &cfg)
	s.state.ScheduleSave()
	s.broadcastState()
	writeJSON(w, http.StatusOK, OKResponse{OK: true})
}

// handleTemplatePatch updates the regions and/or enabled flag for an existing template.
func (s *Server) handleTemplatePatch(w http.ResponseWriter, r *http.Request, id string, n int, pokemon *state.Pokemon) {
	type patchBody struct {
		Regions []state.MatchedRegion `json:"regions,omitempty"`
		Enabled *bool                 `json:"enabled,omitempty"`
	}
	var body patchBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{"invalid json body"})
		return
	}
	cfg2 := state.DetectorConfig{}
	if pokemon.DetectorConfig != nil {
		cfg2 = *pokemon.DetectorConfig
	}
	if n >= len(cfg2.Templates) {
		writeJSON(w, http.StatusBadRequest, errResp{"template index out of range"})
		return
	}
	if body.Regions != nil {
		cfg2.Templates[n].Regions = body.Regions
	}
	if body.Enabled != nil {
		cfg2.Templates[n].Enabled = body.Enabled
	}
	s.state.SetDetectorConfig(id, &cfg2)
	s.state.ScheduleSave()
	s.broadcastState()
	writeJSON(w, http.StatusOK, OKResponse{OK: true})
}

// handleDetectorTemplateUpload saves a new PNG template from an uploaded JPEG (Browser Source)
// POST /api/detector/{id}/template_upload
//
// @Summary      Upload a new template image
// @Tags         detector
// @Accept       json
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Param        body body TemplateUploadRequest true "Base64 image and regions"
// @Success      200 {object} TemplateUploadResponse
// @Failure      400 {object} errResp
// @Failure      404 {object} errResp
// @Failure      500 {object} errResp
// @Router       /detector/{id}/template_upload [post]
func (s *Server) handleDetectorTemplateUpload(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	st := s.state.GetState()
	pokemon := findPokemon(st, id)
	if pokemon == nil {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}

	cfg := state.DetectorConfig{}
	if pokemon.DetectorConfig != nil {
		cfg = *pokemon.DetectorConfig
	}

	pngBytes, regions, err := parseTemplateUpload(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}

	// Ensure the detector_configs row exists in the DB before inserting the
	// template image, because detector_templates.pokemon_id has a FK →
	// detector_configs.pokemon_id. Must use Save() (not ScheduleSave) so
	// the row is written synchronously before the INSERT below.
	s.state.SetDetectorConfig(id, &cfg)
	if err := s.state.Save(); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
		return
	}

	tmpl := state.DetectorTemplate{Regions: regions}
	sortOrder := len(cfg.Templates)
	if err := s.storeTemplateImage(id, pngBytes, sortOrder, &tmpl); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
		return
	}

	cfg.Templates = append(cfg.Templates, tmpl)
	s.state.SetDetectorConfig(id, &cfg)
	s.state.ScheduleSave()
	s.broadcastState()

	writeJSON(w, http.StatusOK, TemplateUploadResponse{Index: sortOrder, TemplateDBID: tmpl.TemplateDBID})
}

// parseTemplateUpload reads and validates the base64-encoded image from the
// request body, returning the re-encoded PNG bytes and regions.
func parseTemplateUpload(r *http.Request) ([]byte, []state.MatchedRegion, error) {
	type templateUploadRequest struct {
		ImageBase64 string                `json:"imageBase64"`
		Regions     []state.MatchedRegion `json:"regions"`
	}

	r.Body = http.MaxBytesReader(nil, r.Body, 20<<20)
	var req templateUploadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return nil, nil, fmt.Errorf("failed to parse json body")
	}

	b64data := req.ImageBase64
	if idx := strings.Index(b64data, ","); idx != -1 {
		b64data = b64data[idx+1:]
	}
	imgData, err := base64.StdEncoding.DecodeString(b64data)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid base64 image data")
	}

	img, _, err := image.Decode(bytes.NewReader(imgData))
	if err != nil {
		return nil, nil, fmt.Errorf("invalid image format: %v", err)
	}

	pngBytes, err := encodePNG(img)
	if err != nil {
		return nil, nil, err
	}
	return pngBytes, req.Regions, nil
}

// encodePNG encodes an image to PNG and returns the bytes.
func encodePNG(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// storeTemplateImage persists PNG bytes to the DB or filesystem and populates
// the template's TemplateDBID or ImagePath accordingly.
func (s *Server) storeTemplateImage(pokemonID string, pngBytes []byte, sortOrder int, tmpl *state.DetectorTemplate) error {
	if s.db != nil {
		dbID, err := s.db.SaveTemplateImage(pokemonID, pngBytes, sortOrder)
		if err != nil {
			return err
		}
		tmpl.TemplateDBID = dbID
		return nil
	}
	templatesDir := filepath.Join(s.state.GetConfigDir(), "templates", pokemonID)
	if err := os.MkdirAll(templatesDir, 0755); err != nil {
		return err
	}
	n := 0
	for {
		candidate := filepath.Join(templatesDir, fmt.Sprintf(templateFileFmt, n))
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			break
		}
		n++
	}
	relPath := fmt.Sprintf(templateFileFmt, n)
	absPath := filepath.Join(templatesDir, relPath)
	if err := os.WriteFile(absPath, pngBytes, 0644); err != nil {
		return err
	}
	tmpl.ImagePath = relPath
	return nil
}

// handleDetectorSpriteTemplate fetches the Pokémon's current sprite URL,
// decodes it (handling animated GIFs by taking the first frame), saves it as
// a PNG template, and appends it to the DetectorConfig.
// POST /api/detector/{id}/sprite_template
//
// @Summary      Create template from Pokemon sprite
// @Tags         detector
// @Accept       json
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Param        body body SpriteTemplateRequest false "Optional sprite URL override"
// @Success      200 {object} TemplateUploadResponse
// @Failure      400 {object} errResp
// @Failure      404 {object} errResp
// @Failure      500 {object} errResp
// @Router       /detector/{id}/sprite_template [post]
func (s *Server) handleDetectorSpriteTemplate(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	st := s.state.GetState()
	pokemon := findPokemon(st, id)
	if pokemon == nil {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}

	spriteURL := resolveSpriteURL(pokemon, r)
	if spriteURL == "" {
		writeJSON(w, http.StatusBadRequest, errResp{"pokemon has no sprite_url"})
		return
	}

	img, err := fetchSpriteImage(spriteURL)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, errResp{err.Error()})
		return
	}

	cfg := state.DetectorConfig{}
	if pokemon.DetectorConfig != nil {
		cfg = *pokemon.DetectorConfig
	}

	pngBytes, err := encodePNG(img)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
		return
	}

	// Ensure the detector_configs row exists in the DB before inserting the
	// template image (FK constraint). Must use Save() synchronously.
	s.state.SetDetectorConfig(id, &cfg)
	if err := s.state.Save(); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
		return
	}

	b := img.Bounds()
	sortOrder := len(cfg.Templates)
	tmpl := state.DetectorTemplate{
		Regions: []state.MatchedRegion{
			{Type: "image", Rect: state.DetectorRect{X: 0, Y: 0, W: b.Dx(), H: b.Dy()}},
		},
	}

	if err := s.storeTemplateImage(id, pngBytes, sortOrder, &tmpl); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
		return
	}

	cfg.Templates = append(cfg.Templates, tmpl)
	s.state.SetDetectorConfig(id, &cfg)
	s.state.ScheduleSave()
	s.broadcastState()

	writeJSON(w, http.StatusOK, TemplateUploadResponse{Index: sortOrder, TemplateDBID: tmpl.TemplateDBID})
}

// resolveSpriteURL returns the sprite URL from the request body override
// or falls back to the Pokémon's stored SpriteURL.
func resolveSpriteURL(pokemon *state.Pokemon, r *http.Request) string {
	spriteURL := pokemon.SpriteURL
	if r.Body != nil {
		var body struct {
			SpriteURL string `json:"sprite_url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err == nil && body.SpriteURL != "" {
			spriteURL = body.SpriteURL
		}
	}
	return spriteURL
}

// fetchSpriteImage downloads and decodes a sprite from the given URL.
func fetchSpriteImage(spriteURL string) (image.Image, error) {
	resp, err := http.Get(spriteURL) //nolint:noctx
	if err != nil {
		return nil, fmt.Errorf("failed to fetch sprite: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	img, _, err := image.Decode(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to decode sprite: %v", err)
	}
	return img, nil
}

// handleDetectorStart starts the detection goroutine for a single hunt.
// POST /api/detector/{id}/start
//
// @Summary      Start detection for a Pokemon
// @Tags         detector
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Success      200 {object} DetectorRunResponse
// @Failure      400 {object} errResp
// @Failure      404 {object} errResp
// @Failure      500 {object} errResp
// @Router       /detector/{id}/start [post]
func (s *Server) handleDetectorStart(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	st := s.state.GetState()
	pokemon := findPokemon(st, id)
	if pokemon == nil {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	if pokemon.DetectorConfig == nil {
		writeJSON(w, http.StatusBadRequest, errResp{"no detector config"})
		return
	}
	if len(pokemon.DetectorConfig.Templates) == 0 {
		writeJSON(w, http.StatusBadRequest, errResp{"no templates configured"})
		return
	}

	cfg := *pokemon.DetectorConfig
	s.hydrateTemplates(&cfg)

	if s.detectorMgr != nil {
		if err := s.launchDetector(id, cfg); err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
			return
		}
	}

	cfg.Enabled = true
	s.state.SetDetectorConfig(id, &cfg)
	s.state.ScheduleSave()
	s.broadcastState()

	writeJSON(w, http.StatusOK, DetectorRunResponse{OK: true, Running: true})
}

// hydrateTemplates loads image BLOBs from the DB for templates that have a
// TemplateDBID but no in-memory ImageData.
func (s *Server) hydrateTemplates(cfg *state.DetectorConfig) {
	if s.db == nil {
		return
	}
	for i := range cfg.Templates {
		if cfg.Templates[i].TemplateDBID > 0 && len(cfg.Templates[i].ImageData) == 0 {
			data, err := s.db.LoadTemplateImage(cfg.Templates[i].TemplateDBID)
			if err != nil {
				slog.Warn("Failed to load template BLOB from DB",
					"template_db_id", cfg.Templates[i].TemplateDBID, "error", err)
				continue
			}
			cfg.Templates[i].ImageData = data
		}
	}
}

// launchDetector starts a browser or native detector depending on the source type.
// Browser sources use BrowserDetector (frames submitted via /match_frame);
// screen_region, window, and camera sources use the goroutine-based Detector.
func (s *Server) launchDetector(id string, cfg state.DetectorConfig) error {
	isBrowser := cfg.SourceType == "browser_camera" || cfg.SourceType == "browser_display"
	if isBrowser {
		s.detectorMgr.GetOrCreateBrowserDetector(id, cfg)
		s.hub.BroadcastRaw("detector_status", map[string]any{
			"pokemon_id": id,
			"state":      "idle",
			"confidence": 0,
			"poll_ms":    0,
		})
		return nil
	}
	return s.detectorMgr.Start(id, cfg)
}

// handleDetectorStop stops the detection goroutine for a single hunt.
// POST /api/detector/{id}/stop
//
// @Summary      Stop detection for a Pokemon
// @Tags         detector
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Success      200 {object} DetectorRunResponse
// @Router       /detector/{id}/stop [post]
func (s *Server) handleDetectorStop(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	if s.detectorMgr != nil {
		s.detectorMgr.Stop(id)
	}

	st := s.state.GetState()
	pokemon := findPokemon(st, id)
	if pokemon != nil && pokemon.DetectorConfig != nil {
		cfg := *pokemon.DetectorConfig
		cfg.Enabled = false
		s.state.SetDetectorConfig(id, &cfg)
		s.state.ScheduleSave()
		s.broadcastState()
	}

	writeJSON(w, http.StatusOK, DetectorRunResponse{OK: true, Running: false})
}

// findPokemon returns a pointer to the Pokémon with the given id within st,
// or nil if no such Pokémon exists. The returned pointer references a copy
// from the state snapshot and is safe to read without additional locking.
func findPokemon(st state.AppState, id string) *state.Pokemon {
	for i := range st.Pokemon {
		if st.Pokemon[i].ID == id {
			return &st.Pokemon[i]
		}
	}
	return nil
}

// downscaleImage resizes img so that its width does not exceed maxWidth,
// preserving the aspect ratio. If img is already narrower, it is returned as-is.
func downscaleImage(img image.Image, maxWidth int) image.Image {
	bounds := img.Bounds()
	w := bounds.Dx()
	h := bounds.Dy()

	if w <= maxWidth {
		return img
	}

	newH := h * maxWidth / w
	dst := image.NewRGBA(image.Rect(0, 0, maxWidth, newH))
	draw.BiLinear.Scale(dst, dst.Bounds(), img, bounds, draw.Over, nil)
	return dst
}

// handleMatchFrame accepts a browser-captured JPEG frame (via POST body), runs
// NCC matching against the Pokémon's templates, advances the state machine, and
// broadcasts detector_status. On a confirmed match it also calls Increment and
// AppendDetectionLog. Requires a BrowserDetector (browser_camera or
// browser_display source types) — returns 400 if no templates are loaded.
// POST /api/detector/{id}/match_frame
//
// @Summary      Submit a browser-captured frame for matching
// @Tags         detector
// @Accept       image/jpeg
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Success      200 {object} MatchFrameResponse
// @Failure      400 {object} errResp
// @Failure      404 {object} errResp
// @Router       /detector/{id}/match_frame [post]
func (s *Server) handleMatchFrame(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	st := s.state.GetState()
	pokemon := findPokemon(st, id)
	if pokemon == nil {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	if pokemon.DetectorConfig == nil || len(pokemon.DetectorConfig.Templates) == 0 {
		writeJSON(w, http.StatusBadRequest, errResp{"no templates configured"})
		return
	}

	frame, err := readFrameFromBody(r, w)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}

	detCfg := *pokemon.DetectorConfig
	s.hydrateTemplates(&detCfg)

	bd := s.detectorMgr.GetOrCreateBrowserDetector(id, detCfg)
	if !bd.HasTemplates() {
		bd = s.detectorMgr.ResetBrowserDetector(id, detCfg)
	}

	result := bd.SubmitFrame(frame)

	if result.Confidence > 0.1 {
		slog.Debug("match_frame result",
			"pokemon", pokemon.Name, "id", id,
			"state", result.State, "confidence", result.Confidence,
			"incremented", result.Incremented)
	}

	s.hub.BroadcastRaw("detector_status", map[string]any{
		"pokemon_id": id,
		"state":      result.State,
		"confidence": result.Confidence,
		"poll_ms":    0,
	})

	if result.Incremented {
		s.handleMatchIncrement(id, pokemon.Name, result.Confidence)
	}

	writeJSON(w, http.StatusOK, MatchFrameResponse{
		Match:      result.Incremented,
		State:      result.State,
		Confidence: result.Confidence,
	})
}

// readFrameFromBody reads and decodes a JPEG frame from the request body.
func readFrameFromBody(r *http.Request, w http.ResponseWriter) (image.Image, error) {
	const maxBodyBytes = 20 << 20
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, fmt.Errorf("read body: %s", err.Error())
	}
	frame, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("decode jpeg: %s", err.Error())
	}
	return frame, nil
}

// handleMatchIncrement processes a confirmed detector match by incrementing
// the counter, logging the detection, and broadcasting updates.
func (s *Server) handleMatchIncrement(id, pokemonName string, confidence float64) {
	slog.Info("Detector match confirmed",
		"pokemon", pokemonName, "id", id,
		"confidence", confidence)
	s.state.Increment(id)
	s.state.AppendDetectionLog(id, confidence)
	s.hub.BroadcastRaw("detector_match", map[string]any{
		"pokemon_id": id,
		"confidence": confidence,
	})
	s.broadcastState()
}

// handleImportTemplates copies all templates from a source Pokemon to the target.
// POST /api/detector/{id}/import_templates
//
// @Summary      Import templates from another Pokemon
// @Tags         detector
// @Accept       json
// @Produce      json
// @Param        id path string true "Target Pokemon ID"
// @Param        body body ImportTemplatesRequest true "Source Pokemon ID"
// @Success      200 {object} ImportResponse
// @Failure      400 {object} errResp
// @Failure      404 {object} errResp
// @Router       /detector/{id}/import_templates [post]
func (s *Server) handleImportTemplates(w http.ResponseWriter, r *http.Request, targetID string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var body ImportTemplatesRequest
	if err := readJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}

	st := s.state.GetState()
	target := findPokemon(st, targetID)
	if target == nil {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	source := findPokemon(st, body.SourcePokemonID)
	if source == nil || source.DetectorConfig == nil || len(source.DetectorConfig.Templates) == 0 {
		writeJSON(w, http.StatusBadRequest, errResp{"source has no templates"})
		return
	}

	targetCfg := state.DetectorConfig{}
	if target.DetectorConfig != nil {
		targetCfg = *target.DetectorConfig
	}

	// Ensure the detector_configs row exists for the target (FK constraint)
	s.state.SetDetectorConfig(targetID, &targetCfg)
	if err := s.state.Save(); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
		return
	}

	imported := 0
	for _, srcTmpl := range source.DetectorConfig.Templates {
		// Load image data from DB
		if srcTmpl.TemplateDBID <= 0 || s.db == nil {
			continue
		}
		imgData, err := s.db.LoadTemplateImage(srcTmpl.TemplateDBID)
		if err != nil {
			continue
		}

		sortOrder := len(targetCfg.Templates)
		newTmpl := state.DetectorTemplate{
			Regions: make([]state.MatchedRegion, len(srcTmpl.Regions)),
			Enabled: srcTmpl.Enabled,
		}
		copy(newTmpl.Regions, srcTmpl.Regions)

		if err := s.storeTemplateImage(targetID, imgData, sortOrder, &newTmpl); err != nil {
			continue
		}
		targetCfg.Templates = append(targetCfg.Templates, newTmpl)
		imported++
	}

	s.state.SetDetectorConfig(targetID, &targetCfg)
	s.state.ScheduleSave()
	s.broadcastState()

	writeJSON(w, http.StatusOK, ImportResponse{Imported: imported})
}

// handleExportTemplates streams a ZIP file of all templates for a Pokemon.
// GET /api/detector/{id}/export_templates
//
// @Summary      Export templates as ZIP
// @Tags         detector
// @Produce      application/zip
// @Param        id path string true "Pokemon ID"
// @Success      200 {file} binary
// @Failure      404 {object} errResp
// @Router       /detector/{id}/export_templates [get]
func (s *Server) handleExportTemplates(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	st := s.state.GetState()
	pokemon := findPokemon(st, id)
	if pokemon == nil || pokemon.DetectorConfig == nil {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}

	type exportMeta struct {
		Filename string                `json:"filename"`
		Regions  []state.MatchedRegion `json:"regions"`
		Enabled  *bool                 `json:"enabled,omitempty"`
	}

	var metadata []exportMeta
	var pngDataList [][]byte

	for i, tmpl := range pokemon.DetectorConfig.Templates {
		if tmpl.TemplateDBID <= 0 || s.db == nil {
			continue
		}
		data, err := s.db.LoadTemplateImage(tmpl.TemplateDBID)
		if err != nil {
			continue
		}
		filename := fmt.Sprintf("template_%d.png", i)
		metadata = append(metadata, exportMeta{
			Filename: filename,
			Regions:  tmpl.Regions,
			Enabled:  tmpl.Enabled,
		})
		pngDataList = append(pngDataList, data)
	}

	safeName := strings.ReplaceAll(pokemon.Name, " ", "_")
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="templates-%s.encounty-templates"`, safeName))

	zw := zip.NewWriter(w)
	defer func() { _ = zw.Close() }()

	// Write metadata.json
	metaJSON, _ := json.Marshal(metadata)
	if fw, err := zw.Create("metadata.json"); err == nil {
		_, _ = fw.Write(metaJSON)
	}

	// Write PNG files
	for i, data := range pngDataList {
		filename := fmt.Sprintf("template_%d.png", i)
		if fw, err := zw.Create(filename); err == nil {
			_, _ = fw.Write(data)
		}
	}
}

// templateImportMeta describes one template entry in an export ZIP's metadata.json.
type templateImportMeta struct {
	Filename string                `json:"filename"`
	Regions  []state.MatchedRegion `json:"regions"`
	Enabled  *bool                 `json:"enabled,omitempty"`
}

// handleImportTemplatesFile imports templates from an uploaded ZIP file.
// POST /api/detector/{id}/import_templates_file
//
// @Summary      Import templates from uploaded ZIP
// @Tags         detector
// @Accept       multipart/form-data
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Param        file formData file true "Template ZIP file"
// @Success      200 {object} ImportResponse
// @Failure      400 {object} errResp
// @Failure      404 {object} errResp
// @Router       /detector/{id}/import_templates_file [post]
func (s *Server) handleImportTemplatesFile(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	zr, err := readZipFromMultipart(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}

	metadata, err := readTemplateMetadata(zr)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}

	pngMap := collectZipPNGs(zr)

	st := s.state.GetState()
	pokemon := findPokemon(st, id)
	if pokemon == nil {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}

	targetCfg := state.DetectorConfig{}
	if pokemon.DetectorConfig != nil {
		targetCfg = *pokemon.DetectorConfig
	}

	s.state.SetDetectorConfig(id, &targetCfg)
	if err := s.state.Save(); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
		return
	}

	imported := s.importTemplatesFromMeta(id, metadata, pngMap, &targetCfg)

	s.state.SetDetectorConfig(id, &targetCfg)
	s.state.ScheduleSave()
	s.broadcastState()

	writeJSON(w, http.StatusOK, ImportResponse{Imported: imported})
}

// readZipFromMultipart reads and parses a ZIP file from a multipart form upload.
func readZipFromMultipart(r *http.Request) (*zip.Reader, error) {
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		return nil, fmt.Errorf("failed to parse form")
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		return nil, fmt.Errorf("no file provided")
	}
	defer func() { _ = file.Close() }()

	data, err := io.ReadAll(file)
	if err != nil {
		return nil, fmt.Errorf("failed to read file")
	}
	return zip.NewReader(bytes.NewReader(data), int64(len(data)))
}

// readTemplateMetadata extracts and parses metadata.json from a ZIP archive.
func readTemplateMetadata(zr *zip.Reader) ([]templateImportMeta, error) {
	for _, f := range zr.File {
		if f.Name != "metadata.json" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("cannot read metadata")
		}
		metaBytes, _ := io.ReadAll(rc)
		_ = rc.Close()
		var metadata []templateImportMeta
		if err := json.Unmarshal(metaBytes, &metadata); err != nil {
			return nil, fmt.Errorf("invalid metadata.json")
		}
		if len(metadata) == 0 {
			return nil, fmt.Errorf("no templates in file")
		}
		return metadata, nil
	}
	return nil, fmt.Errorf("no templates in file")
}

// collectZipPNGs reads all PNG files from a ZIP archive into a filename→data map.
func collectZipPNGs(zr *zip.Reader) map[string][]byte {
	pngMap := map[string][]byte{}
	for _, f := range zr.File {
		if !strings.HasSuffix(f.Name, ".png") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		imgData, _ := io.ReadAll(rc)
		_ = rc.Close()
		pngMap[f.Name] = imgData
	}
	return pngMap
}

// importTemplatesFromMeta stores templates described by metadata entries,
// looking up their PNG data in pngMap. Returns the count of templates imported.
func (s *Server) importTemplatesFromMeta(pokemonID string, metadata []templateImportMeta, pngMap map[string][]byte, targetCfg *state.DetectorConfig) int {
	imported := 0
	for _, meta := range metadata {
		pngBytes := pngMap[meta.Filename]
		if len(pngBytes) == 0 {
			continue
		}
		if _, _, err := image.Decode(bytes.NewReader(pngBytes)); err != nil {
			continue
		}
		sortOrder := len(targetCfg.Templates)
		newTmpl := state.DetectorTemplate{Regions: meta.Regions, Enabled: meta.Enabled}
		if err := s.storeTemplateImage(pokemonID, pngBytes, sortOrder, &newTmpl); err != nil {
			continue
		}
		targetCfg.Templates = append(targetCfg.Templates, newTmpl)
		imported++
	}
	return imported
}

// handleDetectorCapabilities returns platform-specific capture capabilities.
// GET /api/detector/capabilities
//
// @Summary      Get platform capture capabilities
// @Tags         detector
// @Produce      json
// @Success      200 {object} detector.Capabilities
// @Router       /detector/capabilities [get]
func (s *Server) handleDetectorCapabilities(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, detector.GetCapabilities())
}
