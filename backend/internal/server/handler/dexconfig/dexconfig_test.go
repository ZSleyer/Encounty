package dexconfig

import (
	"bytes"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/database"
)

type testStore struct {
	rows    []database.UserPokedexRow
	err     error
	deleted string
}

func (s *testStore) ListUserPokedexes() ([]database.UserPokedexRow, error) { return s.rows, s.err }
func (s *testStore) SaveUserPokedex(row database.UserPokedexRow) error {
	if s.err != nil {
		return s.err
	}
	s.rows = []database.UserPokedexRow{row}
	return nil
}
func (s *testStore) DeleteUserPokedex(id string) error { s.deleted = id; return s.err }

type testDeps struct{ store Store }

func (d testDeps) UserPokedexDB() Store { return d.store }

func request(t *testing.T, store Store, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	mux := http.NewServeMux()
	RegisterRoutes(mux, testDeps{store})
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(method, path, bytes.NewBufferString(body)))
	return w
}

func TestCollectionAndItem(t *testing.T) {
	s := &testStore{}
	valid := `{"name":" National ","show_forms":true,"living_dex":true,"generations":[1],"target_games":["red"],"form_categories":["regional"],"include_species":[25]}`
	if w := request(t, s, http.MethodPost, "/api/pokedexes", valid); w.Code != http.StatusOK || len(s.rows) != 1 || s.rows[0].Name != "National" || s.rows[0].ID == "" || !s.rows[0].LivingDex {
		t.Fatalf("post: code=%d rows=%+v", w.Code, s.rows)
	}
	id := s.rows[0].ID
	if w := request(t, s, http.MethodGet, "/api/pokedexes", ""); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"generations":[1]`) || !strings.Contains(w.Body.String(), `"living_dex":true`) {
		t.Fatalf("get: %d %s", w.Code, w.Body)
	}
	if w := request(t, s, http.MethodPut, "/api/pokedexes/"+id, valid); w.Code != http.StatusOK {
		t.Fatalf("put: %d", w.Code)
	}
	if w := request(t, s, http.MethodDelete, "/api/pokedexes/"+id, ""); w.Code != http.StatusNoContent || s.deleted != id {
		t.Fatalf("delete: %d %q", w.Code, s.deleted)
	}
}

func TestValidationAndErrors(t *testing.T) {
	tests := []struct {
		method, path, body string
		err                error
		want               int
	}{
		{http.MethodPatch, "/api/pokedexes", "", nil, 405},
		{http.MethodPost, "/api/pokedexes", "{", nil, 400},
		{http.MethodPost, "/api/pokedexes", `{"name":""}`, nil, 400},
		{http.MethodPost, "/api/pokedexes", `{"name":"x","generations":[0]}`, nil, 400},
		{http.MethodPost, "/api/pokedexes", `{"name":"x","form_categories":["bad"]}`, nil, 400},
		{http.MethodPost, "/api/pokedexes", `{"name":"x"}`, database.ErrPokedexScopeConflict, 409},
		{http.MethodGet, "/api/pokedexes", "", errors.New("boom"), 500},
		{http.MethodGet, "/api/pokedexes/", "", nil, 404},
		{http.MethodGet, "/api/pokedexes/a/b", "", nil, 404},
		{http.MethodPatch, "/api/pokedexes/a", "", nil, 405},
		{http.MethodPut, "/api/pokedexes/a", "{", nil, 400},
		{http.MethodPut, "/api/pokedexes/a", `{"name":"x"}`, errors.New("boom"), 400},
		{http.MethodDelete, "/api/pokedexes/a", "", database.ErrDefaultPokedex, 409},
		{http.MethodDelete, "/api/pokedexes/a", "", database.ErrPokedexHasAssignments, 409},
		{http.MethodDelete, "/api/pokedexes/a", "", sql.ErrNoRows, 404},
		{http.MethodDelete, "/api/pokedexes/a", "", errors.New("boom"), 500},
	}
	for _, tt := range tests {
		t.Run(tt.method+tt.path+tt.body, func(t *testing.T) {
			if got := request(t, &testStore{err: tt.err}, tt.method, tt.path, tt.body).Code; got != tt.want {
				t.Fatalf("got %d, want %d", got, tt.want)
			}
		})
	}
}
