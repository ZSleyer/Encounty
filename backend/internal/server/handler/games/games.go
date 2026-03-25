// Package games provides HTTP handlers for the game catalogue, hunt type
// presets, and Pokedex endpoints. It delegates to the gamesync and pokedex
// packages for data loading and PokeAPI synchronisation.
package games

import (
	"log/slog"
	"net/http"

	"github.com/zsleyer/encounty/backend/internal/gamesync"
	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/pokedex"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// Deps declares the capabilities the games handlers need from the application
// layer, keeping this package decoupled from the server package.
type Deps interface {
	GamesDB() gamesync.GamesStore
	PokedexDB() pokedex.PokedexStore
	ConfigDir() string
}

// handler groups the games/pokedex HTTP handlers with their dependencies.
type handler struct {
	deps Deps
}

// RegisterRoutes attaches the game catalogue, hunt type, and pokedex
// endpoints to mux.
func RegisterRoutes(mux *http.ServeMux, d Deps) {
	h := &handler{deps: d}
	mux.HandleFunc("/api/games", h.handleGetGames)
	mux.HandleFunc("/api/hunt-types", h.handleGetHuntTypes)
	mux.HandleFunc("/api/games/sync", h.handleSyncGames)
	mux.HandleFunc("/api/pokedex", h.handleGetPokedex)
	mux.HandleFunc("/api/sync/pokemon", h.handleSyncPokemon)
}

// LoadGames triggers the initial game catalogue load, populating the
// in-memory cache. It is intended to be called during server startup
// (e.g. from InitAsync).
func LoadGames(d Deps) []gamesync.GameEntry {
	return gamesync.LoadGames(d.GamesDB())
}

// LoadPokedex triggers the initial Pokédex load, populating the in-memory
// cache. It is intended to be called during server startup (e.g. from
// InitAsync).
func LoadPokedex(d Deps) []pokedex.Entry {
	return pokedex.LoadPokedex(d.PokedexDB())
}

// handleGetGames returns the games list sorted by generation. GET /api/games
//
// @Summary      Get games list
// @Description  Returns the games list sorted by generation
// @Tags         games
// @Produce      json
// @Success      200 {array} gamesync.GameEntry
// @Router       /games [get]
func (h *handler) handleGetGames(w http.ResponseWriter, _ *http.Request) {
	httputil.WriteJSON(w, http.StatusOK, gamesync.LoadGames(h.deps.GamesDB()))
}

// handleGetHuntTypes returns all available hunt type presets as JSON.
// The slice is ordered as defined in state.HuntTypePresets.
// GET /api/hunt-types
//
// @Summary      Get hunt type presets
// @Description  Returns all available hunt type presets
// @Tags         games
// @Produce      json
// @Success      200 {array} state.HuntTypePreset
// @Router       /hunt-types [get]
func (h *handler) handleGetHuntTypes(w http.ResponseWriter, _ *http.Request) {
	httputil.WriteJSON(w, http.StatusOK, state.HuntTypePresets)
}

// handleSyncGames triggers a background sync of game metadata from PokeAPI
// and writes the merged result to the config-dir games.json.
// POST /api/games/sync
//
// @Summary      Sync games from PokeAPI
// @Description  Triggers a background sync of game metadata from PokeAPI
// @Tags         games
// @Produce      json
// @Success      200 {object} gamesync.GamesSyncResult
// @Failure      500 {object} httputil.ErrResp
// @Router       /games/sync [post]
func (h *handler) handleSyncGames(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	result, err := gamesync.SyncFromPokeAPI(h.deps.GamesDB(), nil)
	if err != nil {
		slog.Error("Games sync error", "error", err)
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, result)
}

// pokedexSyncResponse reports the result of a Pokedex sync operation.
type pokedexSyncResponse struct {
	Total        int      `json:"total"`
	Added        int      `json:"added"`
	NamesUpdated int      `json:"namesUpdated"`
	New          []string `json:"new"`
}

// handleGetPokedex returns the full Pokédex from the database cache.
//
// @Summary      Get the Pokedex
// @Tags         pokedex
// @Produce      json
// @Success      200 {array} pokedex.Entry
// @Router       /pokedex [get]
func (h *handler) handleGetPokedex(w http.ResponseWriter, _ *http.Request) {
	entries := pokedex.LoadPokedex(h.deps.PokedexDB())
	if entries == nil {
		entries = []pokedex.Entry{}
	}
	httputil.WriteJSON(w, http.StatusOK, entries)
}

// handleSyncPokemon triggers a full Pokédex sync from PokéAPI and persists
// the result to the database. It loads the current entries for merging so
// that existing data is preserved.
//
// @Summary      Sync Pokedex from PokeAPI
// @Tags         pokedex
// @Produce      json
// @Success      200 {object} pokedexSyncResponse
// @Failure      405
// @Failure      500 {object} httputil.ErrResp
// @Failure      503 {object} httputil.ErrResp
// @Router       /sync/pokemon [post]
func (h *handler) handleSyncPokemon(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	current := pokedex.LoadPokedex(h.deps.PokedexDB())
	if current == nil {
		current = []pokedex.Entry{}
	}

	result, updated, err := pokedex.SyncFromPokeAPI(current, nil)
	if err != nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrResp{Error: err.Error()})
		return
	}

	species, forms := pokedex.EntriesToRows(updated)
	if err := h.deps.PokedexDB().SavePokedex(species, forms); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}
	pokedex.InvalidateCache()

	slog.Info("Pokedex sync complete", "added", result.Added, "names_updated", result.NamesUpdated)
	httputil.WriteJSON(w, http.StatusOK, pokedexSyncResponse{
		Total:        result.Total,
		Added:        result.Added,
		NamesUpdated: result.NamesUpdated,
		New:          result.New,
	})
}
