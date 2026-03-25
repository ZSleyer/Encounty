// Package stats tests the statistics HTTP handlers.
package stats

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/database"
)

const (
	pathStatsOverview = "/api/stats/overview"
	pathChartABC      = "/api/stats/pokemon/abc/chart"
	fmtWantOK         = "status = %d, want 200"
	fmtWant500        = "status = %d, want 500"
	fmtUnmarshal      = "unmarshal: %v"
	fmtWantPokemonID  = "pokemon ID = %q, want %q"
)

// mockStatsQuerier provides canned responses for StatsQuerier methods.
type mockStatsQuerier struct {
	overview       *database.OverviewStats
	overviewErr    error
	encounterStats *database.EncounterStats
	encounterErr   error
	history        []database.EncounterEvent
	historyErr     error
	chart          []database.ChartPoint
	chartErr       error

	// Captured arguments for assertions.
	lastHistoryID     string
	lastHistoryLimit  int
	lastHistoryOffset int
	lastChartID       string
	lastChartInterval string
	lastStatsID       string
}

func (m *mockStatsQuerier) GetOverviewStats() (*database.OverviewStats, error) {
	return m.overview, m.overviewErr
}

func (m *mockStatsQuerier) GetEncounterStats(pokemonID string) (*database.EncounterStats, error) {
	m.lastStatsID = pokemonID
	return m.encounterStats, m.encounterErr
}

func (m *mockStatsQuerier) GetEncounterHistory(pokemonID string, limit, offset int) ([]database.EncounterEvent, error) {
	m.lastHistoryID = pokemonID
	m.lastHistoryLimit = limit
	m.lastHistoryOffset = offset
	return m.history, m.historyErr
}

func (m *mockStatsQuerier) GetChartData(pokemonID, interval string) ([]database.ChartPoint, error) {
	m.lastChartID = pokemonID
	m.lastChartInterval = interval
	return m.chart, m.chartErr
}

// mockDeps implements Deps for testing.
type mockDeps struct {
	db StatsQuerier
}

func (d *mockDeps) StatsDB() StatsQuerier { return d.db }

// newTestMux registers the stats routes with the given mock querier.
func newTestMux(t *testing.T, q StatsQuerier) *http.ServeMux {
	t.Helper()
	mux := http.NewServeMux()
	RegisterRoutes(mux, &mockDeps{db: q})
	return mux
}

// --- Overview tests ----------------------------------------------------------

func TestGetStatsOverview(t *testing.T) {
	want := &database.OverviewStats{
		TotalEncounters: 500,
		TotalPokemon:    12,
		Today:           42,
	}
	mux := newTestMux(t, &mockStatsQuerier{overview: want})

	req := httptest.NewRequest(http.MethodGet, pathStatsOverview, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtWantOK, w.Code)
	}

	var got database.OverviewStats
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf(fmtUnmarshal, err)
	}
	if got.TotalEncounters != want.TotalEncounters {
		t.Errorf("TotalEncounters = %d, want %d", got.TotalEncounters, want.TotalEncounters)
	}
	if got.TotalPokemon != want.TotalPokemon {
		t.Errorf("TotalPokemon = %d, want %d", got.TotalPokemon, want.TotalPokemon)
	}
	if got.Today != want.Today {
		t.Errorf("Today = %d, want %d", got.Today, want.Today)
	}
}

func TestGetStatsOverviewDBNil(t *testing.T) {
	mux := newTestMux(t, nil)

	req := httptest.NewRequest(http.MethodGet, pathStatsOverview, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", w.Code)
	}
}

func TestGetStatsOverviewDBError(t *testing.T) {
	mux := newTestMux(t, &mockStatsQuerier{overviewErr: errors.New("db failure")})

	req := httptest.NewRequest(http.MethodGet, pathStatsOverview, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf(fmtWant500, w.Code)
	}
}

// --- Dispatch / History tests ------------------------------------------------

func TestHistoryWithPagination(t *testing.T) {
	events := []database.EncounterEvent{
		{ID: 1, PokemonID: "abc", PokemonName: "Pikachu", Delta: 1, CountAfter: 10, Source: "manual"},
		{ID: 2, PokemonID: "abc", PokemonName: "Pikachu", Delta: 1, CountAfter: 11, Source: "manual"},
	}
	mock := &mockStatsQuerier{history: events}
	mux := newTestMux(t, mock)

	req := httptest.NewRequest(http.MethodGet, "/api/stats/pokemon/abc/history?limit=5&offset=10", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtWantOK, w.Code)
	}
	if mock.lastHistoryID != "abc" {
		t.Errorf(fmtWantPokemonID, mock.lastHistoryID, "abc")
	}
	if mock.lastHistoryLimit != 5 {
		t.Errorf("limit = %d, want 5", mock.lastHistoryLimit)
	}
	if mock.lastHistoryOffset != 10 {
		t.Errorf("offset = %d, want 10", mock.lastHistoryOffset)
	}

	var got []database.EncounterEvent
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf(fmtUnmarshal, err)
	}
	if len(got) != 2 {
		t.Errorf("len(events) = %d, want 2", len(got))
	}
}

func TestHistoryWithDefaults(t *testing.T) {
	mock := &mockStatsQuerier{history: []database.EncounterEvent{}}
	mux := newTestMux(t, mock)

	req := httptest.NewRequest(http.MethodGet, "/api/stats/pokemon/xyz/history", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtWantOK, w.Code)
	}
	if mock.lastHistoryLimit != 20 {
		t.Errorf("default limit = %d, want 20", mock.lastHistoryLimit)
	}
	if mock.lastHistoryOffset != 0 {
		t.Errorf("default offset = %d, want 0", mock.lastHistoryOffset)
	}
}

func TestHistoryDBError(t *testing.T) {
	mock := &mockStatsQuerier{historyErr: errors.New("query failed")}
	mux := newTestMux(t, mock)

	req := httptest.NewRequest(http.MethodGet, "/api/stats/pokemon/abc/history", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf(fmtWant500, w.Code)
	}
}

// --- Chart tests -------------------------------------------------------------

func TestChartWithInterval(t *testing.T) {
	points := []database.ChartPoint{
		{Label: "2025-01", Count: 30},
		{Label: "2025-02", Count: 45},
	}
	mock := &mockStatsQuerier{chart: points}
	mux := newTestMux(t, mock)

	req := httptest.NewRequest(http.MethodGet, pathChartABC+"?interval=month", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtWantOK, w.Code)
	}
	if mock.lastChartID != "abc" {
		t.Errorf(fmtWantPokemonID, mock.lastChartID, "abc")
	}
	if mock.lastChartInterval != "month" {
		t.Errorf("interval = %q, want %q", mock.lastChartInterval, "month")
	}

	var got []database.ChartPoint
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf(fmtUnmarshal, err)
	}
	if len(got) != 2 {
		t.Errorf("len(chart) = %d, want 2", len(got))
	}
}

func TestChartDefaultInterval(t *testing.T) {
	mock := &mockStatsQuerier{chart: []database.ChartPoint{}}
	mux := newTestMux(t, mock)

	req := httptest.NewRequest(http.MethodGet, pathChartABC, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtWantOK, w.Code)
	}
	if mock.lastChartInterval != "day" {
		t.Errorf("default interval = %q, want %q", mock.lastChartInterval, "day")
	}
}

func TestChartDBError(t *testing.T) {
	mock := &mockStatsQuerier{chartErr: errors.New("chart query failed")}
	mux := newTestMux(t, mock)

	req := httptest.NewRequest(http.MethodGet, pathChartABC, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf(fmtWant500, w.Code)
	}
}

// --- Pokemon stats tests -----------------------------------------------------

func TestPokemonStats(t *testing.T) {
	want := &database.EncounterStats{
		Total:       150,
		Today:       7,
		RatePerHour: 3.5,
		FirstAt:     "2025-01-01T00:00:00Z",
		LastAt:      "2025-03-25T12:00:00Z",
	}
	mock := &mockStatsQuerier{encounterStats: want}
	mux := newTestMux(t, mock)

	req := httptest.NewRequest(http.MethodGet, "/api/stats/pokemon/p123", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtWantOK, w.Code)
	}
	if mock.lastStatsID != "p123" {
		t.Errorf(fmtWantPokemonID, mock.lastStatsID, "p123")
	}

	var got database.EncounterStats
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf(fmtUnmarshal, err)
	}
	if got.Total != want.Total {
		t.Errorf("Total = %d, want %d", got.Total, want.Total)
	}
	if got.RatePerHour != want.RatePerHour {
		t.Errorf("RatePerHour = %f, want %f", got.RatePerHour, want.RatePerHour)
	}
}

func TestPokemonStatsDBError(t *testing.T) {
	mock := &mockStatsQuerier{encounterErr: errors.New("not found")}
	mux := newTestMux(t, mock)

	req := httptest.NewRequest(http.MethodGet, "/api/stats/pokemon/missing", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf(fmtWant500, w.Code)
	}
}

// --- Dispatch DB nil ---------------------------------------------------------

func TestDispatchDBNil(t *testing.T) {
	mux := newTestMux(t, nil)

	paths := []string{
		"/api/stats/pokemon/abc",
		"/api/stats/pokemon/abc/history",
		pathChartABC,
	}
	for _, p := range paths {
		req := httptest.NewRequest(http.MethodGet, p, nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)

		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("path %s: status = %d, want 503", p, w.Code)
		}
	}
}
