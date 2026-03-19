// state_save.go implements SaveFullState, which persists the entire AppState
// to the normalized v2 schema tables within a single SQLite transaction.
package database

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// SaveFullState writes every field of st into the normalized v2 tables inside
// one SQLite transaction, so a crash mid-save never leaves partial data.
func (d *DB) SaveFullState(st *state.AppState) error {
	tx, err := d.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	now := time.Now().UTC().Format(time.RFC3339)

	// ── 1. app_config (singleton) ───────────────────────────────────────
	if _, err := tx.Exec(`
		INSERT INTO app_config (id, active_id, license_accepted, data_path, updated_at)
		VALUES (1, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			active_id        = excluded.active_id,
			license_accepted = excluded.license_accepted,
			data_path        = excluded.data_path,
			updated_at       = excluded.updated_at`,
		st.ActiveID, boolToInt(st.LicenseAccepted), st.DataPath, now,
	); err != nil {
		return fmt.Errorf("upsert app_config: %w", err)
	}

	// ── 2. hotkeys ──────────────────────────────────────────────────────
	if err := saveHotkeyRow(tx, &st.Hotkeys); err != nil {
		return err
	}

	// ── 3. settings + languages ─────────────────────────────────────────
	if err := saveSettingsRow(tx, &st.Settings); err != nil {
		return err
	}
	if err := saveLanguages(tx, st.Settings.Languages); err != nil {
		return err
	}

	// ── 4. Global overlay ───────────────────────────────────────────────
	if err := saveOverlay(tx, &st.Settings.Overlay, "global", "default"); err != nil {
		return fmt.Errorf("save global overlay: %w", err)
	}

	// ── 5. pokemon rows + per-pokemon overlays + detector configs ───────
	pokemonIDs := make([]string, len(st.Pokemon))
	for i, p := range st.Pokemon {
		pokemonIDs[i] = p.ID
	}
	if err := savePokemonRows(tx, st.Pokemon, pokemonIDs); err != nil {
		return err
	}
	if err := savePokemonOverlays(tx, st.Pokemon, pokemonIDs); err != nil {
		return err
	}
	if err := saveDetectorConfigs(tx, st.Pokemon, pokemonIDs); err != nil {
		return err
	}

	// ── 6. detector_templates, template_regions, detection_log ──────────
	if err := saveDetectorTemplates(tx, st.Pokemon); err != nil {
		return fmt.Errorf("save detector_templates: %w", err)
	}
	if err := saveTemplateRegions(tx, st.Pokemon); err != nil {
		return fmt.Errorf("save template_regions: %w", err)
	}
	if err := saveDetectionLogs(tx, st.Pokemon); err != nil {
		return fmt.Errorf("save detection_log: %w", err)
	}

	// ── 7. sessions ─────────────────────────────────────────────────────
	if err := saveSessions(tx, st.Sessions); err != nil {
		return err
	}

	return tx.Commit()
}

// ---------------------------------------------------------------------------
// SaveFullState extracted helpers
// ---------------------------------------------------------------------------

// saveHotkeyRow upserts the singleton hotkeys row.
func saveHotkeyRow(tx *sql.Tx, h *state.HotkeyMap) error {
	if _, err := tx.Exec(`
		INSERT INTO hotkeys (id, increment, decrement, reset, next_pokemon)
		VALUES (1, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			increment    = excluded.increment,
			decrement    = excluded.decrement,
			reset        = excluded.reset,
			next_pokemon = excluded.next_pokemon`,
		h.Increment, h.Decrement, h.Reset, h.NextPokemon,
	); err != nil {
		return fmt.Errorf("upsert hotkeys: %w", err)
	}
	return nil
}

// saveSettingsRow upserts the singleton settings row including tutorial flags.
func saveSettingsRow(tx *sql.Tx, s *state.Settings) error {
	if _, err := tx.Exec(`
		INSERT INTO settings (id, output_enabled, output_dir, auto_save, browser_port,
			crisp_sprites, config_path, tutorial_overlay_editor, tutorial_auto_detection)
		VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			output_enabled          = excluded.output_enabled,
			output_dir              = excluded.output_dir,
			auto_save               = excluded.auto_save,
			browser_port            = excluded.browser_port,
			crisp_sprites           = excluded.crisp_sprites,
			config_path             = excluded.config_path,
			tutorial_overlay_editor = excluded.tutorial_overlay_editor,
			tutorial_auto_detection = excluded.tutorial_auto_detection`,
		boolToInt(s.OutputEnabled), s.OutputDir,
		boolToInt(s.AutoSave), s.BrowserPort,
		boolToInt(s.CrispSprites), s.ConfigPath,
		boolToInt(s.TutorialSeen.OverlayEditor),
		boolToInt(s.TutorialSeen.AutoDetection),
	); err != nil {
		return fmt.Errorf("upsert settings: %w", err)
	}
	return nil
}

// saveLanguages replaces all settings_languages rows with the given ordered list.
func saveLanguages(tx *sql.Tx, languages []string) error {
	if _, err := tx.Exec(`DELETE FROM settings_languages`); err != nil {
		return fmt.Errorf("delete settings_languages: %w", err)
	}
	stmt, err := tx.Prepare(`INSERT INTO settings_languages (language, sort_order) VALUES (?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare settings_languages: %w", err)
	}
	defer func() { _ = stmt.Close() }()
	for i, lang := range languages {
		if _, err := stmt.Exec(lang, i); err != nil {
			return fmt.Errorf("insert language %q: %w", lang, err)
		}
	}
	return nil
}

// savePokemonRows deletes removed pokemon and upserts all current ones.
func savePokemonRows(tx *sql.Tx, pokemon []state.Pokemon, pokemonIDs []string) error {
	if err := deleteNotIn(tx, "pokemon", "id", pokemonIDs); err != nil {
		return fmt.Errorf("delete removed pokemon: %w", err)
	}

	stmt, err := tx.Prepare(`
		INSERT INTO pokemon (id, name, title, canonical_name, sprite_url, sprite_type,
			sprite_style, encounters, step, is_active, created_at, language, game,
			completed_at, overlay_mode, hunt_type, timer_started_at, timer_accumulated_ms, sort_order)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name                 = excluded.name,
			title                = excluded.title,
			canonical_name       = excluded.canonical_name,
			sprite_url           = excluded.sprite_url,
			sprite_type          = excluded.sprite_type,
			sprite_style         = excluded.sprite_style,
			encounters           = excluded.encounters,
			step                 = excluded.step,
			is_active            = excluded.is_active,
			created_at           = excluded.created_at,
			language             = excluded.language,
			game                 = excluded.game,
			completed_at         = excluded.completed_at,
			overlay_mode         = excluded.overlay_mode,
			hunt_type            = excluded.hunt_type,
			timer_started_at     = excluded.timer_started_at,
			timer_accumulated_ms = excluded.timer_accumulated_ms,
			sort_order           = excluded.sort_order`)
	if err != nil {
		return fmt.Errorf("prepare pokemon upsert: %w", err)
	}
	defer func() { _ = stmt.Close() }()

	for i, p := range pokemon {
		if _, err := stmt.Exec(
			p.ID, p.Name, p.Title, p.CanonicalName, p.SpriteURL, p.SpriteType,
			p.SpriteStyle, p.Encounters, p.Step, boolToInt(p.IsActive),
			p.CreatedAt.UTC().Format(time.RFC3339), p.Language, p.Game,
			nullTimeStr(p.CompletedAt), p.OverlayMode, p.HuntType,
			nullTimeStr(p.TimerStartedAt), p.TimerAccumulatedMs, i,
		); err != nil {
			return fmt.Errorf("upsert pokemon %q: %w", p.ID, err)
		}
	}
	return nil
}

// savePokemonOverlays syncs per-pokemon overlay_settings, removing stale entries
// and persisting custom overlays.
func savePokemonOverlays(tx *sql.Tx, pokemon []state.Pokemon, pokemonIDs []string) error {
	for _, p := range pokemon {
		if p.Overlay == nil {
			if _, err := tx.Exec(
				`DELETE FROM overlay_settings WHERE owner_type = 'pokemon' AND owner_id = ?`, p.ID,
			); err != nil {
				return fmt.Errorf("delete overlay for pokemon %q: %w", p.ID, err)
			}
		}
	}
	if err := deleteOverlayNotIn(tx, "pokemon", pokemonIDs); err != nil {
		return fmt.Errorf("delete orphan pokemon overlays: %w", err)
	}
	for _, p := range pokemon {
		if p.Overlay != nil {
			if err := saveOverlay(tx, p.Overlay, "pokemon", p.ID); err != nil {
				return fmt.Errorf("save overlay for pokemon %q: %w", p.ID, err)
			}
		}
	}
	return nil
}

// saveDetectorConfigs upserts or deletes detector_configs rows for each pokemon.
func saveDetectorConfigs(tx *sql.Tx, pokemon []state.Pokemon, pokemonIDs []string) error {
	if err := deleteNotIn(tx, "detector_configs", "pokemon_id", pokemonIDs); err != nil {
		return fmt.Errorf("delete orphan detector_configs: %w", err)
	}
	stmt, err := tx.Prepare(`
		INSERT INTO detector_configs (pokemon_id, enabled, source_type,
			region_x, region_y, region_w, region_h, window_title,
			precision_val, consecutive_hits, cooldown_sec, change_threshold,
			poll_interval_ms, min_poll_ms, max_poll_ms)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(pokemon_id) DO UPDATE SET
			enabled          = excluded.enabled,
			source_type      = excluded.source_type,
			region_x         = excluded.region_x,
			region_y         = excluded.region_y,
			region_w         = excluded.region_w,
			region_h         = excluded.region_h,
			window_title     = excluded.window_title,
			precision_val    = excluded.precision_val,
			consecutive_hits = excluded.consecutive_hits,
			cooldown_sec     = excluded.cooldown_sec,
			change_threshold = excluded.change_threshold,
			poll_interval_ms = excluded.poll_interval_ms,
			min_poll_ms      = excluded.min_poll_ms,
			max_poll_ms      = excluded.max_poll_ms`)
	if err != nil {
		return fmt.Errorf("prepare detector_configs upsert: %w", err)
	}
	defer func() { _ = stmt.Close() }()

	for _, p := range pokemon {
		if p.DetectorConfig == nil {
			if _, err := tx.Exec(`DELETE FROM detector_configs WHERE pokemon_id = ?`, p.ID); err != nil {
				return fmt.Errorf("delete detector_config for %q: %w", p.ID, err)
			}
			continue
		}
		cfg := p.DetectorConfig
		if _, err := stmt.Exec(
			p.ID, boolToInt(cfg.Enabled), cfg.SourceType,
			cfg.Region.X, cfg.Region.Y, cfg.Region.W, cfg.Region.H,
			cfg.WindowTitle, cfg.Precision, cfg.ConsecutiveHits,
			cfg.CooldownSec, cfg.ChangeThreshold,
			cfg.PollIntervalMs, cfg.MinPollMs, cfg.MaxPollMs,
		); err != nil {
			return fmt.Errorf("upsert detector_config for %q: %w", p.ID, err)
		}
	}
	return nil
}

// saveSessions replaces all session rows.
func saveSessions(tx *sql.Tx, sessions []state.Session) error {
	if _, err := tx.Exec(`DELETE FROM sessions`); err != nil {
		return fmt.Errorf("delete sessions: %w", err)
	}
	stmt, err := tx.Prepare(`
		INSERT INTO sessions (id, pokemon_id, started_at, ended_at, encounters)
		VALUES (?, ?, ?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare sessions: %w", err)
	}
	defer func() { _ = stmt.Close() }()
	for _, s := range sessions {
		if _, err := stmt.Exec(
			s.ID, s.PokemonID,
			s.StartedAt.UTC().Format(time.RFC3339),
			nullTimeStr(s.EndedAt),
			s.Encounters,
		); err != nil {
			return fmt.Errorf("insert session %q: %w", s.ID, err)
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Overlay helpers
// ---------------------------------------------------------------------------

// saveOverlay persists one OverlaySettings into overlay_settings, overlay_elements,
// text_styles, and gradient_stops. It upserts the settings row by (owner_type, owner_id),
// then replaces all child rows.
func saveOverlay(tx *sql.Tx, ov *state.OverlaySettings, ownerType, ownerID string) error {
	// Upsert the overlay_settings row.
	if _, err := tx.Exec(`
		INSERT INTO overlay_settings (owner_type, owner_id,
			canvas_width, canvas_height, hidden, background_color, background_opacity,
			background_animation, background_animation_speed, background_image,
			background_image_fit, blur, show_border, border_color, border_width, border_radius)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(owner_type, owner_id) DO UPDATE SET
			canvas_width               = excluded.canvas_width,
			canvas_height              = excluded.canvas_height,
			hidden                     = excluded.hidden,
			background_color           = excluded.background_color,
			background_opacity         = excluded.background_opacity,
			background_animation       = excluded.background_animation,
			background_animation_speed = excluded.background_animation_speed,
			background_image           = excluded.background_image,
			background_image_fit       = excluded.background_image_fit,
			blur                       = excluded.blur,
			show_border                = excluded.show_border,
			border_color               = excluded.border_color,
			border_width               = excluded.border_width,
			border_radius              = excluded.border_radius`,
		ownerType, ownerID,
		ov.CanvasWidth, ov.CanvasHeight, boolToInt(ov.Hidden),
		ov.BackgroundColor, ov.BackgroundOpacity,
		ov.BackgroundAnimation, ov.BackgroundAnimationSpeed,
		ov.BackgroundImage, ov.BackgroundImageFit,
		ov.Blur, boolToInt(ov.ShowBorder), ov.BorderColor, ov.BorderWidth, ov.BorderRadius,
	); err != nil {
		return fmt.Errorf("upsert overlay_settings: %w", err)
	}

	// Retrieve the auto-increment ID for child rows.
	var overlayID int64
	if err := tx.QueryRow(
		`SELECT id FROM overlay_settings WHERE owner_type = ? AND owner_id = ?`,
		ownerType, ownerID,
	).Scan(&overlayID); err != nil {
		return fmt.Errorf("get overlay_settings id: %w", err)
	}

	// Delete existing child elements (cascades to text_styles and gradient_stops).
	if _, err := tx.Exec(`DELETE FROM overlay_elements WHERE overlay_id = ?`, overlayID); err != nil {
		return fmt.Errorf("delete overlay_elements: %w", err)
	}

	// Insert sprite element.
	spriteID, err := insertElement(tx, elementInsertParams{
		overlayID:    overlayID,
		elemType:     "sprite",
		base:         &ov.Sprite.OverlayElementBase,
		showGlow:     boolToInt(ov.Sprite.ShowGlow),
		glowColor:    ov.Sprite.GlowColor,
		glowOpacity:  ov.Sprite.GlowOpacity,
		glowBlur:     ov.Sprite.GlowBlur,
		idleAnim:     ov.Sprite.IdleAnimation,
		triggerEnter: ov.Sprite.TriggerEnter,
		triggerExit:  ov.Sprite.TriggerExit,
	})
	if err != nil {
		return fmt.Errorf("insert sprite element: %w", err)
	}
	// Sprite has no text styles, but we keep spriteID for consistency.
	_ = spriteID

	// Insert name element with main text style.
	nameID, err := insertElement(tx, elementInsertParams{
		overlayID:    overlayID,
		elemType:     "name",
		base:         &ov.Name.OverlayElementBase,
		idleAnim:     ov.Name.IdleAnimation,
		triggerEnter: ov.Name.TriggerEnter,
	})
	if err != nil {
		return fmt.Errorf("insert name element: %w", err)
	}
	if err := saveTextStyle(tx, nameID, "main", &ov.Name.Style); err != nil {
		return fmt.Errorf("save name text style: %w", err)
	}

	// Insert title element with main text style.
	titleID, err := insertElement(tx, elementInsertParams{
		overlayID:    overlayID,
		elemType:     "title",
		base:         &ov.Title.OverlayElementBase,
		idleAnim:     ov.Title.IdleAnimation,
		triggerEnter: ov.Title.TriggerEnter,
	})
	if err != nil {
		return fmt.Errorf("insert title element: %w", err)
	}
	if err := saveTextStyle(tx, titleID, "main", &ov.Title.Style); err != nil {
		return fmt.Errorf("save title text style: %w", err)
	}

	// Insert counter element with main + label text styles.
	counterID, err := insertElement(tx, elementInsertParams{
		overlayID:    overlayID,
		elemType:     "counter",
		base:         &ov.Counter.OverlayElementBase,
		idleAnim:     ov.Counter.IdleAnimation,
		triggerEnter: ov.Counter.TriggerEnter,
		showLabel:    ov.Counter.ShowLabel,
		labelText:    ov.Counter.LabelText,
	})
	if err != nil {
		return fmt.Errorf("insert counter element: %w", err)
	}
	if err := saveTextStyle(tx, counterID, "main", &ov.Counter.Style); err != nil {
		return fmt.Errorf("save counter main text style: %w", err)
	}
	if err := saveTextStyle(tx, counterID, "label", &ov.Counter.LabelStyle); err != nil {
		return fmt.Errorf("save counter label text style: %w", err)
	}

	return nil
}

// elementInsertParams groups all columns for an overlay_elements row,
// keeping the call sites readable and avoiding a 13-parameter function.
type elementInsertParams struct {
	overlayID    int64
	elemType     string
	base         *state.OverlayElementBase
	showGlow     int
	glowColor    string
	glowOpacity  float64
	glowBlur     int
	idleAnim     string
	triggerEnter string
	triggerExit  string
	showLabel    bool
	labelText    string
}

// insertElement inserts one overlay_elements row and returns its auto-increment ID.
// showGlow/glowColor/glowOpacity/glowBlur are nullable and only meaningful for sprite.
func insertElement(tx *sql.Tx, p elementInsertParams) (int64, error) {
	// Use sql.NullInt64/NullString for sprite-only and counter-only fields.
	var glowShowVal, glowBlurVal sql.NullInt64
	var glowColorVal sql.NullString
	var glowOpacityVal sql.NullFloat64
	var showLabelVal sql.NullInt64
	var labelTextVal sql.NullString

	if p.elemType == "sprite" {
		glowShowVal = sql.NullInt64{Int64: int64(p.showGlow), Valid: true}
		glowColorVal = sql.NullString{String: p.glowColor, Valid: true}
		glowOpacityVal = sql.NullFloat64{Float64: p.glowOpacity, Valid: true}
		glowBlurVal = sql.NullInt64{Int64: int64(p.glowBlur), Valid: true}
	}
	if p.elemType == "counter" {
		showLabelVal = sql.NullInt64{Int64: int64(boolToInt(p.showLabel)), Valid: true}
		labelTextVal = sql.NullString{String: p.labelText, Valid: true}
	}

	res, err := tx.Exec(`
		INSERT INTO overlay_elements (overlay_id, element_type, visible, x, y, width, height,
			z_index, show_glow, glow_color, glow_opacity, glow_blur,
			idle_animation, trigger_enter, trigger_exit, show_label, label_text)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.overlayID, p.elemType, boolToInt(p.base.Visible), p.base.X, p.base.Y, p.base.Width, p.base.Height,
		p.base.ZIndex, glowShowVal, glowColorVal, glowOpacityVal, glowBlurVal,
		p.idleAnim, p.triggerEnter, p.triggerExit, showLabelVal, labelTextVal,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// saveTextStyle persists one TextStyle row and its gradient stops.
func saveTextStyle(tx *sql.Tx, elementID int64, role string, style *state.TextStyle) error {
	res, err := tx.Exec(`
		INSERT INTO text_styles (element_id, style_role, font_family, font_size, font_weight,
			text_align, color_type, color, gradient_angle, outline_type, outline_width,
			outline_color, outline_gradient_angle, text_shadow, text_shadow_color,
			text_shadow_color_type, text_shadow_gradient_angle, text_shadow_blur,
			text_shadow_x, text_shadow_y)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		elementID, role, style.FontFamily, style.FontSize, style.FontWeight,
		style.TextAlign, style.ColorType, style.Color, style.GradientAngle,
		style.OutlineType, style.OutlineWidth, style.OutlineColor, style.OutlineGradientAngle,
		boolToInt(style.TextShadow), style.TextShadowColor, style.TextShadowColorType,
		style.TextShadowGradientAngle, style.TextShadowBlur, style.TextShadowX, style.TextShadowY,
	)
	if err != nil {
		return fmt.Errorf("insert text_style: %w", err)
	}
	styleID, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("get text_style id: %w", err)
	}

	// Insert gradient stops for the three gradient types.
	if err := insertGradientStops(tx, styleID, "color", style.GradientStops); err != nil {
		return err
	}
	if err := insertGradientStops(tx, styleID, "outline", style.OutlineGradientStops); err != nil {
		return err
	}
	if err := insertGradientStops(tx, styleID, "shadow", style.TextShadowGradientStops); err != nil {
		return err
	}
	return nil
}

// insertGradientStops inserts a slice of GradientStop rows for a text_style.
func insertGradientStops(tx *sql.Tx, styleID int64, gradientType string, stops []state.GradientStop) error {
	if len(stops) == 0 {
		return nil
	}
	stmt, err := tx.Prepare(`
		INSERT INTO gradient_stops (text_style_id, gradient_type, color, position, sort_order)
		VALUES (?, ?, ?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare gradient_stops: %w", err)
	}
	defer func() { _ = stmt.Close() }()
	for i, s := range stops {
		if _, err := stmt.Exec(styleID, gradientType, s.Color, s.Position, i); err != nil {
			return fmt.Errorf("insert gradient_stop: %w", err)
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Detector helpers
// ---------------------------------------------------------------------------

// saveDetectorTemplates handles upsert/insert/delete logic for detector_templates.
func saveDetectorTemplates(tx *sql.Tx, pokemon []state.Pokemon) error {
	referencedIDs, err := upsertDetectorTemplates(tx, pokemon)
	if err != nil {
		return err
	}
	return deleteUnreferencedTemplates(tx, referencedIDs)
}

// upsertDetectorTemplates updates existing templates and inserts new ones,
// returning the set of DB IDs that are still in use.
func upsertDetectorTemplates(tx *sql.Tx, pokemon []state.Pokemon) (map[int64]bool, error) {
	referencedIDs := map[int64]bool{}
	for _, p := range pokemon {
		if p.DetectorConfig == nil {
			continue
		}
		for sortOrder, tmpl := range p.DetectorConfig.Templates {
			if tmpl.TemplateDBID > 0 {
				if _, err := tx.Exec(
					`UPDATE detector_templates SET sort_order = ? WHERE id = ?`,
					sortOrder, tmpl.TemplateDBID,
				); err != nil {
					return nil, fmt.Errorf("update template sort_order %d: %w", tmpl.TemplateDBID, err)
				}
				referencedIDs[tmpl.TemplateDBID] = true
			} else if tmpl.ImageData != nil {
				res, err := tx.Exec(
					`INSERT INTO detector_templates (pokemon_id, image_data, sort_order) VALUES (?, ?, ?)`,
					p.ID, tmpl.ImageData, sortOrder,
				)
				if err != nil {
					return nil, fmt.Errorf("insert new template for %q: %w", p.ID, err)
				}
				newID, _ := res.LastInsertId()
				referencedIDs[newID] = true
			}
		}
	}
	return referencedIDs, nil
}

// deleteUnreferencedTemplates removes detector_templates rows whose IDs are
// not in the referencedIDs set.
func deleteUnreferencedTemplates(tx *sql.Tx, referencedIDs map[int64]bool) error {
	rows, err := tx.Query(`SELECT id FROM detector_templates`)
	if err != nil {
		return fmt.Errorf("query detector_templates: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var toDelete []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("scan template id: %w", err)
		}
		if !referencedIDs[id] {
			toDelete = append(toDelete, id)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate template ids: %w", err)
	}
	for _, id := range toDelete {
		if _, err := tx.Exec(`DELETE FROM detector_templates WHERE id = ?`, id); err != nil {
			return fmt.Errorf("delete template %d: %w", id, err)
		}
	}
	return nil
}

// saveTemplateRegions replaces all template_regions for every template.
func saveTemplateRegions(tx *sql.Tx, pokemon []state.Pokemon) error {
	if err := saveExistingTemplateRegions(tx, pokemon); err != nil {
		return err
	}
	return saveNewTemplateRegions(tx, pokemon)
}

// saveExistingTemplateRegions replaces regions for templates that already
// have a database ID (TemplateDBID > 0).
func saveExistingTemplateRegions(tx *sql.Tx, pokemon []state.Pokemon) error {
	for _, p := range pokemon {
		if p.DetectorConfig == nil {
			continue
		}
		for _, tmpl := range p.DetectorConfig.Templates {
			if tmpl.TemplateDBID <= 0 {
				continue
			}
			if _, err := tx.Exec(`DELETE FROM template_regions WHERE template_id = ?`, tmpl.TemplateDBID); err != nil {
				return fmt.Errorf("delete regions for template %d: %w", tmpl.TemplateDBID, err)
			}
			if err := insertRegions(tx, tmpl.TemplateDBID, tmpl.Regions); err != nil {
				return err
			}
		}
	}
	return nil
}

// saveNewTemplateRegions handles regions for newly inserted templates
// (TemplateDBID was 0) by looking them up via pokemon_id + sort_order.
func saveNewTemplateRegions(tx *sql.Tx, pokemon []state.Pokemon) error {
	for _, p := range pokemon {
		if p.DetectorConfig == nil {
			continue
		}
		for sortOrder, tmpl := range p.DetectorConfig.Templates {
			if tmpl.TemplateDBID > 0 || tmpl.ImageData == nil {
				continue
			}
			var newID int64
			err := tx.QueryRow(
				`SELECT id FROM detector_templates WHERE pokemon_id = ? AND sort_order = ?`,
				p.ID, sortOrder,
			).Scan(&newID)
			if err != nil {
				return fmt.Errorf("find new template for %q sort %d: %w", p.ID, sortOrder, err)
			}
			if err := insertRegions(tx, newID, tmpl.Regions); err != nil {
				return err
			}
		}
	}
	return nil
}

// insertRegions inserts a slice of MatchedRegion rows for a given template ID.
func insertRegions(tx *sql.Tx, templateID int64, regions []state.MatchedRegion) error {
	for i, r := range regions {
		if _, err := tx.Exec(`
			INSERT INTO template_regions (template_id, type, expected_text,
				rect_x, rect_y, rect_w, rect_h, sort_order)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			templateID, r.Type, r.ExpectedText,
			r.Rect.X, r.Rect.Y, r.Rect.W, r.Rect.H, i,
		); err != nil {
			return fmt.Errorf("insert region for template %d: %w", templateID, err)
		}
	}
	return nil
}

// saveDetectionLogs syncs detection_log entries for each pokemon with a detector config.
// Entries are capped at 20 per pokemon.
func saveDetectionLogs(tx *sql.Tx, pokemon []state.Pokemon) error {
	cfgIDs := collectDetectorPokemonIDs(pokemon)
	if err := deleteNotIn(tx, "detection_log", "pokemon_id", cfgIDs); err != nil {
		return fmt.Errorf("delete orphan detection_log: %w", err)
	}
	for _, p := range pokemon {
		if p.DetectorConfig == nil {
			continue
		}
		if err := replacePokemonDetectionLog(tx, p); err != nil {
			return err
		}
	}
	return nil
}

// collectDetectorPokemonIDs returns the IDs of Pokemon that have a DetectorConfig.
func collectDetectorPokemonIDs(pokemon []state.Pokemon) []string {
	ids := make([]string, 0, len(pokemon))
	for _, p := range pokemon {
		if p.DetectorConfig != nil {
			ids = append(ids, p.ID)
		}
	}
	return ids
}

// replacePokemonDetectionLog deletes and re-inserts detection_log entries
// for a single Pokemon, capped at 20 entries.
func replacePokemonDetectionLog(tx *sql.Tx, p state.Pokemon) error {
	if _, err := tx.Exec(`DELETE FROM detection_log WHERE pokemon_id = ?`, p.ID); err != nil {
		return fmt.Errorf("delete detection_log for %q: %w", p.ID, err)
	}
	entries := p.DetectorConfig.DetectionLog
	if len(entries) > 20 {
		entries = entries[len(entries)-20:]
	}
	for _, e := range entries {
		if _, err := tx.Exec(
			`INSERT INTO detection_log (pokemon_id, at, confidence) VALUES (?, ?, ?)`,
			p.ID, e.At.UTC().Format(time.RFC3339), e.Confidence,
		); err != nil {
			return fmt.Errorf("insert detection_log for %q: %w", p.ID, err)
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

// boolToInt converts a Go bool to a SQLite-compatible integer (0 or 1).
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// nullTimeStr converts a *time.Time to a sql.NullString suitable for TEXT columns.
// Returns a null string if t is nil, otherwise an RFC3339-formatted UTC timestamp.
func nullTimeStr(t *time.Time) sql.NullString {
	if t == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: t.UTC().Format(time.RFC3339), Valid: true}
}

// deleteNotIn removes rows from table where column is not in the given values.
// If values is empty, all rows are deleted.
func deleteNotIn(tx *sql.Tx, table, column string, values []string) error {
	if len(values) == 0 {
		_, err := tx.Exec(fmt.Sprintf("DELETE FROM %s", table))
		return err
	}
	placeholders, args := buildPlaceholders(values)
	query := fmt.Sprintf("DELETE FROM %s WHERE %s NOT IN (%s)", table, column, placeholders)
	_, err := tx.Exec(query, args...)
	return err
}

// deleteOverlayNotIn removes overlay_settings rows of the given owner_type
// whose owner_id is not in the allowed set.
func deleteOverlayNotIn(tx *sql.Tx, ownerType string, allowedIDs []string) error {
	if len(allowedIDs) == 0 {
		_, err := tx.Exec(`DELETE FROM overlay_settings WHERE owner_type = ?`, ownerType)
		return err
	}
	placeholders, idArgs := buildPlaceholders(allowedIDs)
	args := make([]any, 0, 1+len(idArgs))
	args = append(args, ownerType)
	args = append(args, idArgs...)
	query := fmt.Sprintf(
		"DELETE FROM overlay_settings WHERE owner_type = ? AND owner_id NOT IN (%s)",
		placeholders,
	)
	_, err := tx.Exec(query, args...)
	return err
}

// buildPlaceholders constructs a comma-separated "?, ?, ?" placeholder string
// and a corresponding []any argument slice from string values.
func buildPlaceholders(values []string) (string, []any) {
	var b strings.Builder
	args := make([]any, len(values))
	for i, v := range values {
		if i > 0 {
			b.WriteString(", ")
		}
		b.WriteByte('?')
		args[i] = v
	}
	return b.String(), args
}
