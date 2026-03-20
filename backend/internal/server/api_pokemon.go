// api_pokemon.go — HTTP handlers for Pokemon CRUD and encounter mutations.
package server

import (
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// handleAddPokemon creates a new Pokémon entry, assigns a UUID and timestamp,
// and appends it to the state. POST /api/pokemon
//
// @Summary      Create a new Pokemon
// @Description  Creates a new Pokemon entry with a generated UUID and timestamp
// @Tags         pokemon
// @Accept       json
// @Produce      json
// @Param        pokemon body state.Pokemon true "Pokemon to create"
// @Success      201 {object} state.Pokemon
// @Failure      400 {object} errResp
// @Router       /pokemon [post]
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

// handleUpdatePokemon applies the JSON body fields to the Pokémon with the
// given id. PUT /api/pokemon/{id}
//
// @Summary      Update a Pokemon
// @Description  Applies the JSON body fields to the Pokemon with the given ID
// @Tags         pokemon
// @Accept       json
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Param        pokemon body state.Pokemon true "Updated Pokemon fields"
// @Success      200 {object} state.AppState
// @Failure      400 {object} errResp
// @Failure      404 {object} errResp
// @Router       /pokemon/{id} [put]
func (s *Server) handleUpdatePokemon(w http.ResponseWriter, r *http.Request, id string) {
	var p state.Pokemon
	if err := readJSON(r, &p); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	if !s.state.UpdatePokemon(id, p) {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	writeJSON(w, http.StatusOK, s.state.GetState())
}

// handleDeletePokemon removes the Pokémon with the given id.
// It also stops any running detector goroutine and removes the template files.
// DELETE /api/pokemon/{id}
//
// @Summary      Delete a Pokemon
// @Description  Removes the Pokemon, stops its detector, and deletes template files
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} errResp
// @Router       /pokemon/{id} [delete]
func (s *Server) handleDeletePokemon(w http.ResponseWriter, _ *http.Request, id string) {
	if s.detectorMgr != nil {
		s.detectorMgr.Stop(id)
	}
	_ = os.RemoveAll(filepath.Join(s.state.GetConfigDir(), "templates", id))
	if !s.state.DeletePokemon(id) {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("pokemon_deleted", map[string]any{"pokemon_id": id})
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleIncrement adds one encounter to the Pokémon and broadcasts both a
// targeted "encounter_added" event and a full state update.
// POST /api/pokemon/{id}/increment
//
// @Summary      Increment encounter count
// @Description  Adds one encounter to the Pokemon and broadcasts the update
// @Tags         pokemon
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Success      200 {object} CountResponse
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/increment [post]
func (s *Server) handleIncrement(w http.ResponseWriter, _ *http.Request, id string) {
	count, ok := s.state.Increment(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.logEncounter(id, count, "api")
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("encounter_added", map[string]any{"pokemon_id": id, "count": count})
	s.broadcastState()
	writeJSON(w, http.StatusOK, CountResponse{Count: count})
}

// handleDecrement subtracts one encounter (floor 0) from the Pokémon.
// POST /api/pokemon/{id}/decrement
//
// @Summary      Decrement encounter count
// @Description  Subtracts one encounter from the Pokemon (floor 0)
// @Tags         pokemon
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Success      200 {object} CountResponse
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/decrement [post]
func (s *Server) handleDecrement(w http.ResponseWriter, _ *http.Request, id string) {
	count, ok := s.state.Decrement(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.logEncounter(id, count, "api")
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("encounter_removed", map[string]any{"pokemon_id": id, "count": count})
	s.broadcastState()
	writeJSON(w, http.StatusOK, CountResponse{Count: count})
}

// handleReset zeroes out the encounter counter for the Pokémon.
// POST /api/pokemon/{id}/reset
//
// @Summary      Reset encounter count
// @Description  Zeroes out the encounter counter for the Pokemon
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/reset [post]
func (s *Server) handleReset(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.Reset(id) {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("encounter_reset", map[string]any{"pokemon_id": id})
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleSetEncounters sets the encounter count to an exact value.
// POST /api/pokemon/{id}/set_encounters
//
// @Summary      Set encounter count
// @Description  Sets the encounter count to an exact value
// @Tags         pokemon
// @Accept       json
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Param        body body SetEncountersRequest true "Encounter count to set"
// @Success      200 {object} CountResponse
// @Failure      400 {object} errResp
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/set_encounters [post]
func (s *Server) handleSetEncounters(w http.ResponseWriter, r *http.Request, id string) {
	var body SetEncountersRequest
	if err := readJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	count, ok := s.state.SetEncounters(id, body.Count)
	if !ok {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("encounter_set", map[string]any{"pokemon_id": id, "count": count})
	s.broadcastState()
	writeJSON(w, http.StatusOK, CountResponse{Count: count})
}

// handleTimerStart begins the per-Pokemon timer.
// POST /api/pokemon/{id}/timer/start
//
// @Summary      Start Pokemon timer
// @Description  Begins the per-Pokemon timer
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/timer/start [post]
func (s *Server) handleTimerStart(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.StartTimer(id) {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleTimerStop stops the per-Pokemon timer and accumulates elapsed time.
// POST /api/pokemon/{id}/timer/stop
//
// @Summary      Stop Pokemon timer
// @Description  Stops the per-Pokemon timer and accumulates elapsed time
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/timer/stop [post]
func (s *Server) handleTimerStop(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.StopTimer(id) {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleTimerReset clears the per-Pokemon timer entirely.
// POST /api/pokemon/{id}/timer/reset
//
// @Summary      Reset Pokemon timer
// @Description  Clears the per-Pokemon timer entirely
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/timer/reset [post]
func (s *Server) handleTimerReset(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.ResetTimer(id) {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleActivate sets the given Pokémon as the active one for hotkey actions.
// POST /api/pokemon/{id}/activate
//
// @Summary      Activate a Pokemon
// @Description  Sets the given Pokemon as the active one for hotkey actions
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/activate [post]
func (s *Server) handleActivate(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.SetActive(id) {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleCompletePokemon marks the hunt as finished by stamping CompletedAt.
// POST /api/pokemon/{id}/complete
//
// @Summary      Complete a Pokemon hunt
// @Description  Marks the hunt as finished by stamping CompletedAt
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/complete [post]
func (s *Server) handleCompletePokemon(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.CompletePokemon(id) {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("pokemon_completed", map[string]any{"pokemon_id": id})
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleUncompletePokemon clears CompletedAt, returning the Pokémon to
// active-hunt status. POST /api/pokemon/{id}/uncomplete
//
// @Summary      Uncomplete a Pokemon hunt
// @Description  Clears CompletedAt, returning the Pokemon to active-hunt status
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/uncomplete [post]
func (s *Server) handleUncompletePokemon(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.UncompletePokemon(id) {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleUnlinkOverlay copies the resolved overlay into the Pokemon and sets
// its mode to "custom", breaking any link to another Pokemon's overlay.
// POST /api/pokemon/{id}/overlay/unlink
//
// @Summary      Unlink Pokemon overlay
// @Description  Copies the resolved overlay into the Pokemon and sets mode to custom
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/overlay/unlink [post]
func (s *Server) handleUnlinkOverlay(w http.ResponseWriter, r *http.Request) {
	id := pokemonIDFromPath(r.URL.Path, "/api/pokemon/", "/overlay/unlink")
	if !s.state.UnlinkOverlay(id) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}
