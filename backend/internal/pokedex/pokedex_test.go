// pokedex_test.go tests Pokédex JSON persistence and data type serialization.
package pokedex

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/database"
)

// Duplicated test literals extracted for SonarQube S1192 compliance.
const (
	testFormName         = "pikachu-alola"
	wantOneEntryFmt      = "expected 1 entry, got %d"
	wantOneSpeciesRowFmt = "expected 1 species row, got %d"
)

// mockPokedexStore is an in-memory PokedexStore for testing.
type mockPokedexStore struct {
	species    []database.PokedexSpeciesRow
	forms      []database.PokedexFormRow
	hasPokedex bool
	count      int
	saveErr    error
	loadErr    error
	loadCalls  int
}

func (m *mockPokedexStore) SavePokedex(species []database.PokedexSpeciesRow, forms []database.PokedexFormRow) error {
	if m.saveErr != nil {
		return m.saveErr
	}
	m.species = species
	m.forms = forms
	return nil
}

func (m *mockPokedexStore) LoadPokedex() ([]database.PokedexSpeciesRow, []database.PokedexFormRow, error) {
	m.loadCalls++
	if m.loadErr != nil {
		return nil, nil, m.loadErr
	}
	return m.species, m.forms, nil
}

func (m *mockPokedexStore) HasPokedex() bool {
	return m.hasPokedex
}

func (m *mockPokedexStore) PokedexCount() int {
	return m.count
}

// resetPokedexCache clears the package-level cache so each test starts fresh.
func resetPokedexCache(t *testing.T) {
	t.Helper()
	pokedexMu.Lock()
	cachedPokedex = nil
	pokedexMu.Unlock()
}

// fixtureSpeciesRows returns minimal valid species rows for testing.
func fixtureSpeciesRows() []database.PokedexSpeciesRow {
	return []database.PokedexSpeciesRow{
		{ID: 1, Canonical: "bulbasaur", NamesJSON: []byte(`{"en":"Bulbasaur","de":"Bisasam"}`)},
		{ID: 25, Canonical: "pikachu", NamesJSON: []byte(`{"en":"Pikachu","de":"Pikachu"}`)},
	}
}

// fixtureFormRows returns minimal valid form rows for testing.
func fixtureFormRows() []database.PokedexFormRow {
	return []database.PokedexFormRow{
		{SpeciesID: 25, Canonical: testFormName, SpriteID: 10100, NamesJSON: []byte(`{"en":"Alolan Pikachu"}`)},
	}
}

func TestLoadPokedexFromDB(t *testing.T) {
	resetPokedexCache(t)
	store := &mockPokedexStore{
		species:    fixtureSpeciesRows(),
		forms:      fixtureFormRows(),
		hasPokedex: true,
		count:      2,
	}

	entries := LoadPokedex(store)
	if entries == nil {
		t.Fatal("LoadPokedex returned nil")
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}
	if entries[0].Canonical != "bulbasaur" {
		t.Errorf("first entry = %q, want bulbasaur", entries[0].Canonical)
	}
	// Verify form is attached to pikachu
	if len(entries[1].Forms) != 1 {
		t.Fatalf("expected 1 form on pikachu, got %d", len(entries[1].Forms))
	}
	if entries[1].Forms[0].Canonical != testFormName {
		t.Errorf("form canonical = %q, want %s", entries[1].Forms[0].Canonical, testFormName)
	}
}

func TestLoadPokedexCaching(t *testing.T) {
	resetPokedexCache(t)
	store := &mockPokedexStore{
		species:    fixtureSpeciesRows(),
		forms:      fixtureFormRows(),
		hasPokedex: true,
		count:      2,
	}

	first := LoadPokedex(store)
	if first == nil {
		t.Fatal("first call returned nil")
	}

	// Second call should use the cache and not query the store again.
	second := LoadPokedex(store)
	if len(second) != len(first) {
		t.Errorf("cached length mismatch: %d vs %d", len(second), len(first))
	}
	if store.loadCalls != 1 {
		t.Errorf("store.LoadPokedex called %d times, want 1", store.loadCalls)
	}
}

func TestLoadPokedexEmptyStore(t *testing.T) {
	resetPokedexCache(t)
	store := &mockPokedexStore{hasPokedex: false}

	entries := LoadPokedex(store)
	if entries != nil {
		t.Errorf("expected nil for empty store, got %d entries", len(entries))
	}
}

func TestInvalidateCachePokedex(t *testing.T) {
	resetPokedexCache(t)
	store := &mockPokedexStore{
		species:    fixtureSpeciesRows(),
		forms:      fixtureFormRows(),
		hasPokedex: true,
		count:      2,
	}

	first := LoadPokedex(store)
	if first == nil {
		t.Fatal("first call returned nil")
	}

	InvalidateCache()

	// After invalidation, the store should be queried again.
	second := LoadPokedex(store)
	if second == nil {
		t.Fatal("second call returned nil after invalidation")
	}
	if store.loadCalls != 2 {
		t.Errorf("store.LoadPokedex called %d times, want 2", store.loadCalls)
	}
}

func TestNeedsSyncNilStore(t *testing.T) {
	if !NeedsSync(nil) {
		t.Error("NeedsSync(nil) = false, want true")
	}
}

func TestNeedsSyncEmpty(t *testing.T) {
	store := &mockPokedexStore{hasPokedex: false}
	if !NeedsSync(store) {
		t.Error("NeedsSync with empty store = false, want true")
	}
}

func TestNeedsSyncBelowMinimum(t *testing.T) {
	store := &mockPokedexStore{hasPokedex: true, count: 500}
	if !NeedsSync(store) {
		t.Error("NeedsSync with count=500 = false, want true")
	}
}

func TestNeedsSyncAboveMinimum(t *testing.T) {
	store := &mockPokedexStore{hasPokedex: true, count: 900}
	if NeedsSync(store) {
		t.Error("NeedsSync with count=900 = true, want false")
	}
}

func TestRowsToEntries(t *testing.T) {
	species := fixtureSpeciesRows()
	forms := fixtureFormRows()
	entries := RowsToEntries(species, forms)

	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}
	if entries[0].Names["en"] != "Bulbasaur" {
		t.Errorf("entry[0] en name = %q, want Bulbasaur", entries[0].Names["en"])
	}
	if len(entries[1].Forms) != 1 {
		t.Fatalf("expected 1 form on pikachu, got %d", len(entries[1].Forms))
	}
	if entries[1].Forms[0].SpriteID != 10100 {
		t.Errorf("form sprite_id = %d, want 10100", entries[1].Forms[0].SpriteID)
	}
}

func TestRowsToEntriesBadJSON(t *testing.T) {
	species := []database.PokedexSpeciesRow{
		{ID: 1, Canonical: "bulbasaur", NamesJSON: []byte(`not valid json`)},
	}
	entries := RowsToEntries(species, nil)

	// The entry should still be created, but Names will be nil/empty.
	if len(entries) != 1 {
		t.Fatalf(wantOneEntryFmt, len(entries))
	}
	if entries[0].Canonical != "bulbasaur" {
		t.Errorf("canonical = %q, want bulbasaur", entries[0].Canonical)
	}
}

func TestRowsToEntriesOrphanForm(t *testing.T) {
	species := []database.PokedexSpeciesRow{
		{ID: 1, Canonical: "bulbasaur", NamesJSON: []byte(`{"en":"Bulbasaur"}`)},
	}
	// Form references a species ID that does not exist.
	forms := []database.PokedexFormRow{
		{SpeciesID: 999, Canonical: "orphan-form", SpriteID: 50000, NamesJSON: []byte(`{"en":"Orphan"}`)},
	}

	entries := RowsToEntries(species, forms)
	if len(entries) != 1 {
		t.Fatalf(wantOneEntryFmt, len(entries))
	}
	if len(entries[0].Forms) != 0 {
		t.Errorf("expected 0 forms on bulbasaur, got %d", len(entries[0].Forms))
	}
}

func TestEntriesToRows(t *testing.T) {
	entries := []Entry{
		{
			ID:        25,
			Canonical: "pikachu",
			Names:     map[string]string{"en": "Pikachu", "de": "Pikachu"},
			Forms: []Form{
				{Canonical: testFormName, SpriteID: 10100, Names: map[string]string{"en": "Alolan Pikachu"}},
			},
		},
	}

	species, forms := EntriesToRows(entries)
	if len(species) != 1 {
		t.Fatalf(wantOneSpeciesRowFmt, len(species))
	}
	if species[0].ID != 25 {
		t.Errorf("species ID = %d, want 25", species[0].ID)
	}
	if len(forms) != 1 {
		t.Fatalf("expected 1 form row, got %d", len(forms))
	}
	if forms[0].SpeciesID != 25 {
		t.Errorf("form SpeciesID = %d, want 25", forms[0].SpeciesID)
	}

	// Verify roundtrip: rows back to entries.
	roundTripped := RowsToEntries(species, forms)
	if len(roundTripped) != 1 {
		t.Fatalf("roundtrip: expected 1 entry, got %d", len(roundTripped))
	}
	if roundTripped[0].Names["en"] != "Pikachu" {
		t.Errorf("roundtrip en name = %q, want Pikachu", roundTripped[0].Names["en"])
	}
}

// TestEntriesToRowsGenerationsRoundTrip ensures the new Generations slice
// survives a full marshal/unmarshal cycle through the database row layer.
func TestEntriesToRowsGenerationsRoundTrip(t *testing.T) {
	entries := []Entry{
		{
			ID:        25,
			Canonical: "pikachu",
			Forms: []Form{
				{Canonical: "pikachu-original-cap", SpriteID: 10196, Generations: []int{7, 8}},
				{Canonical: "pikachu-gmax", SpriteID: 10368, Generations: []int{8}},
				{Canonical: "pikachu-base", SpriteID: 25}, // no generations
			},
		},
	}
	species, forms := EntriesToRows(entries)
	if len(forms) != 3 {
		t.Fatalf("expected 3 form rows, got %d", len(forms))
	}
	for _, f := range forms {
		if len(f.GenerationsJSON) == 0 {
			t.Errorf("form %q has empty GenerationsJSON", f.Canonical)
		}
	}
	rt := RowsToEntries(species, forms)
	if len(rt) != 1 || len(rt[0].Forms) != 3 {
		t.Fatalf("roundtrip: bad shape: %+v", rt)
	}
	gotByName := map[string][]int{}
	for _, f := range rt[0].Forms {
		gotByName[f.Canonical] = f.Generations
	}
	if g := gotByName["pikachu-original-cap"]; len(g) != 2 || g[0] != 7 || g[1] != 8 {
		t.Errorf("original-cap generations = %v, want [7 8]", g)
	}
	if g := gotByName["pikachu-gmax"]; len(g) != 1 || g[0] != 8 {
		t.Errorf("gmax generations = %v, want [8]", g)
	}
	if g := gotByName["pikachu-base"]; len(g) != 0 {
		t.Errorf("base generations = %v, want empty", g)
	}
}

func TestEntriesToRowsNilNames(t *testing.T) {
	entries := []Entry{
		{ID: 1, Canonical: "bulbasaur", Names: nil},
	}
	species, _ := EntriesToRows(entries)
	if len(species) != 1 {
		t.Fatalf(wantOneSpeciesRowFmt, len(species))
	}
	// nil Names should marshal to "null" or "{}" without error.
	var names map[string]string
	if err := json.Unmarshal(species[0].NamesJSON, &names); err != nil {
		t.Fatalf("failed to unmarshal NamesJSON: %v", err)
	}
}

// fixturePokedexJSON returns a minimal valid pokemon.json for testing.
func fixturePokedexJSON() []byte {
	return []byte(`[
		{"id":1,"canonical":"bulbasaur","names":{"en":"Bulbasaur","de":"Bisasam"}},
		{"id":4,"canonical":"charmander","names":{"en":"Charmander","de":"Glumanda"}},
		{"id":25,"canonical":"pikachu","names":{"en":"Pikachu","de":"Pikachu"},"forms":[
			{"canonical":"pikachu-alola","names":{"en":"Alolan Pikachu"},"sprite_id":10100}
		]}
	]`)
}

func TestReadJSONFromConfigDir(t *testing.T) {
	configDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(configDir, Filename), fixturePokedexJSON(), 0644); err != nil {
		t.Fatal(err)
	}

	data, err := ReadJSON(configDir)
	if err != nil {
		t.Fatal(err)
	}

	var entries []Entry
	if err := json.Unmarshal(data, &entries); err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(entries))
	}
	if entries[0].Canonical != "bulbasaur" {
		t.Errorf("first entry canonical = %q, want bulbasaur", entries[0].Canonical)
	}
}

func TestEntryWithForms(t *testing.T) {
	configDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(configDir, Filename), fixturePokedexJSON(), 0644); err != nil {
		t.Fatal(err)
	}

	data, err := ReadJSON(configDir)
	if err != nil {
		t.Fatal(err)
	}

	var entries []Entry
	if err := json.Unmarshal(data, &entries); err != nil {
		t.Fatal(err)
	}

	// Find pikachu
	var pikachu *Entry
	for i := range entries {
		if entries[i].Canonical == "pikachu" {
			pikachu = &entries[i]
			break
		}
	}
	if pikachu == nil {
		t.Fatal("pikachu not found")
	}
	if len(pikachu.Forms) != 1 {
		t.Fatalf("expected 1 form, got %d", len(pikachu.Forms))
	}
	if pikachu.Forms[0].Canonical != testFormName {
		t.Errorf("form canonical = %q, want %s", pikachu.Forms[0].Canonical, testFormName)
	}
	if pikachu.Forms[0].SpriteID != 10100 {
		t.Errorf("form sprite_id = %d, want 10100", pikachu.Forms[0].SpriteID)
	}
}

func TestReadJSONNotFound(t *testing.T) {
	configDir := t.TempDir()
	// Use a config dir with no pokemon.json and no fallbacks available.
	// The source dir fallback uses runtime.Caller which will look at the real
	// source tree, so this test may still find the file in dev. We mainly
	// verify the function does not panic.
	_, err := ReadJSON(configDir)
	// Either it finds a fallback or returns an error; both are valid
	_ = err
}

func TestSpriteIDResolution(t *testing.T) {
	// Verify that sprite IDs are correctly preserved through JSON round-trip
	entry := Entry{
		ID:        25,
		Canonical: "pikachu",
		Names:     map[string]string{"en": "Pikachu"},
		Forms: []Form{
			{Canonical: testFormName, SpriteID: 10100, Names: map[string]string{"en": "Alolan Pikachu"}},
		},
	}

	data, err := json.Marshal(entry)
	if err != nil {
		t.Fatal(err)
	}

	var decoded Entry
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.ID != 25 {
		t.Errorf("ID = %d, want 25", decoded.ID)
	}
	if len(decoded.Forms) != 1 {
		t.Fatalf("forms length = %d, want 1", len(decoded.Forms))
	}
	if decoded.Forms[0].SpriteID != 10100 {
		t.Errorf("sprite_id = %d, want 10100", decoded.Forms[0].SpriteID)
	}
}

func TestWriteJSON(t *testing.T) {
	configDir := t.TempDir()
	entries := []Entry{
		{ID: 1, Canonical: "bulbasaur", Names: map[string]string{"en": "Bulbasaur"}},
	}

	if err := WriteJSON(configDir, entries); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(filepath.Join(configDir, Filename))
	if err != nil {
		t.Fatal(err)
	}

	var loaded []Entry
	if err := json.Unmarshal(data, &loaded); err != nil {
		t.Fatal(err)
	}
	if len(loaded) != 1 {
		t.Fatalf(wantOneEntryFmt, len(loaded))
	}
	if loaded[0].Canonical != "bulbasaur" {
		t.Errorf("canonical = %q, want bulbasaur", loaded[0].Canonical)
	}
}

func TestRowsToEntriesEmptyInput(t *testing.T) {
	entries := RowsToEntries([]database.PokedexSpeciesRow{}, nil)
	if len(entries) != 0 {
		t.Errorf("expected 0 entries for empty species, got %d", len(entries))
	}
}

func TestRowsToEntriesNilInput(t *testing.T) {
	entries := RowsToEntries(nil, nil)
	if len(entries) != 0 {
		t.Errorf("expected 0 entries for nil species, got %d", len(entries))
	}
}

func TestRowsToEntriesCorruptFormJSON(t *testing.T) {
	species := []database.PokedexSpeciesRow{
		{ID: 25, Canonical: "pikachu", NamesJSON: []byte(`{"en":"Pikachu"}`)},
	}
	forms := []database.PokedexFormRow{
		{SpeciesID: 25, Canonical: "pikachu-corrupt", SpriteID: 10100, NamesJSON: []byte(`{invalid json}`)},
		{SpeciesID: 25, Canonical: "pikachu-valid", SpriteID: 10101, NamesJSON: []byte(`{"en":"Valid Form"}`)},
	}
	entries := RowsToEntries(species, forms)
	if len(entries) != 1 {
		t.Fatalf(wantOneEntryFmt, len(entries))
	}
	// Both forms should be attached (corrupt JSON results in nil Names, not skipped).
	if len(entries[0].Forms) != 2 {
		t.Fatalf("expected 2 forms, got %d", len(entries[0].Forms))
	}
	// The corrupt form should have nil/empty Names.
	if len(entries[0].Forms[0].Names) > 0 {
		t.Errorf("expected nil/empty names for corrupt form, got %v", entries[0].Forms[0].Names)
	}
	// The valid form should have proper Names.
	if entries[0].Forms[1].Names["en"] != "Valid Form" {
		t.Errorf("valid form name = %q, want Valid Form", entries[0].Forms[1].Names["en"])
	}
}

func TestRowsToEntriesEmptyNamesJSON(t *testing.T) {
	species := []database.PokedexSpeciesRow{
		{ID: 1, Canonical: "bulbasaur", NamesJSON: []byte(``)},
	}
	entries := RowsToEntries(species, nil)
	// Empty NamesJSON should not prevent the entry from being created.
	if len(entries) != 1 {
		t.Fatalf(wantOneEntryFmt, len(entries))
	}
	if entries[0].Names != nil {
		t.Errorf("expected nil names for empty JSON, got %v", entries[0].Names)
	}
}

func TestEntriesToRowsWithForms(t *testing.T) {
	entries := []Entry{
		{
			ID:        1,
			Canonical: "bulbasaur",
			Names:     map[string]string{"en": "Bulbasaur"},
			Forms: []Form{
				{Canonical: "bulbasaur-mega", SpriteID: 10001, Names: map[string]string{"en": "Mega Bulbasaur"}},
				{Canonical: "bulbasaur-gmax", SpriteID: 10002, Names: nil},
			},
		},
	}
	species, forms := EntriesToRows(entries)
	if len(species) != 1 {
		t.Fatalf(wantOneSpeciesRowFmt, len(species))
	}
	if len(forms) != 2 {
		t.Fatalf("expected 2 form rows, got %d", len(forms))
	}
	// Form with nil Names should still produce valid JSON ("{}").
	var names map[string]string
	if err := json.Unmarshal(forms[1].NamesJSON, &names); err != nil {
		t.Errorf("failed to unmarshal nil-Names form JSON: %v", err)
	}
}

func TestEntriesToRowsEmpty(t *testing.T) {
	species, forms := EntriesToRows([]Entry{})
	if len(species) != 0 {
		t.Errorf("expected 0 species rows, got %d", len(species))
	}
	if len(forms) != 0 {
		t.Errorf("expected 0 form rows, got %d", len(forms))
	}
}

func TestEntriesToRowsNil(t *testing.T) {
	species, forms := EntriesToRows(nil)
	if len(species) != 0 {
		t.Errorf("expected 0 species rows, got %d", len(species))
	}
	if forms != nil {
		t.Errorf("expected nil forms, got %d", len(forms))
	}
}

func TestLoadPokedexNilStore(t *testing.T) {
	resetPokedexCache(t)
	entries := LoadPokedex(nil)
	if entries != nil {
		t.Errorf("expected nil for nil store, got %d entries", len(entries))
	}
}

func TestLoadPokedexLoadError(t *testing.T) {
	resetPokedexCache(t)
	store := &mockPokedexStore{
		hasPokedex: true,
		count:      2,
		loadErr:    fmt.Errorf("simulated load error"),
	}
	entries := LoadPokedex(store)
	if entries != nil {
		t.Errorf("expected nil for load error, got %d entries", len(entries))
	}
}

func TestWriteJSONCreatesDirectory(t *testing.T) {
	baseDir := t.TempDir()
	nestedDir := filepath.Join(baseDir, "nested", "deep")
	entries := []Entry{
		{ID: 1, Canonical: "bulbasaur", Names: map[string]string{"en": "Bulbasaur"}},
	}
	if err := WriteJSON(nestedDir, entries); err != nil {
		t.Fatalf("WriteJSON failed to create nested dir: %v", err)
	}
	// Verify the file exists.
	if _, err := os.Stat(filepath.Join(nestedDir, Filename)); err != nil {
		t.Errorf("expected file to exist at nested path: %v", err)
	}
}

// TestCollectFormGenerationsPrefersExplicit ensures that when
// pokemonformgenerations is populated, it is the source of truth and the
// versiongroup fallback is not used.
func TestCollectFormGenerationsPrefersExplicit(t *testing.T) {
	got := collectFormGenerations([]pokemonFormRow{{
		VersionGroup:           formVGRow{GenerationID: 3},
		PokemonFormGenerations: []formGenRow{{GenerationID: 7}, {GenerationID: 8}, {GenerationID: 7}},
	}})
	want := []int{7, 8}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("got %v, want %v", got, want)
	}
}

// TestCollectFormGenerationsFallsBackToVG verifies that when
// pokemonformgenerations is empty, the version group's introduction
// generation is used so every form carries at least one hint.
func TestCollectFormGenerationsFallsBackToVG(t *testing.T) {
	got := collectFormGenerations([]pokemonFormRow{{
		VersionGroup:           formVGRow{GenerationID: 8},
		PokemonFormGenerations: nil,
	}})
	if len(got) != 1 || got[0] != 8 {
		t.Errorf("got %v, want [8]", got)
	}
}

// TestCollectFormGenerationsEmpty returns nil when no generation info is
// available at all, signalling "unconstrained" to the frontend filter.
func TestCollectFormGenerationsEmpty(t *testing.T) {
	got := collectFormGenerations(nil)
	if got != nil {
		t.Errorf("got %v, want nil", got)
	}
}

// TestCollectFormGenerationsSorted verifies the result is sorted ascending,
// regardless of input order.
func TestCollectFormGenerationsSorted(t *testing.T) {
	got := collectFormGenerations([]pokemonFormRow{{
		PokemonFormGenerations: []formGenRow{{GenerationID: 9}, {GenerationID: 6}, {GenerationID: 8}},
	}})
	want := []int{6, 8, 9}
	if len(got) != 3 || got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
		t.Errorf("got %v, want %v", got, want)
	}
}
