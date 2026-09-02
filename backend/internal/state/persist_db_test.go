// persist_db_test.go exercises the database-backed Save/Load paths in the
// state package. It uses an external test package to avoid an import cycle
// between state and database. It also carries the legacy-overlay fixture that
// guards a stored layout against being rewritten by the load path, for both the
// database and the legacy JSON snapshot.
package state_test

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/state"
)

const (
	hotkeyCtrl1 = "Ctrl+1"
	hotkeyCtrl4 = "Ctrl+4"
	fmtSave     = "Save: %v"
	fmtLoad     = "Load: %v"
)

// openTestDB creates a fresh SQLite database in dir and registers cleanup.
func openTestDB(t *testing.T, dir string) *database.DB {
	t.Helper()
	db, err := database.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("database.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// makePokemon builds a minimal Pokemon value for testing.
func makePokemon(id, name string) state.Pokemon {
	return state.Pokemon{
		ID:        id,
		Name:      name,
		CreatedAt: time.Now(),
	}
}

// TestSaveAndLoadWithDB verifies that Save persists state to the normalized DB
// and Load reconstructs it faithfully in a fresh Manager.
func TestSaveAndLoadWithDB(t *testing.T) {
	dbDir := t.TempDir()
	db := openTestDB(t, dbDir)

	m := state.NewManager(t.TempDir())
	m.SetDB(db)

	m.AddPokemon(makePokemon("pk1", "Ralts"))
	m.AddPokemon(makePokemon("pk2", "Eevee"))
	m.Increment("pk1")
	m.Increment("pk1")
	m.Increment("pk1")
	m.SetActive("pk2")
	m.UpdateSettings(state.Settings{
		OutputEnabled: true,
		OutputDir:     "/custom/out",
		AutoSave:      true,
		Languages:     []string{"en", "ja"},
		CrispSprites:  true,
	})
	m.UpdateHotkeys(state.HotkeyMap{
		Increment:   hotkeyCtrl1,
		Decrement:   "Ctrl+2",
		Reset:       "Ctrl+3",
		NextPokemon: hotkeyCtrl4,
	})

	if err := m.Save(); err != nil {
		t.Fatalf(fmtSave, err)
	}

	// Load into a completely new Manager wired to the same DB.
	m2 := state.NewManager(t.TempDir())
	m2.SetDB(db)
	if err := m2.Load(); err != nil {
		t.Fatalf(fmtLoad, err)
	}

	st := m2.GetState()

	if st.ActiveID != "pk2" {
		t.Errorf("ActiveID = %q, want %q", st.ActiveID, "pk2")
	}
	if len(st.Pokemon) != 2 {
		t.Fatalf("Pokemon count = %d, want 2", len(st.Pokemon))
	}
	if st.Pokemon[0].Name != "Ralts" {
		t.Errorf("Pokemon[0].Name = %q, want %q", st.Pokemon[0].Name, "Ralts")
	}
	if st.Pokemon[0].Encounters != 3 {
		t.Errorf("Pokemon[0].Encounters = %d, want 3", st.Pokemon[0].Encounters)
	}
	if st.Pokemon[1].Name != "Eevee" {
		t.Errorf("Pokemon[1].Name = %q, want %q", st.Pokemon[1].Name, "Eevee")
	}
	if !st.Settings.OutputEnabled {
		t.Error("OutputEnabled should be true")
	}
	if st.Hotkeys.Increment != hotkeyCtrl1 {
		t.Errorf("Hotkeys.Increment = %q, want %q", st.Hotkeys.Increment, hotkeyCtrl1)
	}
	if st.Hotkeys.NextPokemon != hotkeyCtrl4 {
		t.Errorf("Hotkeys.NextPokemon = %q, want %q", st.Hotkeys.NextPokemon, hotkeyCtrl4)
	}
	if len(st.Settings.Languages) != 2 || st.Settings.Languages[0] != "en" || st.Settings.Languages[1] != "ja" {
		t.Errorf("Languages = %v, want [en ja]", st.Settings.Languages)
	}
}

// TestLoadPrefersDBOverJSON ensures that when both a JSON file and a DB with
// normalized state exist, the DB version takes precedence.
func TestLoadPrefersDBOverJSON(t *testing.T) {
	configDir := t.TempDir()

	// Step 1: Write JSON state to disk (no DB).
	jsonMgr := state.NewManager(configDir)
	jsonMgr.AddPokemon(makePokemon("json1", "Bulbasaur"))
	if err := jsonMgr.Save(); err != nil {
		t.Fatalf("JSON Save: %v", err)
	}

	// Step 2: Create a DB and save different state.
	db := openTestDB(t, configDir)
	dbMgr := state.NewManager(configDir)
	dbMgr.SetDB(db)
	dbMgr.AddPokemon(makePokemon("db1", "Charmander"))
	if err := dbMgr.Save(); err != nil {
		t.Fatalf("DB Save: %v", err)
	}

	// Step 3: Load with DB wired, should get DB version.
	loadMgr := state.NewManager(configDir)
	loadMgr.SetDB(db)
	if err := loadMgr.Load(); err != nil {
		t.Fatalf(fmtLoad, err)
	}

	st := loadMgr.GetState()
	if len(st.Pokemon) != 1 {
		t.Fatalf("Pokemon count = %d, want 1", len(st.Pokemon))
	}
	if st.Pokemon[0].Name != "Charmander" {
		t.Errorf("Pokemon[0].Name = %q, want %q (DB version)", st.Pokemon[0].Name, "Charmander")
	}
}

// TestReloadNotifiesListeners verifies that Reload triggers OnChange callbacks.
func TestReloadNotifiesListeners(t *testing.T) {
	dbDir := t.TempDir()
	db := openTestDB(t, dbDir)

	m := state.NewManager(t.TempDir())
	m.SetDB(db)
	m.AddPokemon(makePokemon("r1", "Gengar"))

	if err := m.Save(); err != nil {
		t.Fatalf(fmtSave, err)
	}

	var called atomic.Int32
	m.OnChange(func(_ state.AppState) {
		called.Add(1)
	})
	m.StartNotifier()
	defer m.StopNotifier()

	if err := m.Reload(); err != nil {
		t.Fatalf("Reload: %v", err)
	}

	// Debounce coalescing (50 ms) plus callback goroutine dispatch time.
	time.Sleep(150 * time.Millisecond)

	if called.Load() == 0 {
		t.Error("OnChange listener was not called after Reload")
	}
}

// TestSaveAndLoadWithDBPreservesOverlayJSON ensures the JSON file on disk is
// NOT the source when a DB is present, even if the JSON file also exists.
// This is a complementary check to TestLoadPrefersDBOverJSON that also verifies
// the JSON file is left untouched by the DB-backed Save.
func TestSaveWithDBDoesNotWriteJSON(t *testing.T) {
	configDir := t.TempDir()
	db := openTestDB(t, configDir)

	m := state.NewManager(configDir)
	m.SetDB(db)
	m.AddPokemon(makePokemon("nj1", "Mudkip"))

	if err := m.Save(); err != nil {
		t.Fatalf(fmtSave, err)
	}

	// The JSON file should NOT exist because the DB path was used.
	jsonPath := filepath.Join(configDir, "state.json")
	if _, err := os.Stat(jsonPath); err == nil {
		t.Error("state.json should not be written when DB is wired")
	}
}

// ---------------------------------------------------------------------------
// Legacy overlay fixture
// ---------------------------------------------------------------------------

// Captions the fixture stores, in the German a pre-rework install wrote them.
// They must survive the load untouched: a caption belongs to its owner.
const (
	legacyCounterLabel = "Begegnungen"
	legacyTimerLabel   = "Zeit"
	legacyOddsLabel    = "Odds"
)

// legacyOverlayDDL is the overlay portion of the schema exactly as it shipped
// at migration version 30, before the overlay editor rework: overlay_elements
// still carries trigger_exit and none of the affix or cycling columns, and
// text_styles still carries the gradient drop shadow columns. It is copied from
// schema.go as of commit 3ef77c1~1 so the fixture reproduces a schema that
// really shipped rather than an invented one.
var legacyOverlayDDL = []string{
	`DROP TABLE gradient_stops`,
	`DROP TABLE text_styles`,
	`DROP TABLE overlay_elements`,
	`CREATE TABLE overlay_elements (
		id             INTEGER PRIMARY KEY AUTOINCREMENT,
		overlay_id     INTEGER NOT NULL,
		element_type   TEXT    NOT NULL,
		visible        INTEGER NOT NULL DEFAULT 1,
		x              INTEGER NOT NULL DEFAULT 0,
		y              INTEGER NOT NULL DEFAULT 0,
		width          INTEGER NOT NULL DEFAULT 0,
		height         INTEGER NOT NULL DEFAULT 0,
		z_index        INTEGER NOT NULL DEFAULT 0,
		show_glow      INTEGER,
		glow_color     TEXT,
		glow_opacity   REAL,
		glow_blur      INTEGER,
		idle_animation TEXT    NOT NULL DEFAULT 'none',
		trigger_enter     TEXT    NOT NULL DEFAULT 'none',
		trigger_exit      TEXT    NOT NULL DEFAULT '',
		trigger_decrement TEXT    NOT NULL DEFAULT 'none',
		show_label     INTEGER,
		label_text     TEXT,
		format         TEXT    NOT NULL DEFAULT '',
		UNIQUE(overlay_id, element_type),
		FOREIGN KEY (overlay_id) REFERENCES overlay_settings(id) ON DELETE CASCADE
	)`,
	`CREATE TABLE text_styles (
		id                         INTEGER PRIMARY KEY AUTOINCREMENT,
		element_id                 INTEGER NOT NULL,
		style_role                 TEXT    NOT NULL DEFAULT 'main',
		font_family                TEXT    NOT NULL DEFAULT 'sans',
		font_size                  INTEGER NOT NULL DEFAULT 16,
		font_weight                INTEGER NOT NULL DEFAULT 400,
		text_align                 TEXT    NOT NULL DEFAULT '',
		color_type                 TEXT    NOT NULL DEFAULT 'solid',
		color                      TEXT    NOT NULL DEFAULT '#ffffff',
		gradient_angle             INTEGER NOT NULL DEFAULT 0,
		outline_type               TEXT    NOT NULL DEFAULT 'none',
		outline_width              INTEGER NOT NULL DEFAULT 0,
		outline_color              TEXT    NOT NULL DEFAULT '#000000',
		outline_gradient_angle     INTEGER NOT NULL DEFAULT 0,
		text_shadow                INTEGER NOT NULL DEFAULT 0,
		text_shadow_color          TEXT    NOT NULL DEFAULT '',
		text_shadow_color_type     TEXT    NOT NULL DEFAULT 'solid',
		text_shadow_gradient_angle INTEGER NOT NULL DEFAULT 0,
		text_shadow_blur           INTEGER NOT NULL DEFAULT 0,
		text_shadow_x              INTEGER NOT NULL DEFAULT 0,
		text_shadow_y              INTEGER NOT NULL DEFAULT 0,
		UNIQUE(element_id, style_role),
		FOREIGN KEY (element_id) REFERENCES overlay_elements(id) ON DELETE CASCADE
	)`,
	`CREATE TABLE gradient_stops (
		id            INTEGER PRIMARY KEY AUTOINCREMENT,
		text_style_id INTEGER NOT NULL,
		gradient_type TEXT    NOT NULL,
		color         TEXT    NOT NULL,
		position      REAL    NOT NULL,
		sort_order    INTEGER NOT NULL DEFAULT 0,
		FOREIGN KEY (text_style_id) REFERENCES text_styles(id) ON DELETE CASCADE
	)`,
	`CREATE INDEX idx_elements_overlay ON overlay_elements(overlay_id)`,
	`CREATE INDEX idx_text_styles_element ON text_styles(element_id)`,
	`CREATE INDEX idx_gradient_stops_style ON gradient_stops(text_style_id)`,
	// Rewind the recorded version so the real migration path replays 31 to 37.
	`DELETE FROM migrations WHERE version > 30`,
}

// legacyOverlayData fills the rewound schema with the overlay a German user of
// the pre-rework release would have stored: an 800x200 global panel on the old
// default grid plus two per-Pokémon overlays, with a solid outline, a gradient
// fill, a gradient drop shadow, a solid drop shadow and a sprite that carries
// trigger_exit.
var legacyOverlayData = []string{
	`INSERT INTO app_config (id, active_id, license_accepted, updated_at)
		VALUES (1, 'pk1', 1, '')`,
	`INSERT INTO settings (id, output_enabled, output_dir, auto_save, crisp_sprites,
		accent_color, tutorial_overlay_editor, tutorial_auto_detection)
		VALUES (1, 0, '', 1, 1, 'violet', 1, 1)`,
	`INSERT INTO settings_languages (language, sort_order) VALUES ('de', 0), ('en', 1)`,
	`INSERT INTO hotkeys (id, increment, decrement, reset, next_pokemon, hunt_toggle)
		VALUES (1, 'F1', 'F2', 'F3', 'F4', '')`,
	`INSERT INTO pokemon (id, name, created_at, overlay_mode, sort_order) VALUES
		('pk1', 'Karpador', '2025-01-01T00:00:00Z', 'custom', 0),
		('pk2', 'Evoli',    '2025-01-02T00:00:00Z', 'custom', 1)`,

	`INSERT INTO overlay_settings (id, owner_type, owner_id, canvas_width, canvas_height,
		hidden, background_color, background_opacity, background_animation,
		background_animation_speed, background_animation_config, background_image,
		background_image_fit, blur, show_border, border_color, border_width, border_radius) VALUES
		(1, 'global',  'default', 800, 200, 0, '#ce5a41', 0.6,  'rb-galaxy',     1.5, '', '', '',  8, 1, 'rgba(255,255,255,0.1)', 2, 40),
		(2, 'pokemon', 'pk1',     640, 160, 0, '#101820', 0.75, 'rb-pixelblast', 2.0, '', '', '', 12, 1, '#334455',               3, 16),
		(3, 'pokemon', 'pk2',     800, 200, 0, '#000000', 0.6,  'waves',         0.0, '', '', '',  8, 0, '',                      0, 40)`,

	`INSERT INTO overlay_elements (id, overlay_id, element_type, visible, x, y, width, height,
		z_index, show_glow, glow_color, glow_opacity, glow_blur, idle_animation,
		trigger_enter, trigger_exit, trigger_decrement, show_label, label_text, format) VALUES
		(101, 1, 'sprite',  1,  10, 10, 180, 180, 1, 1, '#ffffff', 0.2, 42, 'none', 'bounce', 'fade-out', 'shake', NULL, NULL,            ''),
		(102, 1, 'name',    1, 200, 20, 300,  40, 2, NULL, NULL, NULL, NULL,  'none', 'none',   '',         'none',  NULL, NULL,            ''),
		(103, 1, 'title',   1, 200, 60, 300,  30, 4, NULL, NULL, NULL, NULL,  'none', 'none',   '',         'none',  NULL, NULL,            ''),
		(104, 1, 'counter', 1, 200, 80, 300, 100, 3, NULL, NULL, NULL, NULL,  'none', 'slot',   '',         'slot',  1,    'Begegnungen',   ''),
		(105, 1, 'timer',   1, 530, 20, 250,  40, 5, NULL, NULL, NULL, NULL,  'none', 'none',   '',         'none',  1,    'Zeit',          ''),
		(106, 1, 'odds',    0, 530, 70, 250,  50, 6, NULL, NULL, NULL, NULL,  'none', 'none',   '',         'none',  0,    'Odds',          'percent'),
		(201, 2, 'sprite',  1,   8,  8, 140, 140, 1, 0, '',        0.0,  0, 'float','bounce', 'fade-out', 'shake', NULL, NULL,            ''),
		(202, 2, 'name',    1, 160,  8, 470,  36, 2, NULL, NULL, NULL, NULL,  'none', 'none',   '',         'none',  NULL, NULL,            ''),
		(203, 2, 'counter', 1, 160, 50, 470,  90, 3, NULL, NULL, NULL, NULL,  'none', 'slot',   '',         'slot',  1,    'Begegnungen',   ''),
		(301, 3, 'sprite',  1,  10, 10, 180, 180, 1, 1, '#ffffff', 0.2, 42, 'none', 'bounce', '',         'shake', NULL, NULL,            ''),
		(302, 3, 'counter', 1, 200, 80, 300, 100, 3, NULL, NULL, NULL, NULL,  'none', 'slot',   '',         'slot',  0,    'Encounters',    '')`,

	`INSERT INTO text_styles (id, element_id, style_role, font_family, font_size, font_weight,
		text_align, color_type, color, gradient_angle, outline_type, outline_width, outline_color,
		outline_gradient_angle, text_shadow, text_shadow_color, text_shadow_color_type,
		text_shadow_gradient_angle, text_shadow_blur, text_shadow_x, text_shadow_y) VALUES
		(1001, 102, 'main',  'pokemon', 28, 700, '', 'solid',    '#ffffff',  0, 'solid',    4, '#000000',   0, 0, '',        'solid',    0, 0, 0, 0),
		(1002, 103, 'main',  'pokemon', 20, 700, '', 'solid',    '#ffffff',  0, 'none',     0, '#000000',   0, 0, '',        'solid',    0, 0, 0, 0),
		(1003, 104, 'main',  'pokemon', 80, 700, '', 'gradient', '#ffffff', 90, 'solid',    6, '#000000',   0, 0, '',        'solid',    0, 0, 0, 0),
		(1004, 104, 'label', 'sans',    14, 400, '', 'solid',    '#94a3b8',  0, 'none',     0, '#000000',   0, 0, '',        'solid',    0, 0, 0, 0),
		(1005, 105, 'main',  'pokemon', 24, 700, '', 'solid',    '#ffffff',  0, 'gradient', 3, '#000000', 135, 1, '#123456', 'gradient', 45, 6, 2, 3),
		(1006, 105, 'label', 'sans',    14, 400, '', 'solid',    '#94a3b8',  0, 'none',     0, '#000000',   0, 0, '',        'solid',    0, 0, 0, 0),
		(1007, 106, 'main',  'pokemon', 28, 700, '', 'solid',    '#ffffff',  0, 'solid',    3, '#000000',   0, 1, '#00ff00', 'solid',     0, 4, 1, 1),
		(1008, 106, 'label', 'sans',    14, 400, '', 'solid',    '#94a3b8',  0, 'none',     0, '#000000',   0, 0, '',        'solid',     0, 0, 0, 0),
		(2001, 202, 'main',  'pokemon', 22, 700, '', 'solid',    '#eeeeee',  0, 'none',     0, '#000000',   0, 0, '',        'solid',     0, 0, 0, 0),
		(2002, 203, 'main',  'pokemon', 64, 700, '', 'solid',    '#ffffff',  0, 'solid',    5, '#000000',   0, 1, '#aaaaaa', 'gradient', 90, 8, 0, 2),
		(2003, 203, 'label', 'sans',    12, 400, '', 'solid',    '#94a3b8',  0, 'none',     0, '#000000',   0, 0, '',        'solid',     0, 0, 0, 0),
		(3001, 302, 'main',  'sans',    40, 700, '', 'solid',    '#ffffff',  0, 'none',     0, '#000000',   0, 0, '',        'solid',     0, 0, 0, 0)`,

	`INSERT INTO gradient_stops (text_style_id, gradient_type, color, position, sort_order) VALUES
		(1003, 'color',   '#ff0000', 0.0, 0),
		(1003, 'color',   '#00ff00', 1.0, 1),
		(1005, 'outline', '#123123', 0.0, 0),
		(1005, 'outline', '#321321', 1.0, 1),
		(1005, 'shadow',  '#ff0000', 0.0, 0),
		(1005, 'shadow',  '#0000ff', 1.0, 1),
		(2002, 'shadow',  '#112233', 0.0, 0),
		(2002, 'shadow',  '#445566', 1.0, 1)`,
}

// buildLegacyOverlayDB writes a database that looks like a pre-rework install:
// the current schema is created first so every unrelated table exists, then the
// three overlay tables are rewound to their version-30 shape, the recorded
// migration version is rewound with them, and the legacy rows are inserted.
// Reopening the returned path replays migrations 31 to 37 for real.
func buildLegacyOverlayDB(t *testing.T, dir string) string {
	t.Helper()
	path := filepath.Join(dir, "legacy.db")

	db, err := database.Open(path)
	if err != nil {
		t.Fatalf("create schema: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close schema db: %v", err)
	}

	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open raw db: %v", err)
	}
	defer func() { _ = raw.Close() }()
	for _, stmt := range append(append([]string{}, legacyOverlayDDL...), legacyOverlayData...) {
		if _, err := raw.Exec(stmt); err != nil {
			t.Fatalf("exec fixture %.60q: %v", stmt, err)
		}
	}
	return path
}

// loadLegacyOverlayState opens the fixture through the normal application path
// (database.Open runs the migrations, Manager.Load runs the state migrations)
// and returns the resulting state.
func loadLegacyOverlayState(t *testing.T) (state.AppState, *state.Manager) {
	t.Helper()
	path := buildLegacyOverlayDB(t, t.TempDir())

	db, err := database.Open(path)
	if err != nil {
		t.Fatalf("reopen with migrations: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	m := state.NewManager(t.TempDir())
	m.SetDB(db)
	if err := m.Load(); err != nil {
		t.Fatalf(fmtLoad, err)
	}
	return m.GetState(), m
}

// diffOverlay reports every scalar field that differs between two overlays,
// keyed by its field path. It is the whole point of the fixture: the set of
// differences has to stay exactly what the rework intended.
func diffOverlay(before, after state.OverlaySettings) map[string]string {
	out := map[string]string{}
	diffValues("", reflect.ValueOf(before), reflect.ValueOf(after), out)
	return out
}

// diffValues walks two values of the same type and records the leaf mismatches
// into out, using dotted field paths. Embedded structs keep the parent path so
// a base coordinate reads as "Sprite.X" rather than "Sprite.OverlayElementBase.X".
func diffValues(path string, a, b reflect.Value, out map[string]string) {
	switch a.Kind() {
	case reflect.Struct:
		for i := range a.NumField() {
			field := a.Type().Field(i)
			sub := path
			if !field.Anonymous {
				sub = field.Name
				if path != "" {
					sub = path + "." + field.Name
				}
			}
			diffValues(sub, a.Field(i), b.Field(i), out)
		}
	case reflect.Slice:
		if a.Len() != b.Len() {
			out[path+".len"] = fmt.Sprintf("%d => %d", a.Len(), b.Len())
			return
		}
		for i := range a.Len() {
			diffValues(fmt.Sprintf("%s[%d]", path, i), a.Index(i), b.Index(i), out)
		}
	default:
		if !reflect.DeepEqual(a.Interface(), b.Interface()) {
			out[path] = fmt.Sprintf("%v => %v", a.Interface(), b.Interface())
		}
	}
}

// assertDiff compares an observed field diff against the expected one, ignoring
// the paths of elements the fixture never stored (those are checked separately
// by assertFilledHidden).
func assertDiff(t *testing.T, label string, got, want map[string]string, ignorePrefixes ...string) {
	t.Helper()
	filtered := map[string]string{}
	for path, change := range got {
		if hasAnyPrefix(path, ignorePrefixes) {
			continue
		}
		filtered[path] = change
	}
	for path, change := range filtered {
		if want[path] != change {
			t.Errorf("%s: unexpected rewrite of %s: %s", label, path, change)
		}
	}
	for path, change := range want {
		if filtered[path] != change {
			t.Errorf("%s: expected %s to change (%s), got %q", label, path, change, filtered[path])
		}
	}
}

// hasAnyPrefix reports whether path starts with one of the given prefixes.
func hasAnyPrefix(path string, prefixes []string) bool {
	for _, p := range prefixes {
		if strings.HasPrefix(path, p) {
			return true
		}
	}
	return false
}

// assertFilledHidden checks an element the stored overlay never had. Such an
// element must arrive hidden, sized, captioned in the user's language and fully
// inside the stored canvas, so it cannot appear on the stream on its own.
func assertFilledHidden(t *testing.T, label string, el state.LabeledTextElement, o state.OverlaySettings, wantLabel string) {
	t.Helper()
	if el.Visible {
		t.Errorf("%s: filled element is visible, it would appear on the stream unasked", label)
	}
	if el.Width <= 0 || el.Height <= 0 {
		t.Errorf("%s: filled element has no size (%dx%d)", label, el.Width, el.Height)
	}
	if el.X < 0 || el.Y < 0 || el.X+el.Width > o.CanvasWidth || el.Y+el.Height > o.CanvasHeight {
		t.Errorf("%s: filled element (%d,%d %dx%d) escapes the stored %dx%d canvas",
			label, el.X, el.Y, el.Width, el.Height, o.CanvasWidth, o.CanvasHeight)
	}
	if el.LabelText != wantLabel {
		t.Errorf("%s: LabelText = %q, want %q", label, el.LabelText, wantLabel)
	}
}

// legacyGlobalOverlay is the global overlay exactly as the fixture stores it.
func legacyGlobalOverlay() state.OverlaySettings {
	return state.OverlaySettings{
		CanvasWidth:              800,
		CanvasHeight:             200,
		BackgroundColor:          "#ce5a41",
		BackgroundOpacity:        0.6,
		BackgroundAnimation:      "rb-galaxy",
		BackgroundAnimationSpeed: 1.5,
		Blur:                     8,
		ShowBorder:               true,
		BorderColor:              "rgba(255,255,255,0.1)",
		BorderWidth:              2,
		BorderRadius:             40,
		Sprite: state.SpriteElement{
			OverlayElementBase: state.OverlayElementBase{Visible: true, X: 10, Y: 10, Width: 180, Height: 180, ZIndex: 1},
			ShowGlow:           true,
			GlowColor:          "#ffffff",
			GlowOpacity:        0.2,
			GlowBlur:           42,
			IdleAnimation:      "none",
			TriggerEnter:       "bounce",
			TriggerDecrement:   "shake",
		},
		Name: state.NameElement{
			OverlayElementBase: state.OverlayElementBase{Visible: true, X: 200, Y: 20, Width: 300, Height: 40, ZIndex: 2},
			Style: state.TextStyle{
				FontFamily: "pokemon", FontSize: 28, FontWeight: 700,
				ColorType: "solid", Color: "#ffffff",
				OutlineType: "solid", OutlineWidth: 4, OutlineColor: "#000000",
			},
			IdleAnimation: "none", TriggerEnter: "none", TriggerDecrement: "none",
		},
		Title: state.TitleElement{
			OverlayElementBase: state.OverlayElementBase{Visible: true, X: 200, Y: 60, Width: 300, Height: 30, ZIndex: 4},
			Style: state.TextStyle{
				FontFamily: "pokemon", FontSize: 20, FontWeight: 700,
				ColorType: "solid", Color: "#ffffff",
				OutlineType: "none", OutlineColor: "#000000",
			},
			IdleAnimation: "none", TriggerEnter: "none", TriggerDecrement: "none",
		},
		Counter: state.CounterElement{
			OverlayElementBase: state.OverlayElementBase{Visible: true, X: 200, Y: 80, Width: 300, Height: 100, ZIndex: 3},
			Style: state.TextStyle{
				FontFamily: "pokemon", FontSize: 80, FontWeight: 700,
				ColorType: "gradient", Color: "#ffffff", GradientAngle: 90,
				GradientStops: []state.GradientStop{{Color: "#ff0000", Position: 0}, {Color: "#00ff00", Position: 1}},
				OutlineType:   "solid", OutlineWidth: 6, OutlineColor: "#000000",
			},
			ShowLabel: true,
			LabelText: legacyCounterLabel,
			LabelStyle: state.TextStyle{
				FontFamily: "sans", FontSize: 14, FontWeight: 400,
				ColorType: "solid", Color: "#94a3b8",
				OutlineType: "none", OutlineColor: "#000000",
			},
			IdleAnimation: "none", TriggerEnter: "slot", TriggerDecrement: "slot",
		},
		Timer: state.TimerElement{
			OverlayElementBase: state.OverlayElementBase{Visible: true, X: 530, Y: 20, Width: 250, Height: 40, ZIndex: 5},
			Style: state.TextStyle{
				FontFamily: "pokemon", FontSize: 24, FontWeight: 700,
				ColorType: "solid", Color: "#ffffff",
				OutlineType: "gradient", OutlineWidth: 3, OutlineColor: "#000000",
				OutlineGradientStops: []state.GradientStop{{Color: "#123123", Position: 0}, {Color: "#321321", Position: 1}},
				OutlineGradientAngle: 135,
				TextShadow:           true, TextShadowColor: "#123456",
				TextShadowBlur: 6, TextShadowX: 2, TextShadowY: 3,
			},
			ShowLabel: true,
			LabelText: legacyTimerLabel,
			LabelStyle: state.TextStyle{
				FontFamily: "sans", FontSize: 14, FontWeight: 400,
				ColorType: "solid", Color: "#94a3b8",
				OutlineType: "none", OutlineColor: "#000000",
			},
			IdleAnimation: "none",
		},
		Odds: state.OddsElement{
			OverlayElementBase: state.OverlayElementBase{Visible: false, X: 530, Y: 70, Width: 250, Height: 50, ZIndex: 6},
			Style: state.TextStyle{
				FontFamily: "pokemon", FontSize: 28, FontWeight: 700,
				ColorType: "solid", Color: "#ffffff",
				OutlineType: "solid", OutlineWidth: 3, OutlineColor: "#000000",
				TextShadow: true, TextShadowColor: "#00ff00",
				TextShadowBlur: 4, TextShadowX: 1, TextShadowY: 1,
			},
			ShowLabel: false,
			LabelText: legacyOddsLabel,
			LabelStyle: state.TextStyle{
				FontFamily: "sans", FontSize: 14, FontWeight: 400,
				ColorType: "solid", Color: "#94a3b8",
				OutlineType: "none", OutlineColor: "#000000",
			},
			Format:        "percent",
			IdleAnimation: "none", TriggerEnter: "none", TriggerDecrement: "none",
		},
	}
}

// legacyPokemonOverlay is the custom overlay of pk1 exactly as the fixture
// stores it: a smaller canvas than the default layout is authored for, so every
// filled element has to be clamped back inside it.
func legacyPokemonOverlay() state.OverlaySettings {
	return state.OverlaySettings{
		CanvasWidth:              640,
		CanvasHeight:             160,
		BackgroundColor:          "#101820",
		BackgroundOpacity:        0.75,
		BackgroundAnimation:      "rb-pixelblast",
		BackgroundAnimationSpeed: 2,
		Blur:                     12,
		ShowBorder:               true,
		BorderColor:              "#334455",
		BorderWidth:              3,
		BorderRadius:             16,
		Sprite: state.SpriteElement{
			OverlayElementBase: state.OverlayElementBase{Visible: true, X: 8, Y: 8, Width: 140, Height: 140, ZIndex: 1},
			IdleAnimation:      "float",
			TriggerEnter:       "bounce",
			TriggerDecrement:   "shake",
		},
		Name: state.NameElement{
			OverlayElementBase: state.OverlayElementBase{Visible: true, X: 160, Y: 8, Width: 470, Height: 36, ZIndex: 2},
			Style: state.TextStyle{
				FontFamily: "pokemon", FontSize: 22, FontWeight: 700,
				ColorType: "solid", Color: "#eeeeee",
				OutlineType: "none", OutlineColor: "#000000",
			},
			IdleAnimation: "none", TriggerEnter: "none", TriggerDecrement: "none",
		},
		Counter: state.CounterElement{
			OverlayElementBase: state.OverlayElementBase{Visible: true, X: 160, Y: 50, Width: 470, Height: 90, ZIndex: 3},
			Style: state.TextStyle{
				FontFamily: "pokemon", FontSize: 64, FontWeight: 700,
				ColorType: "solid", Color: "#ffffff",
				OutlineType: "solid", OutlineWidth: 5, OutlineColor: "#000000",
				TextShadow: true, TextShadowColor: "#aaaaaa",
				TextShadowBlur: 8, TextShadowX: 0, TextShadowY: 2,
			},
			ShowLabel: true,
			LabelText: legacyCounterLabel,
			LabelStyle: state.TextStyle{
				FontFamily: "sans", FontSize: 12, FontWeight: 400,
				ColorType: "solid", Color: "#94a3b8",
				OutlineType: "none", OutlineColor: "#000000",
			},
			IdleAnimation: "none", TriggerEnter: "slot", TriggerDecrement: "slot",
		},
	}
}

// filledPaths are the field paths of elements the fixture never stored. They are
// asserted by assertFilledHidden instead of by the diff, so an intentional
// change to the default layout does not fail the test for the wrong reason.
var filledPaths = []string{"Phase.", "TotalCounter.", "TotalTimer."}

// TestLegacyDatabaseOverlaySurvivesRework runs a pre-rework database through the
// real migration and load path and pins the complete set of changes a stored
// layout undergoes. Only the removed background animation, the folded gradient
// shadow and the two never-stored sprite cycling defaults may differ; canvas
// size, coordinates, z-indices, captions and styles must come back untouched.
func TestLegacyDatabaseOverlaySurvivesRework(t *testing.T) {
	st, m := loadLegacyOverlayState(t)

	global := st.Settings.Overlay
	assertDiff(t, "global", diffOverlay(legacyGlobalOverlay(), global), map[string]string{
		// The WebGL renderer is gone, so a stored WebGL animation has to become
		// something the CSS renderer can paint.
		"BackgroundAnimation": "rb-galaxy => waves",
		// CSS text-shadow never painted a gradient; the old renderer drew the
		// first stop and that is the colour the style keeps.
		"Timer.Style.TextShadowColor": "#123456 => #ff0000",
		// Never stored before the cycling settings existed.
		"Sprite.CycleIntervalMs": "0 => 3000",
		"Sprite.CycleTransition": " => fade",
	}, filledPaths...)

	assertFilledHidden(t, "global.Phase", global.Phase, global, "PHASE")
	assertFilledHidden(t, "global.TotalCounter", global.TotalCounter, global, "ENCOUNTER GESAMT")
	assertFilledHidden(t, "global.TotalTimer", global.TotalTimer, global, "ZEIT GESAMT")

	custom := findPokemonOverlay(t, st, "pk1")
	assertDiff(t, "pk1", diffOverlay(legacyPokemonOverlay(), *custom), map[string]string{
		"BackgroundAnimation":           "rb-pixelblast => waves",
		"Counter.Style.TextShadowColor": "#aaaaaa => #112233",
		"Sprite.CycleIntervalMs":        "0 => 3000",
		"Sprite.CycleTransition":        " => fade",
	}, append([]string{"Title.", "Timer.", "Odds."}, filledPaths...)...)

	assertFilledHidden(t, "pk1.Phase", custom.Phase, *custom, "PHASE")
	assertFilledHidden(t, "pk1.TotalCounter", custom.TotalCounter, *custom, "ENCOUNTER GESAMT")
	assertFilledHidden(t, "pk1.TotalTimer", custom.TotalTimer, *custom, "ZEIT GESAMT")
	assertFilledBase(t, "pk1.Title", custom.Title.OverlayElementBase, *custom)
	assertFilledBase(t, "pk1.Timer", custom.Timer.OverlayElementBase, *custom)
	assertFilledBase(t, "pk1.Odds", custom.Odds.OverlayElementBase, *custom)
	if custom.Timer.LabelText != "ZEIT" {
		t.Errorf("pk1.Timer.LabelText = %q, want the German default caption", custom.Timer.LabelText)
	}

	// A background animation that still exists must be left alone.
	control := findPokemonOverlay(t, st, "pk2")
	if control.BackgroundAnimation != "waves" {
		t.Errorf("pk2.BackgroundAnimation = %q, want waves (unchanged)", control.BackgroundAnimation)
	}
	if control.CanvasWidth != 800 || control.CanvasHeight != 200 {
		t.Errorf("pk2 canvas = %dx%d, want 800x200", control.CanvasWidth, control.CanvasHeight)
	}

	// The first save after the upgrade writes the migrated overlay back through
	// the new schema. Nothing may be dropped on the way out and back in.
	if err := m.Save(); err != nil {
		t.Fatalf(fmtSave, err)
	}
	if err := m.Load(); err != nil {
		t.Fatalf(fmtLoad, err)
	}
	round := m.GetState()
	assertDiff(t, "global round trip", diffOverlay(global, round.Settings.Overlay), map[string]string{})
	assertDiff(t, "pk1 round trip", diffOverlay(*custom, *findPokemonOverlay(t, round, "pk1")), map[string]string{})

	assertLegacyCatchMetaUpgrade(t, m, round)
}

// assertLegacyCatchMetaUpgrade pins the catch-metadata upgrade of the same
// fixture: every row predating the feature loads without a record, and adding
// one to a legacy entry survives the next save/load cycle without disturbing
// the rest of the row.
func assertLegacyCatchMetaUpgrade(t *testing.T, m *state.Manager, loaded state.AppState) {
	t.Helper()
	for _, p := range loaded.Pokemon {
		if p.Catch != nil {
			t.Errorf("legacy pokemon %s loaded with catch metadata %+v, want none", p.ID, p.Catch)
		}
	}

	before := findLegacyPokemon(t, loaded, "pk1")
	level := 100
	if !m.SetCatchMeta("pk1", &state.CatchMeta{
		Location: "Route 210",
		Nature:   "adamant",
		Ball:     "premier-ball",
		Level:    &level,
		// Zero must stay zero, not collapse into "never recorded".
		HP:      new(int),
		Ribbons: []string{"effort-ribbon"},
	}, "", "", nil) {
		t.Fatal("SetCatchMeta on the legacy entry = false, want true")
	}
	if err := m.Save(); err != nil {
		t.Fatalf(fmtSave, err)
	}
	if err := m.Load(); err != nil {
		t.Fatalf(fmtLoad, err)
	}

	after := findLegacyPokemon(t, m.GetState(), "pk1")
	if after.Catch == nil {
		t.Fatal("pk1 lost its catch metadata across the save")
	}
	if after.Catch.Location != "Route 210" || after.Catch.Nature != "adamant" || after.Catch.Ball != "premier-ball" {
		t.Errorf("pk1 catch text = %+v, want the recorded values", after.Catch)
	}
	if after.Catch.Level == nil || *after.Catch.Level != 100 {
		t.Errorf("pk1 catch Level = %v, want 100", after.Catch.Level)
	}
	if after.Catch.HP == nil || *after.Catch.HP != 0 {
		t.Errorf("pk1 catch HP = %v, want a recorded 0", after.Catch.HP)
	}
	if len(after.Catch.Ribbons) != 1 || after.Catch.Ribbons[0] != "effort-ribbon" {
		t.Errorf("pk1 catch Ribbons = %v, want [effort-ribbon]", after.Catch.Ribbons)
	}

	// Everything except the new record has to come back unchanged.
	before.Catch, after.Catch = nil, nil
	if !reflect.DeepEqual(before, after) {
		t.Errorf("pk1 changed outside its catch metadata:\nbefore = %+v\nafter  = %+v", before, after)
	}
	if other := findLegacyPokemon(t, m.GetState(), "pk2"); other.Catch != nil {
		t.Errorf("pk2 gained catch metadata %+v, want none", other.Catch)
	}
}

// findLegacyPokemon returns a copy of the Pokémon with the given id, failing
// the test when it went missing from the loaded state.
func findLegacyPokemon(t *testing.T, st state.AppState, id string) state.Pokemon {
	t.Helper()
	for _, p := range st.Pokemon {
		if p.ID == id {
			return p
		}
	}
	t.Fatalf("pokemon %s missing from loaded state", id)
	return state.Pokemon{}
}

// assertFilledBase checks the geometry rules of a filled element that is not a
// LabeledTextElement: hidden, sized and inside the stored canvas.
func assertFilledBase(t *testing.T, label string, base state.OverlayElementBase, o state.OverlaySettings) {
	t.Helper()
	if base.Visible {
		t.Errorf("%s: filled element is visible, it would appear on the stream unasked", label)
	}
	if base.Width <= 0 || base.Height <= 0 {
		t.Errorf("%s: filled element has no size (%dx%d)", label, base.Width, base.Height)
	}
	if base.X < 0 || base.Y < 0 || base.X+base.Width > o.CanvasWidth || base.Y+base.Height > o.CanvasHeight {
		t.Errorf("%s: filled element (%d,%d %dx%d) escapes the stored %dx%d canvas",
			label, base.X, base.Y, base.Width, base.Height, o.CanvasWidth, o.CanvasHeight)
	}
}

// findPokemonOverlay returns the custom overlay of one Pokémon, failing the test
// when the Pokémon or its overlay went missing.
func findPokemonOverlay(t *testing.T, st state.AppState, id string) *state.OverlaySettings {
	t.Helper()
	for i := range st.Pokemon {
		if st.Pokemon[i].ID != id {
			continue
		}
		if st.Pokemon[i].Overlay == nil {
			t.Fatalf("pokemon %s lost its custom overlay", id)
		}
		return st.Pokemon[i].Overlay
	}
	t.Fatalf("pokemon %s missing from loaded state", id)
	return nil
}

// TestLegacyJSONOverlaySurvivesRework runs the same stored layout through the
// legacy JSON snapshot path, which reaches the overlay through
// migrateOverlaySettings instead of through the database migrations, and pins
// the same set of changes. Unknown legacy keys (trigger_exit, the shadow
// gradient fields) are present in the snapshot and must be ignored silently.
func TestLegacyJSONOverlaySurvivesRework(t *testing.T) {
	configDir := t.TempDir()
	stored := legacyGlobalOverlay()
	writeLegacyStateJSON(t, configDir, stored)

	m := state.NewManager(configDir)
	if err := m.Load(); err != nil {
		t.Fatalf(fmtLoad, err)
	}
	loaded := m.GetState().Settings.Overlay

	// The JSON path has no database migration to fold the gradient shadow: the
	// snapshot already carries the single colour the old renderer drew.
	assertDiff(t, "json", diffOverlay(stored, loaded), map[string]string{
		"BackgroundAnimation":    "rb-galaxy => waves",
		"Sprite.CycleIntervalMs": "0 => 3000",
		"Sprite.CycleTransition": " => fade",
	}, filledPaths...)

	assertFilledHidden(t, "json.Phase", loaded.Phase, loaded, "PHASE")
	assertFilledHidden(t, "json.TotalCounter", loaded.TotalCounter, loaded, "ENCOUNTER GESAMT")
	assertFilledHidden(t, "json.TotalTimer", loaded.TotalTimer, loaded, "ZEIT GESAMT")
}

// writeLegacyStateJSON writes a state.json holding the given overlay plus the
// keys the rework removed, so the load path is fed a snapshot a pre-rework
// release could really have written.
func writeLegacyStateJSON(t *testing.T, configDir string, overlay state.OverlaySettings) {
	t.Helper()
	snapshot := state.AppState{
		Pokemon:  []state.Pokemon{},
		Sessions: []state.Session{},
		Settings: state.Settings{Languages: []string{"de", "en"}, Overlay: overlay},
	}
	data, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	var generic map[string]any
	if err := json.Unmarshal(data, &generic); err != nil {
		t.Fatalf("unmarshal snapshot: %v", err)
	}
	ov := generic["settings"].(map[string]any)["overlay"].(map[string]any)
	ov["sprite"].(map[string]any)["trigger_exit"] = "fade-out"
	timerStyle := ov["timer"].(map[string]any)["style"].(map[string]any)
	timerStyle["text_shadow_color_type"] = "gradient"
	timerStyle["text_shadow_gradient_angle"] = 45
	timerStyle["text_shadow_gradient_stops"] = []any{
		map[string]any{"color": "#ff0000", "position": 0},
		map[string]any{"color": "#0000ff", "position": 1},
	}
	legacy, err := json.Marshal(generic)
	if err != nil {
		t.Fatalf("marshal legacy snapshot: %v", err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "state.json"), legacy, 0o600); err != nil {
		t.Fatalf("write state.json: %v", err)
	}
}
