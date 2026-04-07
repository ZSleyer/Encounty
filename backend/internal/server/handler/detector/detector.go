// Package detector provides HTTP handlers for detector configuration,
// template management, and browser-driven match submission.
package detector

import (
	"fmt"
	"image"
	"image/jpeg"
	"log/slog"
	"net/http"
	"strings"

	"github.com/kbinani/screenshot"
	"github.com/zsleyer/encounty/backend/internal/detector"
	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/state"
	"golang.org/x/image/draw"
)

// validatePollIntervals enforces the adaptive-polling invariants:
// min ≤ max and min ≤ base ≤ max. Zero values are skipped so that
// partial updates from older clients still work (the state manager
// keeps the existing values).
func validatePollIntervals(cfg *state.DetectorConfig) error {
	minMs, maxMs, baseMs := cfg.MinPollMs, cfg.MaxPollMs, cfg.PollIntervalMs
	if minMs > 0 && maxMs > 0 && minMs > maxMs {
		return fmt.Errorf("min_poll_ms (%d) must be ≤ max_poll_ms (%d)", minMs, maxMs)
	}
	if baseMs > 0 && minMs > 0 && baseMs < minMs {
		return fmt.Errorf("poll_interval_ms (%d) must be ≥ min_poll_ms (%d)", baseMs, minMs)
	}
	if baseMs > 0 && maxMs > 0 && baseMs > maxMs {
		return fmt.Errorf("poll_interval_ms (%d) must be ≤ max_poll_ms (%d)", baseMs, maxMs)
	}
	return nil
}

// DetectorStore defines the database operations needed by detector handlers.
type DetectorStore interface {
	LoadTemplateImage(templateDBID int64) ([]byte, error)
	SaveTemplateImage(pokemonID string, imageData []byte, sortOrder int) (int64, error)
	DeleteTemplateImage(templateDBID int64) error
}

// EncounterLogger persists encounter events to the database.
type EncounterLogger interface {
	LogEncounter(pokemonID, pokemonName string, delta, countAfter int, source string) error
}

// Deps declares the capabilities the detector handlers need from the
// application layer, keeping this package decoupled from the server package.
type Deps interface {
	StateManager() *state.Manager
	DetectorMgr() *detector.Manager
	DetectorDB() DetectorStore
	DetectorEncounterLogger() EncounterLogger
	BroadcastState()
	Broadcast(msgType string, payload any)
	ConfigDir() string
}

// handler groups the detector HTTP handlers together with their dependencies.
type handler struct {
	deps Deps
}

// RegisterRoutes wires the /api/detector/* routes onto mux.
func RegisterRoutes(mux *http.ServeMux, d Deps) {
	h := &handler{deps: d}
	mux.HandleFunc("/api/detector/screenshot", h.handleDetectorScreenshot)
	mux.HandleFunc("/api/detector/", h.handleDetectorDispatch)
}

// --- Response / request types ------------------------------------------------

// okResponse signals a successful operation.
type okResponse struct {
	OK bool `json:"ok"`
}

// --- Screenshot --------------------------------------------------------------

// handleDetectorScreenshot captures the primary monitor, downscales to a max
// width of 1920 px, and returns the result as a JPEG image.
// GET /api/detector/screenshot
//
// @Summary      Capture primary monitor screenshot
// @Tags         detector
// @Produce      jpeg
// @Success      200 {file} binary
// @Failure      500 {object} httputil.ErrResp
// @Router       /detector/screenshot [get]
func (h *handler) handleDetectorScreenshot(w http.ResponseWriter, r *http.Request) {
	bounds := screenshot.GetDisplayBounds(0)
	img, err := screenshot.CaptureRect(bounds)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}

	out := downscaleImage(img, 1920)

	w.Header().Set(headerContentType, contentTypeJPEG)
	if err := jpeg.Encode(w, out, &jpeg.Options{Quality: 75}); err != nil {
		// Headers already sent; nothing useful to do.
		return
	}
}

// --- Dispatch ----------------------------------------------------------------

// handleDetectorDispatch parses the path and dispatches to the appropriate
// per-Pokemon sub-handler. Expected path shapes:
//
//	/api/detector/{id}/config
//	/api/detector/{id}/template/{n}
//	/api/detector/{id}/template_upload
//	/api/detector/{id}/templates          (DELETE — clear all)
//	/api/detector/{id}/detection_log      (DELETE — clear log)
//	/api/detector/{id}/export_templates
//	/api/detector/{id}/import_templates_file
//	/api/detector/{id}/import_templates
//	/api/detector/{id}/match
func (h *handler) handleDetectorDispatch(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/detector/")
	parts := strings.SplitN(rest, "/", 4)

	if len(parts) < 2 {
		w.WriteHeader(http.StatusNotFound)
		return
	}

	id := parts[0]
	action := parts[1]

	switch action {
	case "config":
		h.handleDetectorConfig(w, r, id)
	case "template":
		if len(parts) >= 3 {
			h.handleDetectorTemplateN(w, r, id, parts[2])
		} else {
			w.WriteHeader(http.StatusNotFound)
		}
	case "template_upload":
		h.handleDetectorTemplateUpload(w, r, id)
	case "export_templates":
		h.handleExportTemplates(w, r, id)
	case "import_templates_file":
		h.handleImportTemplatesFile(w, r, id)
	case "import_templates":
		h.handleImportTemplates(w, r, id)
	case "templates":
		h.handleClearAllTemplates(w, r, id)
	case "detection_log":
		h.handleClearDetectionLog(w, r, id)
	case "match":
		h.handleMatchSubmit(w, r, id)
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

// --- Config ------------------------------------------------------------------

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
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Router       /detector/{id}/config [get]
// @Router       /detector/{id}/config [post]
func (h *handler) handleDetectorConfig(w http.ResponseWriter, r *http.Request, id string) {
	sm := h.deps.StateManager()
	st := sm.GetState()
	pokemon := findPokemon(st, id)
	if pokemon == nil {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}

	switch r.Method {
	case http.MethodGet:
		cfg := state.DetectorConfig{}
		if pokemon.DetectorConfig != nil {
			cfg = *pokemon.DetectorConfig
		}
		httputil.WriteJSON(w, http.StatusOK, cfg)

	case http.MethodPost:
		var cfg state.DetectorConfig
		if err := httputil.ReadJSON(r, &cfg); err != nil {
			httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
			return
		}
		if err := validatePollIntervals(&cfg); err != nil {
			httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
			return
		}
		if !sm.SetDetectorConfig(id, &cfg) {
			httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
			return
		}
		sm.ScheduleSave()
		h.deps.BroadcastState()
		httputil.WriteJSON(w, http.StatusOK, okResponse{OK: true})

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// --- Browser Detection (WebGPU score submission) -----------------------------

// matchSubmitRequest is the JSON body for POST /api/detector/{id}/match.
type matchSubmitRequest struct {
	Score      float64 `json:"score"`
	FrameDelta float64 `json:"frame_delta"`
}

// matchSubmitResponse is returned by handleMatchSubmit.
type matchSubmitResponse struct {
	Matched    bool    `json:"matched"`
	Confidence float64 `json:"confidence"`
}

// handleMatchSubmit accepts a confirmed match from the browser WebGPU engine.
// It increments the encounter counter, logs the detection, and broadcasts a
// detector_match event.
// POST /api/detector/{id}/match
//
// @Summary      Submit a WebGPU match score for a Pokemon
// @Tags         detector
// @Accept       json
// @Produce      json
// @Param        id   path string            true "Pokemon ID"
// @Param        body body matchSubmitRequest true "Match score"
// @Success      200 {object} matchSubmitResponse
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Failure      405 {string} string
// @Router       /detector/{id}/match [post]
func (h *handler) handleMatchSubmit(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var req matchSubmitRequest
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}

	sm := h.deps.StateManager()
	st := sm.GetState()
	pokemon := findPokemon(st, id)
	if pokemon == nil {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}

	sm.AppendDetectionLog(id, req.Score)

	count, ok := sm.Increment(id)
	if !ok {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}

	h.logEncounter(id, count, "detector")

	h.deps.BroadcastState()
	h.deps.Broadcast("encounter_added", map[string]any{
		"pokemon_id": id,
		"count":      count,
	})
	h.deps.Broadcast("detector_match", map[string]any{
		"pokemon_id": id,
		"confidence": req.Score,
		"source":     "browser",
	})

	httputil.WriteJSON(w, http.StatusOK, matchSubmitResponse{
		Matched:    true,
		Confidence: req.Score,
	})
}

// logEncounter writes an encounter event to the database via the EncounterLogger.
func (h *handler) logEncounter(pokemonID string, countAfter int, source string) {
	logger := h.deps.DetectorEncounterLogger()
	if logger == nil {
		return
	}
	st := h.deps.StateManager().GetState()
	name := pokemonID
	step := 1
	for _, p := range st.Pokemon {
		if p.ID == pokemonID {
			name = p.Name
			if p.Step > 0 {
				step = p.Step
			}
			break
		}
	}
	if err := logger.LogEncounter(pokemonID, name, step, countAfter, source); err != nil {
		slog.Warn("Failed to log encounter from detector", "pokemon_id", pokemonID, "error", err)
	}
}

// --- Helpers -----------------------------------------------------------------

const (
	errPokemonNotFound = "pokemon not found"
	contentTypeJPEG    = "image/jpeg"
	headerContentType  = "Content-Type"
)

// findPokemon returns a pointer to the Pokemon with the given id within st,
// or nil if no such Pokemon exists.
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
