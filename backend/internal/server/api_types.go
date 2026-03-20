// api_types.go — Named request/response types for Swagger documentation.
// These replace anonymous map literals in handlers so that swaggo can generate
// proper OpenAPI schemas.
package server

import "github.com/zsleyer/encounty/backend/internal/state"

// --- Response types ----------------------------------------------------------

// CountResponse is returned by increment, decrement, and set_encounters.
type CountResponse struct {
	Count int `json:"count"`
}

// OKResponse signals a successful operation.
type OKResponse struct {
	OK bool `json:"ok"`
}

// StatusResponse carries a single status string.
type StatusResponse struct {
	Status string `json:"status"`
}

// PathResponse returns a filesystem path.
type PathResponse struct {
	Path string `json:"path"`
}

// FilenameResponse returns an uploaded file's name.
type FilenameResponse struct {
	Filename string `json:"filename"`
}

// VersionResponse contains build information.
type VersionResponse struct {
	Version   string `json:"version"`
	Commit    string `json:"commit"`
	BuildDate string `json:"build_date"`
	Display   string `json:"display"`
}

// LicenseAcceptResponse confirms license acceptance.
type LicenseAcceptResponse struct {
	LicenseAccepted bool `json:"license_accepted"`
}

// HotkeyUpdateResponse echoes the updated action and key.
type HotkeyUpdateResponse struct {
	Action string `json:"action"`
	Key    string `json:"key"`
}

// HotkeysStatusResponse reports hotkey backend availability.
type HotkeysStatusResponse struct {
	Available bool `json:"available"`
}

// OverlayStateResponse carries the active Pokemon for the OBS overlay.
type OverlayStateResponse struct {
	ActivePokemon *state.Pokemon `json:"active_pokemon"`
	ActiveID      string         `json:"active_id"`
}

// DetectorRunResponse reports whether a detector is running.
type DetectorRunResponse struct {
	OK      bool `json:"ok"`
	Running bool `json:"running"`
}

// TemplateUploadResponse returns the new template's index and DB ID.
type TemplateUploadResponse struct {
	Index        int   `json:"index"`
	TemplateDBID int64 `json:"template_db_id"`
}

// MatchFrameResponse carries the result of a browser-submitted frame match.
type MatchFrameResponse struct {
	Match      bool    `json:"match"`
	State      string  `json:"state"`
	Confidence float64 `json:"confidence"`
}

// ImportResponse reports how many templates were imported.
type ImportResponse struct {
	Imported int `json:"imported"`
}

// PokedexSyncResponse reports the result of a Pokedex sync operation.
type PokedexSyncResponse struct {
	Total        int      `json:"total"`
	Added        int      `json:"added"`
	NamesUpdated int      `json:"namesUpdated"`
	New          []string `json:"new"`
}

// RestoreResponse confirms a successful backup restore.
type RestoreResponse struct {
	OK bool `json:"ok"`
}

// --- Request types -----------------------------------------------------------

// SetEncountersRequest is the body for POST /api/pokemon/{id}/set_encounters.
type SetEncountersRequest struct {
	Count int `json:"count"`
}

// SetConfigPathRequest is the body for POST /api/settings/config-path.
type SetConfigPathRequest struct {
	Path string `json:"path"`
}

// UpdateHotkeyRequest is the body for PUT /api/hotkeys/{action}.
type UpdateHotkeyRequest struct {
	Key string `json:"key"`
}

// UpdateApplyRequest is the body for POST /api/update/apply.
type UpdateApplyRequest struct {
	DownloadURL string `json:"download_url"`
}

// BackgroundUploadRequest is the body for POST /api/backgrounds/upload.
type BackgroundUploadRequest struct {
	ImageBase64 string `json:"image_base64"`
}

// ImportTemplatesRequest is the body for POST /api/detector/{id}/import_templates.
type ImportTemplatesRequest struct {
	SourcePokemonID string `json:"source_pokemon_id"`
}

// SpriteTemplateRequest optionally overrides the sprite URL.
type SpriteTemplateRequest struct {
	SpriteURL string `json:"sprite_url"`
}

// TemplateUploadRequest carries a base64-encoded image and regions for template upload.
type TemplateUploadRequest struct {
	ImageBase64 string                `json:"imageBase64"`
	Regions     []state.MatchedRegion `json:"regions"`
}
