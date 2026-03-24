// Package detector provides HTTP handlers for detector lifecycle,
// configuration, and screenshot capture.
package detector

import (
	"image"
	"image/jpeg"
	"net/http"
	"strconv"
	"strings"

	"github.com/kbinani/screenshot"
	"github.com/zsleyer/encounty/backend/internal/detector"
	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/state"
	"golang.org/x/image/draw"
)

// DetectorStore defines the database operations needed by detector handlers.
type DetectorStore interface {
	LoadTemplateImage(templateDBID int64) ([]byte, error)
	SaveTemplateImage(pokemonID string, imageData []byte, sortOrder int) (int64, error)
	DeleteTemplateImage(templateDBID int64) error
}

// Deps declares the capabilities the detector handlers need from the
// application layer, keeping this package decoupled from the server package.
type Deps interface {
	StateManager() *state.Manager
	DetectorMgr() *detector.Manager
	DetectorDB() DetectorStore
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
	mux.HandleFunc("/api/detector/status", h.handleDetectorStatus)
	mux.HandleFunc("GET /api/detector/windows", h.handleListWindows)
	mux.HandleFunc("GET /api/detector/cameras", h.handleListCameras)
	mux.HandleFunc("GET /api/detector/capabilities", h.handleDetectorCapabilities)
	mux.HandleFunc("/api/detector/", h.handleDetectorDispatch)
}

// --- Response / request types ------------------------------------------------

// detectorStatusEntry reports whether a single detector is running.
type detectorStatusEntry struct {
	PokemonID string `json:"pokemon_id"`
	Running   bool   `json:"running"`
}



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

// --- Status ------------------------------------------------------------------

// handleDetectorStatus returns a JSON array of all running detector IDs.
// GET /api/detector/status
//
// @Summary      List running detector IDs
// @Tags         detector
// @Produce      json
// @Success      200 {array} detectorStatusEntry
// @Router       /detector/status [get]
func (h *handler) handleDetectorStatus(w http.ResponseWriter, r *http.Request) {
	entries := []detectorStatusEntry{}
	if mgr := h.deps.DetectorMgr(); mgr != nil {
		for _, id := range mgr.RunningIDs() {
			entries = append(entries, detectorStatusEntry{PokemonID: id, Running: true})
		}
	}
	httputil.WriteJSON(w, http.StatusOK, entries)
}

// --- Windows / Cameras / Capabilities ----------------------------------------

// handleListWindows returns a JSON array of visible top-level windows.
// GET /api/detector/windows
//
// @Summary      List visible top-level windows
// @Tags         detector
// @Produce      json
// @Success      200 {array} object
// @Router       /detector/windows [get]
func (h *handler) handleListWindows(w http.ResponseWriter, _ *http.Request) {
	windows := detector.ListWindows()
	sources := make([]detector.SourceInfo, 0, len(windows))
	for _, win := range windows {
		sources = append(sources, detector.SourceInfo{
			ID:         strconv.FormatUint(uint64(win.HWND), 10),
			Title:      win.Title,
			SourceType: "window",
			W:          win.W,
			H:          win.H,
		})
	}
	httputil.WriteJSON(w, http.StatusOK, sources)
}

// handleListCameras returns a JSON array of available V4L2 video capture devices.
// GET /api/detector/cameras
//
// @Summary      List available video capture devices
// @Tags         detector
// @Produce      json
// @Success      200 {array} detector.CameraInfo
// @Router       /detector/cameras [get]
func (h *handler) handleListCameras(w http.ResponseWriter, _ *http.Request) {
	cameras := detector.ListCameras()
	sources := make([]detector.SourceInfo, 0, len(cameras))
	for _, cam := range cameras {
		sources = append(sources, detector.SourceInfo{
			ID:         cam.DevicePath,
			Title:      cam.Name,
			SourceType: "camera",
		})
	}
	httputil.WriteJSON(w, http.StatusOK, sources)
}

// handleDetectorCapabilities returns platform-specific capture capabilities.
// GET /api/detector/capabilities
//
// @Summary      Get platform capture capabilities
// @Tags         detector
// @Produce      json
// @Success      200 {object} detector.Capabilities
// @Router       /detector/capabilities [get]
func (h *handler) handleDetectorCapabilities(w http.ResponseWriter, _ *http.Request) {
	httputil.WriteJSON(w, http.StatusOK, detector.GetCapabilities())
}

// --- Dispatch ----------------------------------------------------------------

// handleDetectorDispatch parses the path and dispatches to the appropriate
// per-Pokemon sub-handler. Expected path shapes:
//
//	/api/detector/{id}/config
//	/api/detector/{id}/template/{n}
//	/api/detector/{id}/template_upload
//	/api/detector/{id}/sprite_template
//	/api/detector/{id}/start
//	/api/detector/{id}/stop
//	/api/detector/{id}/export_templates
//	/api/detector/{id}/import_templates_file
//	/api/detector/{id}/import_templates
//	/api/detector/{id}/match
//	/api/detector/{id}/browser/start
//	/api/detector/{id}/browser/stop
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
	case "sprite_template":
		h.handleDetectorSpriteTemplate(w, r, id)
	case "start":
		h.handleBrowserDetectorStart(w, r, id)
	case "stop":
		h.handleBrowserDetectorStop(w, r, id)
	case "export_templates":
		h.handleExportTemplates(w, r, id)
	case "import_templates_file":
		h.handleImportTemplatesFile(w, r, id)
	case "import_templates":
		h.handleImportTemplates(w, r, id)
	case "match":
		h.handleMatchSubmit(w, r, id)
	case "browser":
		if len(parts) < 3 {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		switch parts[2] {
		case "start":
			h.handleBrowserDetectorStart(w, r, id)
		case "stop":
			h.handleBrowserDetectorStop(w, r, id)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
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
	PollMs     int     `json:"poll_ms"`
}

// handleMatchSubmit accepts a pre-computed NCC score from the browser WebGPU
// engine and feeds it into the BrowserDetector state machine. When a match is
// confirmed the encounter counter is incremented and a detector_match event is
// broadcast.
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
// @Failure      503 {object} httputil.ErrResp
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

	mgr := h.deps.DetectorMgr()
	if mgr == nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrResp{Error: errDetectorNotAvailable})
		return
	}

	bd := mgr.GetBrowserDetector(id)
	if bd == nil {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: "no browser detector active for this pokemon"})
		return
	}

	result := bd.SubmitScore(req.Score, req.FrameDelta)

	if result.Matched {
		sm := h.deps.StateManager()
		sm.Increment(id)
		sm.AppendDetectionLog(id, result.Confidence)
		h.deps.Broadcast("detector_match", map[string]any{
			"pokemon_id": id,
			"confidence": result.Confidence,
			"source":     "browser",
		})
	}

	h.deps.Broadcast("detector_status", map[string]any{
		"pokemon_id": id,
		"state":      result.State,
		"confidence": result.Confidence,
		"poll_ms":    result.PollMs,
	})

	httputil.WriteJSON(w, http.StatusOK, matchSubmitResponse{
		Matched:    result.Matched,
		Confidence: result.Confidence,
		PollMs:     result.PollMs,
	})
}

// browserDetectorStartRequest is the optional JSON body for
// POST /api/detector/{id}/browser/start. When empty, the existing
// DetectorConfig from the Pokemon state is used.
type browserDetectorStartRequest struct {
	Precision       float64 `json:"precision,omitempty"`
	ConsecutiveHits int     `json:"consecutive_hits,omitempty"`
	CooldownSec     int     `json:"cooldown_sec,omitempty"`
}

// handleBrowserDetectorStart creates a BrowserDetector for the given Pokemon,
// using either the existing DetectorConfig or overrides from the request body.
// POST /api/detector/{id}/browser/start
//
// @Summary      Start a browser-driven detector for a Pokemon
// @Tags         detector
// @Accept       json
// @Produce      json
// @Param        id   path string true "Pokemon ID"
// @Success      200 {object} okResponse
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Failure      405 {string} string
// @Failure      503 {object} httputil.ErrResp
// @Router       /detector/{id}/browser/start [post]
func (h *handler) handleBrowserDetectorStart(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	mgr := h.deps.DetectorMgr()
	if mgr == nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrResp{Error: errDetectorNotAvailable})
		return
	}

	sm := h.deps.StateManager()
	st := sm.GetState()
	pokemon := findPokemon(st, id)
	if pokemon == nil {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}

	// Start from the existing config if available, then apply overrides.
	var cfg state.DetectorConfig
	if pokemon.DetectorConfig != nil {
		cfg = *pokemon.DetectorConfig
	}

	// Allow partial overrides from the request body (best-effort parse).
	var req browserDetectorStartRequest
	if err := httputil.ReadJSON(r, &req); err == nil {
		if req.Precision > 0 {
			cfg.Precision = req.Precision
		}
		if req.ConsecutiveHits > 0 {
			cfg.ConsecutiveHits = req.ConsecutiveHits
		}
		if req.CooldownSec > 0 {
			cfg.CooldownSec = req.CooldownSec
		}
	}

	mgr.GetOrCreateBrowserDetector(id, cfg)

	// Broadcast an initial detector_status so the frontend immediately shows
	// the running state (before the first POST /match arrives from the browser).
	h.deps.Broadcast("detector_status", map[string]any{
		"pokemon_id": id,
		"state":      "idle",
		"confidence":  0.0,
		"poll_ms":     100,
	})

	httputil.WriteJSON(w, http.StatusOK, okResponse{OK: true})
}

// handleBrowserDetectorStop removes the BrowserDetector for the given Pokemon.
// POST /api/detector/{id}/browser/stop
//
// @Summary      Stop a browser-driven detector for a Pokemon
// @Tags         detector
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Success      200 {object} okResponse
// @Failure      405 {string} string
// @Failure      503 {object} httputil.ErrResp
// @Router       /detector/{id}/browser/stop [post]
func (h *handler) handleBrowserDetectorStop(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	mgr := h.deps.DetectorMgr()
	if mgr == nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrResp{Error: errDetectorNotAvailable})
		return
	}

	mgr.StopBrowserDetector(id)
	httputil.WriteJSON(w, http.StatusOK, okResponse{OK: true})
}

// --- Helpers -----------------------------------------------------------------

const (
	errPokemonNotFound      = "pokemon not found"
	errDetectorNotAvailable = "detector not available"
	contentTypeJPEG   = "image/jpeg"
	headerContentType = "Content-Type"
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

