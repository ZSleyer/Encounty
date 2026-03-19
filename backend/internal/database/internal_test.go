// internal_test.go uses package database (internal) to test private helpers
// and error paths that cannot be reached from an external test package.
package database

import (
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// openInternalTestDB creates a fresh database in a temporary directory.
func openInternalTestDB(t *testing.T) *DB {
	t.Helper()
	db, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// ---------------------------------------------------------------------------
// Null helpers
// ---------------------------------------------------------------------------

func TestNullStrValid(t *testing.T) {
	got := nullStr(sql.NullString{String: "hello", Valid: true})
	if got != "hello" {
		t.Errorf("nullStr(valid) = %q, want %q", got, "hello")
	}
}

func TestNullStrInvalid(t *testing.T) {
	got := nullStr(sql.NullString{})
	if got != "" {
		t.Errorf("nullStr(invalid) = %q, want empty", got)
	}
}

func TestNullFloatValid(t *testing.T) {
	got := nullFloat(sql.NullFloat64{Float64: 3.14, Valid: true})
	if got != 3.14 {
		t.Errorf("nullFloat(valid) = %f, want 3.14", got)
	}
}

func TestNullFloatInvalid(t *testing.T) {
	got := nullFloat(sql.NullFloat64{})
	if got != 0 {
		t.Errorf("nullFloat(invalid) = %f, want 0", got)
	}
}

func TestNullIntValid(t *testing.T) {
	got := nullInt(sql.NullInt64{Int64: 42, Valid: true})
	if got != 42 {
		t.Errorf("nullInt(valid) = %d, want 42", got)
	}
}

func TestNullIntInvalid(t *testing.T) {
	got := nullInt(sql.NullInt64{})
	if got != 0 {
		t.Errorf("nullInt(invalid) = %d, want 0", got)
	}
}

// ---------------------------------------------------------------------------
// boolToInt and nullTimeStr
// ---------------------------------------------------------------------------

func TestBoolToInt(t *testing.T) {
	if boolToInt(true) != 1 {
		t.Error("boolToInt(true) != 1")
	}
	if boolToInt(false) != 0 {
		t.Error("boolToInt(false) != 0")
	}
}

func TestNullTimeStr(t *testing.T) {
	ns := nullTimeStr(nil)
	if ns.Valid {
		t.Error("nullTimeStr(nil) should be invalid")
	}

	now := time.Now().UTC().Truncate(time.Second)
	ns = nullTimeStr(&now)
	if !ns.Valid {
		t.Error("nullTimeStr(&now) should be valid")
	}
	if ns.String != now.Format(time.RFC3339) {
		t.Errorf("nullTimeStr = %q, want %q", ns.String, now.Format(time.RFC3339))
	}
}

// ---------------------------------------------------------------------------
// mustAtoi
// ---------------------------------------------------------------------------

func TestMustAtoi(t *testing.T) {
	tests := []struct {
		in   string
		want int
	}{
		{"0", 0},
		{"7", 7},
		{"90", 90},
		{"365", 365},
	}
	for _, tt := range tests {
		if got := mustAtoi(tt.in); got != tt.want {
			t.Errorf("mustAtoi(%q) = %d, want %d", tt.in, got, tt.want)
		}
	}
}

// ---------------------------------------------------------------------------
// deleteNotIn and deleteOverlayNotIn
// ---------------------------------------------------------------------------

func TestDeleteNotInEmpty(t *testing.T) {
	d := openInternalTestDB(t)
	tx, err := d.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()

	// Insert two pokemon rows.
	now := time.Now().UTC().Format(time.RFC3339)
	_, _ = tx.Exec(`INSERT INTO pokemon (id, name, created_at) VALUES ('a', 'A', ?)`, now)
	_, _ = tx.Exec(`INSERT INTO pokemon (id, name, created_at) VALUES ('b', 'B', ?)`, now)

	// deleteNotIn with empty slice should delete all.
	if err := deleteNotIn(tx, "pokemon", "id", nil); err != nil {
		t.Fatalf("deleteNotIn: %v", err)
	}
	var count int
	_ = tx.QueryRow(`SELECT COUNT(*) FROM pokemon`).Scan(&count)
	if count != 0 {
		t.Errorf("count after deleteNotIn(nil) = %d, want 0", count)
	}
}

func TestDeleteNotInWithValues(t *testing.T) {
	d := openInternalTestDB(t)
	tx, err := d.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()

	now := time.Now().UTC().Format(time.RFC3339)
	_, _ = tx.Exec(`INSERT INTO pokemon (id, name, created_at) VALUES ('a', 'A', ?)`, now)
	_, _ = tx.Exec(`INSERT INTO pokemon (id, name, created_at) VALUES ('b', 'B', ?)`, now)
	_, _ = tx.Exec(`INSERT INTO pokemon (id, name, created_at) VALUES ('c', 'C', ?)`, now)

	if err := deleteNotIn(tx, "pokemon", "id", []string{"a", "c"}); err != nil {
		t.Fatalf("deleteNotIn: %v", err)
	}
	var count int
	_ = tx.QueryRow(`SELECT COUNT(*) FROM pokemon`).Scan(&count)
	if count != 2 {
		t.Errorf("count after deleteNotIn = %d, want 2", count)
	}
}

func TestDeleteOverlayNotInEmpty(t *testing.T) {
	d := openInternalTestDB(t)
	tx, err := d.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()

	_, _ = tx.Exec(`INSERT INTO overlay_settings (owner_type, owner_id) VALUES ('pokemon', 'x')`)
	if err := deleteOverlayNotIn(tx, "pokemon", nil); err != nil {
		t.Fatalf("deleteOverlayNotIn: %v", err)
	}
	var count int
	_ = tx.QueryRow(`SELECT COUNT(*) FROM overlay_settings WHERE owner_type = 'pokemon'`).Scan(&count)
	if count != 0 {
		t.Errorf("count = %d, want 0", count)
	}
}

func TestDeleteOverlayNotInWithValues(t *testing.T) {
	d := openInternalTestDB(t)
	tx, err := d.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()

	_, _ = tx.Exec(`INSERT INTO overlay_settings (owner_type, owner_id) VALUES ('pokemon', 'x')`)
	_, _ = tx.Exec(`INSERT INTO overlay_settings (owner_type, owner_id) VALUES ('pokemon', 'y')`)
	if err := deleteOverlayNotIn(tx, "pokemon", []string{"x"}); err != nil {
		t.Fatalf("deleteOverlayNotIn: %v", err)
	}
	var count int
	_ = tx.QueryRow(`SELECT COUNT(*) FROM overlay_settings WHERE owner_type = 'pokemon'`).Scan(&count)
	if count != 1 {
		t.Errorf("count = %d, want 1", count)
	}
}

// ---------------------------------------------------------------------------
// Error paths via table corruption
// ---------------------------------------------------------------------------

func TestSaveFullStateOnClosedDB(t *testing.T) {
	d := openInternalTestDB(t)
	_ = d.db.Close()
	st := &state.AppState{
		Pokemon: []state.Pokemon{}, Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}},
	}
	err := d.SaveFullState(st)
	if err == nil {
		t.Error("SaveFullState on closed DB should fail")
	}
}

func TestLoadFullStateOnClosedDB(t *testing.T) {
	d := openInternalTestDB(t)
	// First save state so app_config exists.
	st := &state.AppState{
		Pokemon: []state.Pokemon{}, Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{},
			Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
	if err := d.SaveFullState(st); err != nil {
		t.Fatalf("SaveFullState: %v", err)
	}
	_ = d.db.Close()
	_, err := d.LoadFullState()
	if err == nil {
		t.Error("LoadFullState on closed DB should fail")
	}
}

func TestOpenInvalidPath(t *testing.T) {
	// Try to open a DB at a nonexistent directory.
	_, err := Open("/nonexistent/dir/test.db")
	if err == nil {
		t.Error("Open with invalid path should fail")
	}
}

// ---------------------------------------------------------------------------
// Load functions on empty tables (ErrNoRows paths)
// ---------------------------------------------------------------------------

func TestLoadHotkeysNoRow(t *testing.T) {
	d := openInternalTestDB(t)
	h, err := loadHotkeys(d.db)
	if err != nil {
		t.Fatalf("loadHotkeys: %v", err)
	}
	if h.Increment != "" || h.Decrement != "" {
		t.Errorf("expected zero-value HotkeyMap, got %+v", h)
	}
}

func TestLoadSettingsNoRow(t *testing.T) {
	d := openInternalTestDB(t)
	s, err := loadSettings(d.db)
	if err != nil {
		t.Fatalf("loadSettings: %v", err)
	}
	if s.BrowserPort != 0 {
		t.Errorf("expected zero-value Settings, got BrowserPort=%d", s.BrowserPort)
	}
}

func TestLoadLanguagesEmpty(t *testing.T) {
	d := openInternalTestDB(t)
	langs, err := loadLanguages(d.db)
	if err != nil {
		t.Fatalf("loadLanguages: %v", err)
	}
	if langs == nil {
		t.Error("loadLanguages should return non-nil empty slice")
	}
	if len(langs) != 0 {
		t.Errorf("loadLanguages len = %d, want 0", len(langs))
	}
}

func TestLoadPokemonEmpty(t *testing.T) {
	d := openInternalTestDB(t)
	p, err := loadPokemon(d.db)
	if err != nil {
		t.Fatalf("loadPokemon: %v", err)
	}
	if p == nil {
		t.Error("loadPokemon should return non-nil empty slice")
	}
	if len(p) != 0 {
		t.Errorf("loadPokemon len = %d, want 0", len(p))
	}
}

func TestLoadDetectorConfigNoRow(t *testing.T) {
	d := openInternalTestDB(t)
	dc, err := loadDetectorConfig(d.db, "nonexistent")
	if err != nil {
		t.Fatalf("loadDetectorConfig: %v", err)
	}
	if dc != nil {
		t.Error("loadDetectorConfig should return nil for nonexistent pokemon")
	}
}

func TestLoadDetectorTemplatesEmpty(t *testing.T) {
	d := openInternalTestDB(t)
	templates, err := loadDetectorTemplates(d.db, "nonexistent")
	if err != nil {
		t.Fatalf("loadDetectorTemplates: %v", err)
	}
	if templates == nil {
		t.Error("should return non-nil empty slice")
	}
	if len(templates) != 0 {
		t.Errorf("len = %d, want 0", len(templates))
	}
}

func TestLoadTemplateRegionsEmpty(t *testing.T) {
	d := openInternalTestDB(t)
	regions, err := loadTemplateRegions(d.db, 99999)
	if err != nil {
		t.Fatalf("loadTemplateRegions: %v", err)
	}
	if regions == nil {
		t.Error("should return non-nil empty slice")
	}
}

func TestLoadDetectionLogEmpty(t *testing.T) {
	d := openInternalTestDB(t)
	entries, err := loadDetectionLog(d.db, "nonexistent")
	if err != nil {
		t.Fatalf("loadDetectionLog: %v", err)
	}
	if entries == nil {
		t.Error("should return non-nil empty slice")
	}
}

func TestLoadSessionsEmpty(t *testing.T) {
	d := openInternalTestDB(t)
	sessions, err := loadSessions(d.db)
	if err != nil {
		t.Fatalf("loadSessions: %v", err)
	}
	if sessions == nil {
		t.Error("should return non-nil empty slice")
	}
}

func TestLoadOverlayNoRow(t *testing.T) {
	d := openInternalTestDB(t)
	ov, err := loadOverlay(d.db, "global", "default")
	if err != nil {
		t.Fatalf("loadOverlay: %v", err)
	}
	if ov != nil {
		t.Error("loadOverlay should return nil for no-row case")
	}
}

func TestLoadTextStyleNoRow(t *testing.T) {
	d := openInternalTestDB(t)
	ts, err := loadTextStyle(d.db, 99999, "main")
	if err != nil {
		t.Fatalf("loadTextStyle: %v", err)
	}
	// Should return zero-value with initialized slices.
	if ts.GradientStops == nil {
		t.Error("GradientStops should be non-nil")
	}
	if ts.OutlineGradientStops == nil {
		t.Error("OutlineGradientStops should be non-nil")
	}
	if ts.TextShadowGradientStops == nil {
		t.Error("TextShadowGradientStops should be non-nil")
	}
}

func TestLoadGradientStopsEmpty(t *testing.T) {
	d := openInternalTestDB(t)
	stops, err := loadGradientStops(d.db, 99999, "color")
	if err != nil {
		t.Fatalf("loadGradientStops: %v", err)
	}
	if stops == nil {
		t.Error("should return non-nil empty slice")
	}
}

// ---------------------------------------------------------------------------
// Save error paths via dropped tables
// ---------------------------------------------------------------------------

func TestSaveOverlayErrorPath(t *testing.T) {
	d := openInternalTestDB(t)
	tx, err := d.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()

	// Drop overlay_settings to trigger error.
	_, _ = tx.Exec(`DROP TABLE overlay_settings`)
	ov := &state.OverlaySettings{BackgroundAnimation: "none"}
	err = saveOverlay(tx, ov, "global", "default")
	if err == nil {
		t.Error("saveOverlay with dropped table should fail")
	}
}

func TestSaveTextStyleErrorPath(t *testing.T) {
	d := openInternalTestDB(t)
	tx, err := d.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()

	// Drop text_styles to trigger error.
	_, _ = tx.Exec(`DROP TABLE gradient_stops`)
	_, _ = tx.Exec(`DROP TABLE text_styles`)
	style := &state.TextStyle{FontFamily: "test"}
	err = saveTextStyle(tx, 1, "main", style)
	if err == nil {
		t.Error("saveTextStyle with dropped table should fail")
	}
}

func TestInsertGradientStopsErrorPath(t *testing.T) {
	d := openInternalTestDB(t)
	tx, err := d.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()

	_, _ = tx.Exec(`DROP TABLE gradient_stops`)
	stops := []state.GradientStop{{Color: "#fff", Position: 0}}
	err = insertGradientStops(tx, 1, "color", stops)
	if err == nil {
		t.Error("insertGradientStops with dropped table should fail")
	}
}

func TestInsertElementErrorPath(t *testing.T) {
	d := openInternalTestDB(t)
	tx, err := d.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()

	_, _ = tx.Exec(`DROP TABLE overlay_elements`)
	base := &state.OverlayElementBase{Visible: true, X: 0, Y: 0}
	_, err = insertElement(tx, 1, "sprite", base, 0, "", 0, 0, "none", "none", "", false, "")
	if err == nil {
		t.Error("insertElement with dropped table should fail")
	}
}

func TestSaveDetectorTemplatesErrorPath(t *testing.T) {
	d := openInternalTestDB(t)

	// Save initial state with a template.
	now := time.Now().UTC().Truncate(time.Second)
	st := &state.AppState{
		Pokemon: []state.Pokemon{
			{
				ID: "p1", Name: "Test", CreatedAt: now, OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Templates:    []state.DetectorTemplate{{ImageData: []byte{1, 2, 3}, Regions: []state.MatchedRegion{}}},
					DetectionLog: []state.DetectionLogEntry{},
				},
			},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
	if err := d.SaveFullState(st); err != nil {
		t.Fatalf("SaveFullState: %v", err)
	}

	// Now drop detector_templates and try to save again.
	tx, err := d.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()

	_, _ = tx.Exec(`DROP TABLE template_regions`)
	_, _ = tx.Exec(`DROP TABLE detection_log`)
	_, _ = tx.Exec(`DROP TABLE detector_templates`)
	err = saveDetectorTemplates(tx, st.Pokemon)
	if err == nil {
		t.Error("saveDetectorTemplates with dropped table should fail")
	}
}

func TestSaveTemplateRegionsErrorPath(t *testing.T) {
	d := openInternalTestDB(t)

	tx, err := d.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()

	_, _ = tx.Exec(`DROP TABLE template_regions`)
	pokemon := []state.Pokemon{
		{
			ID: "p1",
			DetectorConfig: &state.DetectorConfig{
				Templates: []state.DetectorTemplate{
					{TemplateDBID: 1, Regions: []state.MatchedRegion{{Type: "image"}}},
				},
			},
		},
	}
	err = saveTemplateRegions(tx, pokemon)
	if err == nil {
		t.Error("saveTemplateRegions with dropped table should fail")
	}
}

func TestSaveDetectionLogsErrorPath(t *testing.T) {
	d := openInternalTestDB(t)
	tx, err := d.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()

	_, _ = tx.Exec(`DROP TABLE detection_log`)
	pokemon := []state.Pokemon{
		{
			ID: "p1",
			DetectorConfig: &state.DetectorConfig{
				DetectionLog: []state.DetectionLogEntry{{At: time.Now(), Confidence: 0.9}},
			},
		},
	}
	err = saveDetectionLogs(tx, pokemon)
	if err == nil {
		t.Error("saveDetectionLogs with dropped table should fail")
	}
}

// ---------------------------------------------------------------------------
// Load error paths via dropped tables
// ---------------------------------------------------------------------------

func TestLoadHotkeysError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE hotkeys`)
	_, err := loadHotkeys(d.db)
	if err == nil {
		t.Error("loadHotkeys with dropped table should fail")
	}
}

func TestLoadSettingsError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE settings`)
	_, err := loadSettings(d.db)
	if err == nil {
		t.Error("loadSettings with dropped table should fail")
	}
}

func TestLoadLanguagesError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE settings_languages`)
	_, err := loadLanguages(d.db)
	if err == nil {
		t.Error("loadLanguages with dropped table should fail")
	}
}

func TestLoadPokemonError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE pokemon`)
	_, err := loadPokemon(d.db)
	if err == nil {
		t.Error("loadPokemon with dropped table should fail")
	}
}

func TestLoadSessionsError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE sessions`)
	_, err := loadSessions(d.db)
	if err == nil {
		t.Error("loadSessions with dropped table should fail")
	}
}

func TestLoadOverlayError(t *testing.T) {
	d := openInternalTestDB(t)
	// First insert a row, then drop overlay_elements.
	_, _ = d.db.Exec(`INSERT INTO overlay_settings (owner_type, owner_id) VALUES ('global', 'default')`)
	_, _ = d.db.Exec(`DROP TABLE text_styles`)
	_, _ = d.db.Exec(`DROP TABLE overlay_elements`)
	_, err := loadOverlay(d.db, "global", "default")
	if err == nil {
		t.Error("loadOverlay with dropped table should fail")
	}
}

func TestLoadGradientStopsError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE gradient_stops`)
	_, err := loadGradientStops(d.db, 1, "color")
	if err == nil {
		t.Error("loadGradientStops with dropped table should fail")
	}
}

func TestLoadDetectorTemplatesError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE template_regions`)
	_, _ = d.db.Exec(`DROP TABLE detector_templates`)
	_, err := loadDetectorTemplates(d.db, "p1")
	if err == nil {
		t.Error("loadDetectorTemplates with dropped table should fail")
	}
}

func TestLoadTemplateRegionsError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE template_regions`)
	_, err := loadTemplateRegions(d.db, 1)
	if err == nil {
		t.Error("loadTemplateRegions with dropped table should fail")
	}
}

func TestLoadDetectionLogError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE detection_log`)
	_, err := loadDetectionLog(d.db, "p1")
	if err == nil {
		t.Error("loadDetectionLog with dropped table should fail")
	}
}

func TestLoadTextStyleError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE text_styles`)
	_, err := loadTextStyle(d.db, 1, "main")
	if err == nil {
		t.Error("loadTextStyle with dropped table should fail")
	}
}

// ---------------------------------------------------------------------------
// LoadFullState error paths for sub-loaders
// ---------------------------------------------------------------------------

func TestLoadFullStateHotkeyError(t *testing.T) {
	d := openInternalTestDB(t)
	// Seed app_config so LoadFullState proceeds past the first check.
	_, _ = d.db.Exec(`INSERT INTO app_config (id, active_id, license_accepted, data_path, updated_at) VALUES (1, '', 0, '', '')`)
	_, _ = d.db.Exec(`DROP TABLE hotkeys`)
	_, err := d.LoadFullState()
	if err == nil {
		t.Error("LoadFullState should fail when hotkeys table is dropped")
	}
}

func TestLoadFullStateSettingsError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`INSERT INTO app_config (id, active_id, license_accepted, data_path, updated_at) VALUES (1, '', 0, '', '')`)
	_, _ = d.db.Exec(`INSERT INTO hotkeys (id, increment, decrement, reset, next_pokemon) VALUES (1, '', '', '', '')`)
	_, _ = d.db.Exec(`DROP TABLE settings`)
	_, err := d.LoadFullState()
	if err == nil {
		t.Error("LoadFullState should fail when settings table is dropped")
	}
}

func TestLoadFullStateLanguagesError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`INSERT INTO app_config (id, active_id, license_accepted, data_path, updated_at) VALUES (1, '', 0, '', '')`)
	_, _ = d.db.Exec(`INSERT INTO hotkeys (id, increment, decrement, reset, next_pokemon) VALUES (1, '', '', '', '')`)
	_, _ = d.db.Exec(`INSERT INTO settings (id) VALUES (1)`)
	_, _ = d.db.Exec(`DROP TABLE settings_languages`)
	_, err := d.LoadFullState()
	if err == nil {
		t.Error("LoadFullState should fail when settings_languages table is dropped")
	}
}

func TestLoadFullStateOverlayError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`INSERT INTO app_config (id, active_id, license_accepted, data_path, updated_at) VALUES (1, '', 0, '', '')`)
	_, _ = d.db.Exec(`INSERT INTO hotkeys (id, increment, decrement, reset, next_pokemon) VALUES (1, '', '', '', '')`)
	_, _ = d.db.Exec(`INSERT INTO settings (id) VALUES (1)`)
	// Insert an overlay row but drop overlay_elements.
	_, _ = d.db.Exec(`INSERT INTO overlay_settings (owner_type, owner_id) VALUES ('global', 'default')`)
	_, _ = d.db.Exec(`DROP TABLE text_styles`)
	_, _ = d.db.Exec(`DROP TABLE overlay_elements`)
	_, err := d.LoadFullState()
	if err == nil {
		t.Error("LoadFullState should fail when overlay_elements table is dropped")
	}
}

func TestLoadFullStatePokemonError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`INSERT INTO app_config (id, active_id, license_accepted, data_path, updated_at) VALUES (1, '', 0, '', '')`)
	_, _ = d.db.Exec(`INSERT INTO hotkeys (id, increment, decrement, reset, next_pokemon) VALUES (1, '', '', '', '')`)
	_, _ = d.db.Exec(`INSERT INTO settings (id) VALUES (1)`)
	_, _ = d.db.Exec(`DROP TABLE pokemon`)
	_, err := d.LoadFullState()
	if err == nil {
		t.Error("LoadFullState should fail when pokemon table is dropped")
	}
}

func TestLoadFullStateSessionsError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`INSERT INTO app_config (id, active_id, license_accepted, data_path, updated_at) VALUES (1, '', 0, '', '')`)
	_, _ = d.db.Exec(`INSERT INTO hotkeys (id, increment, decrement, reset, next_pokemon) VALUES (1, '', '', '', '')`)
	_, _ = d.db.Exec(`INSERT INTO settings (id) VALUES (1)`)
	_, _ = d.db.Exec(`DROP TABLE sessions`)
	_, err := d.LoadFullState()
	if err == nil {
		t.Error("LoadFullState should fail when sessions table is dropped")
	}
}

// ---------------------------------------------------------------------------
// SaveFullState sub-step error paths
// ---------------------------------------------------------------------------

func TestSaveFullStateHotkeyError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE hotkeys`)
	st := &state.AppState{Pokemon: []state.Pokemon{}, Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}}}
	err := d.SaveFullState(st)
	if err == nil {
		t.Error("expected error when hotkeys table is dropped")
	}
}

func TestSaveFullStateSettingsError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE settings`)
	st := &state.AppState{Pokemon: []state.Pokemon{}, Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}}}
	err := d.SaveFullState(st)
	if err == nil {
		t.Error("expected error when settings table is dropped")
	}
}

func TestSaveFullStateLanguagesError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE settings_languages`)
	st := &state.AppState{Pokemon: []state.Pokemon{}, Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{"en"}}}
	err := d.SaveFullState(st)
	if err == nil {
		t.Error("expected error when settings_languages table is dropped")
	}
}

func TestSaveFullStateOverlayError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE gradient_stops`)
	_, _ = d.db.Exec(`DROP TABLE text_styles`)
	_, _ = d.db.Exec(`DROP TABLE overlay_elements`)
	_, _ = d.db.Exec(`DROP TABLE overlay_settings`)
	st := &state.AppState{Pokemon: []state.Pokemon{}, Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}}}
	err := d.SaveFullState(st)
	if err == nil {
		t.Error("expected error when overlay tables are dropped")
	}
}

func TestSaveFullStatePokemonDeleteError(t *testing.T) {
	d := openInternalTestDB(t)
	// Save once to create data.
	now := time.Now().UTC().Truncate(time.Second)
	st := &state.AppState{
		Pokemon:  []state.Pokemon{{ID: "p1", Name: "Test", CreatedAt: now, OverlayMode: "default"}},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
	_ = d.SaveFullState(st)
	// Drop pokemon table to cause delete error on next save.
	_, _ = d.db.Exec(`DROP TABLE detector_templates`)
	_, _ = d.db.Exec(`DROP TABLE detector_configs`)
	_, _ = d.db.Exec(`DROP TABLE pokemon`)
	st.Pokemon = nil
	err := d.SaveFullState(st)
	if err == nil {
		t.Error("expected error when pokemon table is dropped")
	}
}

func TestSaveFullStatePokemonUpsertError(t *testing.T) {
	d := openInternalTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	st := &state.AppState{
		Pokemon:  []state.Pokemon{{ID: "p1", Name: "Test", CreatedAt: now, OverlayMode: "default"}},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
	// Drop pokemon table after overlay is saved.
	_, _ = d.db.Exec(`DROP TABLE detector_templates`)
	_, _ = d.db.Exec(`DROP TABLE detector_configs`)
	_, _ = d.db.Exec(`DROP TABLE pokemon`)
	err := d.SaveFullState(st)
	if err == nil {
		t.Error("expected error when pokemon table is dropped for upsert")
	}
}

func TestSaveFullStateSessionsError(t *testing.T) {
	d := openInternalTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	st := &state.AppState{
		Pokemon:  []state.Pokemon{},
		Sessions: []state.Session{{ID: "s1", PokemonID: "p1", StartedAt: now}},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
	_, _ = d.db.Exec(`DROP TABLE sessions`)
	err := d.SaveFullState(st)
	if err == nil {
		t.Error("expected error when sessions table is dropped")
	}
}

func TestSaveFullStateDetectorConfigError(t *testing.T) {
	d := openInternalTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	st := &state.AppState{
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Test", CreatedAt: now, OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Enabled: true, SourceType: "test",
					Templates: []state.DetectorTemplate{}, DetectionLog: []state.DetectionLogEntry{},
				}},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
	_, _ = d.db.Exec(`DROP TABLE template_regions`)
	_, _ = d.db.Exec(`DROP TABLE detection_log`)
	_, _ = d.db.Exec(`DROP TABLE detector_templates`)
	_, _ = d.db.Exec(`DROP TABLE detector_configs`)
	err := d.SaveFullState(st)
	if err == nil {
		t.Error("expected error when detector_configs table is dropped")
	}
}

func TestSaveFullStateDetectorTemplatesError(t *testing.T) {
	d := openInternalTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	st := &state.AppState{
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Test", CreatedAt: now, OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Enabled: true, SourceType: "test",
					Templates:    []state.DetectorTemplate{{ImageData: []byte{1}, Regions: []state.MatchedRegion{}}},
					DetectionLog: []state.DetectionLogEntry{},
				}},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
	_, _ = d.db.Exec(`DROP TABLE template_regions`)
	_, _ = d.db.Exec(`DROP TABLE detection_log`)
	_, _ = d.db.Exec(`DROP TABLE detector_templates`)
	err := d.SaveFullState(st)
	if err == nil {
		t.Error("expected error when detector_templates table is dropped")
	}
}

func TestSaveFullStateTemplateRegionsError(t *testing.T) {
	d := openInternalTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	st := &state.AppState{
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Test", CreatedAt: now, OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Enabled: true, SourceType: "test",
					Templates:    []state.DetectorTemplate{{ImageData: []byte{1}, Regions: []state.MatchedRegion{{Type: "image"}}}},
					DetectionLog: []state.DetectionLogEntry{},
				}},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
	_, _ = d.db.Exec(`DROP TABLE template_regions`)
	err := d.SaveFullState(st)
	if err == nil {
		t.Error("expected error when template_regions table is dropped")
	}
}

func TestSaveFullStateDetectionLogError(t *testing.T) {
	d := openInternalTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	st := &state.AppState{
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Test", CreatedAt: now, OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Enabled: true, SourceType: "test",
					Templates:    []state.DetectorTemplate{},
					DetectionLog: []state.DetectionLogEntry{{At: now, Confidence: 0.5}},
				}},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
	_, _ = d.db.Exec(`DROP TABLE detection_log`)
	err := d.SaveFullState(st)
	if err == nil {
		t.Error("expected error when detection_log table is dropped")
	}
}

// ---------------------------------------------------------------------------
// LoadFullState error paths for pokemon sub-loaders
// ---------------------------------------------------------------------------

func TestLoadFullStateDetectorConfigError(t *testing.T) {
	d := openInternalTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	st := &state.AppState{
		Pokemon:  []state.Pokemon{{ID: "p1", Name: "Test", CreatedAt: now, OverlayMode: "default"}},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
	_ = d.SaveFullState(st)
	// Drop detector_configs table.
	_, _ = d.db.Exec(`DROP TABLE template_regions`)
	_, _ = d.db.Exec(`DROP TABLE detection_log`)
	_, _ = d.db.Exec(`DROP TABLE detector_templates`)
	_, _ = d.db.Exec(`DROP TABLE detector_configs`)
	_, err := d.LoadFullState()
	if err == nil {
		t.Error("LoadFullState should fail when detector_configs is dropped")
	}
}

func TestLoadFullStateDetectorTemplatesError(t *testing.T) {
	d := openInternalTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	st := &state.AppState{
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Test", CreatedAt: now, OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Enabled: true, SourceType: "test",
					Templates:    []state.DetectorTemplate{{ImageData: []byte{1}, Regions: []state.MatchedRegion{}}},
					DetectionLog: []state.DetectionLogEntry{},
				}},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
	_ = d.SaveFullState(st)
	_, _ = d.db.Exec(`DROP TABLE template_regions`)
	_, _ = d.db.Exec(`DROP TABLE detector_templates`)
	_, err := d.LoadFullState()
	if err == nil {
		t.Error("LoadFullState should fail when detector_templates is dropped")
	}
}

func TestLoadFullStateDetectionLogError(t *testing.T) {
	d := openInternalTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	st := &state.AppState{
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Test", CreatedAt: now, OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Enabled: true, SourceType: "test",
					Templates:    []state.DetectorTemplate{},
					DetectionLog: []state.DetectionLogEntry{{At: now, Confidence: 0.5}},
				}},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
	_ = d.SaveFullState(st)
	_, _ = d.db.Exec(`DROP TABLE detection_log`)
	_, err := d.LoadFullState()
	if err == nil {
		t.Error("LoadFullState should fail when detection_log is dropped")
	}
}

func TestLoadFullStatePokemonOverlayError(t *testing.T) {
	d := openInternalTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	customOv := state.OverlaySettings{BackgroundAnimation: "none", CanvasWidth: 100, CanvasHeight: 100}
	st := &state.AppState{
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Test", CreatedAt: now, OverlayMode: "custom", Overlay: &customOv},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
	_ = d.SaveFullState(st)
	// Drop overlay_elements to cause error when loading per-pokemon overlay.
	_, _ = d.db.Exec(`DROP TABLE gradient_stops`)
	_, _ = d.db.Exec(`DROP TABLE text_styles`)
	_, _ = d.db.Exec(`DROP TABLE overlay_elements`)
	_, err := d.LoadFullState()
	if err == nil {
		t.Error("LoadFullState should fail when overlay_elements is dropped")
	}
}

// ---------------------------------------------------------------------------
// loadOverlay text style error paths
// ---------------------------------------------------------------------------

func TestLoadOverlayNameStyleError(t *testing.T) {
	d := openInternalTestDB(t)
	st := &state.AppState{
		Pokemon:  []state.Pokemon{},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{
			BackgroundAnimation: "none",
			Sprite:              state.SpriteElement{OverlayElementBase: state.OverlayElementBase{Width: 100, Height: 100}},
			Name:                state.NameElement{OverlayElementBase: state.OverlayElementBase{Width: 100, Height: 30}},
			Title:               state.TitleElement{OverlayElementBase: state.OverlayElementBase{Width: 100, Height: 30}},
			Counter:             state.CounterElement{OverlayElementBase: state.OverlayElementBase{Width: 100, Height: 30}},
		}},
	}
	_ = d.SaveFullState(st)
	// Drop text_styles to cause error for name/title/counter style loading.
	_, _ = d.db.Exec(`DROP TABLE gradient_stops`)
	_, _ = d.db.Exec(`DROP TABLE text_styles`)
	_, err := loadOverlay(d.db, "global", "default")
	if err == nil {
		t.Error("loadOverlay should fail when text_styles is dropped")
	}
}

// ---------------------------------------------------------------------------
// saveOverlay sub-step error paths
// ---------------------------------------------------------------------------

func TestSaveOverlayElementError(t *testing.T) {
	d := openInternalTestDB(t)
	tx, err := d.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()

	// Create the overlay_settings row.
	_, _ = tx.Exec(`INSERT INTO overlay_settings (owner_type, owner_id) VALUES ('global', 'default')`)
	// Drop overlay_elements to trigger error on element insert.
	_, _ = tx.Exec(`DROP TABLE text_styles`)
	_, _ = tx.Exec(`DROP TABLE overlay_elements`)

	ov := &state.OverlaySettings{BackgroundAnimation: "none"}
	err = saveOverlay(tx, ov, "global", "default")
	if err == nil {
		t.Error("saveOverlay should fail when overlay_elements is dropped")
	}
}

func TestSaveOverlayTitleStyleError(t *testing.T) {
	d := openInternalTestDB(t)
	tx, err := d.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()

	ov := &state.OverlaySettings{
		BackgroundAnimation: "none",
		Sprite:              state.SpriteElement{OverlayElementBase: state.OverlayElementBase{Width: 10, Height: 10}},
		Name:                state.NameElement{OverlayElementBase: state.OverlayElementBase{Width: 10, Height: 10}},
		Title:               state.TitleElement{OverlayElementBase: state.OverlayElementBase{Width: 10, Height: 10}},
		Counter:             state.CounterElement{OverlayElementBase: state.OverlayElementBase{Width: 10, Height: 10}},
	}
	// First save successfully.
	err = saveOverlay(tx, ov, "global", "default")
	if err != nil {
		t.Fatalf("initial saveOverlay: %v", err)
	}

	// Now drop text_styles and gradient_stops, then try again.
	_, _ = tx.Exec(`DROP TABLE gradient_stops`)
	_, _ = tx.Exec(`DROP TABLE text_styles`)
	err = saveOverlay(tx, ov, "global", "default")
	if err == nil {
		t.Error("saveOverlay should fail when text_styles is dropped")
	}
}

func TestSaveTextStyleGradientStopError(t *testing.T) {
	d := openInternalTestDB(t)
	tx, err := d.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()

	// Create overlay and element to satisfy foreign keys.
	_, _ = tx.Exec(`INSERT INTO overlay_settings (id, owner_type, owner_id) VALUES (1, 'global', 'default')`)
	_, _ = tx.Exec(`INSERT INTO overlay_elements (id, overlay_id, element_type) VALUES (1, 1, 'name')`)

	// Drop gradient_stops to trigger error.
	_, _ = tx.Exec(`DROP TABLE gradient_stops`)
	style := &state.TextStyle{
		FontFamily:    "test",
		GradientStops: []state.GradientStop{{Color: "#fff", Position: 0}},
	}
	err = saveTextStyle(tx, 1, "main", style)
	if err == nil {
		t.Error("saveTextStyle should fail when gradient_stops is dropped")
	}
}

// ---------------------------------------------------------------------------
// saveTemplateRegions - new template path error
// ---------------------------------------------------------------------------

func TestSaveTemplateRegionsNewTemplateError(t *testing.T) {
	d := openInternalTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	// Save state with a new template (ImageData set, TemplateDBID=0).
	st := &state.AppState{
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Test", CreatedAt: now, OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Enabled: true, SourceType: "test",
					Templates: []state.DetectorTemplate{
						{ImageData: []byte{1, 2}, Regions: []state.MatchedRegion{{Type: "image", Rect: state.DetectorRect{X: 1, Y: 2, W: 3, H: 4}}}},
					},
					DetectionLog: []state.DetectionLogEntry{},
				}},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}

	// This should succeed and cover the new-template region insertion path.
	if err := d.SaveFullState(st); err != nil {
		t.Fatalf("SaveFullState: %v", err)
	}

	// Verify regions were saved by loading.
	loaded, err := d.LoadFullState()
	if err != nil {
		t.Fatalf("LoadFullState: %v", err)
	}
	dc := loaded.Pokemon[0].DetectorConfig
	if dc == nil || len(dc.Templates) == 0 {
		t.Fatal("expected templates")
	}
	if len(dc.Templates[0].Regions) != 1 {
		t.Errorf("Regions len = %d, want 1", len(dc.Templates[0].Regions))
	}
}

// ---------------------------------------------------------------------------
// saveDetectorTemplates - update existing template sort_order
// ---------------------------------------------------------------------------

func TestSaveDetectorTemplatesUpdateExisting(t *testing.T) {
	d := openInternalTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	// Save initial state with a template.
	st := &state.AppState{
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Test", CreatedAt: now, OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Enabled: true, SourceType: "test",
					Templates:    []state.DetectorTemplate{{ImageData: []byte{1, 2}, Regions: []state.MatchedRegion{}}},
					DetectionLog: []state.DetectionLogEntry{},
				}},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
	if err := d.SaveFullState(st); err != nil {
		t.Fatalf("SaveFullState: %v", err)
	}

	// Load to get template DB ID.
	loaded, err := d.LoadFullState()
	if err != nil {
		t.Fatalf("LoadFullState: %v", err)
	}
	tmplID := loaded.Pokemon[0].DetectorConfig.Templates[0].TemplateDBID

	// Save again with the existing template (TemplateDBID set) - covers update path.
	st.Pokemon[0].DetectorConfig.Templates = []state.DetectorTemplate{
		{TemplateDBID: tmplID, Regions: []state.MatchedRegion{{Type: "image", Rect: state.DetectorRect{X: 5, Y: 6, W: 7, H: 8}}}},
	}
	if err := d.SaveFullState(st); err != nil {
		t.Fatalf("SaveFullState (update): %v", err)
	}

	// Verify regions updated.
	loaded2, err := d.LoadFullState()
	if err != nil {
		t.Fatalf("LoadFullState: %v", err)
	}
	regions := loaded2.Pokemon[0].DetectorConfig.Templates[0].Regions
	if len(regions) != 1 || regions[0].Rect.X != 5 {
		t.Errorf("expected updated region, got %+v", regions)
	}
}

// ---------------------------------------------------------------------------
// Per-pokemon overlay delete when switching to default
// ---------------------------------------------------------------------------

func TestSaveFullStatePokemonOverlayDeleteOnDefault(t *testing.T) {
	d := openInternalTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	customOv := state.OverlaySettings{BackgroundAnimation: "none", CanvasWidth: 500, CanvasHeight: 200}
	st := &state.AppState{
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Test", CreatedAt: now, OverlayMode: "custom", Overlay: &customOv},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
	_ = d.SaveFullState(st)

	// Switch to default overlay.
	st.Pokemon[0].OverlayMode = "default"
	st.Pokemon[0].Overlay = nil
	if err := d.SaveFullState(st); err != nil {
		t.Fatalf("SaveFullState: %v", err)
	}

	loaded, err := d.LoadFullState()
	if err != nil {
		t.Fatalf("LoadFullState: %v", err)
	}
	if loaded.Pokemon[0].Overlay != nil {
		t.Error("overlay should be nil after switching to default")
	}
}

// ---------------------------------------------------------------------------
// DetectorConfig nil deletion path (delete config row)
// ---------------------------------------------------------------------------

func TestSaveFullStateDetectorConfigDeleteOnNil(t *testing.T) {
	d := openInternalTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	st := &state.AppState{
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Test", CreatedAt: now, OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Enabled: true, SourceType: "test",
					Templates: []state.DetectorTemplate{}, DetectionLog: []state.DetectionLogEntry{},
				}},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
	_ = d.SaveFullState(st)

	// Remove detector config.
	st.Pokemon[0].DetectorConfig = nil
	if err := d.SaveFullState(st); err != nil {
		t.Fatalf("SaveFullState: %v", err)
	}

	loaded, err := d.LoadFullState()
	if err != nil {
		t.Fatalf("LoadFullState: %v", err)
	}
	if loaded.Pokemon[0].DetectorConfig != nil {
		t.Error("DetectorConfig should be nil after removal")
	}
}

// ---------------------------------------------------------------------------
// Legacy methods error paths
// ---------------------------------------------------------------------------

func TestLogEncounterError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE encounter_events`)
	err := d.LogEncounter("p1", "Test", 1, 1, "manual")
	if err == nil {
		t.Error("expected error when encounter_events is dropped")
	}
}

func TestGetEncounterHistoryError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE encounter_events`)
	_, err := d.GetEncounterHistory("p1", 10, 0)
	if err == nil {
		t.Error("expected error when encounter_events is dropped")
	}
}

func TestGetEncounterStatsError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE encounter_events`)
	_, err := d.GetEncounterStats("p1")
	if err == nil {
		t.Error("expected error when encounter_events is dropped")
	}
}

func TestGetChartDataError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE encounter_events`)
	_, err := d.GetChartData("p1", "day")
	if err == nil {
		t.Error("expected error when encounter_events is dropped")
	}
}

func TestStartTimerSessionError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE timer_sessions`)
	_, err := d.StartTimerSession("p1")
	if err == nil {
		t.Error("expected error when timer_sessions is dropped")
	}
}

func TestGetTimerSessionsError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE timer_sessions`)
	_, err := d.GetTimerSessions("p1")
	if err == nil {
		t.Error("expected error when timer_sessions is dropped")
	}
}

func TestSaveGamesError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE game_names`)
	_, _ = d.db.Exec(`DROP TABLE games`)
	err := d.SaveGames([]GameRow{{Key: "test", NamesJSON: []byte("{}"), Generation: 1, Platform: "gb"}})
	if err == nil {
		t.Error("expected error when games table is dropped")
	}
}

func TestLoadGamesError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE game_names`)
	_, _ = d.db.Exec(`DROP TABLE games`)
	_, err := d.LoadGames()
	if err == nil {
		t.Error("expected error when games table is dropped")
	}
}

func TestLoadAppStateError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE app_state`)
	_, err := d.LoadAppState()
	if err == nil {
		t.Error("expected error when app_state table is dropped")
	}
}

func TestSaveAppStateError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE app_state`)
	err := d.SaveAppState([]byte(`{}`))
	if err == nil {
		t.Error("expected error when app_state table is dropped")
	}
}

func TestEndTimerSessionError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE timer_sessions`)
	err := d.EndTimerSession(1, 0)
	if err == nil {
		t.Error("expected error when timer_sessions is dropped")
	}
}

func TestSaveTemplateImageError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE template_regions`)
	_, _ = d.db.Exec(`DROP TABLE detector_templates`)
	_, err := d.SaveTemplateImage("p1", []byte{1}, 0)
	if err == nil {
		t.Error("expected error when detector_templates is dropped")
	}
}

func TestDeleteTemplateImageError(t *testing.T) {
	d := openInternalTestDB(t)
	_, _ = d.db.Exec(`DROP TABLE template_regions`)
	_, _ = d.db.Exec(`DROP TABLE detector_templates`)
	err := d.DeleteTemplateImage(1)
	if err == nil {
		t.Error("expected error when detector_templates is dropped")
	}
}

// ---------------------------------------------------------------------------
// Migrate error paths
// ---------------------------------------------------------------------------

func TestMigrateErrorLegacy(t *testing.T) {
	// Create a DB, then corrupt it by making a table with conflicting schema.
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")
	sqlDB, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	// Create encounter_events as a VIEW instead of TABLE to cause migration error.
	_, _ = sqlDB.Exec(`CREATE VIEW encounter_events AS SELECT 1`)
	_ = sqlDB.Close()

	_, err = Open(path)
	if err == nil {
		t.Error("Open should fail with conflicting schema")
	}
}

// ---------------------------------------------------------------------------
// GetChartData interval variants
// ---------------------------------------------------------------------------

func TestGetChartDataHourInterval(t *testing.T) {
	d := openInternalTestDB(t)
	_ = d.LogEncounter("p1", "Test", 1, 1, "manual")
	points, err := d.GetChartData("p1", "hour")
	if err != nil {
		t.Fatalf("GetChartData(hour): %v", err)
	}
	if len(points) != 1 {
		t.Errorf("points len = %d, want 1", len(points))
	}
}

func TestGetChartDataWeekInterval(t *testing.T) {
	d := openInternalTestDB(t)
	_ = d.LogEncounter("p1", "Test", 1, 1, "manual")
	points, err := d.GetChartData("p1", "week")
	if err != nil {
		t.Fatalf("GetChartData(week): %v", err)
	}
	if len(points) != 1 {
		t.Errorf("points len = %d, want 1", len(points))
	}
}

// ---------------------------------------------------------------------------
// GetEncounterStats rate calculation edge case (first == last)
// ---------------------------------------------------------------------------

func TestGetEncounterStatsNoRate(t *testing.T) {
	d := openInternalTestDB(t)
	// Single encounter means first == last, so rate should be 0.
	_ = d.LogEncounter("p1", "Test", 1, 1, "manual")
	stats, err := d.GetEncounterStats("p1")
	if err != nil {
		t.Fatalf("GetEncounterStats: %v", err)
	}
	if stats.Total != 1 {
		t.Errorf("Total = %d, want 1", stats.Total)
	}
	if stats.RatePerHour != 0 {
		t.Errorf("RatePerHour = %f, want 0", stats.RatePerHour)
	}
}

// ---------------------------------------------------------------------------
// SaveGames transaction error path
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// loadDetectorTemplates error: templates exist but regions table dropped
// ---------------------------------------------------------------------------

func TestLoadDetectorTemplatesRegionError(t *testing.T) {
	d := openInternalTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	st := &state.AppState{
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Test", CreatedAt: now, OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Enabled: true, SourceType: "test",
					Templates:    []state.DetectorTemplate{{ImageData: []byte{1}, Regions: []state.MatchedRegion{}}},
					DetectionLog: []state.DetectionLogEntry{},
				}},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
	_ = d.SaveFullState(st)
	// Drop template_regions so loadTemplateRegions fails.
	_, _ = d.db.Exec(`DROP TABLE template_regions`)
	_, err := loadDetectorTemplates(d.db, "p1")
	if err == nil {
		t.Error("loadDetectorTemplates should fail when template_regions is dropped")
	}
}

// ---------------------------------------------------------------------------
// loadOverlay: title and counter text style errors
// ---------------------------------------------------------------------------

func TestLoadOverlayTitleStyleError(t *testing.T) {
	d := openInternalTestDB(t)
	// Save state with overlay, then corrupt text_styles to only keep name style.
	st := &state.AppState{
		Pokemon: []state.Pokemon{}, Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{
			BackgroundAnimation: "none",
			Sprite:              state.SpriteElement{OverlayElementBase: state.OverlayElementBase{Width: 100, Height: 100}},
			Name:                state.NameElement{OverlayElementBase: state.OverlayElementBase{Width: 100, Height: 30}},
			Title:               state.TitleElement{OverlayElementBase: state.OverlayElementBase{Width: 100, Height: 30}},
			Counter:             state.CounterElement{OverlayElementBase: state.OverlayElementBase{Width: 100, Height: 30}},
		}},
	}
	_ = d.SaveFullState(st)
	// Now drop gradient_stops and text_styles to trigger error on title/counter.
	_, _ = d.db.Exec(`DROP TABLE gradient_stops`)
	_, _ = d.db.Exec(`DROP TABLE text_styles`)
	_, err := loadOverlay(d.db, "global", "default")
	if err == nil {
		t.Error("loadOverlay should fail when text_styles is dropped")
	}
}

// ---------------------------------------------------------------------------
// saveOverlay deeper error paths: get overlay_settings id error
// ---------------------------------------------------------------------------

func TestSaveOverlayGetIDError(t *testing.T) {
	d := openInternalTestDB(t)
	tx, err := d.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()

	// Drop overlay_settings entirely, then try to insert (will fail on the upsert).
	_, _ = tx.Exec(`DROP TABLE gradient_stops`)
	_, _ = tx.Exec(`DROP TABLE text_styles`)
	_, _ = tx.Exec(`DROP TABLE overlay_elements`)
	_, _ = tx.Exec(`DROP TABLE overlay_settings`)
	ov := &state.OverlaySettings{BackgroundAnimation: "none"}
	err = saveOverlay(tx, ov, "global", "default")
	if err == nil {
		t.Error("saveOverlay should fail when overlay_settings is dropped")
	}
}

// ---------------------------------------------------------------------------
// saveOverlay: delete overlay_elements error
// ---------------------------------------------------------------------------

func TestSaveOverlayDeleteElementsError(t *testing.T) {
	d := openInternalTestDB(t)
	tx, err := d.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()

	// Insert overlay_settings row.
	_, _ = tx.Exec(`INSERT INTO overlay_settings (owner_type, owner_id) VALUES ('global', 'default')`)
	// Drop overlay_elements.
	_, _ = tx.Exec(`DROP TABLE text_styles`)
	_, _ = tx.Exec(`DROP TABLE overlay_elements`)

	ov := &state.OverlaySettings{BackgroundAnimation: "none"}
	err = saveOverlay(tx, ov, "global", "default")
	if err == nil {
		t.Error("saveOverlay should fail when overlay_elements is dropped")
	}
}

// ---------------------------------------------------------------------------
// SaveFullState: per-pokemon overlay delete error and overlay save error
// ---------------------------------------------------------------------------

func TestSaveFullStatePokemonOverlayDeleteError(t *testing.T) {
	d := openInternalTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	customOv := state.OverlaySettings{BackgroundAnimation: "none", CanvasWidth: 100, CanvasHeight: 100}
	st := &state.AppState{
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Test", CreatedAt: now, OverlayMode: "custom", Overlay: &customOv},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
	_ = d.SaveFullState(st)

	// Switch to default and drop overlay_settings so the delete fails.
	// But we can't easily make the delete fail on existing table.
	// Instead, test the per-pokemon overlay save error path:
	// Drop gradient_stops/text_styles so overlay save fails for pokemon.
	st.Pokemon[0].OverlayMode = "custom"
	_, _ = d.db.Exec(`DROP TABLE gradient_stops`)
	_, _ = d.db.Exec(`DROP TABLE text_styles`)
	_, _ = d.db.Exec(`DROP TABLE overlay_elements`)
	_, _ = d.db.Exec(`DROP TABLE overlay_settings`)
	err := d.SaveFullState(st)
	if err == nil {
		t.Error("expected error when overlay tables are dropped for per-pokemon save")
	}
}

// ---------------------------------------------------------------------------
// SaveFullState: detector_configs delete error when no pokemon
// ---------------------------------------------------------------------------

func TestSaveFullStateDetectorConfigsDeleteError(t *testing.T) {
	d := openInternalTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	st := &state.AppState{
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Test", CreatedAt: now, OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Templates: []state.DetectorTemplate{}, DetectionLog: []state.DetectionLogEntry{},
				}},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
	_ = d.SaveFullState(st)

	// Now remove the pokemon and drop detector_configs to trigger delete error.
	st.Pokemon = nil
	_, _ = d.db.Exec(`DROP TABLE template_regions`)
	_, _ = d.db.Exec(`DROP TABLE detection_log`)
	_, _ = d.db.Exec(`DROP TABLE detector_templates`)
	_, _ = d.db.Exec(`DROP TABLE detector_configs`)
	err := d.SaveFullState(st)
	if err == nil {
		t.Error("expected error when detector_configs is dropped for delete")
	}
}

// ---------------------------------------------------------------------------
// saveDetectorTemplates: cleanup path (query existing IDs)
// ---------------------------------------------------------------------------

func TestSaveDetectorTemplatesCleanup(t *testing.T) {
	d := openInternalTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	// Save with 2 templates.
	st := &state.AppState{
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Test", CreatedAt: now, OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Enabled: true, SourceType: "test",
					Templates: []state.DetectorTemplate{
						{ImageData: []byte{1}, Regions: []state.MatchedRegion{}},
						{ImageData: []byte{2}, Regions: []state.MatchedRegion{}},
					},
					DetectionLog: []state.DetectionLogEntry{},
				}},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
	_ = d.SaveFullState(st)

	// Load to get IDs.
	loaded, _ := d.LoadFullState()
	id1 := loaded.Pokemon[0].DetectorConfig.Templates[0].TemplateDBID

	// Save again with only 1 template (should delete the other).
	st.Pokemon[0].DetectorConfig.Templates = []state.DetectorTemplate{
		{TemplateDBID: id1, Regions: []state.MatchedRegion{}},
	}
	if err := d.SaveFullState(st); err != nil {
		t.Fatalf("SaveFullState: %v", err)
	}

	// Verify only 1 template remains.
	loaded2, _ := d.LoadFullState()
	if len(loaded2.Pokemon[0].DetectorConfig.Templates) != 1 {
		t.Errorf("templates len = %d, want 1", len(loaded2.Pokemon[0].DetectorConfig.Templates))
	}
}

// ---------------------------------------------------------------------------
// saveDetectionLogs: delete orphan path
// ---------------------------------------------------------------------------

func TestSaveDetectionLogsOrphanDelete(t *testing.T) {
	d := openInternalTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	st := &state.AppState{
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Test", CreatedAt: now, OverlayMode: "default",
				DetectorConfig: &state.DetectorConfig{
					Enabled: true, SourceType: "test",
					Templates:    []state.DetectorTemplate{},
					DetectionLog: []state.DetectionLogEntry{{At: now, Confidence: 0.5}},
				}},
		},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{}, Overlay: state.OverlaySettings{BackgroundAnimation: "none"}},
	}
	_ = d.SaveFullState(st)

	// Remove detector config → detection logs should be cleaned up.
	st.Pokemon[0].DetectorConfig = nil
	if err := d.SaveFullState(st); err != nil {
		t.Fatalf("SaveFullState: %v", err)
	}
}

func TestSaveGamesTransactionPath(t *testing.T) {
	d := openInternalTestDB(t)
	// Normal save should work.
	rows := []GameRow{
		{Key: "red", NamesJSON: []byte(`{"en":"Red"}`), Generation: 1, Platform: "gb"},
		{Key: "blue", NamesJSON: []byte(`{"en":"Blue"}`), Generation: 1, Platform: "gb"},
	}
	if err := d.SaveGames(rows); err != nil {
		t.Fatalf("SaveGames: %v", err)
	}
	// Verify.
	loaded, err := d.LoadGames()
	if err != nil {
		t.Fatalf("LoadGames: %v", err)
	}
	if len(loaded) != 2 {
		t.Errorf("loaded len = %d, want 2", len(loaded))
	}
}
