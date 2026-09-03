// catchmeta_test.go covers the persistence of the optional catch metadata: the
// catch_meta column on pokemon, the distinction between an unset and a zero
// individual value, and the removal of the record together with its Pokémon.
package database

import (
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// catchIntPtr returns a pointer to v, so the tests can express "recorded as 0"
// separately from "never recorded".
func catchIntPtr(v int) *int { return &v }

// catchTestState builds a minimal saveable state around the given Pokémon.
func catchTestState(pokemon ...state.Pokemon) *state.AppState {
	return &state.AppState{
		Pokemon:  pokemon,
		Groups:   []state.Group{},
		Sessions: []state.Session{},
		Settings: state.Settings{Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
}

// catchTestPokemon builds a Pokémon row carrying the given catch metadata.
func catchTestPokemon(id, name string, meta *state.CatchMeta) state.Pokemon {
	return state.Pokemon{
		ID: id, Name: name, CanonicalName: name,
		SpriteURL: "u", SpriteType: "shiny", Language: "de",
		CreatedAt: time.Now().UTC().Truncate(time.Second), OverlayMode: "default",
		Tags: []string{}, PhaseTargets: []state.PhaseTarget{},
		Catch: meta,
	}
}

// loadCatchPokemon returns the loaded Pokémon with the given id.
func loadCatchPokemon(t *testing.T, d *DB, id string) state.Pokemon {
	t.Helper()
	loaded, err := d.LoadFullState()
	if err != nil {
		t.Fatalf(fmtLoadFullState, err)
	}
	if loaded == nil {
		t.Fatal("LoadFullState returned nil")
	}
	for _, p := range loaded.Pokemon {
		if p.ID == id {
			return p
		}
	}
	t.Fatalf("pokemon %q missing from loaded state", id)
	return state.Pokemon{}
}

// TestCatchMetaRoundTrip verifies that every recorded field survives a full
// save/load cycle unchanged, that a second save replaces rather than corrupts
// the record, and that a phase child keeps its own metadata.
func TestCatchMetaRoundTrip(t *testing.T) {
	d := openInternalTestDB(t)

	huntMeta := &state.CatchMeta{
		Location:     "Route 210 (Nordteil)",
		Nature:       "adamant",
		Ability:      "static",
		Ball:         "premier-ball",
		Mark:         "rainy-mark",
		ShinyVariant: "square",
		Level:        catchIntPtr(42),
		// A deliberately zero value: it must come back as 0, not as unset.
		HP:      catchIntPtr(0),
		Atk:     catchIntPtr(31),
		Def:     catchIntPtr(17),
		SpAtk:   catchIntPtr(6),
		SpDef:   catchIntPtr(24),
		Speed:   catchIntPtr(31),
		Ribbons: []string{"effort-ribbon", "champion-ribbon"},
	}
	phaseMeta := &state.CatchMeta{
		Location: "Route 210",
		Ball:     "quick-ball",
		Level:    catchIntPtr(7),
		Ribbons:  []string{},
	}

	hunt := catchTestPokemon("hunt", "pikachu", huntMeta)
	hunt.CompletedAt = &hunt.CreatedAt
	phase := catchTestPokemon("phase1", "bidoof", phaseMeta)
	phase.PhaseOf, phase.PhaseNumber = "hunt", 1

	st := catchTestState(hunt, phase)
	if err := d.SaveFullState(st); err != nil {
		t.Fatalf(fmtSaveFullState, err)
	}
	if err := d.SaveFullState(st); err != nil {
		t.Fatalf(fmtSaveFullState, err)
	}

	gotHunt := loadCatchPokemon(t, d, "hunt")
	assertCatchMetaEqual(t, "hunt", gotHunt.Catch, huntMeta)

	gotPhase := loadCatchPokemon(t, d, "phase1")
	assertCatchMetaEqual(t, "phase1", gotPhase.Catch, phaseMeta)
}

// TestCatchMetaZeroIVSurvives is the test a plain-int implementation fails: a
// value recorded as 0 and a value never recorded must stay distinguishable
// across the database.
func TestCatchMetaZeroIVSurvives(t *testing.T) {
	d := openInternalTestDB(t)

	st := catchTestState(catchTestPokemon("hunt", "pikachu", &state.CatchMeta{
		HP:      catchIntPtr(0),
		Ribbons: []string{},
	}))
	if err := d.SaveFullState(st); err != nil {
		t.Fatalf(fmtSaveFullState, err)
	}

	got := loadCatchPokemon(t, d, "hunt")
	if got.Catch == nil {
		t.Fatal("metadata with a zero HP was dropped entirely")
	}
	if got.Catch.HP == nil {
		t.Fatal("HP came back unset, want a pointer to 0")
	}
	if *got.Catch.HP != 0 {
		t.Errorf("HP = %d, want 0", *got.Catch.HP)
	}
	if got.Catch.Atk != nil {
		t.Errorf("Atk = %d, want unset", *got.Catch.Atk)
	}
}

// TestCatchMetaClearedRemovesTheColumnValue verifies that clearing the record
// empties the stored column instead of leaving the previous JSON behind.
func TestCatchMetaClearedRemovesTheColumnValue(t *testing.T) {
	d := openInternalTestDB(t)

	st := catchTestState(catchTestPokemon("hunt", "pikachu", &state.CatchMeta{
		Nature: "timid", Ribbons: []string{},
	}))
	if err := d.SaveFullState(st); err != nil {
		t.Fatalf(fmtSaveFullState, err)
	}

	st.Pokemon[0].Catch = nil
	if err := d.SaveFullState(st); err != nil {
		t.Fatalf(fmtSaveFullState, err)
	}

	var stored string
	if err := d.db.QueryRow(`SELECT catch_meta FROM pokemon WHERE id = ?`, "hunt").Scan(&stored); err != nil {
		t.Fatalf("read catch_meta: %v", err)
	}
	if stored != "" {
		t.Errorf("catch_meta = %q, want empty", stored)
	}
	if got := loadCatchPokemon(t, d, "hunt"); got.Catch != nil {
		t.Errorf("Catch = %+v, want nil", got.Catch)
	}
}

// TestCatchMetaSurvivesUnrelatedSave verifies that saving a state whose other
// fields changed leaves the recorded metadata untouched.
func TestCatchMetaSurvivesUnrelatedSave(t *testing.T) {
	d := openInternalTestDB(t)

	meta := &state.CatchMeta{
		Location: "Kraterberg",
		Level:    catchIntPtr(50),
		Speed:    catchIntPtr(0),
		Ribbons:  []string{"alert-ribbon"},
	}
	st := catchTestState(catchTestPokemon("hunt", "pikachu", meta))
	if err := d.SaveFullState(st); err != nil {
		t.Fatalf(fmtSaveFullState, err)
	}

	st.Pokemon[0].Encounters = 1234
	st.Pokemon[0].Title = "Endlich"
	if err := d.SaveFullState(st); err != nil {
		t.Fatalf(fmtSaveFullState, err)
	}

	got := loadCatchPokemon(t, d, "hunt")
	if got.Encounters != 1234 {
		t.Errorf("Encounters = %d, want 1234", got.Encounters)
	}
	assertCatchMetaEqual(t, "hunt", got.Catch, meta)
}

// TestDeletedPokemonDropsCatchMeta verifies that removing a Pokémon from the
// state takes its metadata with it and leaves the other records alone.
func TestDeletedPokemonDropsCatchMeta(t *testing.T) {
	d := openInternalTestDB(t)

	keptMeta := &state.CatchMeta{Nature: "jolly", Ribbons: []string{}}
	st := catchTestState(
		catchTestPokemon("gone", "bidoof", &state.CatchMeta{Nature: "brave", Ribbons: []string{}}),
		catchTestPokemon("kept", "pikachu", keptMeta),
	)
	if err := d.SaveFullState(st); err != nil {
		t.Fatalf(fmtSaveFullState, err)
	}

	st.Pokemon = st.Pokemon[1:]
	if err := d.SaveFullState(st); err != nil {
		t.Fatalf(fmtSaveFullState, err)
	}

	var count int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM pokemon WHERE id = ?`, "gone").Scan(&count); err != nil {
		t.Fatalf("count pokemon: %v", err)
	}
	if count != 0 {
		t.Errorf("rows for the deleted pokemon = %d, want 0", count)
	}
	assertCatchMetaEqual(t, "kept", loadCatchPokemon(t, d, "kept").Catch, keptMeta)
}

// TestCatchMetaKeepsUnknownLocation verifies that a location the application
// does not know is stored verbatim: the field is free text, not a lookup key.
func TestCatchMetaKeepsUnknownLocation(t *testing.T) {
	d := openInternalTestDB(t)

	const location = "きんいろのもり (Rom-Hack Route 99)"
	st := catchTestState(catchTestPokemon("hunt", "pikachu", &state.CatchMeta{
		Location: location, Ribbons: []string{},
	}))
	if err := d.SaveFullState(st); err != nil {
		t.Fatalf(fmtSaveFullState, err)
	}

	got := loadCatchPokemon(t, d, "hunt")
	if got.Catch == nil {
		t.Fatal("metadata was dropped")
	}
	if got.Catch.Location != location {
		t.Errorf("Location = %q, want %q", got.Catch.Location, location)
	}
}

// assertCatchMetaEqual compares a loaded record against the expected one field
// by field, reporting unset and zero values separately.
func assertCatchMetaEqual(t *testing.T, label string, got, want *state.CatchMeta) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s: Catch = nil, want %+v", label, want)
	}
	texts := []struct {
		name      string
		got, want string
	}{
		{"Location", got.Location, want.Location},
		{"Nature", got.Nature, want.Nature},
		{"Ability", got.Ability, want.Ability},
		{"Ball", got.Ball, want.Ball},
		{"Mark", got.Mark, want.Mark},
		{"ShinyVariant", got.ShinyVariant, want.ShinyVariant},
	}
	for _, f := range texts {
		if f.got != f.want {
			t.Errorf("%s: %s = %q, want %q", label, f.name, f.got, f.want)
		}
	}
	values := []struct {
		name      string
		got, want *int
	}{
		{"Level", got.Level, want.Level},
		{"HP", got.HP, want.HP},
		{"Atk", got.Atk, want.Atk},
		{"Def", got.Def, want.Def},
		{"SpAtk", got.SpAtk, want.SpAtk},
		{"SpDef", got.SpDef, want.SpDef},
		{"Speed", got.Speed, want.Speed},
	}
	for _, f := range values {
		assertOptionalInt(t, label+"."+f.name, f.got, f.want)
	}
	if got.Ribbons == nil {
		t.Errorf("%s: Ribbons = nil, want a non-nil slice", label)
	}
	if len(got.Ribbons) != len(want.Ribbons) {
		t.Fatalf("%s: Ribbons = %v, want %v", label, got.Ribbons, want.Ribbons)
	}
	for i := range want.Ribbons {
		if got.Ribbons[i] != want.Ribbons[i] {
			t.Errorf("%s: Ribbons[%d] = %q, want %q", label, i, got.Ribbons[i], want.Ribbons[i])
		}
	}
}

// assertOptionalInt compares two optional integers, treating nil and 0 as the
// different facts they are.
func assertOptionalInt(t *testing.T, label string, got, want *int) {
	t.Helper()
	switch {
	case got == nil && want == nil:
	case got == nil:
		t.Errorf("%s = unset, want %d", label, *want)
	case want == nil:
		t.Errorf("%s = %d, want unset", label, *got)
	case *got != *want:
		t.Errorf("%s = %d, want %d", label, *got, *want)
	}
}

// TestShinyVariantRoundTrip verifies that the variant survives a save/load
// cycle on both of its homes: the pokemon column and the catch metadata. A
// column missing from either the INSERT or the SELECT list would silently drop
// the value rather than fail the save.
func TestShinyVariantRoundTrip(t *testing.T) {
	d := openInternalTestDB(t)

	star := catchTestPokemon("star", "pikachu", &state.CatchMeta{ShinyVariant: "star", Ribbons: []string{}})
	star.ShinyVariant = "star"
	square := catchTestPokemon("square", "bidoof", &state.CatchMeta{ShinyVariant: "square", Ribbons: []string{}})
	square.ShinyVariant = "square"
	// A hunt without a recorded variant must come back empty, not defaulted.
	plain := catchTestPokemon("plain", "magikarp", nil)

	if err := d.SaveFullState(catchTestState(star, square, plain)); err != nil {
		t.Fatalf(fmtSaveFullState, err)
	}

	for _, tc := range []struct{ id, want string }{
		{"star", "star"}, {"square", "square"}, {"plain", ""},
	} {
		got := loadCatchPokemon(t, d, tc.id)
		if got.ShinyVariant != tc.want {
			t.Errorf("%s: Pokemon.ShinyVariant = %q, want %q", tc.id, got.ShinyVariant, tc.want)
		}
		if tc.want == "" {
			if got.Catch != nil {
				t.Errorf("%s: Catch = %+v, want nil", tc.id, got.Catch)
			}
			continue
		}
		if got.Catch == nil {
			t.Fatalf("%s: metadata holding only a shiny variant was dropped", tc.id)
		}
		if got.Catch.ShinyVariant != tc.want {
			t.Errorf("%s: Catch.ShinyVariant = %q, want %q", tc.id, got.Catch.ShinyVariant, tc.want)
		}
	}
}
