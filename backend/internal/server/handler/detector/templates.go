// templates.go — HTTP handlers for detector template management (CRUD,
// upload, sprite-based creation).
package detector

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	"image/png"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/state"
)

const templateFileFmt = "template_%d.png"

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
//
// @Summary      Get, delete or update a detector template
// @Tags         detector
// @Param        id path string true "Pokemon ID"
// @Param        n path int true "Template index"
// @Success      200 {file} binary
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Router       /detector/{id}/template/{n} [get]
// @Router       /detector/{id}/template/{n} [delete]
// @Router       /detector/{id}/template/{n} [patch]
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
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "invalid template index"})
		return
	}

	sm := h.deps.StateManager()
	st := sm.GetState()
	pokemon := findPokemon(st, id)
	if pokemon == nil || pokemon.DetectorConfig == nil {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}

	cfg := *pokemon.DetectorConfig
	if n < 0 || n >= len(cfg.Templates) {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: "template index out of range"})
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

// handleTemplateGet serves a single template image from the DB or filesystem.
func (h *handler) handleTemplateGet(w http.ResponseWriter, r *http.Request, id string, tmpl state.DetectorTemplate) {
	w.Header().Set("Cache-Control", "no-cache")
	db := h.deps.DetectorDB()
	if tmpl.TemplateDBID > 0 && db != nil {
		data, err := db.LoadTemplateImage(tmpl.TemplateDBID)
		if err != nil {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		_, _ = w.Write(data)
	} else if tmpl.ImagePath != "" {
		absPath := filepath.Join(h.deps.ConfigDir(), "templates", id, tmpl.ImagePath)
		http.ServeFile(w, r, absPath)
	} else {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: "no image data available"})
	}
}

// handleTemplateDelete removes a template from storage and the config.
func (h *handler) handleTemplateDelete(w http.ResponseWriter, id string, n int, cfg state.DetectorConfig) {
	db := h.deps.DetectorDB()
	tmpl := cfg.Templates[n]
	if tmpl.TemplateDBID > 0 && db != nil {
		_ = db.DeleteTemplateImage(tmpl.TemplateDBID)
	} else if tmpl.ImagePath != "" {
		absPath := filepath.Join(h.deps.ConfigDir(), "templates", id, tmpl.ImagePath)
		_ = os.Remove(absPath)
	}
	cfg.Templates = append(cfg.Templates[:n], cfg.Templates[n+1:]...)
	sm := h.deps.StateManager()
	sm.SetDetectorConfig(id, &cfg)
	sm.ScheduleSave()
	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusOK, okResponse{OK: true})
}

// handleTemplatePatch updates the regions, enabled flag, and/or name for an existing template.
// When enabling a template, all other templates for the same Pokemon are disabled
// to enforce single-active semantics.
func (h *handler) handleTemplatePatch(w http.ResponseWriter, r *http.Request, id string, n int, pokemon *state.Pokemon) {
	type patchBody struct {
		Regions []state.MatchedRegion `json:"regions,omitempty"`
		Enabled *bool                 `json:"enabled,omitempty"`
		Name    *string               `json:"name,omitempty"`
	}
	var body patchBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "invalid json body"})
		return
	}
	cfg2 := state.DetectorConfig{}
	if pokemon.DetectorConfig != nil {
		cfg2 = *pokemon.DetectorConfig
	}
	if n >= len(cfg2.Templates) {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "template index out of range"})
		return
	}
	if body.Regions != nil {
		cfg2.Templates[n].Regions = body.Regions
	}
	if body.Name != nil {
		cfg2.Templates[n].Name = *body.Name
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
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}

	cfg := state.DetectorConfig{}
	if pokemon.DetectorConfig != nil {
		cfg = *pokemon.DetectorConfig
	}

	pngBytes, regions, uploadName, err := parseTemplateUpload(r)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}

	// Ensure the detector_configs row exists in the DB before inserting the
	// template image, because detector_templates.pokemon_id has a FK ->
	// detector_configs.pokemon_id. Must use Save() (not ScheduleSave) so
	// the row is written synchronously before the INSERT below.
	sm.SetDetectorConfig(id, &cfg)
	if err := sm.Save(); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}

	sortOrder := len(cfg.Templates)
	t := true
	tmplName := uploadName
	if tmplName == "" {
		tmplName = fmt.Sprintf("Template %d", sortOrder+1)
	}
	tmpl := state.DetectorTemplate{
		Name:    tmplName,
		Regions: regions,
		Enabled: &t,
	}
	if err := h.storeTemplateImage(id, pngBytes, sortOrder, &tmpl); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
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
}

// parseTemplateUpload reads and validates the base64-encoded image from the
// request body, returning the re-encoded PNG bytes, regions, and optional name.
func parseTemplateUpload(r *http.Request) ([]byte, []state.MatchedRegion, string, error) {
	r.Body = http.MaxBytesReader(nil, r.Body, 20<<20)
	var req templateUploadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return nil, nil, "", fmt.Errorf("failed to parse json body")
	}

	b64data := req.ImageBase64
	if idx := strings.Index(b64data, ","); idx != -1 {
		b64data = b64data[idx+1:]
	}
	imgData, err := base64.StdEncoding.DecodeString(b64data)
	if err != nil {
		return nil, nil, "", fmt.Errorf("invalid base64 image data")
	}

	img, _, err := image.Decode(bytes.NewReader(imgData))
	if err != nil {
		return nil, nil, "", fmt.Errorf("invalid image format: %v", err)
	}

	pngBytes, err := encodePNG(img)
	if err != nil {
		return nil, nil, "", err
	}
	return pngBytes, req.Regions, req.Name, nil
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
func (h *handler) storeTemplateImage(pokemonID string, pngBytes []byte, sortOrder int, tmpl *state.DetectorTemplate) error {
	db := h.deps.DetectorDB()
	if db != nil {
		dbID, err := db.SaveTemplateImage(pokemonID, pngBytes, sortOrder)
		if err != nil {
			return err
		}
		tmpl.TemplateDBID = dbID
		return nil
	}
	templatesDir := filepath.Join(h.deps.ConfigDir(), "templates", pokemonID)
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

	// Delete template images from DB/disk
	db := h.deps.DetectorDB()
	for _, tmpl := range pokemon.DetectorConfig.Templates {
		if tmpl.TemplateDBID > 0 && db != nil {
			_ = db.DeleteTemplateImage(tmpl.TemplateDBID)
		} else if tmpl.ImagePath != "" {
			absPath := filepath.Join(h.deps.ConfigDir(), "templates", id, tmpl.ImagePath)
			_ = os.Remove(absPath)
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
