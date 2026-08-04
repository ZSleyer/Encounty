// catchrefs_test.go covers the two embedded catch-reference endpoints.
package games

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/catchrefs"
)

const (
	catchRefsPath     = "/api/catch-refs"
	catchLocationPath = "/api/catch-refs/locations"
)

// newCatchRefsMux registers the routes with empty stores: the catch reference
// endpoints read only embedded data and touch no dependency.
func newCatchRefsMux(t *testing.T) *http.ServeMux {
	t.Helper()
	return newTestMux(t, &mockDeps{
		games:   &mockGamesStore{},
		pokedex: &mockPokedexStore{},
		cfgDir:  t.TempDir(),
	})
}

func TestHandleGetCatchRefs(t *testing.T) {
	rec := httptest.NewRecorder()
	newCatchRefsMux(t).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, catchRefsPath, nil))

	if rec.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, rec.Code)
	}
	var got catchrefs.Refs
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf(fmtUnmarshalError, err)
	}
	if len(got.Natures) != 25 {
		t.Errorf("natures = %d, want 25", len(got.Natures))
	}
	for _, kind := range []struct {
		name string
		n    int
	}{
		{"balls", len(got.Balls)},
		{"abilities", len(got.Abilities)},
		{"ribbons", len(got.Ribbons)},
		{"marks", len(got.Marks)},
	} {
		if kind.n == 0 {
			t.Errorf("%s is empty", kind.name)
		}
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != catchRefsCacheControl {
		t.Errorf("Cache-Control = %q, want %q", cc, catchRefsCacheControl)
	}
}

// TestCatchRefsAreNotCached pins the rule by behaviour rather than against the
// header constant, which a change would drag along with it. An app update
// rewrites these lists, and a cached copy outlives that update with no way for
// the user to evict it: shipping "max-age=86400, immutable" here once left the
// previous release's ball names on screen for a day.
func TestCatchRefsAreNotCached(t *testing.T) {
	for _, path := range []string{catchRefsPath, catchLocationPath + "?game=pokemon-ruby"} {
		t.Run(path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			newCatchRefsMux(t).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))

			if rec.Code != http.StatusOK {
				t.Fatalf(fmtStatusWant200, rec.Code)
			}
			if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
				t.Errorf("Cache-Control = %q, want no-store: a stored copy survives the update that replaces it", cc)
			}
		})
	}
}

func TestHandleGetCatchRefLocations(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, catchLocationPath+"?game=pokemon-ruby", nil)
	newCatchRefsMux(t).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, rec.Code)
	}
	var got locationsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf(fmtUnmarshalError, err)
	}
	if got.Group == "" {
		t.Fatal("group is empty, want the Gen 3 location group")
	}
	if len(got.Locations) == 0 {
		t.Fatal("locations is empty")
	}
}

// TestHandleGetCatchRefLocationsUnknownGame pins that the response carries an
// empty array rather than null, because the renderer maps over it directly.
func TestHandleGetCatchRefLocationsUnknownGame(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, catchLocationPath+"?game=not-a-game", nil)
	newCatchRefsMux(t).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, rec.Code)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf(fmtUnmarshalError, err)
	}
	if string(raw["locations"]) != "[]" {
		t.Errorf("locations = %s, want []", raw["locations"])
	}
}
