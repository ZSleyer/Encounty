// api_types.go — Named request/response types for Swagger documentation.
// These replace anonymous map literals in handlers so that swaggo can generate
// proper OpenAPI schemas.
package server

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

// HotkeyUpdateResponse echoes the updated action and key.
type HotkeyUpdateResponse struct {
	Action string `json:"action"`
	Key    string `json:"key"`
}

// HotkeysStatusResponse reports hotkey backend availability.
type HotkeysStatusResponse struct {
	Available bool `json:"available"`
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

// BackgroundUploadRequest is the body for POST /api/backgrounds/upload.
type BackgroundUploadRequest struct {
	ImageBase64 string `json:"image_base64"`
}
