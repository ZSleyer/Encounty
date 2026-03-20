// detector_api_import.go — HTTP handlers for detector template import and export.
package server

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"io"
	"net/http"
	"strings"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// handleImportTemplates copies all templates from a source Pokemon to the target.
// POST /api/detector/{id}/import_templates
//
// @Summary      Import templates from another Pokemon
// @Tags         detector
// @Accept       json
// @Produce      json
// @Param        id path string true "Target Pokemon ID"
// @Param        body body ImportTemplatesRequest true "Source Pokemon ID"
// @Success      200 {object} ImportResponse
// @Failure      400 {object} errResp
// @Failure      404 {object} errResp
// @Router       /detector/{id}/import_templates [post]
func (s *Server) handleImportTemplates(w http.ResponseWriter, r *http.Request, targetID string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var body ImportTemplatesRequest
	if err := readJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}

	st := s.state.GetState()
	target := findPokemon(st, targetID)
	if target == nil {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	source := findPokemon(st, body.SourcePokemonID)
	if source == nil || source.DetectorConfig == nil || len(source.DetectorConfig.Templates) == 0 {
		writeJSON(w, http.StatusBadRequest, errResp{"source has no templates"})
		return
	}

	targetCfg := state.DetectorConfig{}
	if target.DetectorConfig != nil {
		targetCfg = *target.DetectorConfig
	}

	// Ensure the detector_configs row exists for the target (FK constraint)
	s.state.SetDetectorConfig(targetID, &targetCfg)
	if err := s.state.Save(); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
		return
	}

	imported := 0
	for _, srcTmpl := range source.DetectorConfig.Templates {
		// Load image data from DB
		if srcTmpl.TemplateDBID <= 0 || s.db == nil {
			continue
		}
		imgData, err := s.db.LoadTemplateImage(srcTmpl.TemplateDBID)
		if err != nil {
			continue
		}

		sortOrder := len(targetCfg.Templates)
		newTmpl := state.DetectorTemplate{
			Regions: make([]state.MatchedRegion, len(srcTmpl.Regions)),
			Enabled: srcTmpl.Enabled,
		}
		copy(newTmpl.Regions, srcTmpl.Regions)

		if err := s.storeTemplateImage(targetID, imgData, sortOrder, &newTmpl); err != nil {
			continue
		}
		targetCfg.Templates = append(targetCfg.Templates, newTmpl)
		imported++
	}

	s.state.SetDetectorConfig(targetID, &targetCfg)
	s.state.ScheduleSave()
	s.broadcastState()

	writeJSON(w, http.StatusOK, ImportResponse{Imported: imported})
}

// handleExportTemplates streams a ZIP file of all templates for a Pokemon.
// GET /api/detector/{id}/export_templates
//
// @Summary      Export templates as ZIP
// @Tags         detector
// @Produce      application/zip
// @Param        id path string true "Pokemon ID"
// @Success      200 {file} binary
// @Failure      404 {object} errResp
// @Router       /detector/{id}/export_templates [get]
func (s *Server) handleExportTemplates(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	st := s.state.GetState()
	pokemon := findPokemon(st, id)
	if pokemon == nil || pokemon.DetectorConfig == nil {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}

	type exportMeta struct {
		Filename string                `json:"filename"`
		Regions  []state.MatchedRegion `json:"regions"`
		Enabled  *bool                 `json:"enabled,omitempty"`
	}

	var metadata []exportMeta
	var pngDataList [][]byte

	for i, tmpl := range pokemon.DetectorConfig.Templates {
		if tmpl.TemplateDBID <= 0 || s.db == nil {
			continue
		}
		data, err := s.db.LoadTemplateImage(tmpl.TemplateDBID)
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
// @Success      200 {object} ImportResponse
// @Failure      400 {object} errResp
// @Failure      404 {object} errResp
// @Router       /detector/{id}/import_templates_file [post]
func (s *Server) handleImportTemplatesFile(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	zr, err := readZipFromMultipart(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}

	metadata, err := readTemplateMetadata(zr)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}

	pngMap := collectZipPNGs(zr)

	st := s.state.GetState()
	pokemon := findPokemon(st, id)
	if pokemon == nil {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}

	targetCfg := state.DetectorConfig{}
	if pokemon.DetectorConfig != nil {
		targetCfg = *pokemon.DetectorConfig
	}

	s.state.SetDetectorConfig(id, &targetCfg)
	if err := s.state.Save(); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
		return
	}

	imported := s.importTemplatesFromMeta(id, metadata, pngMap, &targetCfg)

	s.state.SetDetectorConfig(id, &targetCfg)
	s.state.ScheduleSave()
	s.broadcastState()

	writeJSON(w, http.StatusOK, ImportResponse{Imported: imported})
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

// collectZipPNGs reads all PNG files from a ZIP archive into a filename→data map.
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
func (s *Server) importTemplatesFromMeta(pokemonID string, metadata []templateImportMeta, pngMap map[string][]byte, targetCfg *state.DetectorConfig) int {
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
		if err := s.storeTemplateImage(pokemonID, pngBytes, sortOrder, &newTmpl); err != nil {
			continue
		}
		targetCfg.Templates = append(targetCfg.Templates, newTmpl)
		imported++
	}
	return imported
}
