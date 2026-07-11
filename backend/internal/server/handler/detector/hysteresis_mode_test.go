// hysteresis_mode_test.go covers validation and persistence of the
// per-template hysteresis_mode setting through the PATCH and upload handlers.
package detector

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// strPtr returns a pointer to the given string for building test fixtures.
func strPtr(v string) *string { return &v }

// newHysteresisModeMux builds a mux with one pokemon owning a single template
// that optionally carries a stored hysteresis mode.
func newHysteresisModeMux(t *testing.T, stored *string) (http.Handler, *testDeps) {
	t.Helper()
	mux, deps := newTestMux(t)
	addTestPokemonWithConfig(t, deps, "p1", "Pikachu", &state.DetectorConfig{
		Templates: []state.DetectorTemplate{
			{TemplateDBID: 1, Regions: []state.MatchedRegion{{Type: "image"}}, HysteresisMode: stored},
		},
	})
	return mux, deps
}

func TestTemplatePatchSetsHysteresisMode(t *testing.T) {
	for _, mode := range []string{"score", "region"} {
		mux, deps := newHysteresisModeMux(t, nil)

		body := jsonBody(t, map[string]any{"hysteresis_mode": mode})
		req := httptest.NewRequest(http.MethodPatch, pathTemplate0, body)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf(msgWant200Body, w.Code, w.Body.String())
		}
		tmpl := findPokemon(deps.stateMgr.GetState(), "p1").DetectorConfig.Templates[0]
		if tmpl.HysteresisMode == nil || *tmpl.HysteresisMode != mode {
			t.Errorf("HysteresisMode = %v, want %q", tmpl.HysteresisMode, mode)
		}
	}
}

func TestTemplatePatchInvalidHysteresisMode(t *testing.T) {
	mux, _ := newHysteresisModeMux(t, nil)

	body := jsonBody(t, map[string]any{"hysteresis_mode": "pixel"})
	req := httptest.NewRequest(http.MethodPatch, pathTemplate0, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf(msgWant400, w.Code)
	}
}

func TestTemplatePatchOmittedHysteresisModeKept(t *testing.T) {
	mux, deps := newHysteresisModeMux(t, strPtr("region"))

	// A name-only patch omits hysteresis_mode entirely and must not touch it.
	body := jsonBody(t, map[string]any{"name": "renamed"})
	req := httptest.NewRequest(http.MethodPatch, pathTemplate0, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200Body, w.Code, w.Body.String())
	}
	tmpl := findPokemon(deps.stateMgr.GetState(), "p1").DetectorConfig.Templates[0]
	if tmpl.HysteresisMode == nil || *tmpl.HysteresisMode != "region" {
		t.Errorf("HysteresisMode = %v, want \"region\" preserved", tmpl.HysteresisMode)
	}
}

func TestTemplatePatchExplicitNullClearsHysteresisMode(t *testing.T) {
	mux, deps := newHysteresisModeMux(t, strPtr("region"))

	body := jsonBody(t, map[string]any{"hysteresis_mode": nil})
	req := httptest.NewRequest(http.MethodPatch, pathTemplate0, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200Body, w.Code, w.Body.String())
	}
	tmpl := findPokemon(deps.stateMgr.GetState(), "p1").DetectorConfig.Templates[0]
	if tmpl.HysteresisMode != nil {
		t.Errorf("HysteresisMode = %q, want nil after explicit null", *tmpl.HysteresisMode)
	}
}

func TestTemplateUploadSeedsHysteresisMode(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	b64 := base64.StdEncoding.EncodeToString(makePNGBytes(t))
	body := jsonBody(t, map[string]any{
		"imageBase64":     b64,
		"hysteresis_mode": "region",
	})
	req := httptest.NewRequest(http.MethodPost, pathTemplateUpload, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(msgWant200Body, w.Code, w.Body.String())
	}
	tmpl := findPokemon(deps.stateMgr.GetState(), "p1").DetectorConfig.Templates[0]
	if tmpl.HysteresisMode == nil || *tmpl.HysteresisMode != "region" {
		t.Errorf("HysteresisMode = %v, want \"region\"", tmpl.HysteresisMode)
	}
}

func TestTemplateUploadInvalidHysteresisMode(t *testing.T) {
	mux, deps := newTestMux(t)
	addTestPokemon(t, deps, "p1", "Pikachu")

	b64 := base64.StdEncoding.EncodeToString(makePNGBytes(t))
	body := jsonBody(t, map[string]any{
		"imageBase64":     b64,
		"hysteresis_mode": "3d",
	})
	req := httptest.NewRequest(http.MethodPost, pathTemplateUpload, body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf(msgWant400, w.Code)
	}
}
