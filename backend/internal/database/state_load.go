// state_load.go reconstructs a full AppState from the normalized v2 schema.
// It reads every table (app_config, hotkeys, settings, pokemon, sessions, etc.)
// and assembles them into a single state.AppState value. Overlay settings are
// loaded via a shared helper that handles elements, text styles, and gradient stops.
package database

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// HasState reports whether the normalized schema contains an app_config row.
func (d *DB) HasState() bool {
	var n int
	_ = d.db.QueryRow(`SELECT 1 FROM app_config WHERE id = 1`).Scan(&n)
	return n == 1
}

// LoadFullState reads all normalized tables and assembles a complete AppState.
// Returns nil (without error) when no app_config row exists yet.
func (d *DB) LoadFullState() (*state.AppState, error) {
	// 1. Check for app_config row.
	var activeID, dataPath string
	var licenseAccepted int
	err := d.db.QueryRow(`SELECT active_id, license_accepted, data_path FROM app_config WHERE id = 1`).
		Scan(&activeID, &licenseAccepted, &dataPath)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load app_config: %w", err)
	}

	st := &state.AppState{
		ActiveID:        activeID,
		LicenseAccepted: licenseAccepted != 0,
		DataPath:        dataPath,
		Pokemon:         []state.Pokemon{},
		Sessions:        []state.Session{},
	}

	// 2. Load singleton rows (hotkeys, settings, languages, global overlay).
	if err := loadSingletonRows(d.db, st); err != nil {
		return nil, err
	}

	// 3. Load all pokemon with their associated data.
	st.Pokemon, err = loadPokemonWithDetails(d.db)
	if err != nil {
		return nil, err
	}

	// 4. Load sessions.
	st.Sessions, err = loadSessions(d.db)
	if err != nil {
		return nil, fmt.Errorf("load sessions: %w", err)
	}

	return st, nil
}

// loadSingletonRows populates hotkeys, settings, languages, and the global
// overlay on the given AppState.
func loadSingletonRows(db *sql.DB, st *state.AppState) error {
	var err error
	st.Hotkeys, err = loadHotkeys(db)
	if err != nil {
		return fmt.Errorf("load hotkeys: %w", err)
	}
	st.Settings, err = loadSettings(db)
	if err != nil {
		return fmt.Errorf("load settings: %w", err)
	}
	st.Settings.Languages, err = loadLanguages(db)
	if err != nil {
		return fmt.Errorf("load languages: %w", err)
	}
	globalOverlay, err := loadOverlay(db, "global", "default")
	if err != nil {
		return fmt.Errorf("load global overlay: %w", err)
	}
	if globalOverlay != nil {
		st.Settings.Overlay = *globalOverlay
	}
	return nil
}

// loadPokemonWithDetails loads all pokemon rows and enriches each one with its
// optional overlay, detector config (including templates and detection log).
func loadPokemonWithDetails(db *sql.DB) ([]state.Pokemon, error) {
	pokemon, err := loadPokemon(db)
	if err != nil {
		return nil, fmt.Errorf("load pokemon: %w", err)
	}
	for i := range pokemon {
		p := &pokemon[i]
		if err := loadPokemonExtras(db, p); err != nil {
			return nil, err
		}
	}
	return pokemon, nil
}

// loadPokemonExtras attaches the per-pokemon overlay and detector config
// (with templates and detection log) to a single Pokemon value.
func loadPokemonExtras(db *sql.DB, p *state.Pokemon) error {
	if p.OverlayMode == "custom" {
		ov, err := loadOverlay(db, "pokemon", p.ID)
		if err != nil {
			return fmt.Errorf("load overlay for pokemon %s: %w", p.ID, err)
		}
		p.Overlay = ov
	}

	dc, err := loadDetectorConfig(db, p.ID)
	if err != nil {
		return fmt.Errorf("load detector config for %s: %w", p.ID, err)
	}
	if dc != nil {
		dc.Templates, err = loadDetectorTemplates(db, p.ID)
		if err != nil {
			return fmt.Errorf("load templates for %s: %w", p.ID, err)
		}
		dc.DetectionLog, err = loadDetectionLog(db, p.ID)
		if err != nil {
			return fmt.Errorf("load detection log for %s: %w", p.ID, err)
		}
	}
	p.DetectorConfig = dc
	return nil
}

// loadHotkeys reads the singleton hotkeys row.
func loadHotkeys(db *sql.DB) (state.HotkeyMap, error) {
	var h state.HotkeyMap
	err := db.QueryRow(`SELECT increment, decrement, reset, next_pokemon FROM hotkeys WHERE id = 1`).
		Scan(&h.Increment, &h.Decrement, &h.Reset, &h.NextPokemon)
	if err == sql.ErrNoRows {
		return h, nil
	}
	return h, err
}

// loadSettings reads the singleton settings row including inline tutorial flags.
func loadSettings(db *sql.DB) (state.Settings, error) {
	var s state.Settings
	var outputEnabled, autoSave, crispSprites, uiAnimations, tutOverlay, tutDetection int
	err := db.QueryRow(`SELECT output_enabled, output_dir, auto_save,
		crisp_sprites, ui_animations, config_path, tutorial_overlay_editor, tutorial_auto_detection
		FROM settings WHERE id = 1`).
		Scan(&outputEnabled, &s.OutputDir, &autoSave,
			&crispSprites, &uiAnimations, &s.ConfigPath, &tutOverlay, &tutDetection)
	if err == sql.ErrNoRows {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	s.OutputEnabled = outputEnabled != 0
	s.AutoSave = autoSave != 0
	s.CrispSprites = crispSprites != 0
	s.UIAnimations = uiAnimations != 0
	s.TutorialSeen.OverlayEditor = tutOverlay != 0
	s.TutorialSeen.AutoDetection = tutDetection != 0
	return s, nil
}

// loadLanguages reads all language entries ordered by sort_order.
func loadLanguages(db *sql.DB) ([]string, error) {
	rows, err := db.Query(`SELECT language FROM settings_languages ORDER BY sort_order`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var langs []string
	for rows.Next() {
		var lang string
		if err := rows.Scan(&lang); err != nil {
			return nil, err
		}
		langs = append(langs, lang)
	}
	if langs == nil {
		langs = []string{}
	}
	return langs, rows.Err()
}

// loadPokemon reads all pokemon rows ordered by sort_order.
func loadPokemon(db *sql.DB) ([]state.Pokemon, error) {
	rows, err := db.Query(`SELECT id, name, title, canonical_name, sprite_url, sprite_type,
		sprite_style, encounters, step, is_active, created_at, language, game,
		completed_at, overlay_mode, hunt_type, timer_started_at, timer_accumulated_ms,
		hunt_mode
		FROM pokemon ORDER BY sort_order`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var pokemon []state.Pokemon
	for rows.Next() {
		var p state.Pokemon
		var isActive int
		var createdAtStr string
		var completedAt, timerStartedAt sql.NullString

		if err := rows.Scan(&p.ID, &p.Name, &p.Title, &p.CanonicalName, &p.SpriteURL,
			&p.SpriteType, &p.SpriteStyle, &p.Encounters, &p.Step, &isActive,
			&createdAtStr, &p.Language, &p.Game, &completedAt, &p.OverlayMode,
			&p.HuntType, &timerStartedAt, &p.TimerAccumulatedMs, &p.HuntMode); err != nil {
			return nil, err
		}
		p.IsActive = isActive != 0
		if t, err := time.Parse(time.RFC3339, createdAtStr); err == nil {
			p.CreatedAt = t
		}
		p.CompletedAt = parseOptionalTime(completedAt)
		p.TimerStartedAt = parseOptionalTime(timerStartedAt)
		pokemon = append(pokemon, p)
	}
	if pokemon == nil {
		pokemon = []state.Pokemon{}
	}
	return pokemon, rows.Err()
}

// parseOptionalTime parses a nullable RFC3339 string into a *time.Time.
func parseOptionalTime(ns sql.NullString) *time.Time {
	if ns.Valid && ns.String != "" {
		if t, err := time.Parse(time.RFC3339, ns.String); err == nil {
			return &t
		}
	}
	return nil
}

// loadDetectorConfig reads the optional detector_configs row for a pokemon.
func loadDetectorConfig(db *sql.DB, pokemonID string) (*state.DetectorConfig, error) {
	var dc state.DetectorConfig
	var enabled, adaptiveCooldown int
	err := db.QueryRow(`SELECT enabled, source_type, region_x, region_y, region_w, region_h,
		window_title, precision_val, consecutive_hits, cooldown_sec, change_threshold,
		poll_interval_ms, min_poll_ms, max_poll_ms, adaptive_cooldown, adaptive_cooldown_min,
		hysteresis_factor
		FROM detector_configs WHERE pokemon_id = ?`, pokemonID).
		Scan(&enabled, &dc.SourceType, &dc.Region.X, &dc.Region.Y, &dc.Region.W, &dc.Region.H,
			&dc.WindowTitle, &dc.Precision, &dc.ConsecutiveHits, &dc.CooldownSec,
			&dc.ChangeThreshold, &dc.PollIntervalMs, &dc.MinPollMs, &dc.MaxPollMs,
			&adaptiveCooldown, &dc.AdaptiveCooldownMin, &dc.HysteresisFactor)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	dc.Enabled = enabled != 0
	dc.AdaptiveCooldown = adaptiveCooldown != 0
	dc.Templates = []state.DetectorTemplate{}
	dc.DetectionLog = []state.DetectionLogEntry{}
	return &dc, nil
}

// loadDetectorTemplates reads templates for a pokemon without loading image_data BLOBs.
// It collects all template rows first and closes the cursor before querying
// regions, avoiding a deadlock with MaxOpenConns(1).
func loadDetectorTemplates(db *sql.DB, pokemonID string) ([]state.DetectorTemplate, error) {
	rows, err := db.Query(`SELECT id, name, sort_order, enabled FROM detector_templates WHERE pokemon_id = ? ORDER BY sort_order`, pokemonID)
	if err != nil {
		return nil, err
	}

	var templates []state.DetectorTemplate
	for rows.Next() {
		var t state.DetectorTemplate
		var sortOrder int
		var enabledInt int
		if err := rows.Scan(&t.TemplateDBID, &t.Name, &sortOrder, &enabledInt); err != nil {
			_ = rows.Close()
			return nil, err
		}
		enabled := enabledInt != 0
		t.Enabled = &enabled
		templates = append(templates, t)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	_ = rows.Close()

	// Now that the cursor is closed, load regions for each template.
	for i := range templates {
		templates[i].Regions, err = loadTemplateRegions(db, templates[i].TemplateDBID)
		if err != nil {
			return nil, err
		}
	}
	if templates == nil {
		templates = []state.DetectorTemplate{}
	}
	return templates, nil
}

// loadTemplateRegions reads matched regions for a single template.
func loadTemplateRegions(db *sql.DB, templateID int64) ([]state.MatchedRegion, error) {
	rows, err := db.Query(`SELECT type, expected_text, rect_x, rect_y, rect_w, rect_h, is_negative
		FROM template_regions WHERE template_id = ? ORDER BY sort_order`, templateID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var regions []state.MatchedRegion
	for rows.Next() {
		var r state.MatchedRegion
		var isNeg int
		if err := rows.Scan(&r.Type, &r.ExpectedText, &r.Rect.X, &r.Rect.Y, &r.Rect.W, &r.Rect.H, &isNeg); err != nil {
			return nil, err
		}
		if isNeg != 0 {
			r.Polarity = "negative"
		}
		regions = append(regions, r)
	}
	if regions == nil {
		regions = []state.MatchedRegion{}
	}
	return regions, rows.Err()
}

// loadDetectionLog reads the most recent detection log entries for a pokemon.
func loadDetectionLog(db *sql.DB, pokemonID string) ([]state.DetectionLogEntry, error) {
	rows, err := db.Query(`SELECT at, confidence FROM detection_log WHERE pokemon_id = ? ORDER BY id DESC LIMIT 20`, pokemonID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var entries []state.DetectionLogEntry
	for rows.Next() {
		var e state.DetectionLogEntry
		var atStr string
		if err := rows.Scan(&atStr, &e.Confidence); err != nil {
			return nil, err
		}
		if t, err := time.Parse(time.RFC3339, atStr); err == nil {
			e.At = t
		}
		entries = append(entries, e)
	}
	if entries == nil {
		entries = []state.DetectionLogEntry{}
	}
	return entries, rows.Err()
}

// loadSessions reads all session records.
func loadSessions(db *sql.DB) ([]state.Session, error) {
	rows, err := db.Query(`SELECT id, pokemon_id, started_at, ended_at, encounters FROM sessions`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var sessions []state.Session
	for rows.Next() {
		var s state.Session
		var startedAtStr string
		var endedAt sql.NullString
		if err := rows.Scan(&s.ID, &s.PokemonID, &startedAtStr, &endedAt, &s.Encounters); err != nil {
			return nil, err
		}
		if t, err := time.Parse(time.RFC3339, startedAtStr); err == nil {
			s.StartedAt = t
		}
		if endedAt.Valid && endedAt.String != "" {
			if t, err := time.Parse(time.RFC3339, endedAt.String); err == nil {
				s.EndedAt = &t
			}
		}
		sessions = append(sessions, s)
	}
	if sessions == nil {
		sessions = []state.Session{}
	}
	return sessions, rows.Err()
}

// elemRow holds the raw column values for a single overlay_elements row,
// used as an intermediate representation before dispatching to typed fields.
type elemRow struct {
	id                                    int64
	elemType                              string
	base                                  state.OverlayElementBase
	showGlow, showLabel, glowBlur         sql.NullInt64
	glowColor, idleAnim, triggerEnter        sql.NullString
	triggerExit, triggerDecrement, labelText sql.NullString
	glowOpacity                           sql.NullFloat64
}

// loadOverlay reconstructs an OverlaySettings from the overlay_settings,
// overlay_elements, text_styles, and gradient_stops tables.
func loadOverlay(db *sql.DB, ownerType, ownerID string) (*state.OverlaySettings, error) {
	ov, overlayID, err := loadOverlayBase(db, ownerType, ownerID)
	if err != nil || ov == nil {
		return ov, err
	}

	elems, err := scanOverlayElements(db, overlayID)
	if err != nil {
		return nil, err
	}

	for _, e := range elems {
		if err := applyOverlayElement(db, ov, e); err != nil {
			return nil, err
		}
	}
	return ov, nil
}

// loadOverlayBase reads the overlay_settings row and returns the base settings.
// Returns (nil, 0, nil) when no row exists.
func loadOverlayBase(db *sql.DB, ownerType, ownerID string) (*state.OverlaySettings, int64, error) {
	var ov state.OverlaySettings
	var overlayID int64
	var hidden, showBorder int

	var bgAnimConfig string
	err := db.QueryRow(`SELECT id, canvas_width, canvas_height, hidden, background_color,
		background_opacity, background_animation, background_animation_speed,
		background_animation_config, background_image, background_image_fit,
		blur, show_border, border_color, border_width, border_radius
		FROM overlay_settings WHERE owner_type = ? AND owner_id = ?`, ownerType, ownerID).
		Scan(&overlayID, &ov.CanvasWidth, &ov.CanvasHeight, &hidden, &ov.BackgroundColor,
			&ov.BackgroundOpacity, &ov.BackgroundAnimation, &ov.BackgroundAnimationSpeed,
			&bgAnimConfig, &ov.BackgroundImage, &ov.BackgroundImageFit, &ov.Blur, &showBorder,
			&ov.BorderColor, &ov.BorderWidth, &ov.BorderRadius)
	if err == sql.ErrNoRows {
		return nil, 0, nil
	}
	if err != nil {
		return nil, 0, fmt.Errorf("query overlay_settings: %w", err)
	}
	ov.Hidden = hidden != 0
	ov.ShowBorder = showBorder != 0
	if bgAnimConfig != "" {
		ov.BackgroundAnimationConfig = json.RawMessage(bgAnimConfig)
	}
	return &ov, overlayID, nil
}

// scanOverlayElements loads all overlay_elements rows for the given overlay
// ID and closes the cursor before returning.
func scanOverlayElements(db *sql.DB, overlayID int64) ([]elemRow, error) {
	rows, err := db.Query(`SELECT id, element_type, visible, x, y, width, height, z_index,
		show_glow, glow_color, glow_opacity, glow_blur, idle_animation, trigger_enter, trigger_exit,
		trigger_decrement, show_label, label_text
		FROM overlay_elements WHERE overlay_id = ?`, overlayID)
	if err != nil {
		return nil, fmt.Errorf("query overlay_elements: %w", err)
	}

	var elems []elemRow
	for rows.Next() {
		var e elemRow
		var visible int
		if err := rows.Scan(&e.id, &e.elemType, &visible, &e.base.X, &e.base.Y, &e.base.Width,
			&e.base.Height, &e.base.ZIndex, &e.showGlow, &e.glowColor, &e.glowOpacity, &e.glowBlur,
			&e.idleAnim, &e.triggerEnter, &e.triggerExit, &e.triggerDecrement, &e.showLabel, &e.labelText); err != nil {
			_ = rows.Close()
			return nil, fmt.Errorf("scan overlay_element: %w", err)
		}
		e.base.Visible = visible != 0
		elems = append(elems, e)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	_ = rows.Close()
	return elems, nil
}

// applyOverlayElement dispatches a single element row to the appropriate field
// on the OverlaySettings, loading text styles as needed.
func applyOverlayElement(db *sql.DB, ov *state.OverlaySettings, e elemRow) error {
	idleAnimStr := nullStr(e.idleAnim)
	triggerEnterStr := nullStr(e.triggerEnter)
	triggerExitStr := nullStr(e.triggerExit)
	triggerDecrementStr := nullStr(e.triggerDecrement)

	switch e.elemType {
	case "sprite":
		ov.Sprite = state.SpriteElement{
			OverlayElementBase: e.base,
			ShowGlow:           e.showGlow.Valid && e.showGlow.Int64 != 0,
			GlowColor:          nullStr(e.glowColor),
			GlowOpacity:        nullFloat(e.glowOpacity),
			GlowBlur:           int(nullInt(e.glowBlur)),
			IdleAnimation:      idleAnimStr,
			TriggerEnter:       triggerEnterStr,
			TriggerExit:        triggerExitStr,
			TriggerDecrement:   triggerDecrementStr,
		}

	case "name":
		style, err := loadTextStyle(db, e.id, "main")
		if err != nil {
			return fmt.Errorf("load name text style: %w", err)
		}
		ov.Name = state.NameElement{
			OverlayElementBase: e.base,
			Style:              style,
			IdleAnimation:      idleAnimStr,
			TriggerEnter:       triggerEnterStr,
			TriggerDecrement:   triggerDecrementStr,
		}

	case "title":
		style, err := loadTextStyle(db, e.id, "main")
		if err != nil {
			return fmt.Errorf("load title text style: %w", err)
		}
		ov.Title = state.TitleElement{
			OverlayElementBase: e.base,
			Style:              style,
			IdleAnimation:      idleAnimStr,
			TriggerEnter:       triggerEnterStr,
			TriggerDecrement:   triggerDecrementStr,
		}

	case "counter":
		style, err := loadTextStyle(db, e.id, "main")
		if err != nil {
			return fmt.Errorf("load counter text style: %w", err)
		}
		labelStyle, err := loadTextStyle(db, e.id, "label")
		if err != nil {
			return fmt.Errorf("load counter label style: %w", err)
		}
		ov.Counter = state.CounterElement{
			OverlayElementBase: e.base,
			Style:              style,
			ShowLabel:          e.showLabel.Valid && e.showLabel.Int64 != 0,
			LabelText:          nullStr(e.labelText),
			LabelStyle:         labelStyle,
			IdleAnimation:      idleAnimStr,
			TriggerEnter:       triggerEnterStr,
			TriggerDecrement:   triggerDecrementStr,
		}
	}
	return nil
}

// loadTextStyle reads a single text_style row and its gradient stops.
func loadTextStyle(db *sql.DB, elementID int64, role string) (state.TextStyle, error) {
	var ts state.TextStyle
	var styleID int64
	var textShadow int

	err := db.QueryRow(`SELECT id, font_family, font_size, font_weight, text_align,
		color_type, color, gradient_angle, outline_type, outline_width, outline_color,
		outline_gradient_angle, text_shadow, text_shadow_color, text_shadow_color_type,
		text_shadow_gradient_angle, text_shadow_blur, text_shadow_x, text_shadow_y
		FROM text_styles WHERE element_id = ? AND style_role = ?`, elementID, role).
		Scan(&styleID, &ts.FontFamily, &ts.FontSize, &ts.FontWeight, &ts.TextAlign,
			&ts.ColorType, &ts.Color, &ts.GradientAngle, &ts.OutlineType, &ts.OutlineWidth,
			&ts.OutlineColor, &ts.OutlineGradientAngle, &textShadow, &ts.TextShadowColor,
			&ts.TextShadowColorType, &ts.TextShadowGradientAngle, &ts.TextShadowBlur,
			&ts.TextShadowX, &ts.TextShadowY)
	if err == sql.ErrNoRows {
		// Return zero-value style with non-nil slices
		ts.GradientStops = []state.GradientStop{}
		ts.OutlineGradientStops = []state.GradientStop{}
		ts.TextShadowGradientStops = []state.GradientStop{}
		return ts, nil
	}
	if err != nil {
		return ts, err
	}
	ts.TextShadow = textShadow != 0

	// Load gradient stops by type
	var loadErr error
	ts.GradientStops, loadErr = loadGradientStops(db, styleID, "color")
	if loadErr != nil {
		return ts, loadErr
	}
	ts.OutlineGradientStops, loadErr = loadGradientStops(db, styleID, "outline")
	if loadErr != nil {
		return ts, loadErr
	}
	ts.TextShadowGradientStops, loadErr = loadGradientStops(db, styleID, "shadow")
	if loadErr != nil {
		return ts, loadErr
	}

	return ts, nil
}

// loadGradientStops reads gradient stop entries for a text style and gradient type.
func loadGradientStops(db *sql.DB, textStyleID int64, gradientType string) ([]state.GradientStop, error) {
	rows, err := db.Query(`SELECT color, position FROM gradient_stops
		WHERE text_style_id = ? AND gradient_type = ? ORDER BY sort_order`, textStyleID, gradientType)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	stops := []state.GradientStop{}
	for rows.Next() {
		var gs state.GradientStop
		if err := rows.Scan(&gs.Color, &gs.Position); err != nil {
			return nil, err
		}
		stops = append(stops, gs)
	}
	return stops, rows.Err()
}

// nullStr extracts a string from a sql.NullString, returning "" if not valid.
func nullStr(ns sql.NullString) string {
	if ns.Valid {
		return ns.String
	}
	return ""
}

// nullFloat extracts a float64 from a sql.NullFloat64, returning 0 if not valid.
func nullFloat(nf sql.NullFloat64) float64 {
	if nf.Valid {
		return nf.Float64
	}
	return 0
}

// nullInt extracts an int64 from a sql.NullInt64, returning 0 if not valid.
func nullInt(ni sql.NullInt64) int64 {
	if ni.Valid {
		return ni.Int64
	}
	return 0
}
