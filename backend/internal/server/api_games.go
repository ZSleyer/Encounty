// api_games.go — HTTP handlers for the games catalogue and hunt type presets.
package server

import (
	"log/slog"
	"net/http"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// handleGetGames returns the games list sorted by generation. GET /api/games
//
// @Summary      Get games list
// @Description  Returns the games list sorted by generation
// @Tags         games
// @Produce      json
// @Success      200 {array} GameEntry
// @Router       /games [get]
func (s *Server) handleGetGames(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, loadGames())
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
func (s *Server) handleGetHuntTypes(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, state.HuntTypePresets)
}

// handleSyncGames triggers a background sync of game metadata from PokéAPI
// and writes the merged result to the config-dir games.json.
// POST /api/games/sync
//
// @Summary      Sync games from PokeAPI
// @Description  Triggers a background sync of game metadata from PokeAPI
// @Tags         games
// @Produce      json
// @Success      200 {object} GamesSyncResult
// @Failure      500 {object} errResp
// @Router       /games/sync [post]
func (s *Server) handleSyncGames(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	result, err := SyncGamesFromPokeAPI()
	if err != nil {
		slog.Error("Games sync error", "error", err)
		writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, result)
}
