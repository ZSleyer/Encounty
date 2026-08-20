package dexconfig

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/httputil"
)

var categories = map[string]bool{"regional": true, "mega": true, "gigantamax": true, "gender": true, "cosmetic": true, "other": true}

type Store interface {
	ListUserPokedexes() ([]database.UserPokedexRow, error)
	SaveUserPokedex(database.UserPokedexRow) error
	DeleteUserPokedex(string) error
}
type Deps interface{ UserPokedexDB() Store }
type definition struct {
	ID                             string `json:"id"`
	Name                           string `json:"name"`
	ShowForms                      bool   `json:"show_forms"`
	Generations                    []int  `json:"generations"`
	TargetGames, CatchGames        []string
	FormCategories                 []string `json:"form_categories"`
	IncludeSpecies, ExcludeSpecies []int
}
type wireDefinition struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	ShowForms      bool     `json:"show_forms"`
	Generations    []int    `json:"generations"`
	TargetGames    []string `json:"target_games"`
	CatchGames     []string `json:"catch_games"`
	FormCategories []string `json:"form_categories"`
	IncludeSpecies []int    `json:"include_species"`
	ExcludeSpecies []int    `json:"exclude_species"`
}

func RegisterRoutes(mux *http.ServeMux, d Deps) {
	mux.HandleFunc("/api/pokedexes", func(w http.ResponseWriter, r *http.Request) { handleCollection(w, r, d.UserPokedexDB()) })
	mux.HandleFunc("/api/pokedexes/", func(w http.ResponseWriter, r *http.Request) { handleItem(w, r, d.UserPokedexDB()) })
}
func handleCollection(w http.ResponseWriter, r *http.Request, store Store) {
	if r.Method == http.MethodGet {
		list(w, store)
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var in wireDefinition
	if err := httputil.ReadJSON(r, &in); err != nil {
		httputil.WriteJSON(w, 400, httputil.ErrResp{Error: err.Error()})
		return
	}
	in.ID = uuid.NewString()
	if err := save(store, in); err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, database.ErrPokedexScopeConflict) {
			status = http.StatusConflict
		}
		httputil.WriteJSON(w, status, httputil.ErrResp{Error: err.Error()})
		return
	}
	list(w, store)
}
func handleItem(w http.ResponseWriter, r *http.Request, store Store) {
	id := strings.TrimPrefix(r.URL.Path, "/api/pokedexes/")
	if id == "" || strings.Contains(id, "/") {
		http.NotFound(w, r)
		return
	}
	if r.Method == http.MethodDelete {
		err := store.DeleteUserPokedex(id)
		if errors.Is(err, database.ErrDefaultPokedex) {
			httputil.WriteJSON(w, 409, httputil.ErrResp{Error: err.Error()})
			return
		}
		if errors.Is(err, database.ErrPokedexHasAssignments) {
			httputil.WriteJSON(w, http.StatusConflict, httputil.ErrResp{Error: err.Error()})
			return
		}
		if errors.Is(err, sql.ErrNoRows) {
			http.NotFound(w, r)
			return
		}
		if err != nil {
			httputil.WriteJSON(w, 500, httputil.ErrResp{Error: err.Error()})
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPut {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var in wireDefinition
	if err := httputil.ReadJSON(r, &in); err != nil {
		httputil.WriteJSON(w, 400, httputil.ErrResp{Error: err.Error()})
		return
	}
	in.ID = id
	if err := save(store, in); err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, database.ErrPokedexScopeConflict) {
			status = http.StatusConflict
		}
		httputil.WriteJSON(w, status, httputil.ErrResp{Error: err.Error()})
		return
	}
	list(w, store)
}
func save(store Store, in wireDefinition) error {
	in.Name = strings.TrimSpace(in.Name)
	if len(in.Name) < 1 || len(in.Name) > 80 {
		return errors.New("name must be 1-80 characters")
	}
	for _, g := range in.Generations {
		if g < 1 || g > 20 {
			return errors.New("invalid generation")
		}
	}
	for _, c := range in.FormCategories {
		if !categories[c] {
			return errors.New("invalid form category")
		}
	}
	marshal := func(v any) string { b, _ := json.Marshal(v); return string(b) }
	return store.SaveUserPokedex(database.UserPokedexRow{ID: in.ID, Name: in.Name, ShowForms: in.ShowForms,
		GenerationsJSON: marshal(in.Generations), TargetGamesJSON: marshal(in.TargetGames), CatchGamesJSON: marshal(in.CatchGames),
		FormCategoriesJSON: marshal(in.FormCategories), IncludeSpeciesJSON: marshal(in.IncludeSpecies), ExcludeSpeciesJSON: marshal(in.ExcludeSpecies)})
}
func list(w http.ResponseWriter, store Store) {
	rows, err := store.ListUserPokedexes()
	if err != nil {
		httputil.WriteJSON(w, 500, httputil.ErrResp{Error: err.Error()})
		return
	}
	out := make([]wireDefinition, 0, len(rows))
	for _, r := range rows {
		var d wireDefinition
		d.ID = r.ID
		d.Name = r.Name
		d.ShowForms = r.ShowForms
		_ = json.Unmarshal([]byte(r.GenerationsJSON), &d.Generations)
		_ = json.Unmarshal([]byte(r.TargetGamesJSON), &d.TargetGames)
		_ = json.Unmarshal([]byte(r.CatchGamesJSON), &d.CatchGames)
		_ = json.Unmarshal([]byte(r.FormCategoriesJSON), &d.FormCategories)
		_ = json.Unmarshal([]byte(r.IncludeSpeciesJSON), &d.IncludeSpecies)
		_ = json.Unmarshal([]byte(r.ExcludeSpeciesJSON), &d.ExcludeSpecies)
		out = append(out, d)
	}
	httputil.WriteJSON(w, 200, out)
}
