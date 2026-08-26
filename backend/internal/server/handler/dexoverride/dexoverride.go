// Package dexoverride provides the HTTP handler for manual Pokédex
// caught/seen overrides: user-entered flags that mark a species, form,
// gender, and/or game combination as caught or seen, independent of what
// encounter tracking already implies.
package dexoverride

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/pokedex"
	"github.com/zsleyer/encounty/backend/internal/server/handler/pokemon"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// overridesRoute is the single route this package registers; GET and PUT
// share it, distinguished by HTTP method.
const overridesRoute = "/api/pokedex/overrides"
const specimensRoute = "/api/pokedex/specimens"

type SpecimenStore interface {
	ListPokedexSpecimens() ([]database.PokedexSpecimenRow, error)
	SavePokedexSpecimen(database.PokedexSpecimenRow) (database.PokedexSpecimenRow, error)
	DeletePokedexSpecimen(int64) error
}

// Deps declares the capabilities the dexoverride handler needs from the
// application layer, keeping this package decoupled from the server package.
type Deps interface {
	PokedexOverrideDB() pokedex.OverrideStore
	PokedexSpecimenDB() SpecimenStore
}

// handler groups the Pokédex override HTTP handlers with their dependencies.
type handler struct {
	deps Deps
}

// RegisterRoutes attaches the /api/pokedex/overrides endpoint to mux.
func RegisterRoutes(mux *http.ServeMux, d Deps) {
	h := &handler{deps: d}
	mux.HandleFunc(overridesRoute, h.handleOverrides)
	mux.HandleFunc(specimensRoute, h.handleSpecimens)
	mux.HandleFunc(specimensRoute+"/", h.handleSpecimenByID)
}

type specimenPayload struct {
	ID                 int64            `json:"id"`
	PokedexID          string           `json:"pokedex_id"`
	SpeciesID          int              `json:"species_id"`
	FormCanonical      string           `json:"form_canonical,omitempty"`
	Gender             string           `json:"gender,omitempty"`
	Game               string           `json:"game,omitempty"`
	CompletedAt        string           `json:"completed_at,omitempty"`
	HuntType           string           `json:"hunt_type,omitempty"`
	Encounters         int              `json:"encounters"`
	TimerAccumulatedMs int64            `json:"timer_accumulated_ms"`
	Meta               *state.CatchMeta `json:"meta,omitempty"`
	CreatedAt          string           `json:"created_at,omitempty"`
	UpdatedAt          string           `json:"updated_at,omitempty"`
}

func rowToSpecimen(row database.PokedexSpecimenRow) specimenPayload {
	var meta state.CatchMeta
	var ptr *state.CatchMeta
	if json.Unmarshal([]byte(row.MetaJSON), &meta) == nil && !meta.IsEmpty() {
		ptr = &meta
	}
	return specimenPayload{ID: row.ID, PokedexID: row.PokedexID, SpeciesID: row.SpeciesID, FormCanonical: row.FormCanonical, Gender: row.Gender, Game: row.Game, CompletedAt: row.CompletedAt, HuntType: row.HuntType, Encounters: row.Encounters, TimerAccumulatedMs: row.TimerAccumulatedMs, Meta: ptr, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt}
}

func (h *handler) handleSpecimens(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := h.deps.PokedexSpecimenDB().ListPokedexSpecimens()
		if err != nil {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
			return
		}
		pokedexID := r.URL.Query().Get("pokedex_id")
		if pokedexID == "" {
			pokedexID = "default"
		}
		out := []specimenPayload{}
		for _, row := range rows {
			if row.PokedexID == pokedexID {
				out = append(out, rowToSpecimen(row))
			}
		}
		httputil.WriteJSON(w, http.StatusOK, out)
	case http.MethodPost:
		h.saveSpecimen(w, r, 0)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (h *handler) handleSpecimenByID(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(strings.TrimPrefix(r.URL.Path, specimensRoute+"/"), 10, 64)
	if err != nil || id <= 0 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "invalid specimen id"})
		return
	}
	switch r.Method {
	case http.MethodPut:
		h.saveSpecimen(w, r, id)
	case http.MethodDelete:
		if err := h.deps.PokedexSpecimenDB().DeletePokedexSpecimen(id); err != nil {
			httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: "specimen not found"})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (h *handler) saveSpecimen(w http.ResponseWriter, r *http.Request, id int64) {
	var body specimenPayload
	if err := httputil.ReadJSON(r, &body); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	if body.SpeciesID <= 0 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "species_id required"})
		return
	}
	if err := pokemon.ValidateGender(body.Gender); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	if err := pokemon.ValidateCatchMeta(body.Meta); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	if body.Encounters < 0 || body.TimerAccumulatedMs < 0 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "encounters and timer_accumulated_ms must not be negative"})
		return
	}
	body.CompletedAt = strings.TrimSpace(body.CompletedAt)
	if body.CompletedAt != "" {
		if _, err := time.Parse("2006-01-02", body.CompletedAt); err != nil {
			httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "completed_at must be a valid date"})
			return
		}
	}
	if body.PokedexID == "" {
		body.PokedexID = "default"
	}
	metaJSON := "{}"
	if body.Meta != nil && !body.Meta.IsEmpty() {
		encoded, _ := json.Marshal(body.Meta)
		metaJSON = string(encoded)
	}
	row, err := h.deps.PokedexSpecimenDB().SavePokedexSpecimen(database.PokedexSpecimenRow{ID: id, PokedexID: body.PokedexID, SpeciesID: body.SpeciesID, FormCanonical: strings.TrimSpace(body.FormCanonical), Gender: body.Gender, Game: strings.TrimSpace(body.Game), CompletedAt: body.CompletedAt, HuntType: strings.TrimSpace(body.HuntType), Encounters: body.Encounters, TimerAccumulatedMs: body.TimerAccumulatedMs, MetaJSON: metaJSON})
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}
	status := http.StatusOK
	if id == 0 {
		status = http.StatusCreated
	}
	httputil.WriteJSON(w, status, rowToSpecimen(row))
}

// handleOverrides dispatches /api/pokedex/overrides requests by HTTP method.
func (h *handler) handleOverrides(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.handleGetOverrides(w, r)
	case http.MethodPut:
		h.handleSetOverride(w, r)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// handleGetOverrides returns all manual Pokédex caught/seen overrides.
// GET /api/pokedex/overrides
//
// @Summary      Get Pokédex overrides
// @Description  Returns all manual Pokédex caught/seen overrides
// @Tags         pokedex
// @Produce      json
// @Success      200 {array} pokedex.Override
// @Failure      500 {object} httputil.ErrResp
// @Router       /pokedex/overrides [get]
func (h *handler) handleGetOverrides(w http.ResponseWriter, r *http.Request) {
	overrides, err := pokedex.ListOverrides(h.deps.PokedexOverrideDB())
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}
	pokedexID := r.URL.Query().Get("pokedex_id")
	if pokedexID == "" {
		pokedexID = "default"
	}
	filtered := overrides[:0]
	for _, override := range overrides {
		if override.PokedexID == pokedexID {
			filtered = append(filtered, override)
		}
	}
	httputil.WriteJSON(w, http.StatusOK, filtered)
}

// setOverrideRequest is the body for PUT /api/pokedex/overrides.
// FormCanonical empty means the override applies at the species level;
// Gender empty means it is not gender-restricted; Game empty means it is
// global (counts everywhere, both national and every game view). Meta is
// optional catch metadata: an absent (or JSON null) "meta" key leaves this
// field nil, which preserves whatever metadata is already stored for this
// override; an explicit "meta": {} decodes into a non-nil, all-empty
// *state.CatchMeta, which clears the stored metadata.
type setOverrideRequest struct {
	ID            int64            `json:"id,omitempty"`
	PokedexID     string           `json:"pokedex_id"`
	SpeciesID     int              `json:"species_id"`
	FormCanonical string           `json:"form_canonical"`
	Gender        string           `json:"gender"`
	Game          string           `json:"game"`
	Caught        bool             `json:"caught"`
	Seen          bool             `json:"seen"`
	Meta          *state.CatchMeta `json:"meta,omitempty"`
}

// handleSetOverride creates, updates, or deletes a manual Pokédex caught/seen
// override. A request whose caught and seen are both false deletes the
// matching override and responds 204 with an empty body; otherwise it
// responds 200 with the resulting override as JSON. The optional "meta" field
// carries the same catch metadata a real hunt records (location, ball,
// level, nature, ability, mark, individual values, ribbons), validated with
// the same rules as PUT /api/pokemon/{id}/catch. Omitting "meta" preserves
// whatever metadata is already stored for the override; an explicit
// "meta": {} clears it.
// PUT /api/pokedex/overrides
//
// @Summary      Set a Pokédex override
// @Description  Creates, updates, or deletes a manual caught/seen override. A
// @Description  request with caught=false and seen=false deletes the override.
// @Description  Omitting "meta" preserves the previously stored metadata; an
// @Description  explicit "meta": {} clears it.
// @Tags         pokedex
// @Accept       json
// @Produce      json
// @Success      200 {object} pokedex.Override
// @Success      204 "override deleted (both caught and seen false)"
// @Failure      400 {object} httputil.ErrResp
// @Failure      500 {object} httputil.ErrResp
// @Router       /pokedex/overrides [put]
func (h *handler) handleSetOverride(w http.ResponseWriter, r *http.Request) {
	var body setOverrideRequest
	if err := httputil.ReadJSON(r, &body); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	if body.SpeciesID <= 0 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "species_id required"})
		return
	}
	if err := pokemon.ValidateGender(body.Gender); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	if body.Meta != nil {
		if err := pokemon.ValidateCatchMeta(body.Meta); err != nil {
			httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
			return
		}
	}

	if body.PokedexID == "" {
		body.PokedexID = "default"
	}
	result, deleted, err := pokedex.SetOverrideForPokedex(
		h.deps.PokedexOverrideDB(),
		body.PokedexID,
		body.ID, body.SpeciesID, body.FormCanonical, body.Gender, body.Game,
		body.Caught, body.Seen, body.Meta,
	)
	if err != nil {
		if errors.Is(err, database.ErrPokedexOverrideConflict) {
			httputil.WriteJSON(w, http.StatusConflict, httputil.ErrResp{Error: err.Error()})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}
	if deleted {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, result)
}
