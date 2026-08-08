// Package dexoverride tests the HTTP handlers for manual Pokédex caught/seen
// overrides.
package dexoverride

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/pokedex"
)

const (
	fmtStatusWant = "status = %d, want %d"
	fmtUnmarshal  = "unmarshal: %v"
	overridesPath = "/api/pokedex/overrides"
)

var errBoom = errors.New("boom")

// --- Mock store ---------------------------------------------------------------

// mockOverrideStore is an in-memory pokedex.OverrideStore for testing.
type mockOverrideStore struct {
	rows   []database.PokedexOverrideRow
	nextID int64
	err    error
}

func (m *mockOverrideStore) ListPokedexOverrides() ([]database.PokedexOverrideRow, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.rows, nil
}

func (m *mockOverrideStore) UpsertPokedexOverride(row database.PokedexOverrideRow) (database.PokedexOverrideRow, bool, error) {
	if m.err != nil {
		return database.PokedexOverrideRow{}, false, m.err
	}
	if !row.Caught && !row.Seen {
		out := m.rows[:0]
		for _, r := range m.rows {
			if r.SpeciesID == row.SpeciesID && r.FormCanonical == row.FormCanonical &&
				r.Gender == row.Gender && r.Game == row.Game {
				continue
			}
			out = append(out, r)
		}
		m.rows = out
		return database.PokedexOverrideRow{}, true, nil
	}
	for i, r := range m.rows {
		if r.SpeciesID == row.SpeciesID && r.FormCanonical == row.FormCanonical &&
			r.Gender == row.Gender && r.Game == row.Game {
			m.rows[i].Caught = row.Caught
			m.rows[i].Seen = row.Seen
			m.rows[i].UpdatedAt = "updated"
			return m.rows[i], false, nil
		}
	}
	m.nextID++
	row.ID = m.nextID
	row.CreatedAt = "created"
	row.UpdatedAt = "created"
	m.rows = append(m.rows, row)
	return row, false, nil
}

// mockDeps implements Deps for testing.
type mockDeps struct {
	store pokedex.OverrideStore
}

func (d *mockDeps) PokedexOverrideDB() pokedex.OverrideStore { return d.store }

// newTestMux registers the dexoverride routes against a fresh mockOverrideStore.
func newTestMux(t *testing.T, store *mockOverrideStore) *http.ServeMux {
	t.Helper()
	mux := http.NewServeMux()
	RegisterRoutes(mux, &mockDeps{store: store})
	return mux
}

// --- GET tests -----------------------------------------------------------------

func TestHandleGetOverridesEmpty(t *testing.T) {
	mux := newTestMux(t, &mockOverrideStore{})

	req := httptest.NewRequest(http.MethodGet, overridesPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant, w.Code, http.StatusOK)
	}
	body := w.Body.String()
	if body != "[]" && body != "[]\n" {
		t.Errorf("body = %q, want empty JSON array", body)
	}
}

func TestHandleGetOverridesReturnsRows(t *testing.T) {
	store := &mockOverrideStore{rows: []database.PokedexOverrideRow{
		{ID: 1, SpeciesID: 25, Caught: true, Seen: true, UpdatedAt: "now"},
		{ID: 2, SpeciesID: 4, FormCanonical: "charmander", Gender: "female", Game: "pokemon-sword", Seen: true, UpdatedAt: "now"},
	}}
	mux := newTestMux(t, store)

	req := httptest.NewRequest(http.MethodGet, overridesPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant, w.Code, http.StatusOK)
	}
	var got []pokedex.Override
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf(fmtUnmarshal, err)
	}
	if len(got) != 2 {
		t.Fatalf("len(got) = %d, want 2", len(got))
	}
	if got[1].FormCanonical != "charmander" || got[1].Gender != "female" || got[1].Game != "pokemon-sword" {
		t.Errorf("got[1] = %+v", got[1])
	}
}

func TestHandleGetOverridesStoreError(t *testing.T) {
	store := &mockOverrideStore{err: errBoom}
	mux := newTestMux(t, store)

	req := httptest.NewRequest(http.MethodGet, overridesPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf(fmtStatusWant, w.Code, http.StatusInternalServerError)
	}
}

// --- PUT tests -----------------------------------------------------------------

func TestHandlePutCreatesOverride(t *testing.T) {
	store := &mockOverrideStore{}
	mux := newTestMux(t, store)

	body, _ := json.Marshal(map[string]any{
		"species_id":     25,
		"form_canonical": "pikachu-alola",
		"gender":         "",
		"game":           "",
		"caught":         true,
		"seen":           true,
	})
	req := httptest.NewRequest(http.MethodPut, overridesPath, bytes.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant, w.Code, http.StatusOK)
	}
	var got pokedex.Override
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf(fmtUnmarshal, err)
	}
	if got.SpeciesID != 25 {
		t.Errorf("SpeciesID = %v, want 25", got.SpeciesID)
	}
	if got.FormCanonical != "pikachu-alola" {
		t.Errorf("FormCanonical = %v, want pikachu-alola", got.FormCanonical)
	}
	if len(store.rows) != 1 {
		t.Fatalf("store has %d rows, want 1", len(store.rows))
	}
}

func TestHandlePutBothFalseDeletes(t *testing.T) {
	store := &mockOverrideStore{rows: []database.PokedexOverrideRow{
		{ID: 1, SpeciesID: 1, Caught: true, UpdatedAt: "now"},
	}}
	mux := newTestMux(t, store)

	body, _ := json.Marshal(map[string]any{
		"species_id": 1,
		"caught":     false,
		"seen":       false,
	})
	req := httptest.NewRequest(http.MethodPut, overridesPath, bytes.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf(fmtStatusWant, w.Code, http.StatusNoContent)
	}
	if w.Body.Len() != 0 {
		t.Errorf("body = %q, want empty", w.Body.String())
	}
	if len(store.rows) != 0 {
		t.Errorf("store has %d rows, want 0 after delete", len(store.rows))
	}
}

func TestHandlePutMissingSpeciesID(t *testing.T) {
	mux := newTestMux(t, &mockOverrideStore{})

	body, _ := json.Marshal(map[string]any{"caught": true})
	req := httptest.NewRequest(http.MethodPut, overridesPath, bytes.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf(fmtStatusWant, w.Code, http.StatusBadRequest)
	}
}

func TestHandlePutInvalidJSON(t *testing.T) {
	mux := newTestMux(t, &mockOverrideStore{})

	req := httptest.NewRequest(http.MethodPut, overridesPath, bytes.NewReader([]byte("not json")))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf(fmtStatusWant, w.Code, http.StatusBadRequest)
	}
}

func TestHandlePutUpdatesExisting(t *testing.T) {
	store := &mockOverrideStore{rows: []database.PokedexOverrideRow{
		{ID: 1, SpeciesID: 1, Caught: true, Seen: false, UpdatedAt: "before"},
	}}
	mux := newTestMux(t, store)

	body, _ := json.Marshal(map[string]any{"species_id": 1, "caught": true, "seen": true})
	req := httptest.NewRequest(http.MethodPut, overridesPath, bytes.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant, w.Code, http.StatusOK)
	}
	if len(store.rows) != 1 {
		t.Fatalf("store has %d rows, want 1 (update, not duplicate)", len(store.rows))
	}
	if !store.rows[0].Seen {
		t.Error("expected Seen = true after update")
	}
}

func TestHandlePutStoreError(t *testing.T) {
	store := &mockOverrideStore{err: errBoom}
	mux := newTestMux(t, store)

	body, _ := json.Marshal(map[string]any{"species_id": 1, "caught": true})
	req := httptest.NewRequest(http.MethodPut, overridesPath, bytes.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf(fmtStatusWant, w.Code, http.StatusInternalServerError)
	}
}

// --- Method dispatch -----------------------------------------------------------

func TestHandleOverridesMethodNotAllowed(t *testing.T) {
	mux := newTestMux(t, &mockOverrideStore{})

	req := httptest.NewRequest(http.MethodDelete, overridesPath, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf(fmtStatusWant, w.Code, http.StatusMethodNotAllowed)
	}
}
