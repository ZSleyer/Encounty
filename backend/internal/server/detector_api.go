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
	"github.com/zsleyer/encounty/backend/internal/detector"
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

// handleDetectorWindows returns the list of visible top-level windows as JSON.
// GET /api/detector/windows
func (s *Server) handleDetectorWindows(w http.ResponseWriter, r *http.Request) {
	windows := detector.ListWindows()
	writeJSON(w, http.StatusOK, windows)
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
//	/api/detector/{id}/template
//	/api/detector/{id}/template/{n}
//	/api/detector/{id}/preview
//	/api/detector/{id}/start
//	/api/detector/{id}/stop
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
	case "preview":
		s.handleDetectorPreview(w, r, id)
	case "template_upload":
		s.handleDetectorTemplateUpload(w, r, id)
	case "sprite_template":
		s.handleDetectorSpriteTemplate(w, r, id)
	case "start":
		s.handleDetectorStart(w, r, id)
	case "stop":
		s.handleDetectorStop(w, r, id)
	case "log":
		s.handleGetDetectionLog(w, r, id)
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
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
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
			writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
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
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}

	cfg := *pokemon.DetectorConfig
	if n < 0 || n >= len(cfg.Templates) {
		writeJSON(w, http.StatusNotFound, errResp{"template index out of range"})
		return
	}

	tmpl := cfg.Templates[n]

	switch r.Method {
	case http.MethodGet:
		w.Header().Set("Cache-Control", "no-cache")
		// Prefer DB BLOB; fall back to filesystem for legacy templates.
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
		return

	case http.MethodDelete:
		// Remove from DB if stored there; otherwise remove from filesystem.
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

	case http.MethodPatch:
		// Update the regions for an existing template (image file stays the same).
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
		if idx := n; idx >= len(cfg2.Templates) {
			writeJSON(w, http.StatusBadRequest, errResp{"template index out of range"})
			return
		}
		cfg2.Templates[n].Regions = body.Regions
		s.state.SetDetectorConfig(id, &cfg2)
		s.state.ScheduleSave()
		s.broadcastState()
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
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
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}

	cfg := state.DetectorConfig{}
	if pokemon.DetectorConfig != nil {
		cfg = *pokemon.DetectorConfig
	}

	type templateUploadRequest struct {
		ImageBase64 string                `json:"imageBase64"`
		Regions     []state.MatchedRegion `json:"regions"`
	}

	// 20 MB max
	r.Body = http.MaxBytesReader(w, r.Body, 20<<20)
	var req templateUploadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{"failed to parse json body"})
		return
	}

	b64data := req.ImageBase64
	if idx := strings.Index(b64data, ","); idx != -1 {
		b64data = b64data[idx+1:] // strip data:image/jpeg;base64,
	}
	imgData, err := base64.StdEncoding.DecodeString(b64data)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{"invalid base64 image data"})
		return
	}

	img, format, err := image.Decode(bytes.NewReader(imgData))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{fmt.Sprintf("invalid image format: %v", err)})
		return
	}
	_ = format // e.g. "jpeg" or "png"

	// Encode to PNG for storage.
	var pngBuf bytes.Buffer
	if err := png.Encode(&pngBuf, img); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
		return
	}
	pngBytes := pngBuf.Bytes()

	sortOrder := len(cfg.Templates)
	tmpl := state.DetectorTemplate{
		Regions: req.Regions,
	}

	// Save to DB if available; fall back to filesystem otherwise.
	if s.db != nil {
		dbID, err := s.db.SaveTemplateImage(id, pngBytes, sortOrder)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
			return
		}
		tmpl.TemplateDBID = dbID
	} else {
		templatesDir := filepath.Join(s.state.GetConfigDir(), "templates", id)
		if err := os.MkdirAll(templatesDir, 0755); err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
			return
		}
		n := 0
		for {
			candidate := filepath.Join(templatesDir, fmt.Sprintf("template_%d.png", n))
			if _, err := os.Stat(candidate); os.IsNotExist(err) {
				break
			}
			n++
		}
		relPath := fmt.Sprintf("template_%d.png", n)
		absPath := filepath.Join(templatesDir, relPath)
		if err := os.WriteFile(absPath, pngBytes, 0644); err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
			return
		}
		tmpl.ImagePath = relPath
	}

	cfg.Templates = append(cfg.Templates, tmpl)
	s.state.SetDetectorConfig(id, &cfg)
	s.state.ScheduleSave()
	s.broadcastState()

	writeJSON(w, http.StatusOK, map[string]any{"index": sortOrder, "template_db_id": tmpl.TemplateDBID})
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
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}

	// Accept an optional sprite_url override in the request body so the
	// frontend can send the game-specific sprite URL instead of the
	// user's custom sprite.
	spriteURL := pokemon.SpriteURL
	if r.Body != nil {
		var body struct {
			SpriteURL string `json:"sprite_url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err == nil && body.SpriteURL != "" {
			spriteURL = body.SpriteURL
		}
	}
	if spriteURL == "" {
		writeJSON(w, http.StatusBadRequest, errResp{"pokemon has no sprite_url"})
		return
	}

	// Fetch the sprite image from its URL.
	resp, err := http.Get(spriteURL) //nolint:noctx
	if err != nil {
		writeJSON(w, http.StatusBadGateway, errResp{fmt.Sprintf("failed to fetch sprite: %v", err)})
		return
	}
	defer resp.Body.Close()

	// image.Decode auto-detects PNG, JPEG, GIF (registered via blank imports).
	img, _, err := image.Decode(resp.Body)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, errResp{fmt.Sprintf("failed to decode sprite: %v", err)})
		return
	}

	cfg := state.DetectorConfig{}
	if pokemon.DetectorConfig != nil {
		cfg = *pokemon.DetectorConfig
	}

	// Encode sprite to PNG for storage.
	var pngBuf bytes.Buffer
	if err := png.Encode(&pngBuf, img); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
		return
	}
	pngBytes := pngBuf.Bytes()

	// Use the whole sprite as a single image region.
	b := img.Bounds()
	sortOrder := len(cfg.Templates)
	tmpl := state.DetectorTemplate{
		Regions: []state.MatchedRegion{
			{
				Type: "image",
				Rect: state.DetectorRect{X: 0, Y: 0, W: b.Dx(), H: b.Dy()},
			},
		},
	}

	// Save to DB if available; fall back to filesystem otherwise.
	if s.db != nil {
		dbID, err := s.db.SaveTemplateImage(id, pngBytes, sortOrder)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
			return
		}
		tmpl.TemplateDBID = dbID
	} else {
		templatesDir := filepath.Join(s.state.GetConfigDir(), "templates", id)
		if err := os.MkdirAll(templatesDir, 0755); err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
			return
		}
		n := 0
		for {
			candidate := filepath.Join(templatesDir, fmt.Sprintf("template_%d.png", n))
			if _, statErr := os.Stat(candidate); os.IsNotExist(statErr) {
				break
			}
			n++
		}
		relPath := fmt.Sprintf("template_%d.png", n)
		absPath := filepath.Join(templatesDir, relPath)
		if err := os.WriteFile(absPath, pngBytes, 0644); err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
			return
		}
		tmpl.ImagePath = relPath
	}

	cfg.Templates = append(cfg.Templates, tmpl)
	s.state.SetDetectorConfig(id, &cfg)
	s.state.ScheduleSave()
	s.broadcastState()

	writeJSON(w, http.StatusOK, map[string]any{"index": sortOrder, "template_db_id": tmpl.TemplateDBID})
}

// handleDetectorPreview captures the configured region and returns it as a
// JPEG image suitable for a live preview in the settings UI.
// GET /api/detector/{id}/preview
func (s *Server) handleDetectorPreview(w http.ResponseWriter, r *http.Request, id string) {
	st := s.state.GetState()
	pokemon := findPokemon(st, id)
	if pokemon == nil {
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}

	cfg := state.DetectorConfig{}
	if pokemon.DetectorConfig != nil {
		cfg = *pokemon.DetectorConfig
	}

	if cfg.Region.W == 0 {
		writeJSON(w, http.StatusBadRequest, errResp{"no region configured"})
		return
	}

	img, err := detector.CaptureRegion(cfg.Region.X, cfg.Region.Y, cfg.Region.W, cfg.Region.H)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
		return
	}

	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "no-store")
	_ = jpeg.Encode(w, img, &jpeg.Options{Quality: 70})
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
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
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

	// Hydrate templates that are stored in the DB with their image BLOBs
	// so the detector has the pixel data in memory when it starts matching.
	if s.db != nil {
		for i := range cfg.Templates {
			if cfg.Templates[i].TemplateDBID > 0 {
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

	if s.detectorMgr != nil {
		isBrowser := cfg.SourceType == "browser_camera" || cfg.SourceType == "browser_display"
		if isBrowser {
			// For browser sources, detection is driven by the frontend frame
			// submission loop (POST /match_frame). We only need to ensure a
			// BrowserDetector exists and emit an initial status so the UI
			// shows the detector as running.
			s.detectorMgr.GetOrCreateBrowserDetector(id, cfg)
			s.hub.BroadcastRaw("detector_status", map[string]any{
				"pokemon_id": id,
				"state":      "idle",
				"confidence":  0,
				"poll_ms":     0,
			})
		} else {
			// Native screen capture: launch the goroutine-based detector.
			if err := s.detectorMgr.Start(id, cfg); err != nil {
				writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
				return
			}
		}
	}

	cfg.Enabled = true
	s.state.SetDetectorConfig(id, &cfg)
	s.state.ScheduleSave()
	s.broadcastState()

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "running": true})
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

// handleGetDetectionLog returns the last N auto-detection matches for a hunt.
// Returns an empty JSON array when no log entries exist yet.
// GET /api/detector/{id}/log
func (s *Server) handleGetDetectionLog(w http.ResponseWriter, _ *http.Request, id string) {
	st := s.state.GetState()
	for _, p := range st.Pokemon {
		if p.ID != id {
			continue
		}
		if p.DetectorConfig == nil || len(p.DetectorConfig.DetectionLog) == 0 {
			writeJSON(w, http.StatusOK, []struct{}{})
			return
		}
		writeJSON(w, http.StatusOK, p.DetectorConfig.DetectionLog)
		return
	}
	writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
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

	// Validate pokemon exists and has a detector config with templates.
	st := s.state.GetState()
	pokemon := findPokemon(st, id)
	if pokemon == nil {
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}
	if pokemon.DetectorConfig == nil || len(pokemon.DetectorConfig.Templates) == 0 {
		writeJSON(w, http.StatusBadRequest, errResp{"no templates configured"})
		return
	}

	// Read frame body (JPEG), cap at 20 MB.
	const maxBodyBytes = 20 << 20
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{"read body: " + err.Error()})
		return
	}

	// Decode JPEG.
	frame, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		// Try again after seeking — use bytes.NewReader which is proper.
		writeJSON(w, http.StatusBadRequest, errResp{"decode jpeg: " + err.Error()})
		return
	}

	// Hydrate DB-backed templates with their image BLOBs so the
	// BrowserDetector can decode them when first created.
	detCfg := *pokemon.DetectorConfig
	if s.db != nil {
		for i := range detCfg.Templates {
			if detCfg.Templates[i].TemplateDBID > 0 && len(detCfg.Templates[i].ImageData) == 0 {
				data, err := s.db.LoadTemplateImage(detCfg.Templates[i].TemplateDBID)
				if err != nil {
					slog.Warn("Failed to load template BLOB for match_frame",
						"template_db_id", detCfg.Templates[i].TemplateDBID, "error", err)
					continue
				}
				detCfg.Templates[i].ImageData = data
			}
		}
	}

	// Get or create a BrowserDetector for this pokemon.
	bd := s.detectorMgr.GetOrCreateBrowserDetector(id, detCfg)
	if !bd.HasTemplates() {
		// Templates may have changed — reset.
		bd = s.detectorMgr.ResetBrowserDetector(id, detCfg)
	}

	result := bd.SubmitFrame(frame)

	if result.Confidence > 0.1 {
		slog.Debug("match_frame result",
			"pokemon", pokemon.Name, "id", id,
			"state", result.State, "confidence", result.Confidence,
			"incremented", result.Incremented)
	}

	// Broadcast status to all clients.
	s.hub.BroadcastRaw("detector_status", map[string]any{
		"pokemon_id": id,
		"state":      result.State,
		"confidence": result.Confidence,
		"poll_ms":    0,
	})

	if result.Incremented {
		slog.Info("Detector match confirmed",
			"pokemon", pokemon.Name, "id", id,
			"confidence", result.Confidence)
		s.state.Increment(id)
		s.state.AppendDetectionLog(id, result.Confidence)
		s.hub.BroadcastRaw("detector_match", map[string]any{
			"pokemon_id": id,
			"confidence": result.Confidence,
		})
		s.broadcastState()
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"match":      result.Incremented,
		"state":      result.State,
		"confidence": result.Confidence,
	})
}
