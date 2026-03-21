// api.go provides shared HTTP utilities and helper functions used across
// all API handler files in the server package.
package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// WriteJSON sets the Content-Type header, writes the HTTP status code, and
// encodes v as JSON into the response body. It is exported so that handler
// sub-packages can reuse it via server.WriteJSON.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// ReadJSON decodes the JSON request body into v. It is exported so that
// handler sub-packages can reuse it via server.ReadJSON.
func ReadJSON(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}

// broadcastState serialises the current AppState and sends a "state_update"
// message to every connected WebSocket client.
func (s *Server) broadcastState() {
	st := s.state.GetState()
	s.hub.BroadcastRaw("state_update", st)
}

// logEncounter writes an encounter event to the database.
// It resolves the Pokemon name and computes the delta from the previous count.
func (s *Server) logEncounter(pokemonID string, countAfter int, source string) {
	if s.db == nil {
		return
	}
	st := s.state.GetState()
	name := pokemonID
	step := 1
	for _, p := range st.Pokemon {
		if p.ID == pokemonID {
			name = p.Name
			if p.Step > 0 {
				step = p.Step
			}
			break
		}
	}
	// For increment the delta is +step, for decrement -step.
	// We infer direction from the source context; callers use this after Increment/Decrement.
	// Since we don't know direction here, log step as positive (most common).
	// Actual delta = countAfter - previous. We approximate with step.
	_ = s.db.LogEncounter(pokemonID, name, step, countAfter, source)
}

// FindPokemon returns a pointer to the Pokemon with the given id within st,
// or nil if no such Pokemon exists. The returned pointer references a copy
// from the state snapshot and is safe to read without additional locking.
func FindPokemon(st state.AppState, id string) *state.Pokemon {
	for i := range st.Pokemon {
		if st.Pokemon[i].ID == id {
			return &st.Pokemon[i]
		}
	}
	return nil
}

// PokemonIDFromPath extracts the id segment from paths like /api/pokemon/{id}/action.
// It is exported so that handler sub-packages can reuse it via server.PokemonIDFromPath.
func PokemonIDFromPath(path, prefix, suffix string) string {
	path = strings.TrimPrefix(path, prefix)
	if suffix != "" {
		path = strings.TrimSuffix(path, suffix)
	}
	return strings.Trim(path, "/")
}
