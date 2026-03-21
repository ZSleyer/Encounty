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
type importTemplatesRequest struct {
	SourcePokemonID string `json:"source_pokemon_id"`
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

	sm := h.deps.StateManager()
	st := sm.GetState()
	target := findPokemon(st, targetID)
	if target == nil {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}
	source := findPokemon(st, body.SourcePokemonID)
	if source == nil || source.DetectorConfig == nil || len(source.DetectorConfig.Templates) == 0 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "source has no templates"})
		return
	}

	targetCfg := state.DetectorConfig{}
	if target.DetectorConfig != nil {
		targetCfg = *target.DetectorConfig
	}

	// Ensure the detector_configs row exists for the target (FK constraint)
	sm.SetDetectorConfig(targetID, &targetCfg)
	if err := sm.Save(); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}

	db := h.deps.DetectorDB()
	imported := 0
	for _, srcTmpl := range source.DetectorConfig.Templates {
		// Load image data from DB
		if srcTmpl.TemplateDBID <= 0 || db == nil {
			continue
		}
		imgData, err := db.LoadTemplateImage(srcTmpl.TemplateDBID)
		if err != nil {
			continue
		}

		sortOrder := len(targetCfg.Templates)
		newTmpl := state.DetectorTemplate{
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

	sm.SetDetectorConfig(targetID, &targetCfg)
	sm.ScheduleSave()
	h.deps.BroadcastState()

	httputil.WriteJSON(w, http.StatusOK, importResponse{Imported: imported})
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
		newTmpl := state.DetectorTemplate{Regions: meta.Regions, Enabled: meta.Enabled}
		if err := h.storeTemplateImage(pokemonID, pngBytes, sortOrder, &newTmpl); err != nil {
			continue
		}
		targetCfg.Templates = append(targetCfg.Templates, newTmpl)
		imported++
	}
	return imported
}
