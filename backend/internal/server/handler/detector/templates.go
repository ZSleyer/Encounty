// templates.go: HTTP handlers for detector template management (CRUD,
// upload, sprite-based creation).
package detector

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	"image/png"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/imagelimit"
	"github.com/zsleyer/encounty/backend/internal/state"
)

const (
	// maxTemplateUploadBytes bounds a template upload. The body is base64, so
	// the decoded image is roughly three quarters of this.
	maxTemplateUploadBytes = 20 << 20
	// maxPatchBytes bounds a template PATCH, which carries only JSON metadata.
	maxPatchBytes = 1 << 20
)

// validatePollIntervals enforces the adaptive-polling invariants on a
// template's own poll settings: min ≤ max and min ≤ base ≤ max. Fields left
// nil (not present in the request) are skipped so partial updates work.
func validatePollIntervals(minMs, maxMs, baseMs *int) error {
	if minMs != nil && maxMs != nil && *minMs > *maxMs {
		return fmt.Errorf("min_poll_ms (%d) must be ≤ max_poll_ms (%d)", *minMs, *maxMs)
	}
	if baseMs != nil && minMs != nil && *baseMs < *minMs {
		return fmt.Errorf("poll_interval_ms (%d) must be ≥ min_poll_ms (%d)", *baseMs, *minMs)
	}
	if baseMs != nil && maxMs != nil && *baseMs > *maxMs {
		return fmt.Errorf("poll_interval_ms (%d) must be ≤ max_poll_ms (%d)", *baseMs, *maxMs)
	}
	return nil
}

// validateHysteresisMode checks a template's hysteresis re-arm mode. nil is
// valid (the engine falls back to the legacy score-based behaviour); an
// explicit value must be one of the modes the frontend detection engine
// understands, so typos are rejected here instead of silently degrading
// detection behaviour at runtime.
func validateHysteresisMode(mode *string) error {
	if mode == nil {
		return nil
	}
	switch *mode {
	case "score", "region":
		return nil
	default:
		return fmt.Errorf("hysteresis_mode %q must be \"score\" or \"region\"", *mode)
	}
}

// templateUploadResponse returns the new template's index and DB ID.
type templateUploadResponse struct {
	Index        int   `json:"index"`
	TemplateDBID int64 `json:"template_db_id"`
}

// handleDetectorTemplateN serves a template image (GET), deletes it (DELETE),
// or updates its regions (PATCH).
// GET    /api/detector/{id}/template/{n}
// DELETE /api/detector/{id}/template/{n}
// PATCH  /api/detector/{id}/template/{n}
func (h *handler) handleDetectorTemplateN(w http.ResponseWriter, r *http.Request, id, nStr string) {
	switch r.Method {
	case http.MethodGet, http.MethodDelete, http.MethodPatch:
		// handled below
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	n, err := strconv.Atoi(nStr)
	if err != nil {
		httputil.WriteError(w, http.StatusBadRequest, "invalid template index")
		return
	}

	sm := h.deps.StateManager()
	st := sm.GetState()
	pokemon := findPokemon(st, id)
	if pokemon == nil || pokemon.DetectorConfig == nil {
		httputil.WriteError(w, http.StatusNotFound, errPokemonNotFound)
		return
	}

	cfg := *pokemon.DetectorConfig
	if n < 0 || n >= len(cfg.Templates) {
		httputil.WriteError(w, http.StatusNotFound, "template index out of range")
		return
	}

	switch r.Method {
	case http.MethodGet:
		h.handleTemplateGet(w, r, id, cfg.Templates[n])
	case http.MethodDelete:
		h.handleTemplateDelete(w, id, n, cfg)
	case http.MethodPatch:
		h.handleTemplatePatch(w, r, id, n, pokemon)
	}
}

// handleTemplateGet serves a single template image from the database.
// GET /api/detector/{id}/template/{n}
//
// @Summary      Get a detector template image
// @Tags         detector
// @Produce      png
// @Param        id path string true "Pokemon ID"
// @Param        n path int true "Template index"
// @Success      200 {file} binary
// @Failure      404 {object} httputil.ErrResp
// @Router       /detector/{id}/template/{n} [get]
func (h *handler) handleTemplateGet(w http.ResponseWriter, _ *http.Request, _ string, tmpl state.DetectorTemplate) {
	w.Header().Set("Cache-Control", "no-cache")
	db := h.deps.DetectorDB()
	if tmpl.TemplateDBID <= 0 || db == nil {
		httputil.WriteError(w, http.StatusNotFound, "no image data available")
		return
	}
	data, err := db.LoadTemplateImage(tmpl.TemplateDBID)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	_, _ = w.Write(data)
}

// handleTemplateDelete removes a template from storage and the config.
// DELETE /api/detector/{id}/template/{n}
//
// @Summary      Delete a detector template
// @Tags         detector
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Param        n path int true "Template index"
// @Success      200 {object} okResponse
// @Failure      404 {object} httputil.ErrResp
// @Router       /detector/{id}/template/{n} [delete]
func (h *handler) handleTemplateDelete(w http.ResponseWriter, id string, n int, cfg state.DetectorConfig) {
	db := h.deps.DetectorDB()
	tmpl := cfg.Templates[n]
	if tmpl.TemplateDBID > 0 && db != nil {
		_ = db.DeleteTemplateImage(tmpl.TemplateDBID)
	}
	cfg.Templates = append(cfg.Templates[:n], cfg.Templates[n+1:]...)
	sm := h.deps.StateManager()
	sm.SetDetectorConfig(id, &cfg)
	sm.ScheduleSave()
	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusOK, okResponse{OK: true})
}

// templatePatchRequest is the JSON body for PATCH
// /api/detector/{id}/template/{n}.
type templatePatchRequest struct {
	Regions []state.MatchedRegion `json:"regions,omitempty"`
	Enabled *bool                 `json:"enabled,omitempty"`
	Name    *string               `json:"name,omitempty"`
	// Calibration replaces the stored stability calibration when regions
	// are updated; omitted means the old calibration is stale and cleared.
	Calibration json.RawMessage `json:"calibration,omitempty"`
	// The detection-setting fields below are this template's own values.
	// Unlike Calibration, a key absent from the request body keeps the
	// stored value; a key present with a null value clears it back to nil
	// (the engine's hardcoded fallback applies; see presence check below).
	Precision        *float64 `json:"precision,omitempty"`
	HysteresisFactor *float64 `json:"hysteresis_factor,omitempty"`
	ConsecutiveHits  *int     `json:"consecutive_hits,omitempty"`
	CooldownSec      *int     `json:"cooldown_sec,omitempty"`
	PollIntervalMs   *int     `json:"poll_interval_ms,omitempty"`
	MinPollMs        *int     `json:"min_poll_ms,omitempty"`
	MaxPollMs        *int     `json:"max_poll_ms,omitempty"`
	HysteresisMode   *string  `json:"hysteresis_mode,omitempty"`
}

// handleTemplatePatch updates the regions, enabled flag, and/or name for an existing template.
// When enabling a template, all other templates for the same Pokemon are disabled
// to enforce single-active semantics.
// PATCH /api/detector/{id}/template/{n}
//
// @Summary      Update a detector template
// @Tags         detector
// @Accept       json
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Param        n path int true "Template index"
// @Param        body body templatePatchRequest true "Fields to update"
// @Success      200 {object} okResponse
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Failure      413 {object} httputil.ErrResp
// @Router       /detector/{id}/template/{n} [patch]
func (h *handler) handleTemplatePatch(w http.ResponseWriter, r *http.Request, id string, n int, pokemon *state.Pokemon) {
	httputil.LimitBody(w, r, maxPatchBytes)
	rawBody, err := io.ReadAll(r.Body)
	if err != nil {
		httputil.WriteError(w, http.StatusRequestEntityTooLarge, "request body too large")
		return
	}
	var body templatePatchRequest
	if err := json.Unmarshal(rawBody, &body); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	if err := validatePollIntervals(body.MinPollMs, body.MaxPollMs, body.PollIntervalMs); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validateHysteresisMode(body.HysteresisMode); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	// Presence map to distinguish an omitted key (keep stored value) from a
	// key explicitly set to null (clear the value) for the detection settings.
	var presence map[string]json.RawMessage
	_ = json.Unmarshal(rawBody, &presence)

	cfg2 := state.DetectorConfig{}
	if pokemon.DetectorConfig != nil {
		cfg2 = *pokemon.DetectorConfig
	}
	if n >= len(cfg2.Templates) {
		httputil.WriteError(w, http.StatusBadRequest, "template index out of range")
		return
	}
	if body.Regions != nil {
		cfg2.Templates[n].Regions = body.Regions
		// Regions define what the calibration was measured against, so a
		// region update replaces (or clears) the stored calibration.
		cfg2.Templates[n].Calibration = body.Calibration
	}
	if body.Name != nil {
		cfg2.Templates[n].Name = *body.Name
	}
	if _, ok := presence["precision"]; ok {
		cfg2.Templates[n].Precision = body.Precision
	}
	if _, ok := presence["hysteresis_factor"]; ok {
		cfg2.Templates[n].HysteresisFactor = body.HysteresisFactor
	}
	if _, ok := presence["consecutive_hits"]; ok {
		cfg2.Templates[n].ConsecutiveHits = body.ConsecutiveHits
	}
	if _, ok := presence["cooldown_sec"]; ok {
		cfg2.Templates[n].CooldownSec = body.CooldownSec
	}
	if _, ok := presence["poll_interval_ms"]; ok {
		cfg2.Templates[n].PollIntervalMs = body.PollIntervalMs
	}
	if _, ok := presence["min_poll_ms"]; ok {
		cfg2.Templates[n].MinPollMs = body.MinPollMs
	}
	if _, ok := presence["max_poll_ms"]; ok {
		cfg2.Templates[n].MaxPollMs = body.MaxPollMs
	}
	if _, ok := presence["hysteresis_mode"]; ok {
		cfg2.Templates[n].HysteresisMode = body.HysteresisMode
	}
	if body.Enabled != nil {
		cfg2.Templates[n].Enabled = body.Enabled
		// Enforce single-active: when enabling a template, disable all others.
		if *body.Enabled {
			f := false
			for i := range cfg2.Templates {
				if i != n {
					cfg2.Templates[i].Enabled = &f
				}
			}
		}
	}
	sm := h.deps.StateManager()
	sm.SetDetectorConfig(id, &cfg2)
	sm.ScheduleSave()
	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusOK, okResponse{OK: true})
}

// handleDetectorTemplateUpload saves a new PNG template from an uploaded JPEG (Browser Source).
// POST /api/detector/{id}/template_upload
//
// @Summary      Upload a new template image
// @Tags         detector
// @Accept       json
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Param        body body templateUploadRequest true "Base64 image and regions"
// @Success      200 {object} templateUploadResponse
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Failure      500 {object} httputil.ErrResp
// @Router       /detector/{id}/template_upload [post]
func (h *handler) handleDetectorTemplateUpload(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	sm := h.deps.StateManager()
	st := sm.GetState()
	pokemon := findPokemon(st, id)
	if pokemon == nil {
		httputil.WriteError(w, http.StatusNotFound, errPokemonNotFound)
		return
	}

	cfg := state.DetectorConfig{}
	if pokemon.DetectorConfig != nil {
		cfg = *pokemon.DetectorConfig
	}

	pngBytes, req, err := parseTemplateUpload(w, r)
	if err != nil {
		httputil.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validatePollIntervals(req.MinPollMs, req.MaxPollMs, req.PollIntervalMs); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validateHysteresisMode(req.HysteresisMode); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Ensure the detector_configs row exists in the DB before inserting the
	// template image, because detector_templates.pokemon_id has a FK ->
	// detector_configs.pokemon_id. Must use Save() (not ScheduleSave) so
	// the row is written synchronously before the INSERT below.
	sm.SetDetectorConfig(id, &cfg)
	if err := sm.Save(); err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sortOrder := len(cfg.Templates)
	t := true
	tmplName := req.Name
	if tmplName == "" {
		tmplName = fmt.Sprintf("Template %d", sortOrder+1)
	}
	tmpl := state.DetectorTemplate{
		Name:             tmplName,
		Regions:          req.Regions,
		Enabled:          &t,
		Calibration:      req.Calibration,
		Precision:        req.Precision,
		HysteresisFactor: req.HysteresisFactor,
		ConsecutiveHits:  req.ConsecutiveHits,
		CooldownSec:      req.CooldownSec,
		PollIntervalMs:   req.PollIntervalMs,
		MinPollMs:        req.MinPollMs,
		MaxPollMs:        req.MaxPollMs,
		HysteresisMode:   req.HysteresisMode,
	}
	if err := h.storeTemplateImage(id, pngBytes, sortOrder, &tmpl); err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Deactivate all existing templates so only the new one is active.
	f := false
	for i := range cfg.Templates {
		cfg.Templates[i].Enabled = &f
	}

	cfg.Templates = append(cfg.Templates, tmpl)
	sm.SetDetectorConfig(id, &cfg)
	sm.ScheduleSave()
	h.deps.BroadcastState()

	httputil.WriteJSON(w, http.StatusOK, templateUploadResponse{Index: sortOrder, TemplateDBID: tmpl.TemplateDBID})
}

// templateUploadRequest carries a base64-encoded image and regions for template upload.
type templateUploadRequest struct {
	ImageBase64 string                `json:"imageBase64"`
	Regions     []state.MatchedRegion `json:"regions"`
	Name        string                `json:"name,omitempty"`
	// Calibration is the opaque stability calibration JSON computed by the
	// frontend test step; persisted as-is.
	Calibration json.RawMessage `json:"calibration,omitempty"`
	// The detection-setting fields below seed this template's own values;
	// nil means the engine's hardcoded fallback applies.
	Precision        *float64 `json:"precision,omitempty"`
	HysteresisFactor *float64 `json:"hysteresis_factor,omitempty"`
	ConsecutiveHits  *int     `json:"consecutive_hits,omitempty"`
	CooldownSec      *int     `json:"cooldown_sec,omitempty"`
	PollIntervalMs   *int     `json:"poll_interval_ms,omitempty"`
	MinPollMs        *int     `json:"min_poll_ms,omitempty"`
	MaxPollMs        *int     `json:"max_poll_ms,omitempty"`
	HysteresisMode   *string  `json:"hysteresis_mode,omitempty"`
}

// parseTemplateUpload reads and validates the base64-encoded image from the
// request body, returning the re-encoded PNG bytes and the parsed request.
func parseTemplateUpload(w http.ResponseWriter, r *http.Request) ([]byte, *templateUploadRequest, error) {
	httputil.LimitBody(w, r, maxTemplateUploadBytes)
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

	img, _, err := imagelimit.Decode(imgData, imagelimit.MaxPixels)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid image format: %v", err)
	}

	pngBytes, err := encodePNG(img)
	if err != nil {
		return nil, nil, err
	}
	return pngBytes, &req, nil
}

// encodePNG encodes an image to PNG and returns the bytes.
func encodePNG(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// storeTemplateImage persists PNG bytes in the database and records the row id
// on the template. Template images have lived in the database since the
// normalized schema, so without a handle there is nowhere to put them.
func (h *handler) storeTemplateImage(pokemonID string, pngBytes []byte, sortOrder int, tmpl *state.DetectorTemplate) error {
	db := h.deps.DetectorDB()
	if db == nil {
		return errors.New("no database available to store the template image")
	}
	dbID, err := db.SaveTemplateImage(pokemonID, pngBytes, sortOrder)
	if err != nil {
		return err
	}
	tmpl.TemplateDBID = dbID
	return nil
}

// handleClearAllTemplates removes all templates for a Pokemon.
// DELETE /api/detector/{id}/templates
//
// @Summary      Clear all templates for a Pokemon
// @Description  Removes all templates and their images for the given Pokemon.
// @Tags         Detector
// @Param        id   path  string  true  "Pokemon ID"
// @Success      204  "Templates cleared"
// @Failure      405  "Method not allowed"
// @Router       /detector/{id}/templates [delete]
func (h *handler) handleClearAllTemplates(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodDelete {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	sm := h.deps.StateManager()
	st := sm.GetState()
	var pokemon *state.Pokemon
	for i := range st.Pokemon {
		if st.Pokemon[i].ID == id {
			pokemon = &st.Pokemon[i]
			break
		}
	}
	if pokemon == nil || pokemon.DetectorConfig == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// Delete template images from the database
	db := h.deps.DetectorDB()
	for _, tmpl := range pokemon.DetectorConfig.Templates {
		if tmpl.TemplateDBID > 0 && db != nil {
			_ = db.DeleteTemplateImage(tmpl.TemplateDBID)
		}
	}

	sm.ClearAllTemplates(id)
	sm.ScheduleSave()
	h.deps.BroadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleClearDetectionLog removes all detection log entries for a Pokemon.
// DELETE /api/detector/{id}/detection_log
//
// @Summary      Clear detection log for a Pokemon
// @Description  Removes all detection log entries for the given Pokemon.
// @Tags         Detector
// @Param        id   path  string  true  "Pokemon ID"
// @Success      204  "Detection log cleared"
// @Failure      405  "Method not allowed"
// @Router       /detector/{id}/detection_log [delete]
func (h *handler) handleClearDetectionLog(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodDelete {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	sm := h.deps.StateManager()
	sm.ClearDetectionLog(id)
	sm.ScheduleSave()
	h.deps.BroadcastState()
	w.WriteHeader(http.StatusNoContent)
}
