// state_edge_test.go contains edge-case tests for the normalized schema
// persistence layer. It focuses on covering code paths not exercised by
// the main roundtrip test, including:
// - LoadFullState on an empty database (returns nil, nil)
// - Pokemon with TimerStartedAt set
// - Sessions with EndedAt set
// - Outline gradient stops and text shadow gradient stops
// - Detector config with Region fields (X, Y, W, H)
// - Template regions with ExpectedText
package database_test

import (
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// TestLoadFullStateEmptyDB verifies that LoadFullState returns nil (without error)
// when called on a fresh database with no app_config row.
func TestLoadFullStateEmptyDB(t *testing.T) {
	db := openTestDB(t)
	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf("LoadFullState on empty DB: %v", err)
	}
	if got != nil {
		t.Errorf("LoadFullState on empty DB returned %+v, want nil", got)
	}
}

// TestPokemonWithTimerStartedAt verifies that a pokemon with an active timer
// (TimerStartedAt != nil) roundtrips correctly.
func TestPokemonWithTimerStartedAt(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	timerStart := now.Add(-30 * time.Minute)

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{
				ID:                 "p1",
				Name:               "Pikachu",
				CreatedAt:          now,
				OverlayMode:        "default",
				Encounters:         100,
				TimerStartedAt:     &timerStart,
				TimerAccumulatedMs: 1800000, // 30 minutes in ms
			},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{
			Languages: []string{"en"},
			Overlay:   makeTestOverlay(),
		},
	}

	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf("SaveFullState: %v", err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf("LoadFullState: %v", err)
	}
	if got == nil {
		t.Fatal("LoadFullState returned nil")
	}

	p := got.Pokemon[0]
	if p.TimerStartedAt == nil {
		t.Fatal("TimerStartedAt should not be nil")
	}
	if !p.TimerStartedAt.Equal(timerStart) {
		t.Errorf("TimerStartedAt = %v, want %v", *p.TimerStartedAt, timerStart)
	}
	if p.TimerAccumulatedMs != 1800000 {
		t.Errorf("TimerAccumulatedMs = %d, want 1800000", p.TimerAccumulatedMs)
	}
}

// TestSessionWithEndedAt verifies that a session with EndedAt set roundtrips correctly.
func TestSessionWithEndedAt(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	sessionStart := now.Add(-2 * time.Hour)
	sessionEnd := now.Add(-1 * time.Hour)

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{
				ID:          "p1",
				Name:        "Bulbasaur",
				CreatedAt:   now,
				OverlayMode: "default",
			},
		},
		Sessions: []state.Session{
			{
				ID:         "s1",
				PokemonID:  "p1",
				StartedAt:  sessionStart,
				EndedAt:    &sessionEnd,
				Encounters: 50,
			},
		},
		Settings: state.Settings{
			Languages: []string{"en"},
			Overlay:   makeTestOverlay(),
		},
	}

	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf("SaveFullState: %v", err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf("LoadFullState: %v", err)
	}
	if got == nil {
		t.Fatal("LoadFullState returned nil")
	}

	if len(got.Sessions) != 1 {
		t.Fatalf("Sessions len = %d, want 1", len(got.Sessions))
	}

	s := got.Sessions[0]
	if s.EndedAt == nil {
		t.Fatal("Session.EndedAt should not be nil")
	}
	if !s.EndedAt.Equal(sessionEnd) {
		t.Errorf("Session.EndedAt = %v, want %v", *s.EndedAt, sessionEnd)
	}
	if !s.StartedAt.Equal(sessionStart) {
		t.Errorf("Session.StartedAt = %v, want %v", s.StartedAt, sessionStart)
	}
	if s.Encounters != 50 {
		t.Errorf("Session.Encounters = %d, want 50", s.Encounters)
	}
}

// TestOverlayWithOutlineAndShadowGradients verifies that outline gradient stops
// and text shadow gradient stops survive a save/load cycle.
func TestOverlayWithOutlineAndShadowGradients(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	// Create an overlay with outline gradient and shadow gradient on the name element.
	overlay := makeTestOverlay()
	overlay.Name.Style.OutlineGradientStops = []state.GradientStop{
		{Color: "#ff0000", Position: 0},
		{Color: "#00ff00", Position: 0.5},
		{Color: "#0000ff", Position: 1},
	}
	overlay.Name.Style.TextShadowGradientStops = []state.GradientStop{
		{Color: "#111111", Position: 0},
		{Color: "#222222", Position: 1},
	}

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{
				ID:          "p1",
				Name:        "Charmander",
				CreatedAt:   now,
				OverlayMode: "default",
			},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{
			Languages: []string{"en"},
			Overlay:   overlay,
		},
	}

	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf("SaveFullState: %v", err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf("LoadFullState: %v", err)
	}
	if got == nil {
		t.Fatal("LoadFullState returned nil")
	}

	// Check outline gradient stops.
	outlineStops := got.Settings.Overlay.Name.Style.OutlineGradientStops
	if len(outlineStops) != 3 {
		t.Fatalf("OutlineGradientStops len = %d, want 3", len(outlineStops))
	}
	if outlineStops[0].Color != "#ff0000" {
		t.Errorf("OutlineGradientStops[0].Color = %q, want %q", outlineStops[0].Color, "#ff0000")
	}
	if outlineStops[1].Color != "#00ff00" {
		t.Errorf("OutlineGradientStops[1].Color = %q, want %q", outlineStops[1].Color, "#00ff00")
	}
	if outlineStops[2].Color != "#0000ff" {
		t.Errorf("OutlineGradientStops[2].Color = %q, want %q", outlineStops[2].Color, "#0000ff")
	}

	// Check text shadow gradient stops.
	shadowStops := got.Settings.Overlay.Name.Style.TextShadowGradientStops
	if len(shadowStops) != 2 {
		t.Fatalf("TextShadowGradientStops len = %d, want 2", len(shadowStops))
	}
	if shadowStops[0].Color != "#111111" {
		t.Errorf("TextShadowGradientStops[0].Color = %q, want %q", shadowStops[0].Color, "#111111")
	}
	if shadowStops[1].Color != "#222222" {
		t.Errorf("TextShadowGradientStops[1].Color = %q, want %q", shadowStops[1].Color, "#222222")
	}
}

// TestDetectorConfigWithRegionFields verifies that detector config Region fields
// (X, Y, W, H) roundtrip correctly.
func TestDetectorConfigWithRegionFields(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{
				ID:          "p1",
				Name:        "Squirtle",
				CreatedAt:   now,
				OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Enabled:    true,
					SourceType: "screen_region",
					Region: state.DetectorRect{
						X: 100,
						Y: 200,
						W: 300,
						H: 400,
					},
					Precision:       0.85,
					ConsecutiveHits: 2,
					CooldownSec:     3,
					Templates:       []state.DetectorTemplate{},
					DetectionLog:    []state.DetectionLogEntry{},
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
		t.Fatalf("SaveFullState: %v", err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf("LoadFullState: %v", err)
	}
	if got == nil {
		t.Fatal("LoadFullState returned nil")
	}

	dc := got.Pokemon[0].DetectorConfig
	if dc == nil {
		t.Fatal("DetectorConfig should not be nil")
	}

	if dc.Region.X != 100 {
		t.Errorf("Region.X = %d, want 100", dc.Region.X)
	}
	if dc.Region.Y != 200 {
		t.Errorf("Region.Y = %d, want 200", dc.Region.Y)
	}
	if dc.Region.W != 300 {
		t.Errorf("Region.W = %d, want 300", dc.Region.W)
	}
	if dc.Region.H != 400 {
		t.Errorf("Region.H = %d, want 400", dc.Region.H)
	}
}

// TestTemplateRegionWithExpectedText verifies that template regions with
// ExpectedText roundtrip correctly.
func TestTemplateRegionWithExpectedText(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{
				ID:          "p1",
				Name:        "Jigglypuff",
				CreatedAt:   now,
				OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Enabled:      true,
					SourceType:   "browser_camera",
					Precision:    0.9,
					Templates: []state.DetectorTemplate{
						{
							ImageData: []byte{0x89, 0x50, 0x4e, 0x47},
							Regions: []state.MatchedRegion{
								{
									Type:         "text",
									ExpectedText: "A wild Jigglypuff appeared!",
									Rect:         state.DetectorRect{X: 10, Y: 20, W: 100, H: 30},
								},
								{
									Type:         "image",
									ExpectedText: "",
									Rect:         state.DetectorRect{X: 50, Y: 60, W: 80, H: 90},
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
		t.Fatalf("SaveFullState: %v", err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf("LoadFullState: %v", err)
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

	// Check text region with ExpectedText.
	r0 := regions[0]
	if r0.Type != "text" {
		t.Errorf("Regions[0].Type = %q, want %q", r0.Type, "text")
	}
	if r0.ExpectedText != "A wild Jigglypuff appeared!" {
		t.Errorf("Regions[0].ExpectedText = %q, want %q", r0.ExpectedText, "A wild Jigglypuff appeared!")
	}
	if r0.Rect.X != 10 || r0.Rect.Y != 20 || r0.Rect.W != 100 || r0.Rect.H != 30 {
		t.Errorf("Regions[0].Rect = %+v, want {X:10 Y:20 W:100 H:30}", r0.Rect)
	}

	// Check image region with empty ExpectedText.
	r1 := regions[1]
	if r1.Type != "image" {
		t.Errorf("Regions[1].Type = %q, want %q", r1.Type, "image")
	}
	if r1.ExpectedText != "" {
		t.Errorf("Regions[1].ExpectedText = %q, want empty string", r1.ExpectedText)
	}
	if r1.Rect.X != 50 || r1.Rect.Y != 60 || r1.Rect.W != 80 || r1.Rect.H != 90 {
		t.Errorf("Regions[1].Rect = %+v, want {X:50 Y:60 W:80 H:90}", r1.Rect)
	}
}

// TestMultiplePokemonWithMixedOverlayModes verifies that saving and loading
// multiple pokemon with different overlay modes (default vs custom) works correctly.
func TestMultiplePokemonWithMixedOverlayModes(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	customOverlay := makeTestOverlayPtr()
	customOverlay.CanvasWidth = 500

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{
				ID:          "p1",
				Name:        "Eevee",
				CreatedAt:   now,
				OverlayMode: "default",
			},
			{
				ID:          "p2",
				Name:        "Vaporeon",
				CreatedAt:   now,
				OverlayMode: "custom",
				Overlay:     customOverlay,
			},
			{
				ID:          "p3",
				Name:        "Jolteon",
				CreatedAt:   now,
				OverlayMode: "default",
			},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{
			Languages: []string{"en"},
			Overlay:   makeTestOverlay(),
		},
	}

	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf("SaveFullState: %v", err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf("LoadFullState: %v", err)
	}
	if got == nil {
		t.Fatal("LoadFullState returned nil")
	}

	if len(got.Pokemon) != 3 {
		t.Fatalf("Pokemon len = %d, want 3", len(got.Pokemon))
	}

	// p1: default overlay, should have nil Overlay
	if got.Pokemon[0].Overlay != nil {
		t.Errorf("Pokemon[0] (Eevee) should have nil Overlay")
	}

	// p2: custom overlay, should have non-nil Overlay
	if got.Pokemon[1].Overlay == nil {
		t.Fatal("Pokemon[1] (Vaporeon) should have non-nil Overlay")
	}
	if got.Pokemon[1].Overlay.CanvasWidth != 500 {
		t.Errorf("Pokemon[1].Overlay.CanvasWidth = %d, want 500", got.Pokemon[1].Overlay.CanvasWidth)
	}

	// p3: default overlay, should have nil Overlay
	if got.Pokemon[2].Overlay != nil {
		t.Errorf("Pokemon[2] (Jolteon) should have nil Overlay")
	}
}

// TestDetectorConfigWithWindowTitle verifies that the WindowTitle field roundtrips.
func TestDetectorConfigWithWindowTitle(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{
				ID:          "p1",
				Name:        "Mewtwo",
				CreatedAt:   now,
				OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Enabled:         true,
					SourceType:      "window",
					WindowTitle:     "Pokemon Game Window",
					Precision:       0.95,
					ConsecutiveHits: 5,
					Templates:       []state.DetectorTemplate{},
					DetectionLog:    []state.DetectionLogEntry{},
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
		t.Fatalf("SaveFullState: %v", err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf("LoadFullState: %v", err)
	}
	if got == nil {
		t.Fatal("LoadFullState returned nil")
	}

	dc := got.Pokemon[0].DetectorConfig
	if dc == nil {
		t.Fatal("DetectorConfig should not be nil")
	}

	if dc.WindowTitle != "Pokemon Game Window" {
		t.Errorf("DetectorConfig.WindowTitle = %q, want %q", dc.WindowTitle, "Pokemon Game Window")
	}
}

// TestEmptyLanguages verifies that an empty languages slice roundtrips correctly.
func TestEmptyLanguages(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{
				ID:          "p1",
				Name:        "Ditto",
				CreatedAt:   now,
				OverlayMode: "default",
			},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{
			Languages: []string{}, // Explicitly empty
			Overlay:   makeTestOverlay(),
		},
	}

	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf("SaveFullState: %v", err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf("LoadFullState: %v", err)
	}
	if got == nil {
		t.Fatal("LoadFullState returned nil")
	}

	if got.Settings.Languages == nil {
		t.Error("Languages should not be nil")
	}
	if len(got.Settings.Languages) != 0 {
		t.Errorf("Languages len = %d, want 0", len(got.Settings.Languages))
	}
}

// TestDetectorConfigAllFields verifies that all DetectorConfig fields roundtrip,
// including ChangeThreshold, PollIntervalMs, MinPollMs, MaxPollMs.
func TestDetectorConfigAllFields(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{
				ID:          "p1",
				Name:        "Mew",
				CreatedAt:   now,
				OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Enabled:         true,
					SourceType:      "browser_camera",
					Precision:       0.92,
					ConsecutiveHits: 4,
					CooldownSec:     10,
					ChangeThreshold: 0.25,
					PollIntervalMs:  75,
					MinPollMs:       25,
					MaxPollMs:       600,
					Templates:       []state.DetectorTemplate{},
					DetectionLog:    []state.DetectionLogEntry{},
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
		t.Fatalf("SaveFullState: %v", err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf("LoadFullState: %v", err)
	}
	if got == nil {
		t.Fatal("LoadFullState returned nil")
	}

	dc := got.Pokemon[0].DetectorConfig
	if dc == nil {
		t.Fatal("DetectorConfig should not be nil")
	}

	if !floatClose(dc.ChangeThreshold, 0.25, 0.001) {
		t.Errorf("ChangeThreshold = %f, want 0.25", dc.ChangeThreshold)
	}
	if dc.PollIntervalMs != 75 {
		t.Errorf("PollIntervalMs = %d, want 75", dc.PollIntervalMs)
	}
	if dc.MinPollMs != 25 {
		t.Errorf("MinPollMs = %d, want 25", dc.MinPollMs)
	}
	if dc.MaxPollMs != 600 {
		t.Errorf("MaxPollMs = %d, want 600", dc.MaxPollMs)
	}
}

// TestPokemonAllStringFields verifies that all string fields on Pokemon roundtrip,
// including SpriteStyle which was added later.
func TestPokemonAllStringFields(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	st := state.AppState{
		ActiveID: "p1",
		Pokemon: []state.Pokemon{
			{
				ID:            "p1",
				Name:          "Gengar",
				Title:         "Spooky Hunt",
				CanonicalName: "gengar",
				SpriteURL:     "https://example.com/gengar.png",
				SpriteType:    "shiny",
				SpriteStyle:   "animated",
				CreatedAt:     now,
				Language:      "fr",
				Game:          "silver",
				OverlayMode:   "default",
				HuntType:      "masuda",
			},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{
			Languages: []string{"en"},
			Overlay:   makeTestOverlay(),
		},
	}

	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf("SaveFullState: %v", err)
	}

	got, err := db.LoadFullState()
	if err != nil {
		t.Fatalf("LoadFullState: %v", err)
	}
	if got == nil {
		t.Fatal("LoadFullState returned nil")
	}

	p := got.Pokemon[0]
	if p.SpriteStyle != "animated" {
		t.Errorf("SpriteStyle = %q, want %q", p.SpriteStyle, "animated")
	}
	if p.Title != "Spooky Hunt" {
		t.Errorf("Title = %q, want %q", p.Title, "Spooky Hunt")
	}
	if p.HuntType != "masuda" {
		t.Errorf("HuntType = %q, want %q", p.HuntType, "masuda")
	}
}
