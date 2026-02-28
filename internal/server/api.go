package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/encounty/encounty/internal/state"
	"github.com/google/uuid"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func readJSON(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}

type errResp struct {
	Error string `json:"error"`
}

func (s *Server) handleGetState(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.state.GetState())
}

func (s *Server) handleAddPokemon(w http.ResponseWriter, r *http.Request) {
	var p state.Pokemon
	if err := readJSON(r, &p); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	p.ID = uuid.NewString()
	p.CreatedAt = time.Now()
	// p.Phase removed
	s.state.AddPokemon(p)
	s.state.ScheduleSave()
	s.broadcastState()
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) handleUpdatePokemon(w http.ResponseWriter, r *http.Request, id string) {
	var p state.Pokemon
	if err := readJSON(r, &p); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	if !s.state.UpdatePokemon(id, p) {
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	writeJSON(w, http.StatusOK, s.state.GetState())
}

func (s *Server) handleDeletePokemon(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.DeletePokemon(id) {
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleIncrement(w http.ResponseWriter, _ *http.Request, id string) {
	count, ok := s.state.Increment(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("encounter_added", map[string]any{"pokemon_id": id, "count": count})
	s.broadcastState()
	if s.fileWriter != nil {
		s.fileWriter.Write(s.state.GetState())
	}
	writeJSON(w, http.StatusOK, map[string]int{"count": count})
}

func (s *Server) handleDecrement(w http.ResponseWriter, _ *http.Request, id string) {
	count, ok := s.state.Decrement(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	if s.fileWriter != nil {
		s.fileWriter.Write(s.state.GetState())
	}
	writeJSON(w, http.StatusOK, map[string]int{"count": count})
}

func (s *Server) handleReset(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.Reset(id) {
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	if s.fileWriter != nil {
		s.fileWriter.Write(s.state.GetState())
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleActivate(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.SetActive(id) {
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGetSessions(w http.ResponseWriter, r *http.Request) {
	st := s.state.GetState()
	writeJSON(w, http.StatusOK, st.Sessions)
}

func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var settings state.Settings
	if err := readJSON(r, &settings); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	s.state.UpdateSettings(settings)
	s.state.ScheduleSave()
	s.broadcastState()
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleUpdateHotkeys(w http.ResponseWriter, r *http.Request) {
	var hk state.HotkeyMap
	if err := readJSON(r, &hk); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	s.state.UpdateHotkeys(hk)
	s.state.ScheduleSave()
	if s.hotkeyMgr != nil {
		if err := s.hotkeyMgr.Reload(hk, s.state); err != nil {
			writeJSON(w, http.StatusConflict, errResp{"hotkey conflict: " + err.Error()})
			return
		}
	}
	s.broadcastState()
	writeJSON(w, http.StatusOK, hk)
}

func (s *Server) handleGetGames(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, loadGames())
}

func (s *Server) handleOverlayState(w http.ResponseWriter, r *http.Request) {
	st := s.state.GetState()
	var active *state.Pokemon
	for i := range st.Pokemon {
		if st.Pokemon[i].ID == st.ActiveID {
			active = &st.Pokemon[i]
			break
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"active_pokemon": active,
		"active_id":      st.ActiveID,
	})
}

func (s *Server) broadcastState() {
	st := s.state.GetState()
	s.hub.BroadcastRaw("state_update", st)
}

func (s *Server) handleWSMessage(msg WSMessage) {
	type idPayload struct {
		PokemonID string `json:"pokemon_id"`
	}

	switch msg.Type {
	case "increment":
		var p idPayload
		if json.Unmarshal(msg.Payload, &p) == nil && p.PokemonID != "" {
			count, ok := s.state.Increment(p.PokemonID)
			if ok {
				s.state.ScheduleSave()
				s.hub.BroadcastRaw("encounter_added", map[string]any{"pokemon_id": p.PokemonID, "count": count})
				s.broadcastState()
				if s.fileWriter != nil {
					s.fileWriter.Write(s.state.GetState())
				}
			}
		}
	case "decrement":
		var p idPayload
		if json.Unmarshal(msg.Payload, &p) == nil && p.PokemonID != "" {
			s.state.Decrement(p.PokemonID)
			s.state.ScheduleSave()
			s.broadcastState()
			if s.fileWriter != nil {
				s.fileWriter.Write(s.state.GetState())
			}
		}
	case "reset":
		var p idPayload
		if json.Unmarshal(msg.Payload, &p) == nil && p.PokemonID != "" {
			s.state.Reset(p.PokemonID)
			s.state.ScheduleSave()
			s.broadcastState()
			if s.fileWriter != nil {
				s.fileWriter.Write(s.state.GetState())
			}
		}
	case "set_active":
		var p idPayload
		if json.Unmarshal(msg.Payload, &p) == nil && p.PokemonID != "" {
			s.state.SetActive(p.PokemonID)
			s.state.ScheduleSave()
			s.broadcastState()
		}
	case "update_hotkeys":
		var hk state.HotkeyMap
		if json.Unmarshal(msg.Payload, &hk) == nil {
			s.state.UpdateHotkeys(hk)
			s.state.ScheduleSave()
			if s.hotkeyMgr != nil {
				_ = s.hotkeyMgr.Reload(hk, s.state)
			}
			s.broadcastState()
		}
	}
}

// pokemonIDFromPath extracts the id segment from paths like /api/pokemon/{id}/action
func pokemonIDFromPath(path, prefix, suffix string) string {
	path = strings.TrimPrefix(path, prefix)
	if suffix != "" {
		path = strings.TrimSuffix(path, suffix)
	}
	return strings.Trim(path, "/")
}
