// Package detector provides HTTP handlers for detector lifecycle,
// configuration, and screenshot capture.
package detector

import (
	"fmt"
	"image"
	"image/jpeg"
	pngenc "image/png"
	"io"
	"log/slog"
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
	mux.HandleFunc("GET /api/detector/screens", h.handleListScreens)
	mux.HandleFunc("GET /api/detector/windows", h.handleListWindows)
	mux.HandleFunc("GET /api/detector/cameras", h.handleListCameras)
	mux.HandleFunc("GET /api/detector/capabilities", h.handleDetectorCapabilities)
	mux.HandleFunc("GET /api/detector/source/thumbnail", h.handleSourceThumbnail)
	mux.HandleFunc("GET /api/detector/source/capture_frame", h.handleCaptureFrame)
	mux.HandleFunc("/api/detector/", h.handleDetectorDispatch)
}

// --- Response / request types ------------------------------------------------

// detectorStatusEntry reports whether a single detector is running.
type detectorStatusEntry struct {
	PokemonID string `json:"pokemon_id"`
	Running   bool   `json:"running"`
}

// detectorRunResponse reports whether a detector is running.
type detectorRunResponse struct {
	OK      bool `json:"ok"`
	Running bool `json:"running"`
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
	if mgr := h.deps.DetectorMgr(); mgr != nil {
		if sources, err := mgr.ListSources("window"); err == nil {
			httputil.WriteJSON(w, http.StatusOK, sources)
			return
		}
	}
	// Fallback to Go-native listing, converted to SourceInfo for API consistency.
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
	if mgr := h.deps.DetectorMgr(); mgr != nil {
		if sources, err := mgr.ListSources("camera"); err == nil {
			httputil.WriteJSON(w, http.StatusOK, sources)
			return
		}
	}
	// Fallback to Go-native listing, converted to SourceInfo for API consistency.
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

// handleListScreens returns a JSON array of available screens via the sidecar.
// GET /api/detector/screens
//
// @Summary      List available screens via sidecar
// @Tags         detector
// @Produce      json
// @Success      200 {array} detector.SourceInfo
// @Failure      503 {object} httputil.ErrResp
// @Router       /detector/screens [get]
func (h *handler) handleListScreens(w http.ResponseWriter, _ *http.Request) {
	mgr := h.deps.DetectorMgr()
	if mgr == nil {
		httputil.WriteJSON(w, http.StatusOK, []detector.SourceInfo{})
		return
	}
	sources, err := mgr.ListSources("screen")
	if err != nil {
		// Sidecar not available — return empty list rather than an error
		slog.Debug("ListSources(screen) failed", "error", err)
		httputil.WriteJSON(w, http.StatusOK, []detector.SourceInfo{})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, sources)
}

// handleSourceThumbnail captures a single frame from a source and returns it
// as a JPEG thumbnail. Query parameters: source_type, source_id, w (optional).
// GET /api/detector/source/thumbnail?source_type=window&source_id=123&w=320
//
// @Summary      Capture a source thumbnail via sidecar
// @Tags         detector
// @Produce      jpeg
// @Param        source_type query string true "Source type (screen, window, camera)"
// @Param        source_id   query string true "Source identifier"
// @Param        w           query int    false "Max width in pixels (default 320)"
// @Success      200 {file} binary
// @Failure      400 {object} httputil.ErrResp
// @Failure      503 {object} httputil.ErrResp
// @Router       /detector/source/thumbnail [get]
func (h *handler) handleSourceThumbnail(w http.ResponseWriter, r *http.Request) {
	sourceType := r.URL.Query().Get("source_type")
	sourceID := r.URL.Query().Get("source_id")
	if sourceType == "" || sourceID == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "source_type and source_id required"})
		return
	}

	maxW := 320
	if wStr := r.URL.Query().Get("w"); wStr != "" {
		if v, err := strconv.Atoi(wStr); err == nil && v > 0 && v <= 1920 {
			maxW = v
		}
	}

	mgr := h.deps.DetectorMgr()
	if mgr == nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrResp{Error: errDetectorNotAvailable})
		return
	}

	// Request a frame with proportional height (0 lets sidecar choose).
	img, err := mgr.CaptureSourceFrame(sourceType, sourceID, maxW, 0)
	if err != nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrResp{Error: err.Error()})
		return
	}

	// Downscale to the requested width before encoding; the sidecar may return
	// a full-resolution frame on Wayland even when a smaller w was requested.
	img = downscaleImage(img, maxW)

	w.Header().Set(headerContentType, contentTypeJPEG)
	w.Header().Set("Cache-Control", "no-cache")
	if err := jpeg.Encode(w, img, &jpeg.Options{Quality: 85}); err != nil {
		return
	}
}

// handleCaptureFrame captures a single full-resolution frame from a source and
// returns it as a lossless PNG. Unlike handleSourceThumbnail, this does
// not downscale the image, making it suitable for template creation and OCR.
// Query parameters: source_type, source_id.
// GET /api/detector/source/capture_frame?source_type=window&source_id=123
//
// @Summary      Capture a full-resolution source frame via sidecar
// @Tags         detector
// @Produce      png
// @Param        source_type query string true "Source type (screen, window, camera)"
// @Param        source_id   query string true "Source identifier"
// @Success      200 {file} binary
// @Failure      400 {object} httputil.ErrResp
// @Failure      503 {object} httputil.ErrResp
// @Router       /detector/source/capture_frame [get]
func (h *handler) handleCaptureFrame(w http.ResponseWriter, r *http.Request) {
	sourceType := r.URL.Query().Get("source_type")
	sourceID := r.URL.Query().Get("source_id")
	if sourceType == "" || sourceID == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "source_type and source_id required"})
		return
	}

	mgr := h.deps.DetectorMgr()
	if mgr == nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrResp{Error: errDetectorNotAvailable})
		return
	}

	// Request full resolution (0, 0 lets the sidecar return native size).
	img, err := mgr.CaptureSourceFrame(sourceType, sourceID, 0, 0)
	if err != nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrResp{Error: err.Error()})
		return
	}

	w.Header().Set(headerContentType, contentTypePNG)
	w.Header().Set("Cache-Control", "no-cache")
	if err := pngenc.Encode(w, img); err != nil {
		return
	}
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
//	/api/detector/{id}/preview_session/start
//	/api/detector/{id}/preview_session/stop
//	/api/detector/{id}/replay/status
//	/api/detector/{id}/replay/snapshot
//	/api/detector/{id}/replay/snapshot/{index}
//	/api/detector/{id}/replay/rematch
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
		h.handleDetectorStart(w, r, id)
	case "stop":
		h.handleDetectorStop(w, r, id)
	case "export_templates":
		h.handleExportTemplates(w, r, id)
	case "import_templates_file":
		h.handleImportTemplatesFile(w, r, id)
	case "import_templates":
		h.handleImportTemplates(w, r, id)
	case "mjpeg":
		h.handleMJPEGStream(w, r, id)
	case "stream":
		h.handleVideoStream(w, r, id)
	case "raw_stream":
		h.handleRawStream(w, r, id)
	case "preview":
		if len(parts) < 3 {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		switch parts[2] {
		case "start":
			h.handlePreviewStart(w, r, id)
		case "stop":
			h.handlePreviewStop(w, r, id)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	case "preview_session":
		if len(parts) < 3 {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		switch parts[2] {
		case "start":
			h.handlePreviewSessionStart(w, r, id)
		case "stop":
			h.handlePreviewSessionStop(w, r, id)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	case "replay":
		h.dispatchReplay(w, r, id, parts[2:])
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
		// Propagate tunable parameters to a running sidecar session.
		if mgr := h.deps.DetectorMgr(); mgr != nil {
			_ = mgr.UpdateConfig(id, cfg)
		}
		h.deps.BroadcastState()
		httputil.WriteJSON(w, http.StatusOK, okResponse{OK: true})

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// --- Start / Stop ------------------------------------------------------------

// handleDetectorStart starts the detection goroutine for a single hunt.
// POST /api/detector/{id}/start
//
// @Summary      Start detection for a Pokemon
// @Tags         detector
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Success      200 {object} detectorRunResponse
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Failure      500 {object} httputil.ErrResp
// @Router       /detector/{id}/start [post]
func (h *handler) handleDetectorStart(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	sm := h.deps.StateManager()
	st := sm.GetState()
	pokemon := findPokemon(st, id)
	if pokemon == nil {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}
	if pokemon.DetectorConfig == nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "no detector config"})
		return
	}
	if len(pokemon.DetectorConfig.Templates) == 0 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "no templates configured"})
		return
	}

	cfg := *pokemon.DetectorConfig
	h.hydrateTemplates(&cfg)

	if mgr := h.deps.DetectorMgr(); mgr != nil {
		if err := h.launchDetector(id, cfg); err != nil {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
			return
		}
	}

	cfg.Enabled = true
	sm.SetDetectorConfig(id, &cfg)
	sm.ScheduleSave()
	h.deps.BroadcastState()

	httputil.WriteJSON(w, http.StatusOK, detectorRunResponse{OK: true, Running: true})
}

// launchDetector starts the detection goroutine for the given config.
func (h *handler) launchDetector(id string, cfg state.DetectorConfig) error {
	return h.deps.DetectorMgr().Start(id, cfg)
}

// handleDetectorStop stops the detection goroutine for a single hunt.
// POST /api/detector/{id}/stop
//
// @Summary      Stop detection for a Pokemon
// @Tags         detector
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Success      200 {object} detectorRunResponse
// @Router       /detector/{id}/stop [post]
func (h *handler) handleDetectorStop(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	if mgr := h.deps.DetectorMgr(); mgr != nil {
		mgr.Stop(id)
	}

	sm := h.deps.StateManager()
	st := sm.GetState()
	pokemon := findPokemon(st, id)
	if pokemon != nil && pokemon.DetectorConfig != nil {
		cfg := *pokemon.DetectorConfig
		cfg.Enabled = false
		sm.SetDetectorConfig(id, &cfg)
		sm.ScheduleSave()
		h.deps.BroadcastState()
	}

	httputil.WriteJSON(w, http.StatusOK, detectorRunResponse{OK: true, Running: false})
}

// --- Preview -----------------------------------------------------------------

// handlePreviewStart starts the JPEG preview stream for a running detector session.
// POST /api/detector/{id}/preview/start
//
// @Summary      Start preview stream for a detector session
// @Tags         detector
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Success      200 {object} okResponse
// @Failure      405 {string} string
// @Failure      500 {object} httputil.ErrResp
// @Failure      503 {object} httputil.ErrResp
// @Router       /detector/{id}/preview/start [post]
func (h *handler) handlePreviewStart(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	mgr := h.deps.DetectorMgr()
	if mgr == nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrResp{Error: errDetectorNotAvailable})
		return
	}

	if err := mgr.StartPreview(id, 960, 85, 0); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, okResponse{OK: true})
}

// handlePreviewStop stops the JPEG preview stream for a detector session.
// POST /api/detector/{id}/preview/stop
//
// @Summary      Stop preview stream for a detector session
// @Tags         detector
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Success      200 {object} okResponse
// @Failure      405 {string} string
// @Failure      500 {object} httputil.ErrResp
// @Failure      503 {object} httputil.ErrResp
// @Router       /detector/{id}/preview/stop [post]
func (h *handler) handlePreviewStop(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	mgr := h.deps.DetectorMgr()
	if mgr == nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrResp{Error: errDetectorNotAvailable})
		return
	}

	if err := mgr.StopPreview(id); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, okResponse{OK: true})
}

// --- MJPEG Stream ------------------------------------------------------------

// handleMJPEGStream serves a multipart/x-mixed-replace MJPEG stream of
// preview frames for the given detector session. The browser's native <img>
// tag decodes this natively with zero JavaScript overhead.
// GET /api/detector/{id}/mjpeg
func (h *handler) handleMJPEGStream(w http.ResponseWriter, r *http.Request, id string) {
	mgr := h.deps.DetectorMgr()
	if mgr == nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrResp{Error: errDetectorNotAvailable})
		return
	}

	ch, unsub := mgr.SubscribePreview(id)
	defer unsub()

	const boundary = "frame"
	w.Header().Set("Content-Type", "multipart/x-mixed-replace; boundary="+boundary)
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Connection", "close")

	flusher, ok := w.(http.Flusher)
	if !ok {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: "streaming not supported"})
		return
	}

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case frame, open := <-ch:
			if !open {
				return
			}
			if len(frame.JPEGData) == 0 {
				continue
			}
			fmt.Fprintf(w, "--%s\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n", boundary, len(frame.JPEGData))
			if _, err := w.Write(frame.JPEGData); err != nil {
				return
			}
			io.WriteString(w, "\r\n")
			flusher.Flush()
		}
	}
}

// handleVideoStream serves a continuous fMP4 (H.264) byte stream for the
// given detector session. The browser consumes this via MSE (Media Source
// Extensions) for hardware-accelerated H.264 decoding.
// GET /api/detector/{id}/stream
func (h *handler) handleVideoStream(w http.ResponseWriter, r *http.Request, id string) {
	mgr := h.deps.DetectorMgr()
	if mgr == nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrResp{Error: errDetectorNotAvailable})
		return
	}

	ch, unsub := mgr.SubscribePreview(id)
	defer unsub()

	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Connection", "close")

	flusher, ok := w.(http.Flusher)
	if !ok {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: "streaming not supported"})
		return
	}

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case frame, open := <-ch:
			if !open {
				return
			}
			if len(frame.FMP4Data) > 0 {
				if _, err := w.Write(frame.FMP4Data); err != nil {
					return
				}
				flusher.Flush()
			} else if len(frame.JPEGData) > 0 {
				// JPEG fallback — send nothing on the video stream endpoint.
				// Clients using /stream expect fMP4 only.
				continue
			}
		}
	}
}

// --- Raw RGBA Stream ---------------------------------------------------------

// handleRawStream serves a binary stream of raw RGBA preview frames for the
// given detector session. Each frame is prefixed with an 8-byte header:
// [width:u16 LE][height:u16 LE][length:u32 LE][rgba_data].
// TCP backpressure naturally limits throughput — when the client cannot consume
// fast enough, Write() blocks and the subscriber channel drops frames.
// GET /api/detector/{id}/raw_stream
func (h *handler) handleRawStream(w http.ResponseWriter, r *http.Request, id string) {
	mgr := h.deps.DetectorMgr()
	if mgr == nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrResp{Error: errDetectorNotAvailable})
		return
	}

	ch, unsub := mgr.SubscribePreview(id)
	defer unsub()

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Connection", "close")

	flusher, ok := w.(http.Flusher)
	if !ok {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: "streaming not supported"})
		return
	}

	ctx := r.Context()
	var hdr [8]byte
	for {
		select {
		case <-ctx.Done():
			return
		case frame, open := <-ch:
			if !open {
				return
			}
			if !frame.IsRaw || len(frame.RGBAData) == 0 {
				continue
			}
			// 8-byte header: width(u16 LE) + height(u16 LE) + length(u32 LE)
			hdr[0] = byte(frame.Width)
			hdr[1] = byte(frame.Width >> 8)
			hdr[2] = byte(frame.Height)
			hdr[3] = byte(frame.Height >> 8)
			dataLen := uint32(len(frame.RGBAData))
			hdr[4] = byte(dataLen)
			hdr[5] = byte(dataLen >> 8)
			hdr[6] = byte(dataLen >> 16)
			hdr[7] = byte(dataLen >> 24)
			if _, err := w.Write(hdr[:]); err != nil {
				return
			}
			if _, err := w.Write(frame.RGBAData); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// --- Preview Session ---------------------------------------------------------

// handlePreviewSessionStart starts a preview-only sidecar session for a Pokemon
// that does not have a running detection session. This allows live preview
// without starting full detection.
// POST /api/detector/{id}/preview_session/start
//
// @Summary      Start a preview-only sidecar session
// @Tags         detector
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Success      200 {object} okResponse
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Failure      405 {string} string
// @Failure      500 {object} httputil.ErrResp
// @Failure      503 {object} httputil.ErrResp
// @Router       /detector/{id}/preview_session/start [post]
func (h *handler) handlePreviewSessionStart(w http.ResponseWriter, r *http.Request, id string) {
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
	if pokemon.DetectorConfig == nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "no detector config"})
		return
	}

	cfg := *pokemon.DetectorConfig

	if err := mgr.StartPreviewSession(id, cfg); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, okResponse{OK: true})
}

// handlePreviewSessionStop stops a preview-only sidecar session for a Pokemon.
// POST /api/detector/{id}/preview_session/stop
//
// @Summary      Stop a preview-only sidecar session
// @Tags         detector
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Success      200 {object} okResponse
// @Failure      405 {string} string
// @Failure      500 {object} httputil.ErrResp
// @Failure      503 {object} httputil.ErrResp
// @Router       /detector/{id}/preview_session/stop [post]
func (h *handler) handlePreviewSessionStop(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	mgr := h.deps.DetectorMgr()
	if mgr == nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrResp{Error: errDetectorNotAvailable})
		return
	}

	if err := mgr.StopPreviewSession(id); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, okResponse{OK: true})
}

// --- Replay / Snapshot -------------------------------------------------------

// dispatchReplay routes /api/detector/{id}/replay/* sub-paths.
func (h *handler) dispatchReplay(w http.ResponseWriter, r *http.Request, id string, sub []string) {
	if len(sub) == 0 {
		w.WriteHeader(http.StatusNotFound)
		return
	}

	switch sub[0] {
	case "status":
		h.handleReplayStatus(w, r, id)
	case "snapshot":
		if len(sub) == 1 {
			h.handleReplaySnapshot(w, r, id)
		} else {
			h.handleSnapshotFrame(w, r, id, sub[1])
		}
	case "rematch":
		h.handleReplayRematch(w, r, id)
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

// handleReplayStatus returns the current replay buffer status for a session.
// GET /api/detector/{id}/replay/status
func (h *handler) handleReplayStatus(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	mgr := h.deps.DetectorMgr()
	if mgr == nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrResp{Error: errDetectorNotAvailable})
		return
	}

	dur, count, err := mgr.GetReplayStatus(id)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"duration_sec": dur,
		"frame_count":  count,
	})
}

// handleReplaySnapshot creates or deletes a replay buffer snapshot.
// POST   /api/detector/{id}/replay/snapshot — freeze the replay buffer to disk.
// DELETE /api/detector/{id}/replay/snapshot — remove the snapshot directory.
func (h *handler) handleReplaySnapshot(w http.ResponseWriter, r *http.Request, id string) {
	mgr := h.deps.DetectorMgr()
	if mgr == nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrResp{Error: errDetectorNotAvailable})
		return
	}

	switch r.Method {
	case http.MethodPost:
		count, dur, path, err := mgr.SnapshotReplay(id)
		if err != nil {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
			return
		}
		httputil.WriteJSON(w, http.StatusOK, map[string]any{
			"frame_count":  count,
			"duration_sec": dur,
			"path":         path,
		})

	case http.MethodDelete:
		if err := mgr.DeleteSnapshot(id); err != nil {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
			return
		}
		httputil.WriteJSON(w, http.StatusOK, okResponse{OK: true})

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// handleReplayRematch triggers NCC matching over the replay buffer.
// POST /api/detector/{id}/replay/rematch
func (h *handler) handleReplayRematch(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	mgr := h.deps.DetectorMgr()
	if mgr == nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrResp{Error: errDetectorNotAvailable})
		return
	}

	type rematchReq struct {
		WindowSec int `json:"window_sec"`
	}
	var req rematchReq
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	if req.WindowSec == 0 {
		req.WindowSec = 30
	}

	if err := mgr.TriggerRematch(id, req.WindowSec); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, okResponse{OK: true})
}

// handleSnapshotFrame returns a single PNG frame from a saved snapshot.
// GET /api/detector/{id}/replay/snapshot/{index}
func (h *handler) handleSnapshotFrame(w http.ResponseWriter, r *http.Request, id string, indexStr string) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	mgr := h.deps.DetectorMgr()
	if mgr == nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrResp{Error: errDetectorNotAvailable})
		return
	}

	idx, err := strconv.Atoi(indexStr)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "invalid frame index"})
		return
	}

	pngData, err := mgr.GetSnapshotFrame(id, idx)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}

	w.Header().Set(headerContentType, contentTypePNG)
	w.Header().Set("Content-Length", strconv.Itoa(len(pngData)))
	_, _ = w.Write(pngData)
}

// --- Helpers -----------------------------------------------------------------

const (
	errPokemonNotFound     = "pokemon not found"
	errDetectorNotAvailable = "detector not available"
	contentTypeJPEG        = "image/jpeg"
	contentTypePNG         = "image/png"
	headerContentType      = "Content-Type"
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

// hydrateTemplates loads image BLOBs from the DB for templates that have a
// TemplateDBID but no in-memory ImageData.
func (h *handler) hydrateTemplates(cfg *state.DetectorConfig) {
	db := h.deps.DetectorDB()
	if db == nil {
		return
	}
	for i := range cfg.Templates {
		if cfg.Templates[i].TemplateDBID > 0 && len(cfg.Templates[i].ImageData) == 0 {
			data, err := db.LoadTemplateImage(cfg.Templates[i].TemplateDBID)
			if err != nil {
				slog.Warn("Failed to load template BLOB from DB",
					"template_db_id", cfg.Templates[i].TemplateDBID, "error", err)
				continue
			}
			cfg.Templates[i].ImageData = data
		}
	}
}
