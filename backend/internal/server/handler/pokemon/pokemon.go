// Package pokemon provides HTTP handlers for Pokemon CRUD operations and
// encounter mutations (increment, decrement, reset, set, timers, completion).
package pokemon

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/state"
)

const pokemonAPIPrefix = "/api/pokemon/"

const errPokemonNotFound = "pokemon not found"

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
	case path == pokemonAPIPrefix+"reorder":
		if r.Method == http.MethodPut {
			h.handleReorderPokemon(w, r)
		} else {
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	case strings.HasSuffix(path, "/overlay/unlink"):
		if r.Method == http.MethodPost {
			h.handleUnlinkOverlay(w, r)
		} else {
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	case strings.HasSuffix(path, "/sprite"):
		h.handleSprite(w, r, httputil.IDFromPath(path, pokemonAPIPrefix, "/sprite"))
	case strings.HasSuffix(path, "/set_encounters"):
		h.handleSetEncounters(w, r, httputil.IDFromPath(path, pokemonAPIPrefix, "/set_encounters"))
	case strings.HasSuffix(path, "/timer/start"):
		h.handleTimerStart(w, r, httputil.IDFromPath(path, pokemonAPIPrefix, "/timer/start"))
	case strings.HasSuffix(path, "/timer/stop"):
		h.handleTimerStop(w, r, httputil.IDFromPath(path, pokemonAPIPrefix, "/timer/stop"))
	case strings.HasSuffix(path, "/timer/reset"):
		h.handleTimerReset(w, r, httputil.IDFromPath(path, pokemonAPIPrefix, "/timer/reset"))
	case strings.HasSuffix(path, "/timer/set"):
		h.handleTimerSet(w, r, httputil.IDFromPath(path, pokemonAPIPrefix, "/timer/set"))
	case strings.HasSuffix(path, "/increment"):
		h.handleIncrement(w, r, httputil.IDFromPath(path, pokemonAPIPrefix, "/increment"))
	case strings.HasSuffix(path, "/decrement"):
		h.handleDecrement(w, r, httputil.IDFromPath(path, pokemonAPIPrefix, "/decrement"))
	case strings.HasSuffix(path, "/reset"):
		h.handleReset(w, r, httputil.IDFromPath(path, pokemonAPIPrefix, "/reset"))
	case strings.HasSuffix(path, "/activate"):
		h.handleActivate(w, r, httputil.IDFromPath(path, pokemonAPIPrefix, "/activate"))
	case strings.HasSuffix(path, "/complete"):
		h.handleCompletePokemon(w, r, httputil.IDFromPath(path, pokemonAPIPrefix, "/complete"))
	case strings.HasSuffix(path, "/completed_at"):
		if r.Method == http.MethodPut {
			h.handleSetCompletedAt(w, r, httputil.IDFromPath(path, pokemonAPIPrefix, "/completed_at"))
		} else {
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	case strings.HasSuffix(path, "/uncomplete"):
		h.handleUncompletePokemon(w, r, httputil.IDFromPath(path, pokemonAPIPrefix, "/uncomplete"))
	case strings.HasSuffix(path, "/fail"):
		h.handleFailPokemon(w, r, httputil.IDFromPath(path, pokemonAPIPrefix, "/fail"))
	case strings.HasSuffix(path, "/catch"):
		if r.Method == http.MethodPut {
			h.handleSetCatchMeta(w, r, httputil.IDFromPath(path, pokemonAPIPrefix, "/catch"))
		} else {
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	case strings.HasSuffix(path, "/phase"):
		id := httputil.IDFromPath(path, pokemonAPIPrefix, "/phase")
		switch r.Method {
		case http.MethodPost:
			h.handleEndPhase(w, r, id)
		case http.MethodDelete:
			h.handleUndoPhase(w, r, id)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	default:
		id := httputil.IDFromPath(path, pokemonAPIPrefix, "")
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
	if err := validateNewPokemon(p); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	// A posted entry may already carry a phase link, so it goes through the
	// same validator EndPhase uses. The resolved number replaces whatever the
	// client sent, including "let the backend derive it" (0). The state
	// snapshot is only taken when the body actually carries phase fields, so an
	// ordinary hunt is still created without reading the whole state.
	if p.PhaseOf != "" || p.PhaseNumber != 0 {
		number, err := state.ResolvePhaseLink(h.deps.StateGetState().Pokemon, "", p.PhaseOf, p.PhaseNumber)
		if err != nil {
			httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
			return
		}
		p.PhaseNumber = number
	}
	p.Nickname = strings.TrimSpace(p.Nickname)
	if p.PokedexIDs == nil {
		p.PokedexIDs = []string{"default"}
	}
	p.ID = uuid.NewString()
	p.CreatedAt = time.Now()
	applyEntryDefaults(&p)
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
	body, err := io.ReadAll(r.Body)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	var p state.Pokemon
	if err := json.Unmarshal(body, &p); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	h.keepOmittedAlwaysAppliedFields(id, &p, body)
	if err := validatePokemonGenders(p); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	if err := ValidateEntrySource(p.EntrySource); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	if err := ValidateShinyVariant(p.ShinyVariant); err != nil {
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
// It also stops any running detector goroutine and removes the template files
// and any uploaded sprite BLOB. The sprite is removed explicitly here rather
// than relying on the pokemon_sprites foreign key cascade, since that cascade
// only fires once the deletion is persisted to SQLite on the next state save.
// DELETE /api/pokemon/{id}
//
// @Summary      Delete a Pokemon
// @Description  Removes the Pokemon, stops its detector, and deletes its templates and any uploaded sprite
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} httputil.ErrResp
// @Router       /pokemon/{id} [delete]
func (h *handler) handleDeletePokemon(w http.ResponseWriter, _ *http.Request, id string) {
	if ds := h.deps.DetectorStopper(); ds != nil {
		ds.Stop(id)
	}
	if db := h.deps.PokemonDB(); db != nil {
		_ = db.DeleteSprite(id)
	}
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
	h.logEncounter(id, count, 1, "api")
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
	h.logEncounter(id, count, -1, "api")
	// Counting back down to zero clears the event history, but only for a hunt
	// without phases: the events of every earlier phase stay on the hunt, so
	// dropping them here would erase the whole chart instead of the few events
	// of the current phase.
	if count == 0 && !h.hasPhases(id) {
		if logger := h.deps.EncounterLogger(); logger != nil {
			_ = logger.DeleteEncounterEvents(id)
		}
	}
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
	if !h.deps.StateReset(id) {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}
	// A reset only zeroes the counter of the running phase; the phase entries
	// keep their own encounters. Dropping the events of a phased hunt here would
	// therefore erase history that the reset did not touch.
	if !h.hasPhases(id) {
		if logger := h.deps.EncounterLogger(); logger != nil {
			_ = logger.DeleteEncounterEvents(id)
		}
	}
	h.deps.StateScheduleSave()
	h.deps.Broadcaster().BroadcastRaw("encounter_reset", map[string]any{"pokemon_id": id})
	h.deps.BroadcastState()
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

// handleReorderPokemon assigns each Pokemon in the request body a zero-based
// SortOrder matching its position, then broadcasts the updated state.
// PUT /api/pokemon/reorder
//
// @Summary      Reorder Pokemon
// @Description  Assigns each Pokemon a zero-based SortOrder matching its position in the request order
// @Tags         pokemon
// @Accept       json
// @Param        body body reorderRequest true "Ordered Pokemon IDs"
// @Success      200 {object} state.AppState
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Router       /pokemon/reorder [put]
func (h *handler) handleReorderPokemon(w http.ResponseWriter, r *http.Request) {
	var body reorderRequest
	if err := httputil.ReadJSON(r, &body); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	if err := h.deps.StateReorderPokemon(body.Order); err != nil {
		// An unknown id means the client sent a stale or invalid ordering.
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: err.Error()})
		return
	}
	h.deps.StateScheduleSave()
	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusOK, h.deps.StateGetState())
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

// handleTimerSet sets the per-Pokemon timer to an exact value.
// POST /api/pokemon/{id}/timer/set
//
// @Summary      Set Pokemon timer
// @Description  Sets the per-Pokemon timer accumulated value to an exact millisecond value
// @Tags         pokemon
// @Accept       json
// @Param        id path string true "Pokemon ID"
// @Param        body body setTimerRequest true "Timer value"
// @Success      204
// @Failure      404 {object} httputil.ErrResp
// @Router       /pokemon/{id}/timer/set [post]
func (h *handler) handleTimerSet(w http.ResponseWriter, r *http.Request, id string) {
	var body setTimerRequest
	if err := httputil.ReadJSON(r, &body); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	if !h.deps.StateSetTimer(id, body.Ms) {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}
	h.deps.StateScheduleSave()
	h.deps.BroadcastState()
	w.WriteHeader(http.StatusNoContent)
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

// handleSetCompletedAt re-dates an entry that is already finished. It corrects
// the archive date of a hand-entered catch and of a tracked hunt alike, so it
// is not restricted to manual entries. Finishing a running hunt stays with
// /complete, which also finalizes the timer.
// PUT /api/pokemon/{id}/completed_at
//
// @Summary      Re-date a finished entry
// @Description  Overwrites CompletedAt of an already finished entry with the given RFC3339 timestamp
// @Tags         pokemon
// @Accept       json
// @Param        id path string true "Pokemon ID"
// @Param        body body setCompletedAtRequest true "New completion timestamp"
// @Success      204
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Router       /pokemon/{id}/completed_at [put]
func (h *handler) handleSetCompletedAt(w http.ResponseWriter, r *http.Request, id string) {
	var body setCompletedAtRequest
	if err := httputil.ReadJSON(r, &body); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	at, err := time.Parse(time.RFC3339, body.CompletedAt)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "completed_at must be an RFC3339 timestamp"})
		return
	}
	// The state lookup happens here rather than in the manager so a running
	// hunt can be answered with a 400 instead of the manager's plain false.
	entry, ok := findPokemonByID(h.deps.StateGetState().Pokemon, id)
	if !ok {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}
	if entry.CompletedAt == nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "the hunt is still running; complete it before re-dating it"})
		return
	}
	if !h.deps.StateSetCompletedAt(id, at) {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}
	h.deps.StateScheduleSave()
	h.deps.BroadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// alwaysAppliedFields are the JSON keys of the fields UpdatePokemon writes even
// when they carry their zero value, so an entry can be cleared again. Their
// order does not matter; the map is only used as a presence lookup.
var alwaysAppliedFields = map[string]func(dst *state.Pokemon, stored state.Pokemon){
	"shiny_charm":     func(dst *state.Pokemon, stored state.Pokemon) { dst.ShinyCharm = stored.ShinyCharm },
	"sparkling_power": func(dst *state.Pokemon, stored state.Pokemon) { dst.SparklingPower = stored.SparklingPower },
	"shiny_variant":   func(dst *state.Pokemon, stored state.Pokemon) { dst.ShinyVariant = stored.ShinyVariant },
	"hunt_mode":       func(dst *state.Pokemon, stored state.Pokemon) { dst.HuntMode = stored.HuntMode },
	"group_id":        func(dst *state.Pokemon, stored state.Pokemon) { dst.GroupID = stored.GroupID },
	"failed":          func(dst *state.Pokemon, stored state.Pokemon) { dst.Failed = stored.Failed },
}

// keepOmittedAlwaysAppliedFields carries the always-applied fields over from the
// stored entry when the request body did not mention them. Without this a patch
// touching a single field, say a group move, would silently clear the Shiny
// Charm, the Sparkling Power level, the shiny variant and the hunt mode, since
// their zero value is a meaningful state the update cannot distinguish from
// "not sent". Sending the key with its zero value still clears the field.
func (h *handler) keepOmittedAlwaysAppliedFields(id string, p *state.Pokemon, body []byte) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return
	}
	var omitted []func(dst *state.Pokemon, stored state.Pokemon)
	for key, carry := range alwaysAppliedFields {
		if _, sent := raw[key]; !sent {
			omitted = append(omitted, carry)
		}
	}
	if len(omitted) == 0 {
		return
	}
	stored, ok := findPokemonByID(h.deps.StateGetState().Pokemon, id)
	if !ok {
		return
	}
	for _, carry := range omitted {
		carry(p, stored)
	}
}

// findPokemonByID returns the entry with the given id from a state snapshot.
func findPokemonByID(all []state.Pokemon, id string) (state.Pokemon, bool) {
	for _, p := range all {
		if p.ID == id {
			return p, true
		}
	}
	return state.Pokemon{}, false
}

// handleFailPokemon marks the hunt as finished and failed by stamping
// CompletedAt and setting Failed: a shiny was sighted but not caught.
// POST /api/pokemon/{id}/fail
//
// @Summary      Fail a Pokemon hunt
// @Description  Marks the hunt as finished and failed by stamping CompletedAt (shiny sighted, not caught)
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} httputil.ErrResp
// @Router       /pokemon/{id}/fail [post]
func (h *handler) handleFailPokemon(w http.ResponseWriter, _ *http.Request, id string) {
	h.pokemonMutate(w, id, "pokemon_failed", h.deps.StateFailPokemon)
}

// CatchMetaRequest combines catch details with an optional automatic sprite update.
type CatchMetaRequest struct {
	state.CatchMeta
	Gender    string  `json:"gender,omitempty"`
	SpriteURL *string `json:"sprite_url,omitempty"`
}

// handleSetCatchMeta replaces the optional details recorded for a catch. A body
// of {} clears them, so there is no separate delete route.
// PUT /api/pokemon/{id}/catch
//
// @Summary      Record catch metadata
// @Description  Replaces the optional catch details and may atomically update an automatically generated gender sprite; an empty body clears the details
// @Tags         pokemon
// @Accept       json
// @Param        id path string true "Pokemon ID"
// @Param        meta body CatchMetaRequest true "Catch metadata with gender and an optional automatic sprite URL"
// @Success      204
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Router       /pokemon/{id}/catch [put]
func (h *handler) handleSetCatchMeta(w http.ResponseWriter, r *http.Request, id string) {
	var body CatchMetaRequest
	if err := httputil.ReadJSON(r, &body); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	// Validate before the id is looked up so a malformed body cannot be used to
	// probe which Pokemon ids exist.
	if err := ValidateCatchMeta(&body.CatchMeta); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	if err := ValidateGender(body.Gender); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	if body.SpriteURL != nil && !isAutomaticSpriteURL(*body.SpriteURL) {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "sprite_url must use a supported sprite source"})
		return
	}
	h.pokemonMutate(w, id, "", func(pokemonID string) bool {
		return h.deps.StateSetCatchMeta(pokemonID, &body.CatchMeta, body.Nickname, body.Gender, body.SpriteURL)
	})
}

func isAutomaticSpriteURL(raw string) bool {
	for _, prefix := range []string{
		"https://raw.githubusercontent.com/PokeAPI/sprites/",
		"https://raw.githubusercontent.com/msikma/pokesprite/",
		"https://raw.githubusercontent.com/kwsch/PKHeX/",
		"https://play.pokemonshowdown.com/sprites/",
	} {
		if strings.HasPrefix(raw, prefix) {
			return true
		}
	}
	return false
}

// handleEndPhase ends the current phase of the hunt: the off-target shiny from
// the request body becomes a completed phase entry linked to the hunt, and the
// hunt's counter and timer restart at zero.
// POST /api/pokemon/{id}/phase
//
// @Summary      End the current phase
// @Description  Archives the off-target shiny as a linked phase entry and restarts the hunt's counter and timer at zero; an optional failed flag marks the archived phase as sighted-but-not-caught
// @Tags         pokemon
// @Accept       json
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Param        body body endPhaseRequest true "Off-target shiny that ended the phase"
// @Success      201 {object} state.Pokemon
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Failure      409 {object} httputil.ErrResp
// @Router       /pokemon/{id}/phase [post]
func (h *handler) handleEndPhase(w http.ResponseWriter, r *http.Request, id string) {
	var body endPhaseRequest
	if err := httputil.ReadJSON(r, &body); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	catch := state.PhaseCatch{
		CanonicalName: strings.TrimSpace(body.CanonicalName),
		Name:          strings.TrimSpace(body.Name),
		BaseName:      strings.TrimSpace(body.BaseName),
		FormName:      strings.TrimSpace(body.FormName),
		SpriteURL:     normalizeCatchSpriteURL(strings.TrimSpace(body.SpriteURL), id),
		Gender:        body.Gender,
	}
	if err := ValidateGender(catch.Gender); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	if catch.Name == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "name is required"})
		return
	}
	child, err := h.deps.StateEndPhase(id, catch, body.Failed)
	if err != nil {
		writePhaseError(w, err)
		return
	}
	h.deps.StateScheduleSave()
	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusCreated, child)
}

// handleUndoPhase reverts the newest phase of a hunt: the phase entry with the
// given id is removed and its encounters and timer milliseconds flow back into
// the parent hunt. Responds with the updated parent hunt.
// DELETE /api/pokemon/{id}/phase
//
// @Summary      Undo a phase
// @Description  Removes the newest phase entry and returns its encounters and timer to the parent hunt
// @Tags         pokemon
// @Produce      json
// @Param        id path string true "Phase entry ID"
// @Success      200 {object} state.Pokemon
// @Failure      404 {object} httputil.ErrResp
// @Failure      409 {object} httputil.ErrResp
// @Router       /pokemon/{id}/phase [delete]
func (h *handler) handleUndoPhase(w http.ResponseWriter, _ *http.Request, id string) {
	parent, err := h.deps.StateUndoPhase(id)
	if err != nil {
		writePhaseError(w, err)
		return
	}
	h.deps.StateScheduleSave()
	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusOK, parent)
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
	id := httputil.IDFromPath(r.URL.Path, pokemonAPIPrefix, "/overlay/unlink")
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

// writePhaseError maps the sentinel errors of the phase state transitions onto
// HTTP status codes: an unknown hunt is a 404, a hunt or entry that may not
// take part in the transition is a 409.
func writePhaseError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, state.ErrPhaseParentNotFound):
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
	case errors.Is(err, state.ErrNotPhaseable):
		httputil.WriteJSON(w, http.StatusConflict, httputil.ErrResp{Error: err.Error()})
	default:
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
	}
}

// normalizeCatchSpriteURL drops a sprite URL that points at the sprite upload
// endpoint of the hunt the phase belongs to. That BLOB is owned by the hunt and
// disappears with it, so a phase entry referencing it would end up with a dead
// image; an empty URL lets the frontend fall back to the default sprite.
func normalizeCatchSpriteURL(spriteURL, parentID string) string {
	uploadPath := pokemonAPIPrefix + parentID + "/sprite"
	if spriteURL == uploadPath || strings.HasPrefix(spriteURL, uploadPath+"?") {
		return ""
	}
	return spriteURL
}

// hasPhases reports whether the Pokemon with the given id has phase entries
// attached to it.
//
// This clones the whole state, unlike the equivalent check on the WebSocket and
// hotkey paths, which reads the live Pokemon slice under a read lock. Avoiding
// the clone here would mean a new Deps method plus its test double, while the
// decrement caller already clones the state one line earlier through
// logEncounter, so the interface stays as small as it is.
func (h *handler) hasPhases(id string) bool {
	st := h.deps.StateGetState()
	return len(state.PhaseChildren(st.Pokemon, id)) > 0
}

// logEncounter writes an encounter event to the database.
// It resolves the Pokemon name and computes the step delta.
// sign must be +1 for increments or -1 for decrements so the logged
// step value correctly reflects the direction of the count change.
func (h *handler) logEncounter(pokemonID string, countAfter int, sign int, source string) {
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
	_ = logger.LogEncounter(pokemonID, name, step*sign, countAfter, source)
}
