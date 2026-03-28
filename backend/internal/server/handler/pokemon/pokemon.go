// Package pokemon provides HTTP handlers for Pokemon CRUD operations and
// encounter mutations (increment, decrement, reset, set, timers, completion).
package pokemon

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/state"
)

const pokemonAPIPrefix = "/api/pokemon/"

const errPokemonNotFound = "pokemon not found"

// --- DTO types ---------------------------------------------------------------

// countResponse is returned by increment, decrement, and set_encounters.
type countResponse struct {
	Count int `json:"count"`
}

// setEncountersRequest is the body for POST /api/pokemon/{id}/set_encounters.
type setEncountersRequest struct {
	Count int `json:"count"`
}

// --- Deps interface ----------------------------------------------------------

// DetectorStopper can stop a running detector for a given Pokemon ID.
type DetectorStopper interface {
	Stop(pokemonID string)
}

// EncounterLogger persists encounter events to the database.
type EncounterLogger interface {
	LogEncounter(pokemonID, pokemonName string, delta, countAfter int, source string) error
}

// Broadcaster sends typed messages to all connected WebSocket clients.
type Broadcaster interface {
	BroadcastRaw(msgType string, payload any)
}

// Deps declares the capabilities that pokemon handlers require from the
// application layer. Each method maps to a specific subsystem so this package
// stays decoupled from the concrete Server type.
type Deps interface {
	// State mutations
	StateAddPokemon(p state.Pokemon)
	StateUpdatePokemon(id string, update state.Pokemon) bool
	StateDeletePokemon(id string) bool
	StateIncrement(id string) (int, bool)
	StateDecrement(id string) (int, bool)
	StateReset(id string) bool
	StateSetEncounters(id string, count int) (int, bool)
	StateSetActive(id string) bool
	StateCompletePokemon(id string) bool
	StateUncompletePokemon(id string) bool
	StateUnlinkOverlay(pokemonID string) bool
	StateStartTimer(id string) bool
	StateStopTimer(id string) bool
	StateResetTimer(id string) bool
	StateGetState() state.AppState
	StateScheduleSave()

	// Infrastructure
	ConfigDir() string
	DetectorStopper() DetectorStopper
	EncounterLogger() EncounterLogger
	Broadcaster() Broadcaster
	BroadcastState()
}

// --- Handler -----------------------------------------------------------------

// handler groups the Pokemon HTTP handlers together with their dependencies.
type handler struct {
	deps Deps
}

// RegisterRoutes wires the /api/pokemon and /api/pokemon/{id}/* routes onto mux.
func RegisterRoutes(mux *http.ServeMux, d Deps) {
	h := &handler{deps: d}

	mux.HandleFunc("/api/pokemon", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			st := d.StateGetState()
			httputil.WriteJSON(w, http.StatusOK, st.Pokemon)
		case http.MethodPost:
			h.handleAddPokemon(w, r)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc(pokemonAPIPrefix, func(w http.ResponseWriter, r *http.Request) {
		h.dispatchPokemonAction(w, r)
	})
}

// --- Route dispatch ----------------------------------------------------------

// dispatchPokemonAction routes a /api/pokemon/{id}/... request to the
// appropriate handler based on the URL suffix.
func (h *handler) dispatchPokemonAction(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	switch {
	case strings.HasSuffix(path, "/overlay/unlink"):
		if r.Method == http.MethodPost {
			h.handleUnlinkOverlay(w, r)
		} else {
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	case strings.HasSuffix(path, "/set_encounters"):
		h.handleSetEncounters(w, r, httputil.PokemonIDFromPath(path, pokemonAPIPrefix, "/set_encounters"))
	case strings.HasSuffix(path, "/timer/start"):
		h.handleTimerStart(w, r, httputil.PokemonIDFromPath(path, pokemonAPIPrefix, "/timer/start"))
	case strings.HasSuffix(path, "/timer/stop"):
		h.handleTimerStop(w, r, httputil.PokemonIDFromPath(path, pokemonAPIPrefix, "/timer/stop"))
	case strings.HasSuffix(path, "/timer/reset"):
		h.handleTimerReset(w, r, httputil.PokemonIDFromPath(path, pokemonAPIPrefix, "/timer/reset"))
	case strings.HasSuffix(path, "/increment"):
		h.handleIncrement(w, r, httputil.PokemonIDFromPath(path, pokemonAPIPrefix, "/increment"))
	case strings.HasSuffix(path, "/decrement"):
		h.handleDecrement(w, r, httputil.PokemonIDFromPath(path, pokemonAPIPrefix, "/decrement"))
	case strings.HasSuffix(path, "/reset"):
		h.handleReset(w, r, httputil.PokemonIDFromPath(path, pokemonAPIPrefix, "/reset"))
	case strings.HasSuffix(path, "/activate"):
		h.handleActivate(w, r, httputil.PokemonIDFromPath(path, pokemonAPIPrefix, "/activate"))
	case strings.HasSuffix(path, "/complete"):
		h.handleCompletePokemon(w, r, httputil.PokemonIDFromPath(path, pokemonAPIPrefix, "/complete"))
	case strings.HasSuffix(path, "/uncomplete"):
		h.handleUncompletePokemon(w, r, httputil.PokemonIDFromPath(path, pokemonAPIPrefix, "/uncomplete"))
	default:
		id := httputil.PokemonIDFromPath(path, pokemonAPIPrefix, "")
		switch r.Method {
		case http.MethodPut:
			h.handleUpdatePokemon(w, r, id)
		case http.MethodDelete:
			h.handleDeletePokemon(w, r, id)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

// --- Handlers ----------------------------------------------------------------

// handleAddPokemon creates a new Pokemon entry, assigns a UUID and timestamp,
// and appends it to the state. POST /api/pokemon
//
// @Summary      Create a new Pokemon
// @Description  Creates a new Pokemon entry with a generated UUID and timestamp
// @Tags         pokemon
// @Accept       json
// @Produce      json
// @Param        pokemon body state.Pokemon true "Pokemon to create"
// @Success      201 {object} state.Pokemon
// @Failure      400 {object} httputil.ErrResp
// @Router       /pokemon [post]
func (h *handler) handleAddPokemon(w http.ResponseWriter, r *http.Request) {
	var p state.Pokemon
	if err := httputil.ReadJSON(r, &p); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	p.ID = uuid.NewString()
	p.CreatedAt = time.Now()
	if p.DetectorConfig == nil {
		p.DetectorConfig = state.DefaultDetectorConfig()
	}
	h.deps.StateAddPokemon(p)
	h.deps.StateScheduleSave()
	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusCreated, p)
}

// handleUpdatePokemon applies the JSON body fields to the Pokemon with the
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
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Router       /pokemon/{id} [put]
func (h *handler) handleUpdatePokemon(w http.ResponseWriter, r *http.Request, id string) {
	var p state.Pokemon
	if err := httputil.ReadJSON(r, &p); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	if !h.deps.StateUpdatePokemon(id, p) {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}
	h.deps.StateScheduleSave()
	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusOK, h.deps.StateGetState())
}

// handleDeletePokemon removes the Pokemon with the given id.
// It also stops any running detector goroutine and removes the template files.
// DELETE /api/pokemon/{id}
//
// @Summary      Delete a Pokemon
// @Description  Removes the Pokemon, stops its detector, and deletes template files
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} httputil.ErrResp
// @Router       /pokemon/{id} [delete]
func (h *handler) handleDeletePokemon(w http.ResponseWriter, _ *http.Request, id string) {
	if ds := h.deps.DetectorStopper(); ds != nil {
		ds.Stop(id)
	}
	_ = os.RemoveAll(filepath.Join(h.deps.ConfigDir(), "templates", id))
	if !h.deps.StateDeletePokemon(id) {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}
	h.deps.StateScheduleSave()
	h.deps.Broadcaster().BroadcastRaw("pokemon_deleted", map[string]any{"pokemon_id": id})
	h.deps.BroadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleIncrement adds one encounter to the Pokemon and broadcasts both a
// targeted "encounter_added" event and a full state update.
// POST /api/pokemon/{id}/increment
//
// @Summary      Increment encounter count
// @Description  Adds one encounter to the Pokemon and broadcasts the update
// @Tags         pokemon
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Success      200 {object} countResponse
// @Failure      404 {object} httputil.ErrResp
// @Router       /pokemon/{id}/increment [post]
func (h *handler) handleIncrement(w http.ResponseWriter, _ *http.Request, id string) {
	count, ok := h.deps.StateIncrement(id)
	if !ok {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}
	h.logEncounter(id, count, "api")
	h.deps.StateScheduleSave()
	h.deps.Broadcaster().BroadcastRaw("encounter_added", map[string]any{"pokemon_id": id, "count": count})
	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusOK, countResponse{Count: count})
}

// handleDecrement subtracts one encounter (floor 0) from the Pokemon.
// POST /api/pokemon/{id}/decrement
//
// @Summary      Decrement encounter count
// @Description  Subtracts one encounter from the Pokemon (floor 0)
// @Tags         pokemon
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Success      200 {object} countResponse
// @Failure      404 {object} httputil.ErrResp
// @Router       /pokemon/{id}/decrement [post]
func (h *handler) handleDecrement(w http.ResponseWriter, _ *http.Request, id string) {
	count, ok := h.deps.StateDecrement(id)
	if !ok {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}
	h.logEncounter(id, count, "api")
	h.deps.StateScheduleSave()
	h.deps.Broadcaster().BroadcastRaw("encounter_removed", map[string]any{"pokemon_id": id, "count": count})
	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusOK, countResponse{Count: count})
}

// handleReset zeroes out the encounter counter for the Pokemon.
// POST /api/pokemon/{id}/reset
//
// @Summary      Reset encounter count
// @Description  Zeroes out the encounter counter for the Pokemon
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} httputil.ErrResp
// @Router       /pokemon/{id}/reset [post]
func (h *handler) handleReset(w http.ResponseWriter, _ *http.Request, id string) {
	h.pokemonMutate(w, id, "encounter_reset", h.deps.StateReset)
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
// @Param        body body setEncountersRequest true "Encounter count to set"
// @Success      200 {object} countResponse
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Router       /pokemon/{id}/set_encounters [post]
func (h *handler) handleSetEncounters(w http.ResponseWriter, r *http.Request, id string) {
	var body setEncountersRequest
	if err := httputil.ReadJSON(r, &body); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	count, ok := h.deps.StateSetEncounters(id, body.Count)
	if !ok {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}
	h.deps.StateScheduleSave()
	h.deps.Broadcaster().BroadcastRaw("encounter_set", map[string]any{"pokemon_id": id, "count": count})
	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusOK, countResponse{Count: count})
}

// handleTimerStart begins the per-Pokemon timer.
// POST /api/pokemon/{id}/timer/start
//
// @Summary      Start Pokemon timer
// @Description  Begins the per-Pokemon timer
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} httputil.ErrResp
// @Router       /pokemon/{id}/timer/start [post]
func (h *handler) handleTimerStart(w http.ResponseWriter, _ *http.Request, id string) {
	h.pokemonMutate(w, id, "", h.deps.StateStartTimer)
}

// handleTimerStop stops the per-Pokemon timer and accumulates elapsed time.
// POST /api/pokemon/{id}/timer/stop
//
// @Summary      Stop Pokemon timer
// @Description  Stops the per-Pokemon timer and accumulates elapsed time
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} httputil.ErrResp
// @Router       /pokemon/{id}/timer/stop [post]
func (h *handler) handleTimerStop(w http.ResponseWriter, _ *http.Request, id string) {
	h.pokemonMutate(w, id, "", h.deps.StateStopTimer)
}

// handleTimerReset clears the per-Pokemon timer entirely.
// POST /api/pokemon/{id}/timer/reset
//
// @Summary      Reset Pokemon timer
// @Description  Clears the per-Pokemon timer entirely
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} httputil.ErrResp
// @Router       /pokemon/{id}/timer/reset [post]
func (h *handler) handleTimerReset(w http.ResponseWriter, _ *http.Request, id string) {
	h.pokemonMutate(w, id, "", h.deps.StateResetTimer)
}

// handleActivate sets the given Pokemon as the active one for hotkey actions.
// POST /api/pokemon/{id}/activate
//
// @Summary      Activate a Pokemon
// @Description  Sets the given Pokemon as the active one for hotkey actions
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} httputil.ErrResp
// @Router       /pokemon/{id}/activate [post]
func (h *handler) handleActivate(w http.ResponseWriter, _ *http.Request, id string) {
	h.pokemonMutate(w, id, "", h.deps.StateSetActive)
}

// handleCompletePokemon marks the hunt as finished by stamping CompletedAt.
// POST /api/pokemon/{id}/complete
//
// @Summary      Complete a Pokemon hunt
// @Description  Marks the hunt as finished by stamping CompletedAt
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} httputil.ErrResp
// @Router       /pokemon/{id}/complete [post]
func (h *handler) handleCompletePokemon(w http.ResponseWriter, _ *http.Request, id string) {
	h.pokemonMutate(w, id, "pokemon_completed", h.deps.StateCompletePokemon)
}

// handleUncompletePokemon clears CompletedAt, returning the Pokemon to
// active-hunt status. POST /api/pokemon/{id}/uncomplete
//
// @Summary      Uncomplete a Pokemon hunt
// @Description  Clears CompletedAt, returning the Pokemon to active-hunt status
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} httputil.ErrResp
// @Router       /pokemon/{id}/uncomplete [post]
func (h *handler) handleUncompletePokemon(w http.ResponseWriter, _ *http.Request, id string) {
	h.pokemonMutate(w, id, "", h.deps.StateUncompletePokemon)
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
// @Failure      404 {object} httputil.ErrResp
// @Router       /pokemon/{id}/overlay/unlink [post]
func (h *handler) handleUnlinkOverlay(w http.ResponseWriter, r *http.Request) {
	id := httputil.PokemonIDFromPath(r.URL.Path, pokemonAPIPrefix, "/overlay/unlink")
	if !h.deps.StateUnlinkOverlay(id) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	h.deps.StateScheduleSave()
	h.deps.BroadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// pokemonMutate is a shared helper for handlers that perform a state mutation
// on a Pokemon identified by id. It calls mutateFn to perform the mutation,
// returns 404 when the Pokemon is not found, then schedules a save, broadcasts
// state, and writes 204 No Content. If eventType is non-empty, an additional
// typed event is broadcast with the Pokemon ID.
func (h *handler) pokemonMutate(w http.ResponseWriter, id string, eventType string, mutateFn func(string) bool) {
	if !mutateFn(id) {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}
	h.deps.StateScheduleSave()
	if eventType != "" {
		h.deps.Broadcaster().BroadcastRaw(eventType, map[string]any{"pokemon_id": id})
	}
	h.deps.BroadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// --- Helpers -----------------------------------------------------------------

// logEncounter writes an encounter event to the database.
// It resolves the Pokemon name and computes the step delta.
func (h *handler) logEncounter(pokemonID string, countAfter int, source string) {
	logger := h.deps.EncounterLogger()
	if logger == nil {
		return
	}
	st := h.deps.StateGetState()
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
	_ = logger.LogEncounter(pokemonID, name, step, countAfter, source)
}
