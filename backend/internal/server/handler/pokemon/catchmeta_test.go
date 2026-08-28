// catchmeta_test.go covers PUT /api/pokemon/{id}/catch: the happy path, the
// error responses, and the validation rules that keep impossible levels,
// individual values and oversized free text out of the state.
package pokemon

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/state"
)

const pathCatchP1 = "/api/pokemon/p1/catch"

// catchLevel returns a pointer to v, so a test can express "recorded as 0"
// separately from "never recorded".
func catchLevel(v int) *int { return &v }

// storedCatch returns the metadata recorded for the given Pokemon.
func storedCatch(t *testing.T, deps *testDeps, id string) *state.CatchMeta {
	t.Helper()
	for _, p := range deps.stateMgr.GetState().Pokemon {
		if p.ID == id {
			return p.Catch
		}
	}
	t.Fatalf("pokemon %q missing from state", id)
	return nil
}

// TestHandleSetCatchMeta verifies that a valid body is recorded, the state is
// scheduled for saving and the full-state update is broadcast.
func TestHandleSetCatchMeta(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")
	broadcastsBefore := deps.broadcastN

	body := jsonBody(t, CatchMetaRequest{
		Gender: "female",
		CatchMeta: state.CatchMeta{
			Nickname: "  Sparky  ",
			Location: "  Route 210  ",
			Nature:   "adamant",
			Level:    catchLevel(42),
			HP:       catchLevel(0),
			Ribbons:  []string{"effort-ribbon", "effort-ribbon"},
		},
	})
	req := httptest.NewRequest(http.MethodPut, pathCatchP1, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNoContent)
	}
	if deps.saveCount == 0 {
		t.Error(fmtWantSaveCall)
	}
	if deps.broadcastN == broadcastsBefore {
		t.Error("expected a state update to be broadcast")
	}

	got := storedCatch(t, deps, "p1")
	if got == nil {
		t.Fatal("Catch = nil, want the recorded metadata")
	}
	if got.Location != "Route 210" {
		t.Errorf("Location = %q, want %q", got.Location, "Route 210")
	}
	if got.Level == nil || *got.Level != 42 {
		t.Errorf("Level = %v, want 42", got.Level)
	}
	if got.HP == nil || *got.HP != 0 {
		t.Errorf("HP = %v, want a recorded 0", got.HP)
	}
	if len(got.Ribbons) != 1 || got.Ribbons[0] != "effort-ribbon" {
		t.Errorf("Ribbons = %v, want [effort-ribbon]", got.Ribbons)
	}
	if nickname := deps.stateMgr.GetState().Pokemon[0].Nickname; nickname != "Sparky" {
		t.Errorf("Nickname = %q, want Sparky", nickname)
	}
}

func TestHandleSetCatchMetaUpdatesAutomaticSprite(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")
	url := "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/female/25.png"
	req := httptest.NewRequest(http.MethodPut, pathCatchP1, jsonBody(t, map[string]any{
		"gender": "female", "sprite_url": url,
	}))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNoContent)
	}
	p := deps.stateMgr.GetState().Pokemon[0]
	if p.Gender != "female" || p.SpriteURL != url {
		t.Fatalf("stored catch/sprite = %+v / %q", p.Catch, p.SpriteURL)
	}
}

func TestHandleSetCatchMetaRejectsCustomSprite(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")
	req := httptest.NewRequest(http.MethodPut, pathCatchP1, jsonBody(t, map[string]any{
		"gender": "female", "sprite_url": "https://example.com/custom.png",
	}))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusBadRequest)
	}
	if storedCatch(t, deps, "p1") != nil {
		t.Fatal("invalid request mutated catch metadata")
	}
}

// TestHandleSetCatchMetaUnknownPokemon verifies that recording metadata for an
// id that does not exist is a 404.
func TestHandleSetCatchMetaUnknownPokemon(t *testing.T) {
	mux, deps := newTestMux(t)

	req := httptest.NewRequest(http.MethodPut, "/api/pokemon/nope/catch", jsonBody(t, state.CatchMeta{Nature: "timid"}))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
	if deps.saveCount != 0 {
		t.Error("a 404 must not schedule a save")
	}
}

// TestHandleSetCatchMetaBadJSON verifies that an unparsable body is a 400 and
// leaves the existing record alone.
func TestHandleSetCatchMetaBadJSON(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodPut, pathCatchP1, strings.NewReader("{not json"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusBadRequest)
	}
	if deps.saveCount != 0 {
		t.Error("a 400 must not schedule a save")
	}
	if got := storedCatch(t, deps, "p1"); got != nil {
		t.Errorf("Catch = %+v, want nil", got)
	}
}

// TestHandleSetCatchMetaWrongMethod verifies that only PUT is accepted; there
// is no delete route because a PUT with an empty body clears the record.
func TestHandleSetCatchMetaWrongMethod(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	for _, method := range []string{http.MethodPost, http.MethodDelete, http.MethodGet} {
		req := httptest.NewRequest(method, pathCatchP1, nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s: status = %d, want %d", method, w.Code, http.StatusMethodNotAllowed)
		}
	}
}

// TestValidateCatchMeta pins the accepted ranges of every field, including the
// rune-based length limits and the deduplication of ribbons.
func TestValidateCatchMeta(t *testing.T) {
	tests := []struct {
		name    string
		meta    state.CatchMeta
		wantErr bool
	}{
		{name: "empty metadata", meta: state.CatchMeta{}},
		{name: "iv zero", meta: state.CatchMeta{HP: catchLevel(0)}},
		{name: "iv unset", meta: state.CatchMeta{}},
		{name: "iv max", meta: state.CatchMeta{Speed: catchLevel(31)}},
		{name: "iv above max", meta: state.CatchMeta{Speed: catchLevel(32)}, wantErr: true},
		{name: "iv negative", meta: state.CatchMeta{Def: catchLevel(-1)}, wantErr: true},
		{name: "level min", meta: state.CatchMeta{Level: catchLevel(1)}},
		{name: "level max", meta: state.CatchMeta{Level: catchLevel(100)}},
		{name: "level above max", meta: state.CatchMeta{Level: catchLevel(101)}, wantErr: true},
		{name: "level zero", meta: state.CatchMeta{Level: catchLevel(0)}, wantErr: true},
		{name: "location at limit", meta: state.CatchMeta{Location: strings.Repeat("a", 120)}},
		{name: "location at limit in japanese", meta: state.CatchMeta{Location: strings.Repeat("も", 120)}},
		{name: "location over limit", meta: state.CatchMeta{Location: strings.Repeat("a", 121)}, wantErr: true},
		{name: "nature over limit", meta: state.CatchMeta{Nature: strings.Repeat("a", 61)}, wantErr: true},
		{name: "ribbons at limit", meta: state.CatchMeta{Ribbons: catchRibbonSlugs(64)}},
		{name: "ribbons over limit", meta: state.CatchMeta{Ribbons: catchRibbonSlugs(65)}, wantErr: true},
		{name: "duplicate ribbons", meta: state.CatchMeta{Ribbons: []string{"effort", "effort"}}},
		{name: "evolution chain", meta: state.CatchMeta{Evolutions: []state.EvolutionStep{{CanonicalName: "ivysaur"}, {CanonicalName: "venusaur-mega"}}}},
		{name: "empty evolution", meta: state.CatchMeta{Evolutions: []state.EvolutionStep{{}}}, wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			meta := tc.meta
			err := ValidateCatchMeta(&meta)
			if tc.wantErr && err == nil {
				t.Fatalf("ValidateCatchMeta(%+v) = nil, want an error", tc.meta)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("ValidateCatchMeta(%+v) = %v, want nil", tc.meta, err)
			}
		})
	}

	// Duplicates are deduplicated in place rather than rejected.
	dupes := state.CatchMeta{Ribbons: []string{"effort", " effort ", "champion"}}
	if err := ValidateCatchMeta(&dupes); err != nil {
		t.Fatalf("validateCatchMeta on duplicates = %v, want nil", err)
	}
	if len(dupes.Ribbons) != 2 {
		t.Errorf("Ribbons = %v, want two entries", dupes.Ribbons)
	}
}

// catchRibbonSlugs builds n distinct ribbon slugs for the count limit cases.
func catchRibbonSlugs(n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = "ribbon-" + string(rune('a'+i%26)) + string(rune('a'+i/26))
	}
	return out
}

// TestValidateShinyVariant pins the accepted variant slugs. The comparison is
// case-sensitive on purpose: the API stores the slug verbatim, so accepting a
// differently cased spelling would put two encodings of one value in the data.
func TestValidateShinyVariant(t *testing.T) {
	tests := []struct {
		name    string
		variant string
		wantErr bool
	}{
		{name: "unrecorded", variant: ""},
		{name: "star", variant: "star"},
		{name: "square", variant: "square"},
		{name: "capitalized star", variant: "Star", wantErr: true},
		{name: "uppercase square", variant: "SQUARE", wantErr: true},
		{name: "unknown shape", variant: "triangle", wantErr: true},
		{name: "padded star", variant: " star", wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateShinyVariant(tc.variant)
			if tc.wantErr && err == nil {
				t.Fatalf("ValidateShinyVariant(%q) = nil, want an error", tc.variant)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("ValidateShinyVariant(%q) = %v, want nil", tc.variant, err)
			}
		})
	}
}

// TestValidateCatchMetaRejectsShinyVariant verifies that the catch path, which
// dexoverride shares, refuses a bogus variant instead of storing it.
func TestValidateCatchMetaRejectsShinyVariant(t *testing.T) {
	meta := state.CatchMeta{ShinyVariant: "triangle"}
	if err := ValidateCatchMeta(&meta); err == nil {
		t.Fatal("ValidateCatchMeta accepted an unknown shiny variant")
	}
	valid := state.CatchMeta{ShinyVariant: "square"}
	if err := ValidateCatchMeta(&valid); err != nil {
		t.Fatalf("ValidateCatchMeta(square) = %v, want nil", err)
	}
}
