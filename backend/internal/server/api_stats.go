// api_stats.go — HTTP handlers for encounter statistics.
package server

import (
	"fmt"
	"net/http"
	"strings"
)

// handleStatsOverview returns global encounter statistics.
// GET /api/stats/overview
//
// @Summary      Get statistics overview
// @Description  Returns global encounter statistics
// @Tags         statistics
// @Produce      json
// @Success      200 {object} database.OverviewStats
// @Failure      503 {object} errResp
// @Failure      500 {object} errResp
// @Router       /stats/overview [get]
func (s *Server) handleStatsOverview(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, errResp{"database not available"})
		return
	}
	stats, err := s.db.GetOverviewStats()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

// handleStatsDispatch routes /api/stats/pokemon/{id}, /api/stats/pokemon/{id}/history,
// and /api/stats/pokemon/{id}/chart to the appropriate handler.
//
// @Summary      Get Pokemon encounter stats
// @Description  Returns encounter statistics for a specific Pokemon, with optional /history or /chart sub-paths
// @Tags         statistics
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Success      200 {object} database.EncounterStats
// @Failure      503 {object} errResp
// @Failure      500 {object} errResp
// @Router       /stats/pokemon/{id} [get]
func (s *Server) handleStatsDispatch(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, errResp{"database not available"})
		return
	}
	path := r.URL.Path
	switch {
	case strings.HasSuffix(path, "/history"):
		id := pokemonIDFromPath(path, statsPokemonPrefix, "/history")
		limit := 20
		offset := 0
		if v := r.URL.Query().Get("limit"); v != "" {
			_, _ = fmt.Sscanf(v, "%d", &limit)
		}
		if v := r.URL.Query().Get("offset"); v != "" {
			_, _ = fmt.Sscanf(v, "%d", &offset)
		}
		events, err := s.db.GetEncounterHistory(id, limit, offset)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, events)
	case strings.HasSuffix(path, "/chart"):
		id := pokemonIDFromPath(path, statsPokemonPrefix, "/chart")
		interval := r.URL.Query().Get("interval")
		if interval == "" {
			interval = "day"
		}
		data, err := s.db.GetChartData(id, interval)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, data)
	default:
		id := pokemonIDFromPath(path, statsPokemonPrefix, "")
		stats, err := s.db.GetEncounterStats(id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, stats)
	}
}
