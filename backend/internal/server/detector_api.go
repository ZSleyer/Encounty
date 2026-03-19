// detector_api.go — HTTP handlers for the /api/detector/* endpoint group.
// These handlers manage per-hunt auto-detection configuration, template capture,
// and start/stop control for the detector goroutine manager.
package server

import (
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
	"github.com/zsleyer/encounty/backend/internal/state"
	"golang.org/x/image/draw"
)

// handleDetectorScreenshot captures the primary monitor, downscales to a max
// width of 1920 px, and returns the result as a JPEG image.
// GET /api/detector/screenshot
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
func (s *Server) handleDetectorStatus(w http.ResponseWriter, r *http.Request) {
	entries := []detectorStatusEntry{}
	if s.detectorMgr != nil {
		for _, id := range s.detectorMgr.RunningIDs() {
			entries = append(entries, detectorStatusEntry{PokemonID: id, Running: true})
		}
	}
	writeJSON(w, http.StatusOK, entries)
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
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

// handleDetectorConfig reads or replaces the DetectorConfig for a single hunt.
// GET  /api/detector/{id}/config — returns the current config (empty struct if nil).
// POST /api/detector/{id}/config — replaces the config with the request body.
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
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// handleDetectorTemplateN serves a template image (GET), deletes it (DELETE),
// or updates its regions (PATCH).
// GET    /api/detector/{id}/template/{n}
// DELETE /api/detector/{id}/template/{n}
// PATCH  /api/detector/{id}/template/{n}
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
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleTemplatePatch updates the regions for an existing template.
func (s *Server) handleTemplatePatch(w http.ResponseWriter, r *http.Request, id string, n int, pokemon *state.Pokemon) {
	type patchBody struct {
		Regions []state.MatchedRegion `json:"regions"`
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
	cfg2.Templates[n].Regions = body.Regions
	s.state.SetDetectorConfig(id, &cfg2)
	s.state.ScheduleSave()
	s.broadcastState()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleDetectorTemplateUpload saves a new PNG template from an uploaded JPEG (Browser Source)
// POST /api/detector/{id}/template_upload
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

	writeJSON(w, http.StatusOK, map[string]any{"index": sortOrder, "template_db_id": tmpl.TemplateDBID})
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

	writeJSON(w, http.StatusOK, map[string]any{"index": sortOrder, "template_db_id": tmpl.TemplateDBID})
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

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "running": true})
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

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "running": false})
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

	writeJSON(w, http.StatusOK, map[string]any{
		"match":      result.Incremented,
		"state":      result.State,
		"confidence": result.Confidence,
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
