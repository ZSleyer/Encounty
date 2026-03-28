// importexport.go — HTTP handlers for detector template import and export
// between Pokemon and via ZIP files.
package detector

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"io"
	"net/http"
	"strings"

	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// importResponse reports how many templates were imported.
type importResponse struct {
	Imported int `json:"imported"`
}

// importTemplatesRequest is the body for POST /api/detector/{id}/import_templates.
// When TemplateIndices is non-empty, only the templates at those indices are imported.
type importTemplatesRequest struct {
	SourcePokemonID string `json:"source_pokemon_id"`
	TemplateIndices []int  `json:"template_indices,omitempty"`
}

// handleImportTemplates copies all templates from a source Pokemon to the target.
// POST /api/detector/{id}/import_templates
//
// @Summary      Import templates from another Pokemon
// @Tags         detector
// @Accept       json
// @Produce      json
// @Param        id path string true "Target Pokemon ID"
// @Param        body body importTemplatesRequest true "Source Pokemon ID"
// @Success      200 {object} importResponse
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Router       /detector/{id}/import_templates [post]
func (h *handler) handleImportTemplates(w http.ResponseWriter, r *http.Request, targetID string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var body importTemplatesRequest
	if err := httputil.ReadJSON(r, &body); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}

	srcTemplates, targetCfg, status, err := h.validateImportRequest(targetID, &body)
	if err != nil {
		httputil.WriteJSON(w, status, httputil.ErrResp{Error: err.Error()})
		return
	}

	imported := h.copyTemplatesFromSource(targetID, srcTemplates, targetCfg)

	activateFirstTemplate(targetCfg.Templates)

	sm := h.deps.StateManager()
	sm.SetDetectorConfig(targetID, targetCfg)
	sm.ScheduleSave()
	h.deps.BroadcastState()

	httputil.WriteJSON(w, http.StatusOK, importResponse{Imported: imported})
}

// validateImportRequest validates the import request, resolves source and target
// Pokemon, ensures the target config row exists, and returns the source templates
// to import along with the target config. On failure it returns an HTTP status and error.
func (h *handler) validateImportRequest(targetID string, body *importTemplatesRequest) ([]state.DetectorTemplate, *state.DetectorConfig, int, error) {
	sm := h.deps.StateManager()
	st := sm.GetState()

	target := findPokemon(st, targetID)
	if target == nil {
		return nil, nil, http.StatusNotFound, fmt.Errorf(errPokemonNotFound)
	}
	source := findPokemon(st, body.SourcePokemonID)
	if source == nil || source.DetectorConfig == nil || len(source.DetectorConfig.Templates) == 0 {
		return nil, nil, http.StatusBadRequest, fmt.Errorf("source has no templates")
	}

	targetCfg := state.DetectorConfig{}
	if target.DetectorConfig != nil {
		targetCfg = *target.DetectorConfig
	}

	// Ensure the detector_configs row exists for the target (FK constraint)
	sm.SetDetectorConfig(targetID, &targetCfg)
	if err := sm.Save(); err != nil {
		return nil, nil, http.StatusInternalServerError, err
	}

	srcTemplates := filterSourceTemplates(source.DetectorConfig.Templates, body.TemplateIndices)
	return srcTemplates, &targetCfg, 0, nil
}

// filterSourceTemplates returns the subset of templates at the given indices,
// or all templates if indices is empty.
func filterSourceTemplates(all []state.DetectorTemplate, indices []int) []state.DetectorTemplate {
	if len(indices) == 0 {
		return all
	}
	filtered := make([]state.DetectorTemplate, 0, len(indices))
	for _, idx := range indices {
		if idx >= 0 && idx < len(all) {
			filtered = append(filtered, all[idx])
		}
	}
	return filtered
}

// copyTemplatesFromSource loads image data for each source template and stores
// a copy in the target config. Returns the number of templates imported.
func (h *handler) copyTemplatesFromSource(targetID string, srcTemplates []state.DetectorTemplate, targetCfg *state.DetectorConfig) int {
	db := h.deps.DetectorDB()
	imported := 0

	for _, srcTmpl := range srcTemplates {
		if srcTmpl.TemplateDBID <= 0 || db == nil {
			continue
		}
		imgData, err := db.LoadTemplateImage(srcTmpl.TemplateDBID)
		if err != nil {
			continue
		}

		sortOrder := len(targetCfg.Templates)
		name := srcTmpl.Name
		if name == "" {
			name = fmt.Sprintf("Template %d", sortOrder+1)
		}
		newTmpl := state.DetectorTemplate{
			Name:    name,
			Regions: make([]state.MatchedRegion, len(srcTmpl.Regions)),
			Enabled: srcTmpl.Enabled,
		}
		copy(newTmpl.Regions, srcTmpl.Regions)

		if err := h.storeTemplateImage(targetID, imgData, sortOrder, &newTmpl); err != nil {
			continue
		}
		targetCfg.Templates = append(targetCfg.Templates, newTmpl)
		imported++
	}
	return imported
}

// handleExportTemplates streams a ZIP file of all templates for a Pokemon.
// GET /api/detector/{id}/export_templates
//
// @Summary      Export templates as ZIP
// @Tags         detector
// @Produce      application/zip
// @Param        id path string true "Pokemon ID"
// @Success      200 {file} binary
// @Failure      404 {object} httputil.ErrResp
// @Router       /detector/{id}/export_templates [get]
func (h *handler) handleExportTemplates(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	sm := h.deps.StateManager()
	st := sm.GetState()
	pokemon := findPokemon(st, id)
	if pokemon == nil || pokemon.DetectorConfig == nil {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}

	type exportMeta struct {
		Filename string                `json:"filename"`
		Name     string                `json:"name"`
		Regions  []state.MatchedRegion `json:"regions"`
		Enabled  *bool                 `json:"enabled,omitempty"`
	}

	db := h.deps.DetectorDB()
	var metadata []exportMeta
	var pngDataList [][]byte

	for i, tmpl := range pokemon.DetectorConfig.Templates {
		if tmpl.TemplateDBID <= 0 || db == nil {
			continue
		}
		data, err := db.LoadTemplateImage(tmpl.TemplateDBID)
		if err != nil {
			continue
		}
		filename := fmt.Sprintf("template_%d.png", i)
		metadata = append(metadata, exportMeta{
			Filename: filename,
			Name:     tmpl.Name,
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
	Name     string                `json:"name"`
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
// @Success      200 {object} importResponse
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Router       /detector/{id}/import_templates_file [post]
func (h *handler) handleImportTemplatesFile(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	zr, err := readZipFromMultipart(r)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}

	metadata, err := readTemplateMetadata(zr)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}

	pngMap := collectZipPNGs(zr)

	sm := h.deps.StateManager()
	st := sm.GetState()
	pokemon := findPokemon(st, id)
	if pokemon == nil {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}

	targetCfg := state.DetectorConfig{}
	if pokemon.DetectorConfig != nil {
		targetCfg = *pokemon.DetectorConfig
	}

	sm.SetDetectorConfig(id, &targetCfg)
	if err := sm.Save(); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}

	imported := h.importTemplatesFromMeta(id, metadata, pngMap, &targetCfg)

	sm.SetDetectorConfig(id, &targetCfg)
	sm.ScheduleSave()
	h.deps.BroadcastState()

	httputil.WriteJSON(w, http.StatusOK, importResponse{Imported: imported})
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

// collectZipPNGs reads all PNG files from a ZIP archive into a filename->data map.
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
// After import, single-active semantics are enforced by activating the first
// template and deactivating all others.
func (h *handler) importTemplatesFromMeta(pokemonID string, metadata []templateImportMeta, pngMap map[string][]byte, targetCfg *state.DetectorConfig) int {
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
		name := meta.Name
		if name == "" {
			name = fmt.Sprintf("Template %d", sortOrder+1)
		}
		newTmpl := state.DetectorTemplate{Name: name, Regions: meta.Regions, Enabled: meta.Enabled}
		if err := h.storeTemplateImage(pokemonID, pngBytes, sortOrder, &newTmpl); err != nil {
			continue
		}
		targetCfg.Templates = append(targetCfg.Templates, newTmpl)
		imported++
	}

	// Enforce single-active: activate the first template, deactivate all others.
	activateFirstTemplate(targetCfg.Templates)

	return imported
}

// activateFirstTemplate enables the first template in the slice and disables
// all others, enforcing single-active semantics.
func activateFirstTemplate(templates []state.DetectorTemplate) {
	if len(templates) == 0 {
		return
	}
	t := true
	f := false
	templates[0].Enabled = &t
	for i := 1; i < len(templates); i++ {
		templates[i].Enabled = &f
	}
}
