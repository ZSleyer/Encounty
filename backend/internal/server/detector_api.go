// detector_api.go — HTTP handlers for detector lifecycle, configuration, and frame matching.
package server

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"log/slog"
	"net/http"
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
