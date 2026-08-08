// sync_test.go tests the PokéAPI GraphQL merge logic in sync.go, including
// the gender-tagging (Path A) and synthesized female-variant (Path B) logic.
package pokedex

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// withMockGraphQL redirects pokeAPIGraphQL to an httptest server serving
// body for the duration of the test, restoring the original value on cleanup.
func withMockGraphQL(t *testing.T, body string) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)

	original := pokeAPIGraphQL
	pokeAPIGraphQL = server.URL
	t.Cleanup(func() { pokeAPIGraphQL = original })
}

// ---------------------------------------------------------------------------
// formNameGender / genderFromPokemonForms
// ---------------------------------------------------------------------------

func TestFormNameGender(t *testing.T) {
	tests := []struct {
		formName string
		want     string
	}{
		{"male", "male"},
		{"female", "female"},
		{"", ""},
		{"alola", ""},
		{"mega", ""},
	}
	for _, tt := range tests {
		if got := formNameGender(tt.formName); got != tt.want {
			t.Errorf("formNameGender(%q) = %q, want %q", tt.formName, got, tt.want)
		}
	}
}

func TestGenderFromPokemonForms(t *testing.T) {
	got := genderFromPokemonForms([]pokemonFormRow{
		{FormName: "standard"},
		{FormName: "female"},
	})
	if got != "female" {
		t.Errorf("genderFromPokemonForms = %q, want female", got)
	}

	if got := genderFromPokemonForms([]pokemonFormRow{{FormName: "standard"}}); got != "" {
		t.Errorf("genderFromPokemonForms = %q, want empty", got)
	}

	if got := genderFromPokemonForms(nil); got != "" {
		t.Errorf("genderFromPokemonForms(nil) = %q, want empty", got)
	}
}

// ---------------------------------------------------------------------------
// fetchAndMergeForms — Path A gender tagging
// ---------------------------------------------------------------------------

// TestFetchAndMergeFormsTagsGender verifies that a variant pokemonform whose
// form_name is "female" gets Form.Gender set to "female", while a form with
// an unrelated form_name is left untagged.
func TestFetchAndMergeFormsTagsGender(t *testing.T) {
	withMockGraphQL(t, `{"data":{"pokemon":[
		{"id":10159,"name":"pyroar-female","pokemon_species_id":668,"pokemonforms":[
			{"form_name":"female","versiongroup":{"generation_id":6},"pokemonformgenerations":[{"generation_id":6}]}
		]},
		{"id":10100,"name":"pikachu-alola","pokemon_species_id":25,"pokemonforms":[
			{"form_name":"alola","versiongroup":{"generation_id":7},"pokemonformgenerations":[{"generation_id":7}]}
		]}
	]}}`)

	current := []Entry{
		{ID: 668, Canonical: "pyroar"},
		{ID: 25, Canonical: "pikachu"},
	}
	added, err := fetchAndMergeForms(&current)
	if err != nil {
		t.Fatalf("fetchAndMergeForms: %v", err)
	}
	if len(added) != 2 {
		t.Fatalf("added = %v, want 2 entries", added)
	}

	female := findForm(current, "pyroar-female")
	if female == nil {
		t.Fatal("pyroar-female not attached")
	}
	if female.Gender != "female" {
		t.Errorf("pyroar-female Gender = %q, want female", female.Gender)
	}
	if female.SpriteID != 10159 {
		t.Errorf("pyroar-female SpriteID = %d, want 10159", female.SpriteID)
	}

	alola := findForm(current, "pikachu-alola")
	if alola == nil {
		t.Fatal("pikachu-alola not attached")
	}
	if alola.Gender != "" {
		t.Errorf("pikachu-alola Gender = %q, want empty", alola.Gender)
	}
}

// ---------------------------------------------------------------------------
// fetchAndMergeGenderVariants — Path B synthesis
// ---------------------------------------------------------------------------

// TestFetchAndMergeGenderVariantsSynthesizes verifies that a species with
// PokéAPI gender differences and no existing gender-tagged form gets a
// synthesized "<canonical>-female" form with SpriteID set to the species id.
func TestFetchAndMergeGenderVariantsSynthesizes(t *testing.T) {
	withMockGraphQL(t, `{"data":{"pokemonspecies":[{"id":1}]}}`)

	current := []Entry{{ID: 1, Canonical: "bulbasaur"}}
	added, err := fetchAndMergeGenderVariants(&current)
	if err != nil {
		t.Fatalf("fetchAndMergeGenderVariants: %v", err)
	}
	if len(added) != 1 || added[0] != "bulbasaur-female" {
		t.Fatalf("added = %v, want [bulbasaur-female]", added)
	}

	f := findForm(current, "bulbasaur-female")
	if f == nil {
		t.Fatal("bulbasaur-female not attached")
	}
	if f.Gender != "female" {
		t.Errorf("Gender = %q, want female", f.Gender)
	}
	if f.SpriteID != 1 {
		t.Errorf("SpriteID = %d, want 1 (species id)", f.SpriteID)
	}
}

// TestFetchAndMergeGenderVariantsSkipsAlreadyTagged verifies that a species
// which already carries a gender-tagged form (from Path A form_name matching)
// is not given a second, synthesized form.
func TestFetchAndMergeGenderVariantsSkipsAlreadyTagged(t *testing.T) {
	withMockGraphQL(t, `{"data":{"pokemonspecies":[{"id":668}]}}`)

	current := []Entry{
		{ID: 668, Canonical: "pyroar", Forms: []Form{
			{Canonical: "pyroar-female", SpriteID: 10159, Gender: "female"},
		}},
	}
	added, err := fetchAndMergeGenderVariants(&current)
	if err != nil {
		t.Fatalf("fetchAndMergeGenderVariants: %v", err)
	}
	if len(added) != 0 {
		t.Fatalf("added = %v, want empty (already tagged)", added)
	}
	if len(current[0].Forms) != 1 {
		t.Fatalf("forms = %d, want 1 (no duplicate synthesized)", len(current[0].Forms))
	}
}

// TestFetchAndMergeGenderVariantsSkipsCollision verifies that a synthesized
// canonical colliding with an existing species or form canonical is skipped
// instead of being added, mirroring the UNIQUE-constraint guard used by
// mergeCosmeticFormRows.
func TestFetchAndMergeGenderVariantsSkipsCollision(t *testing.T) {
	withMockGraphQL(t, `{"data":{"pokemonspecies":[{"id":3}]}}`)

	current := []Entry{
		{ID: 3, Canonical: "venusaur", Forms: []Form{
			{Canonical: "venusaur-female"}, // pre-existing, unrelated, ungendered form
		}},
	}
	added, err := fetchAndMergeGenderVariants(&current)
	if err != nil {
		t.Fatalf("fetchAndMergeGenderVariants: %v", err)
	}
	if len(added) != 0 {
		t.Fatalf("added = %v, want empty (collision)", added)
	}
	if len(current[0].Forms) != 1 {
		t.Fatalf("forms = %d, want 1 (no duplicate added)", len(current[0].Forms))
	}
	if current[0].Forms[0].Gender != "" {
		t.Errorf("existing form Gender = %q, want unchanged empty", current[0].Forms[0].Gender)
	}
}

// TestFetchAndMergeGenderVariantsIgnoresUnknownSpecies verifies that a
// species id absent from current (not yet synced) is skipped without error.
func TestFetchAndMergeGenderVariantsIgnoresUnknownSpecies(t *testing.T) {
	withMockGraphQL(t, `{"data":{"pokemonspecies":[{"id":9999}]}}`)

	current := []Entry{{ID: 1, Canonical: "bulbasaur"}}
	added, err := fetchAndMergeGenderVariants(&current)
	if err != nil {
		t.Fatalf("fetchAndMergeGenderVariants: %v", err)
	}
	if len(added) != 0 {
		t.Fatalf("added = %v, want empty", added)
	}
}

// TestFetchAndMergeGenderVariantsHTTPError verifies that a transport-level
// failure surfaces as an error rather than panicking.
func TestFetchAndMergeGenderVariantsHTTPError(t *testing.T) {
	original := pokeAPIGraphQL
	pokeAPIGraphQL = "http://127.0.0.1:0"
	t.Cleanup(func() { pokeAPIGraphQL = original })

	current := []Entry{{ID: 1, Canonical: "bulbasaur"}}
	if _, err := fetchAndMergeGenderVariants(&current); err == nil {
		t.Error("expected an error for an unreachable endpoint")
	}
}
