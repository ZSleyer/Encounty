// Package httputil provides shared HTTP helper functions used across handler
// sub-packages to avoid circular imports with the server package.
package httputil

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// LimitBody caps how much of the request body a handler will read. Without it a
// single upload can exhaust memory, since ParseMultipartForm only bounds the
// in-memory part and spills the rest to disk, and io.ReadAll bounds nothing.
// Call it before parsing the body.
func LimitBody(w http.ResponseWriter, r *http.Request, maxBytes int64) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
}

// WriteBodyError reports err from reading a limited body, distinguishing a
// payload that hit the limit (413) from one that was merely malformed (400).
func WriteBodyError(w http.ResponseWriter, err error, malformedMsg string) {
	var maxErr *http.MaxBytesError
	if errors.As(err, &maxErr) {
		http.Error(w, "request body exceeds the size limit", http.StatusRequestEntityTooLarge)
		return
	}
	http.Error(w, malformedMsg, http.StatusBadRequest)
}

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
