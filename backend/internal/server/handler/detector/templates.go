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

// handleTemplatePatch updates the regions and/or enabled flag for an existing template.
func (h *handler) handleTemplatePatch(w http.ResponseWriter, r *http.Request, id string, n int, pokemon *state.Pokemon) {
	type patchBody struct {
		Regions []state.MatchedRegion `json:"regions,omitempty"`
		Enabled *bool                 `json:"enabled,omitempty"`
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
	if body.Enabled != nil {
		cfg2.Templates[n].Enabled = body.Enabled
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

	pngBytes, regions, err := parseTemplateUpload(r)
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

	tmpl := state.DetectorTemplate{Regions: regions}
	sortOrder := len(cfg.Templates)
	if err := h.storeTemplateImage(id, pngBytes, sortOrder, &tmpl); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
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
}

// parseTemplateUpload reads and validates the base64-encoded image from the
// request body, returning the re-encoded PNG bytes and regions.
func parseTemplateUpload(r *http.Request) ([]byte, []state.MatchedRegion, error) {
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

// handleDetectorSpriteTemplate fetches the Pokemon's current sprite URL,
// decodes it (handling animated GIFs by taking the first frame), saves it as
// a PNG template, and appends it to the DetectorConfig.
// POST /api/detector/{id}/sprite_template
//
// @Summary      Create template from Pokemon sprite
// @Tags         detector
// @Accept       json
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Param        body body object false "Optional sprite URL override (sprite_url field)"
// @Success      200 {object} templateUploadResponse
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Failure      500 {object} httputil.ErrResp
// @Router       /detector/{id}/sprite_template [post]
func (h *handler) handleDetectorSpriteTemplate(w http.ResponseWriter, r *http.Request, id string) {
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

	spriteURL := resolveSpriteURL(pokemon, r)
	if spriteURL == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "pokemon has no sprite_url"})
		return
	}

	img, err := fetchSpriteImage(spriteURL)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadGateway, httputil.ErrResp{Error: err.Error()})
		return
	}

	cfg := state.DetectorConfig{}
	if pokemon.DetectorConfig != nil {
		cfg = *pokemon.DetectorConfig
	}

	pngBytes, err := encodePNG(img)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}

	// Ensure the detector_configs row exists in the DB before inserting the
	// template image (FK constraint). Must use Save() synchronously.
	sm.SetDetectorConfig(id, &cfg)
	if err := sm.Save(); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}

	b := img.Bounds()
	sortOrder := len(cfg.Templates)
	tmpl := state.DetectorTemplate{
		Regions: []state.MatchedRegion{
			{Type: "image", Rect: state.DetectorRect{X: 0, Y: 0, W: b.Dx(), H: b.Dy()}},
		},
	}

	if err := h.storeTemplateImage(id, pngBytes, sortOrder, &tmpl); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}

	cfg.Templates = append(cfg.Templates, tmpl)
	sm.SetDetectorConfig(id, &cfg)
	sm.ScheduleSave()
	h.deps.BroadcastState()

	httputil.WriteJSON(w, http.StatusOK, templateUploadResponse{Index: sortOrder, TemplateDBID: tmpl.TemplateDBID})
}

// resolveSpriteURL returns the sprite URL from the request body override
// or falls back to the Pokemon's stored SpriteURL.
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
