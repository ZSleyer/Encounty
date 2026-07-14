// state_load.go reconstructs a full AppState from the normalized v2 schema.
// It reads every table (app_config, hotkeys, settings, pokemon, sessions, etc.)
// and assembles them into a single state.AppState value. Child tables are read
// with one batched query per table (keyed by owner id) and assembled in memory,
// avoiding the O(pokemon x elements) per-parent query fan-out that would
// otherwise serialise behind MaxOpenConns(1) on startup.
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

	// 2. Load singleton rows (hotkeys, settings, languages).
	if err := loadSingletonRows(d.db, st); err != nil {
		return nil, err
	}

	// 3. Load every overlay (global + per-pokemon) in one batched pass and
	//    assign the global overlay to the settings.
	overlays, err := loadAllOverlays(d.db)
	if err != nil {
		return nil, fmt.Errorf("load overlays: %w", err)
	}
	if global := overlays[overlayKey("global", "default")]; global != nil {
		st.Settings.Overlay = *global
	}

	// 4. Load all pokemon rows and attach custom overlays from the map.
	st.Pokemon, err = loadPokemon(d.db)
	if err != nil {
		return nil, fmt.Errorf("load pokemon: %w", err)
	}
	for i := range st.Pokemon {
		if st.Pokemon[i].OverlayMode == "custom" {
			st.Pokemon[i].Overlay = overlays[overlayKey("pokemon", st.Pokemon[i].ID)]
		}
	}

	// 4a. Attach detector configs, templates, regions, and logs in batched passes.
	if err := attachDetectors(d.db, st.Pokemon); err != nil {
		return nil, err
	}

	// 4b. Load per-Pokémon tags and attach them to the loaded Pokémon.
	if err := attachPokemonTags(d.db, st.Pokemon); err != nil {
		return nil, fmt.Errorf("load pokemon tags: %w", err)
	}

	// 4c. Load organizational groups.
	st.Groups, err = loadGroups(d.db)
	if err != nil {
		return nil, fmt.Errorf("load groups: %w", err)
	}

	// 5. Load sessions.
	st.Sessions, err = loadSessions(d.db)
	if err != nil {
		return nil, fmt.Errorf("load sessions: %w", err)
	}

	return st, nil
}

// loadGroups reads every pokemon_groups row ordered by sort_order, then id
// so the frontend receives a stable, user-controlled ordering.
func loadGroups(db *sql.DB) ([]state.Group, error) {
	rows, err := db.Query(`SELECT id, name, color, sort_order, collapsed FROM pokemon_groups ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	groups := []state.Group{}
	for rows.Next() {
		var g state.Group
		var collapsed int
		if err := rows.Scan(&g.ID, &g.Name, &g.Color, &g.SortOrder, &collapsed); err != nil {
			return nil, err
		}
		g.Collapsed = collapsed != 0
		groups = append(groups, g)
	}
	return groups, rows.Err()
}

// attachPokemonTags fills Pokemon.Tags for every entry in pokemon by reading
// pokemon_tags in a single query. Pokémon without tag rows end up with a
// non-nil empty slice so JSON serialisation emits [] rather than null.
func attachPokemonTags(db *sql.DB, pokemon []state.Pokemon) error {
	for i := range pokemon {
		pokemon[i].Tags = []string{}
	}
	rows, err := db.Query(`SELECT pokemon_id, tag FROM pokemon_tags ORDER BY pokemon_id, tag`)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	idx := make(map[string]int, len(pokemon))
	for i, p := range pokemon {
		idx[p.ID] = i
	}
	for rows.Next() {
		var pokemonID, tag string
		if err := rows.Scan(&pokemonID, &tag); err != nil {
			return err
		}
		if i, ok := idx[pokemonID]; ok {
			pokemon[i].Tags = append(pokemon[i].Tags, tag)
		}
	}
	return rows.Err()
}

// loadSingletonRows populates hotkeys, settings, and languages on the given
// AppState. The overlay is loaded separately via loadAllOverlays.
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
	st.Settings.CaptureResolutions, err = loadCaptureResolutions(db)
	if err != nil {
		return fmt.Errorf("load capture resolutions: %w", err)
	}
	return nil
}

// loadHotkeys reads the singleton hotkeys row.
func loadHotkeys(db *sql.DB) (state.HotkeyMap, error) {
	var h state.HotkeyMap
	err := db.QueryRow(`SELECT increment, decrement, reset, next_pokemon, hunt_toggle FROM hotkeys WHERE id = 1`).
		Scan(&h.Increment, &h.Decrement, &h.Reset, &h.NextPokemon, &h.HuntToggle)
	if err == sql.ErrNoRows {
		return h, nil
	}
	return h, err
}

// loadSettings reads the singleton settings row including inline tutorial flags.
func loadSettings(db *sql.DB) (state.Settings, error) {
	var s state.Settings
	var outputEnabled, autoSave, crispSprites, tutOverlay, tutDetection int
	err := db.QueryRow(`SELECT output_enabled, output_dir, auto_save,
		crisp_sprites, accent_color, config_path, tutorial_overlay_editor, tutorial_auto_detection
		FROM settings WHERE id = 1`).
		Scan(&outputEnabled, &s.OutputDir, &autoSave,
			&crispSprites, &s.AccentColor, &s.ConfigPath, &tutOverlay, &tutDetection)
	if err == sql.ErrNoRows {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	s.OutputEnabled = outputEnabled != 0
	s.AutoSave = autoSave != 0
	s.CrispSprites = crispSprites != 0
	if s.AccentColor == "" {
		s.AccentColor = "violet"
	}
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

// loadCaptureResolutions reads the per-device capture resolution map. Returns a
// non-nil (possibly empty) map so the broadcast never emits null.
func loadCaptureResolutions(db *sql.DB) (map[string]string, error) {
	rows, err := db.Query(`SELECT device_key, resolution FROM capture_resolutions`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	resolutions := map[string]string{}
	for rows.Next() {
		var deviceKey, resolution string
		if err := rows.Scan(&deviceKey, &resolution); err != nil {
			return nil, err
		}
		resolutions[deviceKey] = resolution
	}
	return resolutions, rows.Err()
}

// loadPokemon reads all pokemon rows ordered by sort_order.
func loadPokemon(db *sql.DB) ([]state.Pokemon, error) {
	rows, err := db.Query(`SELECT id, name, base_name, form_name, title, canonical_name, sprite_url, sprite_type,
		sprite_style, encounters, step, is_active, created_at, language, game,
		completed_at, overlay_mode, hunt_type, shiny_charm, timer_started_at, timer_accumulated_ms,
		hunt_mode, group_id
		FROM pokemon ORDER BY sort_order`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var pokemon []state.Pokemon
	for rows.Next() {
		var p state.Pokemon
		var isActive int
		var shinyCharm int
		var createdAtStr string
		var completedAt, timerStartedAt sql.NullString

		if err := rows.Scan(&p.ID, &p.Name, &p.BaseName, &p.FormName, &p.Title, &p.CanonicalName, &p.SpriteURL,
			&p.SpriteType, &p.SpriteStyle, &p.Encounters, &p.Step, &isActive,
			&createdAtStr, &p.Language, &p.Game, &completedAt, &p.OverlayMode,
			&p.HuntType, &shinyCharm, &timerStartedAt, &p.TimerAccumulatedMs, &p.HuntMode, &p.GroupID); err != nil {
			return nil, err
		}
		p.IsActive = isActive != 0
		p.ShinyCharm = shinyCharm != 0
		if t, err := time.Parse(time.RFC3339, createdAtStr); err == nil {
			p.CreatedAt = t
		}
		p.CompletedAt = parseOptionalTime(completedAt)
		p.TimerStartedAt = parseOptionalTime(timerStartedAt)
		// Ensure Tags is always a non-nil slice; attachPokemonTags will fill
		// it from the pokemon_tags table once all rows are loaded.
		p.Tags = []string{}
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

// ---------------------------------------------------------------------------
// Detector batching
// ---------------------------------------------------------------------------

// attachDetectors loads detector configs, templates, regions, and detection
// logs with one query per table and attaches the assembled DetectorConfig to
// each Pokémon that has one.
func attachDetectors(db *sql.DB, pokemon []state.Pokemon) error {
	configs, err := loadAllDetectorConfigs(db)
	if err != nil {
		return fmt.Errorf("load detector configs: %w", err)
	}
	if len(configs) == 0 {
		return nil
	}

	regions, err := loadAllTemplateRegions(db)
	if err != nil {
		return fmt.Errorf("load template regions: %w", err)
	}
	templates, err := loadAllDetectorTemplates(db, regions)
	if err != nil {
		return fmt.Errorf("load detector templates: %w", err)
	}
	logs, err := loadAllDetectionLogs(db)
	if err != nil {
		return fmt.Errorf("load detection logs: %w", err)
	}

	for id, cfg := range configs {
		if t, ok := templates[id]; ok {
			cfg.Templates = t
		}
		if l, ok := logs[id]; ok {
			cfg.DetectionLog = l
		}
	}
	for i := range pokemon {
		if cfg, ok := configs[pokemon[i].ID]; ok {
			pokemon[i].DetectorConfig = cfg
		}
	}
	return nil
}

// loadAllDetectorConfigs reads every detector_configs row into a map keyed by
// pokemon_id. Each config starts with non-nil empty Templates and DetectionLog
// slices so JSON serialisation never emits null.
func loadAllDetectorConfigs(db *sql.DB) (map[string]*state.DetectorConfig, error) {
	rows, err := db.Query(`SELECT pokemon_id, enabled, source_type, region_x, region_y, region_w, region_h,
		window_title, change_threshold, adaptive_cooldown, adaptive_cooldown_min
		FROM detector_configs`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	configs := map[string]*state.DetectorConfig{}
	for rows.Next() {
		var pokemonID string
		var dc state.DetectorConfig
		var enabled, adaptiveCooldown int
		if err := rows.Scan(&pokemonID, &enabled, &dc.SourceType, &dc.Region.X, &dc.Region.Y, &dc.Region.W, &dc.Region.H,
			&dc.WindowTitle, &dc.ChangeThreshold, &adaptiveCooldown, &dc.AdaptiveCooldownMin); err != nil {
			return nil, err
		}
		dc.Enabled = enabled != 0
		dc.AdaptiveCooldown = adaptiveCooldown != 0
		dc.Templates = []state.DetectorTemplate{}
		dc.DetectionLog = []state.DetectionLogEntry{}
		cfg := dc
		configs[pokemonID] = &cfg
	}
	return configs, rows.Err()
}

// loadAllDetectorTemplates reads every detector_templates row (without the
// image_data BLOB), groups them by pokemon_id in sort_order, and attaches the
// preloaded regions for each template.
func loadAllDetectorTemplates(db *sql.DB, regions map[int64][]state.MatchedRegion) (map[string][]state.DetectorTemplate, error) {
	rows, err := db.Query(`SELECT pokemon_id, id, name, sort_order, enabled, calibration, precision_val, hysteresis_factor,
		consecutive_hits, cooldown_sec, poll_interval_ms, min_poll_ms, max_poll_ms, hysteresis_mode
		FROM detector_templates ORDER BY pokemon_id, sort_order`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	templates := map[string][]state.DetectorTemplate{}
	for rows.Next() {
		var pokemonID string
		var t state.DetectorTemplate
		var sortOrder int
		var enabledInt int
		var calibration sql.NullString
		var precision, hysteresis sql.NullFloat64
		var consecutiveHits, cooldownSec, pollIntervalMs, minPollMs, maxPollMs sql.NullInt64
		var hysteresisMode sql.NullString
		if err := rows.Scan(&pokemonID, &t.TemplateDBID, &t.Name, &sortOrder, &enabledInt, &calibration, &precision, &hysteresis,
			&consecutiveHits, &cooldownSec, &pollIntervalMs, &minPollMs, &maxPollMs, &hysteresisMode); err != nil {
			return nil, err
		}
		applyTemplateNullables(&t, enabledInt, calibration, precision, hysteresis,
			consecutiveHits, cooldownSec, pollIntervalMs, minPollMs, maxPollMs, hysteresisMode)
		if r, ok := regions[t.TemplateDBID]; ok {
			t.Regions = r
		} else {
			t.Regions = []state.MatchedRegion{}
		}
		templates[pokemonID] = append(templates[pokemonID], t)
	}
	return templates, rows.Err()
}

// applyTemplateNullables copies the nullable template columns onto t, mirroring
// the pointer semantics used by the frontend detection engine.
func applyTemplateNullables(t *state.DetectorTemplate, enabledInt int, calibration sql.NullString,
	precision, hysteresis sql.NullFloat64,
	consecutiveHits, cooldownSec, pollIntervalMs, minPollMs, maxPollMs sql.NullInt64,
	hysteresisMode sql.NullString) {
	enabled := enabledInt != 0
	t.Enabled = &enabled
	if calibration.Valid && calibration.String != "" {
		t.Calibration = json.RawMessage(calibration.String)
	}
	if precision.Valid {
		t.Precision = &precision.Float64
	}
	if hysteresis.Valid {
		t.HysteresisFactor = &hysteresis.Float64
	}
	if consecutiveHits.Valid {
		v := int(consecutiveHits.Int64)
		t.ConsecutiveHits = &v
	}
	if cooldownSec.Valid {
		v := int(cooldownSec.Int64)
		t.CooldownSec = &v
	}
	if pollIntervalMs.Valid {
		v := int(pollIntervalMs.Int64)
		t.PollIntervalMs = &v
	}
	if minPollMs.Valid {
		v := int(minPollMs.Int64)
		t.MinPollMs = &v
	}
	if maxPollMs.Valid {
		v := int(maxPollMs.Int64)
		t.MaxPollMs = &v
	}
	if hysteresisMode.Valid && hysteresisMode.String != "" {
		t.HysteresisMode = &hysteresisMode.String
	}
}

// loadAllTemplateRegions reads every template_regions row into a map keyed by
// template_id, preserving sort_order within each template.
func loadAllTemplateRegions(db *sql.DB) (map[int64][]state.MatchedRegion, error) {
	rows, err := db.Query(`SELECT template_id, type, expected_text, rect_x, rect_y, rect_w, rect_h, is_negative, category
		FROM template_regions ORDER BY template_id, sort_order`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	regions := map[int64][]state.MatchedRegion{}
	for rows.Next() {
		var templateID int64
		var r state.MatchedRegion
		var isNeg int
		if err := rows.Scan(&templateID, &r.Type, &r.ExpectedText, &r.Rect.X, &r.Rect.Y, &r.Rect.W, &r.Rect.H, &isNeg, &r.Category); err != nil {
			return nil, err
		}
		regions[templateID] = append(regions[templateID], r)
	}
	return regions, rows.Err()
}

// loadAllDetectionLogs reads every detection_log row and returns the most
// recent 20 entries per pokemon (id DESC), matching the per-Pokémon LIMIT of
// the original per-parent query.
func loadAllDetectionLogs(db *sql.DB) (map[string][]state.DetectionLogEntry, error) {
	rows, err := db.Query(`SELECT pokemon_id, at, confidence, category FROM detection_log ORDER BY pokemon_id, id DESC`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	logs := map[string][]state.DetectionLogEntry{}
	for rows.Next() {
		var pokemonID string
		var e state.DetectionLogEntry
		var atStr string
		if err := rows.Scan(&pokemonID, &atStr, &e.Confidence, &e.Category); err != nil {
			return nil, err
		}
		if len(logs[pokemonID]) >= 20 {
			continue
		}
		if t, err := time.Parse(time.RFC3339, atStr); err == nil {
			e.At = t
		}
		logs[pokemonID] = append(logs[pokemonID], e)
	}
	return logs, rows.Err()
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

// ---------------------------------------------------------------------------
// Overlay batching
// ---------------------------------------------------------------------------

// elemRow holds the raw column values for a single overlay_elements row,
// used as an intermediate representation before dispatching to typed fields.
type elemRow struct {
	id                                       int64
	elemType                                 string
	base                                     state.OverlayElementBase
	showGlow, showLabel, glowBlur            sql.NullInt64
	glowColor, idleAnim, triggerEnter        sql.NullString
	triggerExit, triggerDecrement, labelText sql.NullString
	format                                   sql.NullString
	glowOpacity                              sql.NullFloat64
}

// overlayKey builds the map key that identifies one overlay by its owner.
func overlayKey(ownerType, ownerID string) string {
	return ownerType + ":" + ownerID
}

// loadAllOverlays reconstructs every OverlaySettings (global and per-pokemon)
// from the overlay_settings, overlay_elements, text_styles, and gradient_stops
// tables using one query per table. The result is keyed by overlayKey.
func loadAllOverlays(db *sql.DB) (map[string]*state.OverlaySettings, error) {
	byKey, byID, err := loadAllOverlayBases(db)
	if err != nil {
		return nil, err
	}
	if len(byID) == 0 {
		return byKey, nil
	}

	elemsByOverlay, err := loadAllOverlayElements(db)
	if err != nil {
		return nil, err
	}
	styles, err := loadAllTextStyles(db)
	if err != nil {
		return nil, err
	}

	styleLookup := func(elementID int64, role string) state.TextStyle {
		if roles, ok := styles[elementID]; ok {
			if ts, ok := roles[role]; ok {
				return ts
			}
		}
		return emptyTextStyle()
	}

	for overlayID, ov := range byID {
		for _, e := range elemsByOverlay[overlayID] {
			applyOverlayElement(ov, e, styleLookup)
		}
	}
	return byKey, nil
}

// loadAllOverlayBases reads every overlay_settings row and returns lookup maps
// by owner key and by primary id.
func loadAllOverlayBases(db *sql.DB) (map[string]*state.OverlaySettings, map[int64]*state.OverlaySettings, error) {
	rows, err := db.Query(`SELECT id, owner_type, owner_id, canvas_width, canvas_height, hidden, background_color,
		background_opacity, background_animation, background_animation_speed,
		background_animation_config, background_image, background_image_fit,
		blur, show_border, border_color, border_width, border_radius
		FROM overlay_settings`)
	if err != nil {
		return nil, nil, fmt.Errorf("query overlay_settings: %w", err)
	}
	defer func() { _ = rows.Close() }()

	byKey := map[string]*state.OverlaySettings{}
	byID := map[int64]*state.OverlaySettings{}
	for rows.Next() {
		var ov state.OverlaySettings
		var overlayID int64
		var ownerType, ownerID string
		var hidden, showBorder int
		var bgAnimConfig string
		if err := rows.Scan(&overlayID, &ownerType, &ownerID, &ov.CanvasWidth, &ov.CanvasHeight, &hidden, &ov.BackgroundColor,
			&ov.BackgroundOpacity, &ov.BackgroundAnimation, &ov.BackgroundAnimationSpeed,
			&bgAnimConfig, &ov.BackgroundImage, &ov.BackgroundImageFit, &ov.Blur, &showBorder,
			&ov.BorderColor, &ov.BorderWidth, &ov.BorderRadius); err != nil {
			return nil, nil, fmt.Errorf("scan overlay_settings: %w", err)
		}
		ov.Hidden = hidden != 0
		ov.ShowBorder = showBorder != 0
		if bgAnimConfig != "" {
			ov.BackgroundAnimationConfig = json.RawMessage(bgAnimConfig)
		}
		stored := ov
		byKey[overlayKey(ownerType, ownerID)] = &stored
		byID[overlayID] = &stored
	}
	return byKey, byID, rows.Err()
}

// loadAllOverlayElements reads every overlay_elements row into a map keyed by
// overlay_id.
func loadAllOverlayElements(db *sql.DB) (map[int64][]elemRow, error) {
	rows, err := db.Query(`SELECT overlay_id, id, element_type, visible, x, y, width, height, z_index,
		show_glow, glow_color, glow_opacity, glow_blur, idle_animation, trigger_enter, trigger_exit,
		trigger_decrement, show_label, label_text, format
		FROM overlay_elements`)
	if err != nil {
		return nil, fmt.Errorf("query overlay_elements: %w", err)
	}
	defer func() { _ = rows.Close() }()

	elems := map[int64][]elemRow{}
	for rows.Next() {
		var overlayID int64
		var e elemRow
		var visible int
		if err := rows.Scan(&overlayID, &e.id, &e.elemType, &visible, &e.base.X, &e.base.Y, &e.base.Width,
			&e.base.Height, &e.base.ZIndex, &e.showGlow, &e.glowColor, &e.glowOpacity, &e.glowBlur,
			&e.idleAnim, &e.triggerEnter, &e.triggerExit, &e.triggerDecrement, &e.showLabel, &e.labelText, &e.format); err != nil {
			return nil, fmt.Errorf("scan overlay_element: %w", err)
		}
		e.base.Visible = visible != 0
		elems[overlayID] = append(elems[overlayID], e)
	}
	return elems, rows.Err()
}

// loadAllTextStyles reads every text_styles row plus its gradient stops and
// returns a map keyed by element_id then style_role.
func loadAllTextStyles(db *sql.DB) (map[int64]map[string]state.TextStyle, error) {
	stops, err := loadAllGradientStops(db)
	if err != nil {
		return nil, err
	}

	rows, err := db.Query(`SELECT id, element_id, style_role, font_family, font_size, font_weight, text_align,
		color_type, color, gradient_angle, outline_type, outline_width, outline_color,
		outline_gradient_angle, text_shadow, text_shadow_color, text_shadow_color_type,
		text_shadow_gradient_angle, text_shadow_blur, text_shadow_x, text_shadow_y
		FROM text_styles`)
	if err != nil {
		return nil, fmt.Errorf("query text_styles: %w", err)
	}
	defer func() { _ = rows.Close() }()

	styles := map[int64]map[string]state.TextStyle{}
	for rows.Next() {
		var ts state.TextStyle
		var styleID, elementID int64
		var role string
		var textShadow int
		if err := rows.Scan(&styleID, &elementID, &role, &ts.FontFamily, &ts.FontSize, &ts.FontWeight, &ts.TextAlign,
			&ts.ColorType, &ts.Color, &ts.GradientAngle, &ts.OutlineType, &ts.OutlineWidth, &ts.OutlineColor,
			&ts.OutlineGradientAngle, &textShadow, &ts.TextShadowColor, &ts.TextShadowColorType,
			&ts.TextShadowGradientAngle, &ts.TextShadowBlur, &ts.TextShadowX, &ts.TextShadowY); err != nil {
			return nil, fmt.Errorf("scan text_style: %w", err)
		}
		ts.TextShadow = textShadow != 0
		ts.GradientStops = gradientStopsOrEmpty(stops, styleID, "color")
		ts.OutlineGradientStops = gradientStopsOrEmpty(stops, styleID, "outline")
		ts.TextShadowGradientStops = gradientStopsOrEmpty(stops, styleID, "shadow")
		if styles[elementID] == nil {
			styles[elementID] = map[string]state.TextStyle{}
		}
		styles[elementID][role] = ts
	}
	return styles, rows.Err()
}

// loadAllGradientStops reads every gradient_stops row into a nested map keyed
// by text_style_id then gradient_type, preserving sort_order.
func loadAllGradientStops(db *sql.DB) (map[int64]map[string][]state.GradientStop, error) {
	rows, err := db.Query(`SELECT text_style_id, gradient_type, color, position FROM gradient_stops
		ORDER BY text_style_id, gradient_type, sort_order`)
	if err != nil {
		return nil, fmt.Errorf("query gradient_stops: %w", err)
	}
	defer func() { _ = rows.Close() }()

	stops := map[int64]map[string][]state.GradientStop{}
	for rows.Next() {
		var styleID int64
		var gradientType string
		var gs state.GradientStop
		if err := rows.Scan(&styleID, &gradientType, &gs.Color, &gs.Position); err != nil {
			return nil, err
		}
		if stops[styleID] == nil {
			stops[styleID] = map[string][]state.GradientStop{}
		}
		stops[styleID][gradientType] = append(stops[styleID][gradientType], gs)
	}
	return stops, rows.Err()
}

// gradientStopsOrEmpty returns the stops of a given type for a text style, or a
// non-nil empty slice so JSON serialisation never emits null.
func gradientStopsOrEmpty(stops map[int64]map[string][]state.GradientStop, styleID int64, gradientType string) []state.GradientStop {
	if byType, ok := stops[styleID]; ok {
		if s, ok := byType[gradientType]; ok {
			return s
		}
	}
	return []state.GradientStop{}
}

// emptyTextStyle returns a zero-value TextStyle with non-nil empty gradient
// slices, matching a text_styles row that does not exist.
func emptyTextStyle() state.TextStyle {
	return state.TextStyle{
		GradientStops:           []state.GradientStop{},
		OutlineGradientStops:    []state.GradientStop{},
		TextShadowGradientStops: []state.GradientStop{},
	}
}

// applyOverlayElement dispatches a single element row to the appropriate field
// on the OverlaySettings, resolving text styles via the given lookup.
func applyOverlayElement(ov *state.OverlaySettings, e elemRow, style func(elementID int64, role string) state.TextStyle) {
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
		ov.Name = state.NameElement{
			OverlayElementBase: e.base,
			Style:              style(e.id, "main"),
			IdleAnimation:      idleAnimStr,
			TriggerEnter:       triggerEnterStr,
			TriggerDecrement:   triggerDecrementStr,
		}

	case "title":
		ov.Title = state.TitleElement{
			OverlayElementBase: e.base,
			Style:              style(e.id, "main"),
			IdleAnimation:      idleAnimStr,
			TriggerEnter:       triggerEnterStr,
			TriggerDecrement:   triggerDecrementStr,
		}

	case "counter":
		ov.Counter = state.CounterElement{
			OverlayElementBase: e.base,
			Style:              style(e.id, "main"),
			ShowLabel:          e.showLabel.Valid && e.showLabel.Int64 != 0,
			LabelText:          nullStr(e.labelText),
			LabelStyle:         style(e.id, "label"),
			IdleAnimation:      idleAnimStr,
			TriggerEnter:       triggerEnterStr,
			TriggerDecrement:   triggerDecrementStr,
		}

	case "timer":
		ov.Timer = state.TimerElement{
			OverlayElementBase: e.base,
			Style:              style(e.id, "main"),
			ShowLabel:          e.showLabel.Valid && e.showLabel.Int64 != 0,
			LabelText:          nullStr(e.labelText),
			LabelStyle:         style(e.id, "label"),
			IdleAnimation:      idleAnimStr,
		}

	case "odds":
		format := nullStr(e.format)
		if format == "" {
			format = "fractional"
		}
		ov.Odds = state.OddsElement{
			OverlayElementBase: e.base,
			Style:              style(e.id, "main"),
			ShowLabel:          e.showLabel.Valid && e.showLabel.Int64 != 0,
			LabelText:          nullStr(e.labelText),
			LabelStyle:         style(e.id, "label"),
			Format:             format,
			IdleAnimation:      idleAnimStr,
			TriggerEnter:       triggerEnterStr,
			TriggerDecrement:   triggerDecrementStr,
		}
	}
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
