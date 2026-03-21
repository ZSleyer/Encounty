// Package httputil provides shared HTTP helper functions used across handler
// sub-packages to avoid circular imports with the server package.
package httputil

import (
	"encoding/json"
	"net/http"
	"strings"
)

// WriteJSON marshals v as JSON and writes it with the given status code.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// ReadJSON decodes the JSON request body into v.
func ReadJSON(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}

// PokemonIDFromPath extracts the id segment from paths like /api/pokemon/{id}/action.
func PokemonIDFromPath(path, prefix, suffix string) string {
	path = strings.TrimPrefix(path, prefix)
	if suffix != "" {
		path = strings.TrimSuffix(path, suffix)
	}
	return strings.Trim(path, "/")
}

// IDFromPath extracts an identifier segment from a URL path by stripping a
// known prefix and optional suffix. It is a general-purpose alias suited for
// any resource type (stats, detector, etc.).
func IDFromPath(path, prefix, suffix string) string {
	return PokemonIDFromPath(path, prefix, suffix)
}

// ErrResp is a generic JSON error envelope returned by handlers.
type ErrResp struct {
	Error string `json:"error"`
}
