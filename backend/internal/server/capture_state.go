// capture_state.go tracks which Pokémon currently have a live browser
// capture stream or detection loop attached, and exposes the frontend
// heartbeat endpoints that keep that record current.

package server

import (
	"encoding/json"
	"net/http"
)

// SetCaptureState records whether the given Pokémon currently has a live
// browser capture stream. Called by the frontend after each start/stop so
// the hotkey hunt gate can decide without guessing.
func (s *Server) SetCaptureState(pokemonID string, capturing bool) {
	s.capturingMu.Lock()
	defer s.capturingMu.Unlock()
	if capturing {
		s.capturing[pokemonID] = true
	} else {
		delete(s.capturing, pokemonID)
	}
}

// isCapturing reports whether the given Pokémon currently has a live
// capture stream according to the last frontend heartbeat.
func (s *Server) isCapturing(pokemonID string) bool {
	s.capturingMu.RLock()
	defer s.capturingMu.RUnlock()
	return s.capturing[pokemonID]
}

// SetDetectionState records whether the given Pokémon currently has an
// active in-browser detection loop. The backend uses this to decide
// whether a hunt-toggle hotkey should start or stop when the timer is
// not itself the source of "hunt running" (detector-only mode).
func (s *Server) SetDetectionState(pokemonID string, detecting bool) {
	s.detectingMu.Lock()
	defer s.detectingMu.Unlock()
	if detecting {
		s.detecting[pokemonID] = true
	} else {
		delete(s.detecting, pokemonID)
	}
}

// isDetecting reports whether the given Pokémon has an active detection
// loop according to the last frontend heartbeat.
func (s *Server) isDetecting(pokemonID string) bool {
	s.detectingMu.RLock()
	defer s.detectingMu.RUnlock()
	return s.detecting[pokemonID]
}

// handleCaptureState accepts POST {pokemon_id, capturing} heartbeats from
// the frontend CaptureServiceProvider. The state is memory-only and scoped
// to the current backend run: after a restart every stream has to be
// re-attached on the frontend side, which will re-post here.
func (s *Server) handleCaptureState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		PokemonID string `json:"pokemon_id"`
		Capturing bool   `json:"capturing"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.PokemonID == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	s.SetCaptureState(body.PokemonID, body.Capturing)
	w.WriteHeader(http.StatusNoContent)
}

// handleDetectionState accepts POST {pokemon_id, detecting} heartbeats
// from the frontend DetectionLoop registry so the backend knows which
// Pokémon currently have a live in-browser detection loop attached.
func (s *Server) handleDetectionState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		PokemonID string `json:"pokemon_id"`
		Detecting bool   `json:"detecting"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.PokemonID == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	s.SetDetectionState(body.PokemonID, body.Detecting)
	w.WriteHeader(http.StatusNoContent)
}
