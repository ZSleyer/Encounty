// pokedex.go provides HTTP handler wrappers around the pokedex package for
// serving and syncing the Pokédex.
package server

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/zsleyer/encounty/backend/internal/pokedex"
)

// handleGetPokedex serves the pokemon list (configDir first, then source fallbacks).
//
// @Summary      Get the Pokedex
// @Tags         pokedex
// @Produce      json
// @Success      200 {array} pokedex.Entry
// @Failure      500 {object} errResp
// @Router       /pokedex [get]
func (s *Server) handleGetPokedex(w http.ResponseWriter, _ *http.Request) {
	data, err := pokedex.ReadJSON(s.state.GetConfigDir())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{"could not load pokedex: " + err.Error()})
		return
	}
	w.Header().Set("Content-Type", contentTypeJSON)
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = w.Write(data)
}

// handleSyncPokemon downloads the latest pokemon list from PokéAPI and saves
// it to the config directory. It delegates to the pokedex package for fetching
// and merging species, forms, and localized names.
//
// @Summary      Sync Pokedex from PokeAPI
// @Tags         pokedex
// @Produce      json
// @Success      200 {object} PokedexSyncResponse
// @Failure      500 {object} errResp
// @Router       /sync/pokemon [post]
func (s *Server) handleSyncPokemon(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	// Load current pokedex
	currentData, err := pokedex.ReadJSON(s.state.GetConfigDir())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{"could not load current pokedex: " + err.Error()})
		return
	}

	var current []pokedex.Entry
	if err := json.Unmarshal(currentData, &current); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{"could not parse current pokedex: " + err.Error()})
		return
	}

	// Delegate sync to the pokedex package.
	result, updated, err := pokedex.SyncFromPokeAPI(current)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, errResp{err.Error()})
		return
	}

	// Persist the updated Pokédex to disk.
	if err := pokedex.WriteJSON(s.state.GetConfigDir(), updated); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
		return
	}

	slog.Info("Pokedex sync complete", "added", result.Added, "names_updated", result.NamesUpdated)
	writeJSON(w, http.StatusOK, PokedexSyncResponse{
		Total:        result.Total,
		Added:        result.Added,
		NamesUpdated: result.NamesUpdated,
		New:          result.New,
	})
}
