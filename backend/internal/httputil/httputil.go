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
		WriteError(w, http.StatusRequestEntityTooLarge, "request body exceeds the size limit")
		return
	}
	WriteError(w, http.StatusBadRequest, malformedMsg)
}

// WriteJSON marshals v as JSON and writes it with the given status code.
//
// The nosniff header goes out with every response written through here, because
// net/http.Error sets it unconditionally and handlers that moved off http.Error
// would otherwise have lost it silently. The only responses that do not pass
// through this function are the Swagger spec and UI, which set it themselves.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// ReadJSON decodes the JSON request body into v.
func ReadJSON(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}

// IDFromPath extracts an identifier segment from a URL path by stripping a
// known prefix and an optional suffix, as in /api/pokemon/{id}/action.
func IDFromPath(path, prefix, suffix string) string {
	path = strings.TrimPrefix(path, prefix)
	if suffix != "" {
		path = strings.TrimSuffix(path, suffix)
	}
	return strings.Trim(path, "/")
}

// ErrResp is a generic JSON error envelope returned by handlers.
type ErrResp struct {
	Error string `json:"error"`
}

// WriteError writes msg as a JSON error envelope with the given status code.
// Handlers construct that envelope on nearly two hundred paths; routing them
// through one function keeps the wire format in a single place.
func WriteError(w http.ResponseWriter, status int, msg string) {
	WriteJSON(w, status, ErrResp{Error: msg})
}
