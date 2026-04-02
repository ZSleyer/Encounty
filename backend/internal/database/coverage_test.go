// coverage_test.go targets uncovered functions and code paths to increase the
// database package test coverage toward ~93%. It covers Pokedex CRUD,
// MigrationVersion, negative-polarity template regions, adaptive cooldown
// fields, HuntMode roundtrip, template enabled/disabled flags, overlay
// hidden+border fields, and detection log ordering.
package database_test

import (
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/state"
)

const (
	fmtSavePokedex = "SavePokedex: %v"
	fmtSaveState   = "SaveFullState: %v"
	fmtLoadState   = "LoadFullState: %v"
	enabledTmpl    = "enabled-template"
	disabledTmpl   = "disabled-template"
	testColorHex   = "#deadbe"
	testColorHex2  = "#aaa111"
	testImagePath  = "/some/path"
)

// ---------------------------------------------------------------------------
// Pokedex CRUD (SavePokedex, LoadPokedex, HasPokedex, PokedexCount)
// ---------------------------------------------------------------------------

// TestSaveAndLoadPokedex verifies that species and form rows round-trip
// through SavePokedex and LoadPokedex correctly.
func TestSaveAndLoadPokedex(t *testing.T) {
	db := openTestDB(t)

	species := []database.PokedexSpeciesRow{
		{ID: 1, Canonical: "bulbasaur", NamesJSON: []byte(`{"en":"Bulbasaur","de":"Bisasam"}`)},
		{ID: 4, Canonical: "charmander", NamesJSON: []byte(`{"en":"Charmander","de":"Glumanda"}`)},
		{ID: 25, Canonical: "pikachu", NamesJSON: []byte(`{"en":"Pikachu","de":"Pikachu"}`)},
	}
	forms := []database.PokedexFormRow{
		{SpeciesID: 25, Canonical: "pikachu-gmax", SpriteID: 10025, NamesJSON: []byte(`{"en":"Gigantamax Pikachu"}`)},
		{SpeciesID: 4, Canonical: "charmander-default", SpriteID: 4, NamesJSON: []byte(`{"en":"Charmander"}`)},
	}

	if err := db.SavePokedex(species, forms); err != nil {
		t.Fatalf(fmtSavePokedex, err)
	}

	gotSpecies, gotForms, err := db.LoadPokedex()
	if err != nil {
		t.Fatalf("LoadPokedex: %v", err)
	}

	// Species are ordered by ID.
	if len(gotSpecies) != 3 {
		t.Fatalf("species len = %d, want 3", len(gotSpecies))
	}
	if gotSpecies[0].ID != 1 || gotSpecies[0].Canonical != "bulbasaur" {
		t.Errorf("species[0] = %+v, want ID=1 canonical=bulbasaur", gotSpecies[0])
	}
	if gotSpecies[1].ID != 4 {
		t.Errorf("species[1].ID = %d, want 4", gotSpecies[1].ID)
	}
	if gotSpecies[2].ID != 25 {
		t.Errorf("species[2].ID = %d, want 25", gotSpecies[2].ID)
	}
	if string(gotSpecies[2].NamesJSON) != `{"en":"Pikachu","de":"Pikachu"}` {
		t.Errorf("species[2].NamesJSON = %s", gotSpecies[2].NamesJSON)
	}

	// Forms are ordered by species_id, then id.
	if len(gotForms) != 2 {
		t.Fatalf("forms len = %d, want 2", len(gotForms))
	}
	if gotForms[0].SpeciesID != 4 {
		t.Errorf("forms[0].SpeciesID = %d, want 4", gotForms[0].SpeciesID)
	}
	if gotForms[1].SpeciesID != 25 {
		t.Errorf("forms[1].SpeciesID = %d, want 25", gotForms[1].SpeciesID)
	}
	if gotForms[1].SpriteID != 10025 {
		t.Errorf("forms[1].SpriteID = %d, want 10025", gotForms[1].SpriteID)
	}
}

// TestSavePokedexReplace verifies that SavePokedex replaces all rows.
func TestSavePokedexReplace(t *testing.T) {
	db := openTestDB(t)

	species := []database.PokedexSpeciesRow{
		{ID: 1, Canonical: "bulbasaur", NamesJSON: []byte(`{}`)},
		{ID: 2, Canonical: "ivysaur", NamesJSON: []byte(`{}`)},
	}
	forms := []database.PokedexFormRow{
		{SpeciesID: 1, Canonical: "bulbasaur-default", SpriteID: 1, NamesJSON: []byte(`{}`)},
	}
	if err := db.SavePokedex(species, forms); err != nil {
		t.Fatalf("SavePokedex (1st): %v", err)
	}

	// Replace with different data.
	species2 := []database.PokedexSpeciesRow{
		{ID: 150, Canonical: "mewtwo", NamesJSON: []byte(`{"en":"Mewtwo"}`)},
	}
	if err := db.SavePokedex(species2, nil); err != nil {
		t.Fatalf("SavePokedex (2nd): %v", err)
	}

	gotSpecies, gotForms, err := db.LoadPokedex()
	if err != nil {
		t.Fatalf("LoadPokedex: %v", err)
	}
	if len(gotSpecies) != 1 || gotSpecies[0].ID != 150 {
		t.Errorf("species after replace = %+v, want [Mewtwo]", gotSpecies)
	}
	if len(gotForms) != 0 {
		t.Errorf("forms after replace len = %d, want 0", len(gotForms))
	}
}

// TestHasPokedex verifies HasPokedex returns false initially, true after save.
func TestHasPokedex(t *testing.T) {
	db := openTestDB(t)

	if db.HasPokedex() {
		t.Error("HasPokedex should be false initially")
	}

	species := []database.PokedexSpeciesRow{
		{ID: 1, Canonical: "bulbasaur", NamesJSON: []byte(`{}`)},
	}
	if err := db.SavePokedex(species, nil); err != nil {
		t.Fatalf(fmtSavePokedex, err)
	}

	if !db.HasPokedex() {
		t.Error("HasPokedex should be true after save")
	}
}

// TestPokedexCount verifies PokedexCount returns the correct number of species.
func TestPokedexCount(t *testing.T) {
	db := openTestDB(t)

	if db.PokedexCount() != 0 {
		t.Errorf("PokedexCount on empty = %d, want 0", db.PokedexCount())
	}

	species := []database.PokedexSpeciesRow{
		{ID: 1, Canonical: "bulbasaur", NamesJSON: []byte(`{}`)},
		{ID: 4, Canonical: "charmander", NamesJSON: []byte(`{}`)},
		{ID: 7, Canonical: "squirtle", NamesJSON: []byte(`{}`)},
	}
	if err := db.SavePokedex(species, nil); err != nil {
		t.Fatalf(fmtSavePokedex, err)
	}

	if db.PokedexCount() != 3 {
		t.Errorf("PokedexCount = %d, want 3", db.PokedexCount())
	}
}

// TestLoadPokedexEmpty verifies that LoadPokedex returns nil slices when empty.
func TestLoadPokedexEmpty(t *testing.T) {
	db := openTestDB(t)

	species, forms, err := db.LoadPokedex()
	if err != nil {
		t.Fatalf("LoadPokedex (empty): %v", err)
	}
	if species != nil {
		t.Errorf("species should be nil, got %v", species)
	}
	if forms != nil {
		t.Errorf("forms should be nil, got %v", forms)
	}
}

// ---------------------------------------------------------------------------
// MigrationVersion
// ---------------------------------------------------------------------------

// TestMigrationVersion verifies that MigrationVersion returns the highest
// applied migration version.
func TestMigrationVersion(t *testing.T) {
	db := openTestDB(t)

	v := db.MigrationVersion()
	if v <= 0 {
		t.Errorf("MigrationVersion = %d, want > 0", v)
	}
	// Should match the last migration in the list.
	if v != 8 {
		t.Errorf("MigrationVersion = %d, want 8", v)
	}
}

// ---------------------------------------------------------------------------
// Negative polarity template regions
// ---------------------------------------------------------------------------

// TestTemplateRegionNegativePolarity verifies that regions with polarity
// "negative" round-trip correctly through save/load.
func TestTemplateRegionNegativePolarity(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{
				ID:          "p1",
				Name:        "Absol",
				CreatedAt:   now,
				OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Enabled:    true,
					SourceType: "window",
					Templates: []state.DetectorTemplate{
						{
							ImageData: []byte{0x89, 0x50, 0x4e, 0x47},
							Regions: []state.MatchedRegion{
								{
									Type:     "image",
									Polarity: "negative",
									Rect:     state.DetectorRect{X: 5, Y: 10, W: 50, H: 60},
								},
								{
									Type: "image",
									// Default polarity (empty string, should not load as "negative")
									Rect: state.DetectorRect{X: 100, Y: 200, W: 30, H: 40},
								},
							},
						},
					},
					DetectionLog: []state.DetectionLogEntry{},
				},
			},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{
			Languages: []string{"en"},
			Overlay:   makeTestOverlay(),
		},
	}

	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf(fmtSaveState, err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf(fmtLoadState, err)
	}
	if got == nil {
		t.Fatal("LoadFullState returned nil")
	}

	dc := got.Pokemon[0].DetectorConfig
	if dc == nil {
		t.Fatal("DetectorConfig should not be nil")
	}
	if len(dc.Templates) != 1 {
		t.Fatalf("Templates len = %d, want 1", len(dc.Templates))
	}
	regions := dc.Templates[0].Regions
	if len(regions) != 2 {
		t.Fatalf("Regions len = %d, want 2", len(regions))
	}
	if regions[0].Polarity != "negative" {
		t.Errorf("Regions[0].Polarity = %q, want %q", regions[0].Polarity, "negative")
	}
	if regions[1].Polarity != "" {
		t.Errorf("Regions[1].Polarity = %q, want empty", regions[1].Polarity)
	}
}

// ---------------------------------------------------------------------------
// Adaptive cooldown fields
// ---------------------------------------------------------------------------

// TestDetectorConfigAdaptiveCooldown verifies that AdaptiveCooldown and
// AdaptiveCooldownMin fields round-trip correctly.
func TestDetectorConfigAdaptiveCooldown(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{
				ID:          "p1",
				Name:        "Lucario",
				CreatedAt:   now,
				OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Enabled:             true,
					SourceType:          "screen_region",
					AdaptiveCooldown:    true,
					AdaptiveCooldownMin: 5,
					Templates:           []state.DetectorTemplate{},
					DetectionLog:        []state.DetectionLogEntry{},
				},
			},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{
			Languages: []string{"en"},
			Overlay:   makeTestOverlay(),
		},
	}

	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf(fmtSaveState, err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf(fmtLoadState, err)
	}

	dc := got.Pokemon[0].DetectorConfig
	if dc == nil {
		t.Fatal("DetectorConfig should not be nil")
	}
	if !dc.AdaptiveCooldown {
		t.Error("AdaptiveCooldown should be true")
	}
	if dc.AdaptiveCooldownMin != 5 {
		t.Errorf("AdaptiveCooldownMin = %d, want 5", dc.AdaptiveCooldownMin)
	}
}

// ---------------------------------------------------------------------------
// HuntMode roundtrip
// ---------------------------------------------------------------------------

// TestPokemonHuntModeRoundtrip verifies that the hunt_mode field persists
// correctly for different values.
func TestPokemonHuntModeRoundtrip(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Eevee", CreatedAt: now, OverlayMode: "default", HuntMode: "timer"},
			{ID: "p2", Name: "Snorlax", CreatedAt: now, OverlayMode: "default", HuntMode: "detector"},
			{ID: "p3", Name: "Magikarp", CreatedAt: now, OverlayMode: "default", HuntMode: "both"},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{
			Languages: []string{"en"},
			Overlay:   makeTestOverlay(),
		},
	}

	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf(fmtSaveState, err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf(fmtLoadState, err)
	}

	modes := map[string]string{
		"p1": "timer",
		"p2": "detector",
		"p3": "both",
	}
	for _, p := range got.Pokemon {
		want := modes[p.ID]
		if p.HuntMode != want {
			t.Errorf("Pokemon %q HuntMode = %q, want %q", p.ID, p.HuntMode, want)
		}
	}
}

// ---------------------------------------------------------------------------
// Template enabled/disabled flag
// ---------------------------------------------------------------------------

// TestTemplateEnabledFlag verifies that the template enabled flag round-trips,
// including an explicitly disabled template.
func TestTemplateEnabledFlag(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	falseVal := false
	trueVal := true

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{
				ID:          "p1",
				Name:        "Ditto",
				CreatedAt:   now,
				OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Enabled:    true,
					SourceType: "browser_camera",
					Templates: []state.DetectorTemplate{
						{
							ImageData: []byte{1, 2, 3},
							Enabled:   &trueVal,
							Name:      enabledTmpl,
							Regions:   []state.MatchedRegion{},
						},
						{
							ImageData: []byte{4, 5, 6},
							Enabled:   &falseVal,
							Name:      disabledTmpl,
							Regions:   []state.MatchedRegion{},
						},
						{
							ImageData: []byte{7, 8, 9},
							// Enabled is nil -> defaults to true
							Regions: []state.MatchedRegion{},
						},
					},
					DetectionLog: []state.DetectionLogEntry{},
				},
			},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{
			Languages: []string{"en"},
			Overlay:   makeTestOverlay(),
		},
	}

	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf(fmtSaveState, err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf(fmtLoadState, err)
	}

	templates := got.Pokemon[0].DetectorConfig.Templates
	if len(templates) != 3 {
		t.Fatalf("Templates len = %d, want 3", len(templates))
	}

	// First template: enabled
	if templates[0].Enabled == nil || !*templates[0].Enabled {
		t.Error("templates[0] should be enabled")
	}
	if templates[0].Name != enabledTmpl {
		t.Errorf("templates[0].Name = %q, want %q", templates[0].Name, enabledTmpl)
	}

	// Second template: disabled
	if templates[1].Enabled == nil || *templates[1].Enabled {
		t.Error("templates[1] should be disabled")
	}
	if templates[1].Name != disabledTmpl {
		t.Errorf("templates[1].Name = %q, want %q", templates[1].Name, disabledTmpl)
	}

	// Third template: nil Enabled defaults to true
	if templates[2].Enabled == nil || !*templates[2].Enabled {
		t.Error("templates[2] should be enabled (nil defaults to true)")
	}
}

// ---------------------------------------------------------------------------
// Overlay hidden and border fields
// ---------------------------------------------------------------------------

// TestOverlayHiddenAndBorderFields verifies that the overlay Hidden field
// and border-related fields round-trip correctly.
func TestOverlayHiddenAndBorderFields(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	overlay := makeTestOverlay()
	overlay.Hidden = true
	overlay.ShowBorder = false
	overlay.BorderColor = testColorHex
	overlay.BorderWidth = 7
	overlay.BorderRadius = 99

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Wobbuffet", CreatedAt: now, OverlayMode: "default"},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{
			Languages: []string{"en"},
			Overlay:   overlay,
		},
	}

	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf(fmtSaveState, err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf(fmtLoadState, err)
	}

	ov := got.Settings.Overlay
	if !ov.Hidden {
		t.Error("Overlay.Hidden should be true")
	}
	if ov.ShowBorder {
		t.Error("Overlay.ShowBorder should be false")
	}
	if ov.BorderColor != testColorHex {
		t.Errorf("Overlay.BorderColor = %q, want %q", ov.BorderColor, testColorHex)
	}
	if ov.BorderWidth != 7 {
		t.Errorf("Overlay.BorderWidth = %d, want 7", ov.BorderWidth)
	}
	if ov.BorderRadius != 99 {
		t.Errorf("Overlay.BorderRadius = %d, want 99", ov.BorderRadius)
	}
}

// ---------------------------------------------------------------------------
// Overlay with all animation fields (trigger_decrement, trigger_exit)
// ---------------------------------------------------------------------------

// TestOverlayTriggerDecrement verifies that trigger_decrement and trigger_exit
// animation fields round-trip for all element types.
func TestOverlayTriggerDecrement(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	overlay := makeTestOverlay()
	overlay.Sprite.TriggerDecrement = "shake"
	overlay.Name.TriggerDecrement = "bounce"
	overlay.Title.TriggerDecrement = "flash"
	overlay.Counter.TriggerDecrement = "pulse"

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Haunter", CreatedAt: now, OverlayMode: "default"},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{
			Languages: []string{"en"},
			Overlay:   overlay,
		},
	}

	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf(fmtSaveState, err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf(fmtLoadState, err)
	}

	ov := got.Settings.Overlay
	if ov.Sprite.TriggerDecrement != "shake" {
		t.Errorf("Sprite.TriggerDecrement = %q, want %q", ov.Sprite.TriggerDecrement, "shake")
	}
	if ov.Name.TriggerDecrement != "bounce" {
		t.Errorf("Name.TriggerDecrement = %q, want %q", ov.Name.TriggerDecrement, "bounce")
	}
	if ov.Title.TriggerDecrement != "flash" {
		t.Errorf("Title.TriggerDecrement = %q, want %q", ov.Title.TriggerDecrement, "flash")
	}
	if ov.Counter.TriggerDecrement != "pulse" {
		t.Errorf("Counter.TriggerDecrement = %q, want %q", ov.Counter.TriggerDecrement, "pulse")
	}
}

// ---------------------------------------------------------------------------
// Multiple detection log entries ordering
// ---------------------------------------------------------------------------

// TestDetectionLogOrdering verifies that detection log entries are loaded
// in descending order (newest first) by database ID.
func TestDetectionLogOrdering(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	entries := make([]state.DetectionLogEntry, 5)
	for i := range entries {
		entries[i] = state.DetectionLogEntry{
			At:         now.Add(time.Duration(i) * time.Minute),
			Confidence: float64(i+1) / 10.0,
		}
	}

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{
				ID:          "p1",
				Name:        "Gastly",
				CreatedAt:   now,
				OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Enabled:      true,
					SourceType:   "window",
					Templates:    []state.DetectorTemplate{},
					DetectionLog: entries,
				},
			},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{
			Languages: []string{"en"},
			Overlay:   makeTestOverlay(),
		},
	}

	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf(fmtSaveState, err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf(fmtLoadState, err)
	}

	log := got.Pokemon[0].DetectorConfig.DetectionLog
	if len(log) != 5 {
		t.Fatalf("DetectionLog len = %d, want 5", len(log))
	}
	// Loaded in DESC order by id, so newest (highest confidence) first.
	if !floatClose(log[0].Confidence, 0.5, 0.001) {
		t.Errorf("DetectionLog[0].Confidence = %f, want ~0.5", log[0].Confidence)
	}
	if !floatClose(log[4].Confidence, 0.1, 0.001) {
		t.Errorf("DetectionLog[4].Confidence = %f, want ~0.1", log[4].Confidence)
	}
}

// ---------------------------------------------------------------------------
// Multiple sessions with mixed ended_at
// ---------------------------------------------------------------------------

// TestMultipleSessionsMixed verifies saving and loading multiple sessions
// with some having EndedAt and some not.
func TestMultipleSessionsMixed(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	end := now.Add(time.Hour)

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Togepi", CreatedAt: now, OverlayMode: "default"},
		},
		Sessions: []state.Session{
			{ID: "s1", PokemonID: "p1", StartedAt: now, EndedAt: &end, Encounters: 100},
			{ID: "s2", PokemonID: "p1", StartedAt: now, Encounters: 0},
			{ID: "s3", PokemonID: "p1", StartedAt: now, EndedAt: &end, Encounters: 50},
		},
		Settings: state.Settings{
			Languages: []string{"de", "en"},
			Overlay:   makeTestOverlay(),
		},
	}

	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf(fmtSaveState, err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf(fmtLoadState, err)
	}

	if len(got.Sessions) != 3 {
		t.Fatalf("Sessions len = %d, want 3", len(got.Sessions))
	}

	// s2 should have nil EndedAt.
	found := false
	for _, s := range got.Sessions {
		if s.ID == "s2" {
			found = true
			if s.EndedAt != nil {
				t.Error("s2.EndedAt should be nil")
			}
		}
	}
	if !found {
		t.Error("session s2 not found")
	}
}

// ---------------------------------------------------------------------------
// Settings UIAnimations field
// ---------------------------------------------------------------------------

// TestSettingsUIAnimations verifies that UIAnimations flag round-trips.
func TestSettingsUIAnimations(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Pichu", CreatedAt: now, OverlayMode: "default"},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{
			UIAnimations: false,
			CrispSprites: false,
			AutoSave:     false,
			Languages:    []string{"en"},
			Overlay:      makeTestOverlay(),
		},
	}

	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf(fmtSaveState, err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf(fmtLoadState, err)
	}

	if got.Settings.UIAnimations {
		t.Error("UIAnimations should be false")
	}
	if got.Settings.CrispSprites {
		t.Error("CrispSprites should be false")
	}
	if got.Settings.AutoSave {
		t.Error("AutoSave should be false")
	}
}

// ---------------------------------------------------------------------------
// Pokemon with step and sort_order
// ---------------------------------------------------------------------------

// TestPokemonSortOrder verifies that pokemon are loaded in the correct
// sort_order as determined by their position in the saved slice.
func TestPokemonSortOrder(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	st := state.AppState{
		ActiveID: "p3",
		Pokemon: []state.Pokemon{
			{ID: "p3", Name: "Squirtle", CreatedAt: now, OverlayMode: "default", Step: 5},
			{ID: "p1", Name: "Bulbasaur", CreatedAt: now, OverlayMode: "default", Step: 1},
			{ID: "p2", Name: "Charmander", CreatedAt: now, OverlayMode: "default", Step: 3},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{
			Languages: []string{"en"},
			Overlay:   makeTestOverlay(),
		},
	}

	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf(fmtSaveState, err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf(fmtLoadState, err)
	}

	if len(got.Pokemon) != 3 {
		t.Fatalf("Pokemon len = %d, want 3", len(got.Pokemon))
	}

	// Order should match the input slice order (sort_order = 0, 1, 2).
	if got.Pokemon[0].ID != "p3" {
		t.Errorf("Pokemon[0].ID = %q, want p3", got.Pokemon[0].ID)
	}
	if got.Pokemon[1].ID != "p1" {
		t.Errorf("Pokemon[1].ID = %q, want p1", got.Pokemon[1].ID)
	}
	if got.Pokemon[2].ID != "p2" {
		t.Errorf("Pokemon[2].ID = %q, want p2", got.Pokemon[2].ID)
	}
	if got.Pokemon[0].Step != 5 {
		t.Errorf("Pokemon[0].Step = %d, want 5", got.Pokemon[0].Step)
	}
}

// ---------------------------------------------------------------------------
// Overlay with counter label style gradient stops
// ---------------------------------------------------------------------------

// TestOverlayCounterLabelGradientStops verifies that gradient stops on the
// counter's label style round-trip correctly.
func TestOverlayCounterLabelGradientStops(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	overlay := makeTestOverlay()
	overlay.Counter.LabelStyle.GradientStops = []state.GradientStop{
		{Color: testColorHex2, Position: 0},
		{Color: "#bbb222", Position: 0.5},
		{Color: "#ccc333", Position: 1},
	}
	overlay.Counter.LabelStyle.OutlineGradientStops = []state.GradientStop{
		{Color: "#ddd444", Position: 0},
		{Color: "#eee555", Position: 1},
	}

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Clefairy", CreatedAt: now, OverlayMode: "default"},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{
			Languages: []string{"en"},
			Overlay:   overlay,
		},
	}

	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf(fmtSaveState, err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf(fmtLoadState, err)
	}

	labelStyle := got.Settings.Overlay.Counter.LabelStyle
	if len(labelStyle.GradientStops) != 3 {
		t.Fatalf("LabelStyle.GradientStops len = %d, want 3", len(labelStyle.GradientStops))
	}
	if labelStyle.GradientStops[0].Color != testColorHex2 {
		t.Errorf("LabelStyle.GradientStops[0].Color = %q, want %q", labelStyle.GradientStops[0].Color, testColorHex2)
	}
	if len(labelStyle.OutlineGradientStops) != 2 {
		t.Fatalf("LabelStyle.OutlineGradientStops len = %d, want 2", len(labelStyle.OutlineGradientStops))
	}
}

// ---------------------------------------------------------------------------
// LicenseAccepted false roundtrip
// ---------------------------------------------------------------------------

// TestLicenseAcceptedFalse verifies that LicenseAccepted=false round-trips.
func TestLicenseAcceptedFalse(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	st := state.AppState{
		ActiveID:        "p1",
		LicenseAccepted: false,
		DataPath:        testImagePath,
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Rattata", CreatedAt: now, OverlayMode: "default"},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{
			Languages: []string{"en"},
			Overlay:   makeTestOverlay(),
		},
	}

	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf(fmtSaveState, err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf(fmtLoadState, err)
	}

	if got.LicenseAccepted {
		t.Error("LicenseAccepted should be false")
	}
	if got.DataPath != testImagePath {
		t.Errorf("DataPath = %q, want %q", got.DataPath, testImagePath)
	}
}

// ---------------------------------------------------------------------------
// Multiple languages ordering
// ---------------------------------------------------------------------------

// TestMultipleLanguagesOrdering verifies that multiple languages preserve
// their sort order across save/load cycles.
func TestMultipleLanguagesOrdering(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Meowth", CreatedAt: now, OverlayMode: "default"},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{
			Languages: []string{"ja", "fr", "de", "en", "ko"},
			Overlay:   makeTestOverlay(),
		},
	}

	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf(fmtSaveState, err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf(fmtLoadState, err)
	}

	want := []string{"ja", "fr", "de", "en", "ko"}
	if len(got.Settings.Languages) != len(want) {
		t.Fatalf("Languages len = %d, want %d", len(got.Settings.Languages), len(want))
	}
	for i, lang := range want {
		if got.Settings.Languages[i] != lang {
			t.Errorf("Languages[%d] = %q, want %q", i, got.Settings.Languages[i], lang)
		}
	}
}
