// Package stats provides HTTP handlers for encounter statistics endpoints.
package stats

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/httputil"
)

const pokemonPrefix = "/api/stats/pokemon/"

// StatsQuerier defines the database operations needed by stats handlers.
type StatsQuerier interface {
	GetOverviewStats() (*database.OverviewStats, error)
	GetEncounterStats(pokemonID string) (*database.EncounterStats, error)
	GetEncounterHistory(pokemonID string, limit, offset int) ([]database.EncounterEvent, error)
	GetChartData(pokemonID, interval string) ([]database.ChartPoint, error)
}

// Deps declares the dependencies that stats handlers require.
type Deps interface {
	StatsDB() StatsQuerier
}

// handler groups the stats HTTP handlers together with their dependencies.
type handler struct {
	deps Deps
}

// RegisterRoutes attaches the statistics endpoints to mux.
func RegisterRoutes(mux *http.ServeMux, d Deps) {
	h := &handler{deps: d}
	mux.HandleFunc("/api/stats/overview", h.handleStatsOverview)
	mux.HandleFunc("/api/stats/pokemon/", h.handleStatsDispatch)
}

// handleStatsOverview returns global encounter statistics.
// GET /api/stats/overview
//
// @Summary      Get statistics overview
// @Description  Returns global encounter statistics
// @Tags         statistics
// @Produce      json
// @Success      200 {object} database.OverviewStats
// @Failure      503 {object} httputil.ErrResp
// @Failure      500 {object} httputil.ErrResp
// @Router       /stats/overview [get]
func (h *handler) handleStatsOverview(w http.ResponseWriter, r *http.Request) {
	db := h.deps.StatsDB()
	if db == nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrResp{Error: "database not available"})
		return
	}
	stats, err := db.GetOverviewStats()
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, stats)
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
// @Failure      503 {object} httputil.ErrResp
// @Failure      500 {object} httputil.ErrResp
// @Router       /stats/pokemon/{id} [get]
func (h *handler) handleStatsDispatch(w http.ResponseWriter, r *http.Request) {
	db := h.deps.StatsDB()
	if db == nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrResp{Error: "database not available"})
		return
	}
	path := r.URL.Path
	switch {
	case strings.HasSuffix(path, "/history"):
		h.handleHistory(w, r, db, path)
	case strings.HasSuffix(path, "/chart"):
		h.handleChart(w, r, db, path)
	default:
		h.handlePokemonStats(w, db, path)
	}
}

// handleHistory returns paginated encounter events for a Pokemon.
func (h *handler) handleHistory(w http.ResponseWriter, r *http.Request, db StatsQuerier, path string) {
	id := httputil.IDFromPath(path, pokemonPrefix, "/history")
	limit := 20
	offset := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		_, _ = fmt.Sscanf(v, "%d", &limit)
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		_, _ = fmt.Sscanf(v, "%d", &offset)
	}
	events, err := db.GetEncounterHistory(id, limit, offset)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, events)
}

// handleChart returns encounter counts grouped by time interval.
func (h *handler) handleChart(w http.ResponseWriter, r *http.Request, db StatsQuerier, path string) {
	id := httputil.IDFromPath(path, pokemonPrefix, "/chart")
	interval := r.URL.Query().Get("interval")
	if interval == "" {
		interval = "day"
	}
	data, err := db.GetChartData(id, interval)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, data)
}

// handlePokemonStats returns aggregated stats for a single Pokemon.
func (h *handler) handlePokemonStats(w http.ResponseWriter, db StatsQuerier, path string) {
	id := httputil.IDFromPath(path, pokemonPrefix, "")
	stats, err := db.GetEncounterStats(id)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, stats)
}
