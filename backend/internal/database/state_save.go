// state_save.go implements SaveFullState, which persists the entire AppState
// to the normalized v2 schema tables within a single SQLite transaction.
package database

import (
	"database/sql"
	"fmt"
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

	// ── 2. hotkeys (singleton) ──────────────────────────────────────────
	if _, err := tx.Exec(`
		INSERT INTO hotkeys (id, increment, decrement, reset, next_pokemon)
		VALUES (1, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			increment    = excluded.increment,
			decrement    = excluded.decrement,
			reset        = excluded.reset,
			next_pokemon = excluded.next_pokemon`,
		st.Hotkeys.Increment, st.Hotkeys.Decrement,
		st.Hotkeys.Reset, st.Hotkeys.NextPokemon,
	); err != nil {
		return fmt.Errorf("upsert hotkeys: %w", err)
	}

	// ── 3. settings (singleton, TutorialFlags flattened inline) ─────────
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
		boolToInt(st.Settings.OutputEnabled), st.Settings.OutputDir,
		boolToInt(st.Settings.AutoSave), st.Settings.BrowserPort,
		boolToInt(st.Settings.CrispSprites), st.Settings.ConfigPath,
		boolToInt(st.Settings.TutorialSeen.OverlayEditor),
		boolToInt(st.Settings.TutorialSeen.AutoDetection),
	); err != nil {
		return fmt.Errorf("upsert settings: %w", err)
	}

	// ── 4. settings_languages ───────────────────────────────────────────
	if _, err := tx.Exec(`DELETE FROM settings_languages`); err != nil {
		return fmt.Errorf("delete settings_languages: %w", err)
	}
	langStmt, err := tx.Prepare(`INSERT INTO settings_languages (language, sort_order) VALUES (?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare settings_languages: %w", err)
	}
	defer func() { _ = langStmt.Close() }()
	for i, lang := range st.Settings.Languages {
		if _, err := langStmt.Exec(lang, i); err != nil {
			return fmt.Errorf("insert language %q: %w", lang, err)
		}
	}

	// ── 5. Global overlay ───────────────────────────────────────────────
	if err := saveOverlay(tx, &st.Settings.Overlay, "global", "default"); err != nil {
		return fmt.Errorf("save global overlay: %w", err)
	}

	// ── 6. pokemon — delete removed, upsert existing ────────────────────
	// Build set of current IDs for cleanup queries.
	pokemonIDs := make([]string, len(st.Pokemon))
	for i, p := range st.Pokemon {
		pokemonIDs[i] = p.ID
	}
	if err := deleteNotIn(tx, "pokemon", "id", pokemonIDs); err != nil {
		return fmt.Errorf("delete removed pokemon: %w", err)
	}

	pokemonStmt, err := tx.Prepare(`
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
	defer func() { _ = pokemonStmt.Close() }()

	for i, p := range st.Pokemon {
		if _, err := pokemonStmt.Exec(
			p.ID, p.Name, p.Title, p.CanonicalName, p.SpriteURL, p.SpriteType,
			p.SpriteStyle, p.Encounters, p.Step, boolToInt(p.IsActive),
			p.CreatedAt.UTC().Format(time.RFC3339), p.Language, p.Game,
			nullTimeStr(p.CompletedAt), p.OverlayMode, p.HuntType,
			nullTimeStr(p.TimerStartedAt), p.TimerAccumulatedMs, i,
		); err != nil {
			return fmt.Errorf("upsert pokemon %q: %w", p.ID, err)
		}
	}

	// ── 7. Per-pokemon overlays ─────────────────────────────────────────
	// Delete overlay_settings for pokemon that no longer have custom overlays.
	for _, p := range st.Pokemon {
		if p.Overlay == nil {
			if _, err := tx.Exec(
				`DELETE FROM overlay_settings WHERE owner_type = 'pokemon' AND owner_id = ?`, p.ID,
			); err != nil {
				return fmt.Errorf("delete overlay for pokemon %q: %w", p.ID, err)
			}
		}
	}
	// Delete overlay_settings for pokemon that were removed entirely.
	if err := deleteOverlayNotIn(tx, "pokemon", pokemonIDs); err != nil {
		return fmt.Errorf("delete orphan pokemon overlays: %w", err)
	}
	// Save overlays for pokemon that have them.
	for _, p := range st.Pokemon {
		if p.Overlay != nil {
			if err := saveOverlay(tx, p.Overlay, "pokemon", p.ID); err != nil {
				return fmt.Errorf("save overlay for pokemon %q: %w", p.ID, err)
			}
		}
	}

	// ── 8. detector_configs ─────────────────────────────────────────────
	// Delete configs for removed pokemon.
	if err := deleteNotIn(tx, "detector_configs", "pokemon_id", pokemonIDs); err != nil {
		return fmt.Errorf("delete orphan detector_configs: %w", err)
	}
	detCfgStmt, err := tx.Prepare(`
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
	defer func() { _ = detCfgStmt.Close() }()

	for _, p := range st.Pokemon {
		if p.DetectorConfig == nil {
			// Delete config row if it existed.
			if _, err := tx.Exec(`DELETE FROM detector_configs WHERE pokemon_id = ?`, p.ID); err != nil {
				return fmt.Errorf("delete detector_config for %q: %w", p.ID, err)
			}
			continue
		}
		cfg := p.DetectorConfig
		if _, err := detCfgStmt.Exec(
			p.ID, boolToInt(cfg.Enabled), cfg.SourceType,
			cfg.Region.X, cfg.Region.Y, cfg.Region.W, cfg.Region.H,
			cfg.WindowTitle, cfg.Precision, cfg.ConsecutiveHits,
			cfg.CooldownSec, cfg.ChangeThreshold,
			cfg.PollIntervalMs, cfg.MinPollMs, cfg.MaxPollMs,
		); err != nil {
			return fmt.Errorf("upsert detector_config for %q: %w", p.ID, err)
		}
	}

	// ── 9. detector_templates ───────────────────────────────────────────
	if err := saveDetectorTemplates(tx, st.Pokemon); err != nil {
		return fmt.Errorf("save detector_templates: %w", err)
	}

	// ── 10. template_regions ────────────────────────────────────────────
	if err := saveTemplateRegions(tx, st.Pokemon); err != nil {
		return fmt.Errorf("save template_regions: %w", err)
	}

	// ── 11. detection_log ───────────────────────────────────────────────
	if err := saveDetectionLogs(tx, st.Pokemon); err != nil {
		return fmt.Errorf("save detection_log: %w", err)
	}

	// ── 12. sessions ────────────────────────────────────────────────────
	if _, err := tx.Exec(`DELETE FROM sessions`); err != nil {
		return fmt.Errorf("delete sessions: %w", err)
	}
	sessStmt, err := tx.Prepare(`
		INSERT INTO sessions (id, pokemon_id, started_at, ended_at, encounters)
		VALUES (?, ?, ?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare sessions: %w", err)
	}
	defer func() { _ = sessStmt.Close() }()
	for _, s := range st.Sessions {
		if _, err := sessStmt.Exec(
			s.ID, s.PokemonID,
			s.StartedAt.UTC().Format(time.RFC3339),
			nullTimeStr(s.EndedAt),
			s.Encounters,
		); err != nil {
			return fmt.Errorf("insert session %q: %w", s.ID, err)
		}
	}

	return tx.Commit()
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
	spriteID, err := insertElement(tx, overlayID, "sprite", &ov.Sprite.OverlayElementBase,
		boolToInt(ov.Sprite.ShowGlow), ov.Sprite.GlowColor, ov.Sprite.GlowOpacity, ov.Sprite.GlowBlur,
		ov.Sprite.IdleAnimation, ov.Sprite.TriggerEnter, ov.Sprite.TriggerExit,
		false, "")
	if err != nil {
		return fmt.Errorf("insert sprite element: %w", err)
	}
	// Sprite has no text styles, but we keep spriteID for consistency.
	_ = spriteID

	// Insert name element with main text style.
	nameID, err := insertElement(tx, overlayID, "name", &ov.Name.OverlayElementBase,
		0, "", 0, 0,
		ov.Name.IdleAnimation, ov.Name.TriggerEnter, "",
		false, "")
	if err != nil {
		return fmt.Errorf("insert name element: %w", err)
	}
	if err := saveTextStyle(tx, nameID, "main", &ov.Name.Style); err != nil {
		return fmt.Errorf("save name text style: %w", err)
	}

	// Insert title element with main text style.
	titleID, err := insertElement(tx, overlayID, "title", &ov.Title.OverlayElementBase,
		0, "", 0, 0,
		ov.Title.IdleAnimation, ov.Title.TriggerEnter, "",
		false, "")
	if err != nil {
		return fmt.Errorf("insert title element: %w", err)
	}
	if err := saveTextStyle(tx, titleID, "main", &ov.Title.Style); err != nil {
		return fmt.Errorf("save title text style: %w", err)
	}

	// Insert counter element with main + label text styles.
	counterID, err := insertElement(tx, overlayID, "counter", &ov.Counter.OverlayElementBase,
		0, "", 0, 0,
		ov.Counter.IdleAnimation, ov.Counter.TriggerEnter, "",
		ov.Counter.ShowLabel, ov.Counter.LabelText)
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

// insertElement inserts one overlay_elements row and returns its auto-increment ID.
// showGlow/glowColor/glowOpacity/glowBlur are nullable and only meaningful for sprite.
func insertElement(tx *sql.Tx, overlayID int64, elemType string, base *state.OverlayElementBase,
	showGlow int, glowColor string, glowOpacity float64, glowBlur int,
	idleAnim, triggerEnter, triggerExit string,
	showLabel bool, labelText string,
) (int64, error) {
	// Use sql.NullInt64/NullString for sprite-only and counter-only fields.
	var glowShowVal, glowBlurVal sql.NullInt64
	var glowColorVal sql.NullString
	var glowOpacityVal sql.NullFloat64
	var showLabelVal sql.NullInt64
	var labelTextVal sql.NullString

	if elemType == "sprite" {
		glowShowVal = sql.NullInt64{Int64: int64(showGlow), Valid: true}
		glowColorVal = sql.NullString{String: glowColor, Valid: true}
		glowOpacityVal = sql.NullFloat64{Float64: glowOpacity, Valid: true}
		glowBlurVal = sql.NullInt64{Int64: int64(glowBlur), Valid: true}
	}
	if elemType == "counter" {
		showLabelVal = sql.NullInt64{Int64: int64(boolToInt(showLabel)), Valid: true}
		labelTextVal = sql.NullString{String: labelText, Valid: true}
	}

	res, err := tx.Exec(`
		INSERT INTO overlay_elements (overlay_id, element_type, visible, x, y, width, height,
			z_index, show_glow, glow_color, glow_opacity, glow_blur,
			idle_animation, trigger_enter, trigger_exit, show_label, label_text)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		overlayID, elemType, boolToInt(base.Visible), base.X, base.Y, base.Width, base.Height,
		base.ZIndex, glowShowVal, glowColorVal, glowOpacityVal, glowBlurVal,
		idleAnim, triggerEnter, triggerExit, showLabelVal, labelTextVal,
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
	// Collect all referenced template DB IDs to know which to keep.
	referencedIDs := map[int64]bool{}

	for _, p := range pokemon {
		if p.DetectorConfig == nil {
			continue
		}
		for sortOrder, tmpl := range p.DetectorConfig.Templates {
			if tmpl.TemplateDBID > 0 {
				// Existing template: update sort_order only (image_data managed separately).
				if _, err := tx.Exec(
					`UPDATE detector_templates SET sort_order = ? WHERE id = ?`,
					sortOrder, tmpl.TemplateDBID,
				); err != nil {
					return fmt.Errorf("update template sort_order %d: %w", tmpl.TemplateDBID, err)
				}
				referencedIDs[tmpl.TemplateDBID] = true
			} else if tmpl.ImageData != nil {
				// New template with image data: insert with BLOB.
				res, err := tx.Exec(
					`INSERT INTO detector_templates (pokemon_id, image_data, sort_order) VALUES (?, ?, ?)`,
					p.ID, tmpl.ImageData, sortOrder,
				)
				if err != nil {
					return fmt.Errorf("insert new template for %q: %w", p.ID, err)
				}
				newID, _ := res.LastInsertId()
				referencedIDs[newID] = true
			}
			// If TemplateDBID == 0 && ImagePath != "": legacy, skip (handled by migration).
		}
	}

	// Delete templates no longer referenced. Query all existing IDs and remove unreferenced ones.
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
	for _, p := range pokemon {
		if p.DetectorConfig == nil {
			continue
		}
		for _, tmpl := range p.DetectorConfig.Templates {
			if tmpl.TemplateDBID <= 0 {
				// New templates were just inserted; we need their IDs.
				// Since new templates got inserted in saveDetectorTemplates, we cannot
				// easily link back without the returned ID. For new templates the regions
				// are saved by looking up templates by (pokemon_id, sort_order).
				continue
			}
			// Delete old regions for this template.
			if _, err := tx.Exec(`DELETE FROM template_regions WHERE template_id = ?`, tmpl.TemplateDBID); err != nil {
				return fmt.Errorf("delete regions for template %d: %w", tmpl.TemplateDBID, err)
			}
			// Insert new regions.
			for i, r := range tmpl.Regions {
				if _, err := tx.Exec(`
					INSERT INTO template_regions (template_id, type, expected_text,
						rect_x, rect_y, rect_w, rect_h, sort_order)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
					tmpl.TemplateDBID, r.Type, r.ExpectedText,
					r.Rect.X, r.Rect.Y, r.Rect.W, r.Rect.H, i,
				); err != nil {
					return fmt.Errorf("insert region for template %d: %w", tmpl.TemplateDBID, err)
				}
			}
		}
	}

	// Also handle regions for newly inserted templates (TemplateDBID was 0).
	// Look them up by pokemon_id and sort_order.
	for _, p := range pokemon {
		if p.DetectorConfig == nil {
			continue
		}
		for sortOrder, tmpl := range p.DetectorConfig.Templates {
			if tmpl.TemplateDBID > 0 || tmpl.ImageData == nil {
				continue // Already handled above, or legacy path.
			}
			// Find the newly inserted template by pokemon_id + sort_order.
			var newID int64
			err := tx.QueryRow(
				`SELECT id FROM detector_templates WHERE pokemon_id = ? AND sort_order = ?`,
				p.ID, sortOrder,
			).Scan(&newID)
			if err != nil {
				return fmt.Errorf("find new template for %q sort %d: %w", p.ID, sortOrder, err)
			}
			for i, r := range tmpl.Regions {
				if _, err := tx.Exec(`
					INSERT INTO template_regions (template_id, type, expected_text,
						rect_x, rect_y, rect_w, rect_h, sort_order)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
					newID, r.Type, r.ExpectedText,
					r.Rect.X, r.Rect.Y, r.Rect.W, r.Rect.H, i,
				); err != nil {
					return fmt.Errorf("insert region for new template %d: %w", newID, err)
				}
			}
		}
	}
	return nil
}

// saveDetectionLogs syncs detection_log entries for each pokemon with a detector config.
// Entries are capped at 20 per pokemon.
func saveDetectionLogs(tx *sql.Tx, pokemon []state.Pokemon) error {
	// Collect pokemon IDs that have detector configs.
	cfgIDs := make([]string, 0, len(pokemon))
	for _, p := range pokemon {
		if p.DetectorConfig != nil {
			cfgIDs = append(cfgIDs, p.ID)
		}
	}

	// Delete all detection_log for pokemon that no longer have configs.
	if err := deleteNotIn(tx, "detection_log", "pokemon_id", cfgIDs); err != nil {
		return fmt.Errorf("delete orphan detection_log: %w", err)
	}

	for _, p := range pokemon {
		if p.DetectorConfig == nil {
			continue
		}
		// Delete existing log entries for this pokemon and re-insert.
		if _, err := tx.Exec(`DELETE FROM detection_log WHERE pokemon_id = ?`, p.ID); err != nil {
			return fmt.Errorf("delete detection_log for %q: %w", p.ID, err)
		}
		// Cap at 20 entries (take last 20).
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
	// Build placeholder list and args.
	placeholders := ""
	args := make([]interface{}, len(values))
	for i, v := range values {
		if i > 0 {
			placeholders += ", "
		}
		placeholders += "?"
		args[i] = v
	}
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
	placeholders := ""
	args := []interface{}{ownerType}
	for i, id := range allowedIDs {
		if i > 0 {
			placeholders += ", "
		}
		placeholders += "?"
		args = append(args, id)
	}
	query := fmt.Sprintf(
		"DELETE FROM overlay_settings WHERE owner_type = ? AND owner_id NOT IN (%s)",
		placeholders,
	)
	_, err := tx.Exec(query, args...)
	return err
}
