// Package pokemon provides HTTP handlers for Pokemon CRUD operations and
// encounter mutations (increment, decrement, reset, set, timers, completion).
package pokemon

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/pathsafe"
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

// setTimerRequest is the JSON body for POST /api/pokemon/{id}/timer/set.
type setTimerRequest struct {
	Ms int64 `json:"ms"`
}

// endPhaseRequest is the JSON body for POST /api/pokemon/{id}/phase. It only
// carries the identity of the off-target shiny that ended the phase; every
// other field of the resulting archive entry comes from the parent hunt. Name
// is the sole required field so a phase can also be ended with a free-text
// species that has no Pokédex entry yet.
type endPhaseRequest struct {
	CanonicalName string `json:"canonical_name"`
	Name          string `json:"name"`
	BaseName      string `json:"base_name"`
	FormName      string `json:"form_name"`
	SpriteURL     string `json:"sprite_url"`
}

// reorderRequest is the JSON body for PUT /api/pokemon/reorder. Order lists the
// Pokemon IDs in their new display order (index becomes the SortOrder).
type reorderRequest struct {
	Order []string `json:"order"`
}

// --- Deps interface ----------------------------------------------------------

// DetectorStopper can stop a running detector for a given Pokemon ID.
type DetectorStopper interface {
	Stop(pokemonID string)
}

// EncounterLogger persists encounter events to the database.
type EncounterLogger interface {
	LogEncounter(pokemonID, pokemonName string, delta, countAfter int, source string) error
	DeleteEncounterEvents(pokemonID string) error
}

// Broadcaster sends typed messages to all connected WebSocket clients.
type Broadcaster interface {
	BroadcastRaw(msgType string, payload any)
}

// SpriteStore defines the database operations needed to persist and serve
// user-uploaded local Pokemon sprite images as BLOBs.
type SpriteStore interface {
	SaveSprite(pokemonID string, data []byte, mime string) error
	LoadSprite(pokemonID string) (data []byte, mime string, err error)
	DeleteSprite(pokemonID string) error
}

// Deps declares the capabilities that pokemon handlers require from the
// application layer. Each method maps to a specific subsystem so this package
// stays decoupled from the concrete Server type.
type Deps interface {
	// State mutations
	StateAddPokemon(p state.Pokemon)
	StateUpdatePokemon(id string, update state.Pokemon) bool
	// StateClearPokemonSprite resets sprite_url to empty. UpdatePokemon cannot
	// do this itself since it treats an empty SpriteURL as "leave unchanged".
	StateClearPokemonSprite(id string) bool
	StateDeletePokemon(id string) bool
	StateIncrement(id string) (int, bool)
	StateDecrement(id string) (int, bool)
	StateReset(id string) bool
	StateSetEncounters(id string, count int) (int, bool)
	StateReorderPokemon(orderedIDs []string) error
	StateSetActive(id string) bool
	StateCompletePokemon(id string) bool
	StateUncompletePokemon(id string) bool
	// StateSetCatchMeta replaces the optional details recorded for a catch.
	StateSetCatchMeta(id string, meta *state.CatchMeta) bool
	// StateEndPhase archives catch as a phase entry of the hunt and restarts
	// the hunt's counter and timer at zero.
	StateEndPhase(parentID string, catch state.PhaseCatch) (state.Pokemon, error)
	// StateUndoPhase removes the newest phase entry of a hunt and returns its
	// encounters and timer milliseconds to the parent hunt.
	StateUndoPhase(childID string) (state.Pokemon, error)
	StateUnlinkOverlay(pokemonID string) bool
	StateStartTimer(id string) bool
	StateStopTimer(id string) bool
	StateResetTimer(id string) bool
	StateSetTimer(id string, ms int64) bool
	StateGetState() state.AppState
	StateScheduleSave()

	// Infrastructure
	ConfigDir() string
	DetectorStopper() DetectorStopper
	EncounterLogger() EncounterLogger
	Broadcaster() Broadcaster
	BroadcastState()
	// PokemonDB returns the sprite store, or nil when no database is configured.
	PokemonDB() SpriteStore
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
		h.handleSprite(w, r, httputil.PokemonIDFromPath(path, pokemonAPIPrefix, "/sprite"))
	case strings.HasSuffix(path, "/set_encounters"):
		h.handleSetEncounters(w, r, httputil.PokemonIDFromPath(path, pokemonAPIPrefix, "/set_encounters"))
	case strings.HasSuffix(path, "/timer/start"):
		h.handleTimerStart(w, r, httputil.PokemonIDFromPath(path, pokemonAPIPrefix, "/timer/start"))
	case strings.HasSuffix(path, "/timer/stop"):
		h.handleTimerStop(w, r, httputil.PokemonIDFromPath(path, pokemonAPIPrefix, "/timer/stop"))
	case strings.HasSuffix(path, "/timer/reset"):
		h.handleTimerReset(w, r, httputil.PokemonIDFromPath(path, pokemonAPIPrefix, "/timer/reset"))
	case strings.HasSuffix(path, "/timer/set"):
		h.handleTimerSet(w, r, httputil.PokemonIDFromPath(path, pokemonAPIPrefix, "/timer/set"))
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
	case strings.HasSuffix(path, "/catch"):
		if r.Method == http.MethodPut {
			h.handleSetCatchMeta(w, r, httputil.PokemonIDFromPath(path, pokemonAPIPrefix, "/catch"))
		} else {
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	case strings.HasSuffix(path, "/phase"):
		id := httputil.PokemonIDFromPath(path, pokemonAPIPrefix, "/phase")
		switch r.Method {
		case http.MethodPost:
			h.handleEndPhase(w, r, id)
		case http.MethodDelete:
			h.handleUndoPhase(w, r, id)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
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
// It also stops any running detector goroutine and removes the template files
// and any uploaded sprite BLOB. The sprite is removed explicitly here rather
// than relying on the pokemon_sprites foreign key cascade, since that cascade
// only fires once the deletion is persisted to SQLite on the next state save.
// DELETE /api/pokemon/{id}
//
// @Summary      Delete a Pokemon
// @Description  Removes the Pokemon, stops its detector, and deletes template files and any uploaded sprite
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} httputil.ErrResp
// @Router       /pokemon/{id} [delete]
func (h *handler) handleDeletePokemon(w http.ResponseWriter, _ *http.Request, id string) {
	if ds := h.deps.DetectorStopper(); ds != nil {
		ds.Stop(id)
	}
	// id is a URL path param; contain it so it cannot delete outside the
	// templates directory (e.g. id = "../../..").
	if dir, err := pathsafe.Join(h.deps.ConfigDir(), "templates", id); err == nil {
		_ = os.RemoveAll(dir)
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

// handleSetCatchMeta replaces the optional details recorded for a catch. A body
// of {} clears them, so there is no separate delete route.
// PUT /api/pokemon/{id}/catch
//
// @Summary      Record catch metadata
// @Description  Replaces the optional catch details (location, nature, ability, ball, mark, level, IVs, ribbons); an empty body clears them
// @Tags         pokemon
// @Accept       json
// @Param        id path string true "Pokemon ID"
// @Param        meta body state.CatchMeta true "Catch metadata"
// @Success      204
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Router       /pokemon/{id}/catch [put]
func (h *handler) handleSetCatchMeta(w http.ResponseWriter, r *http.Request, id string) {
	var body state.CatchMeta
	if err := httputil.ReadJSON(r, &body); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	// Validate before the id is looked up so a malformed body cannot be used to
	// probe which Pokemon ids exist.
	if err := ValidateCatchMeta(&body); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	h.pokemonMutate(w, id, "", func(pokemonID string) bool {
		return h.deps.StateSetCatchMeta(pokemonID, &body)
	})
}

// handleEndPhase ends the current phase of the hunt: the off-target shiny from
// the request body becomes a completed phase entry linked to the hunt, and the
// hunt's counter and timer restart at zero.
// POST /api/pokemon/{id}/phase
//
// @Summary      End the current phase
// @Description  Archives the off-target shiny as a linked phase entry and restarts the hunt's counter and timer at zero
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
	}
	if catch.Name == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "name is required"})
		return
	}
	child, err := h.deps.StateEndPhase(id, catch)
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

// Length limits of the free-text catch metadata fields, in runes. Location is
// a sentence, the remaining fields hold a single name or slug.
const (
	catchLocationMaxRunes = 120
	catchFieldMaxRunes    = 60
	catchRibbonsMax       = 64
)

// cleanCatchText trims a free-text catch field and drops the control characters
// a paste can carry in, so a stored note cannot break the overlay renderer.
func cleanCatchText(s string) string {
	return strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s))
}

// ValidateCatchMeta normalizes the catch metadata in place (trimming text,
// stripping control characters, deduplicating ribbons) and rejects values
// outside the ranges the game itself allows. A nil or empty meta is valid: it
// clears the record. Exported so other handler packages that also accept
// catch metadata (e.g. dexoverride) can enforce the same rules.
func ValidateCatchMeta(meta *state.CatchMeta) error {
	if meta == nil {
		return nil
	}
	meta.Location = cleanCatchText(meta.Location)
	meta.Nature = cleanCatchText(meta.Nature)
	meta.Ability = cleanCatchText(meta.Ability)
	meta.Ball = cleanCatchText(meta.Ball)
	meta.Mark = cleanCatchText(meta.Mark)

	if utf8.RuneCountInString(meta.Location) > catchLocationMaxRunes {
		return fmt.Errorf("location must be at most %d characters", catchLocationMaxRunes)
	}
	for _, f := range []struct {
		name  string
		value string
	}{
		{"nature", meta.Nature}, {"ability", meta.Ability},
		{"ball", meta.Ball}, {"mark", meta.Mark},
	} {
		if utf8.RuneCountInString(f.value) > catchFieldMaxRunes {
			return fmt.Errorf("%s must be at most %d characters", f.name, catchFieldMaxRunes)
		}
	}

	if meta.Level != nil && (*meta.Level < 1 || *meta.Level > 100) {
		return errors.New("level must be between 1 and 100")
	}
	for _, v := range []struct {
		name string
		v    *int
	}{
		{"hp", meta.HP}, {"atk", meta.Atk}, {"def", meta.Def},
		{"sp_atk", meta.SpAtk}, {"sp_def", meta.SpDef}, {"speed", meta.Speed},
	} {
		if v.v != nil && (*v.v < 0 || *v.v > 31) {
			return fmt.Errorf("%s must be between 0 and 31", v.name)
		}
	}

	return ValidateCatchRibbons(meta)
}

// ValidateCatchRibbons cleans and deduplicates the ribbon slugs in place. It
// lives apart from ValidateCatchMeta so neither function grows a second loop
// nesting level. Exported alongside ValidateCatchMeta for the same reason.
func ValidateCatchRibbons(meta *state.CatchMeta) error {
	if len(meta.Ribbons) > catchRibbonsMax {
		return fmt.Errorf("at most %d ribbons are allowed", catchRibbonsMax)
	}
	seen := make(map[string]struct{}, len(meta.Ribbons))
	cleaned := make([]string, 0, len(meta.Ribbons))
	for _, ribbon := range meta.Ribbons {
		ribbon = cleanCatchText(ribbon)
		if ribbon == "" {
			continue
		}
		if utf8.RuneCountInString(ribbon) > catchFieldMaxRunes {
			return fmt.Errorf("a ribbon must be at most %d characters", catchFieldMaxRunes)
		}
		if _, dup := seen[ribbon]; dup {
			continue
		}
		seen[ribbon] = struct{}{}
		cleaned = append(cleaned, ribbon)
	}
	meta.Ribbons = cleaned
	return nil
}

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
