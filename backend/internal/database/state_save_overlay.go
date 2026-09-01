// state_save_overlay.go writes one OverlaySettings into the overlay_settings,
// overlay_elements, text_styles and gradient_stops tables. It is the save half
// of the overlay persistence, split out of state_save.go so the overlay tables
// and the detector tables no longer share one file.

package database

import (
	"database/sql"
	"fmt"

	"github.com/zsleyer/encounty/backend/internal/state"
)

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
			background_animation, background_animation_speed, background_animation_config,
			background_image, background_image_fit, blur, show_border, border_color,
			border_width, border_radius)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(owner_type, owner_id) DO UPDATE SET
			canvas_width                = excluded.canvas_width,
			canvas_height               = excluded.canvas_height,
			hidden                      = excluded.hidden,
			background_color            = excluded.background_color,
			background_opacity          = excluded.background_opacity,
			background_animation        = excluded.background_animation,
			background_animation_speed  = excluded.background_animation_speed,
			background_animation_config = excluded.background_animation_config,
			background_image            = excluded.background_image,
			background_image_fit        = excluded.background_image_fit,
			blur                        = excluded.blur,
			show_border                 = excluded.show_border,
			border_color                = excluded.border_color,
			border_width                = excluded.border_width,
			border_radius               = excluded.border_radius`,
		ownerType, ownerID,
		ov.CanvasWidth, ov.CanvasHeight, boolToInt(ov.Hidden),
		ov.BackgroundColor, ov.BackgroundOpacity,
		ov.BackgroundAnimation, ov.BackgroundAnimationSpeed, string(ov.BackgroundAnimationConfig),
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
		overlayID:         overlayID,
		elemType:          "sprite",
		base:              &ov.Sprite.OverlayElementBase,
		showGlow:          boolToInt(ov.Sprite.ShowGlow),
		glowColor:         ov.Sprite.GlowColor,
		glowOpacity:       ov.Sprite.GlowOpacity,
		glowBlur:          ov.Sprite.GlowBlur,
		idleAnim:          ov.Sprite.IdleAnimation,
		triggerEnter:      ov.Sprite.TriggerEnter,
		triggerDecrement:  ov.Sprite.TriggerDecrement,
		cyclePhaseTargets: ov.Sprite.CyclePhaseTargets,
		cycleIntervalMs:   ov.Sprite.CycleIntervalMs,
		cycleTransition:   ov.Sprite.CycleTransition,
	})
	if err != nil {
		return fmt.Errorf("insert sprite element: %w", err)
	}
	// Sprite has no text styles, but we keep spriteID for consistency.
	_ = spriteID

	// Insert name element with main text style.
	nameID, err := insertElement(tx, elementInsertParams{
		overlayID:        overlayID,
		elemType:         "name",
		base:             &ov.Name.OverlayElementBase,
		idleAnim:         ov.Name.IdleAnimation,
		triggerEnter:     ov.Name.TriggerEnter,
		triggerDecrement: ov.Name.TriggerDecrement,
	})
	if err != nil {
		return fmt.Errorf("insert name element: %w", err)
	}
	if err := saveTextStyle(tx, nameID, "main", &ov.Name.Style); err != nil {
		return fmt.Errorf("save name text style: %w", err)
	}

	// Insert title element with main text style.
	titleID, err := insertElement(tx, elementInsertParams{
		overlayID:        overlayID,
		elemType:         "title",
		base:             &ov.Title.OverlayElementBase,
		idleAnim:         ov.Title.IdleAnimation,
		triggerEnter:     ov.Title.TriggerEnter,
		triggerDecrement: ov.Title.TriggerDecrement,
	})
	if err != nil {
		return fmt.Errorf("insert title element: %w", err)
	}
	if err := saveTextStyle(tx, titleID, "main", &ov.Title.Style); err != nil {
		return fmt.Errorf("save title text style: %w", err)
	}

	// Insert counter element with main + label text styles.
	counterID, err := insertElement(tx, elementInsertParams{
		overlayID:        overlayID,
		elemType:         "counter",
		base:             &ov.Counter.OverlayElementBase,
		idleAnim:         ov.Counter.IdleAnimation,
		triggerEnter:     ov.Counter.TriggerEnter,
		triggerDecrement: ov.Counter.TriggerDecrement,
		showLabel:        ov.Counter.ShowLabel,
		labelText:        ov.Counter.LabelText,
		prefixText:       ov.Counter.PrefixText,
		suffixText:       ov.Counter.SuffixText,
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

	// Insert timer element with main + label text styles.
	timerID, err := insertElement(tx, elementInsertParams{
		overlayID:    overlayID,
		elemType:     "timer",
		base:         &ov.Timer.OverlayElementBase,
		idleAnim:     ov.Timer.IdleAnimation,
		triggerEnter: "none",
		showLabel:    ov.Timer.ShowLabel,
		labelText:    ov.Timer.LabelText,
		prefixText:   ov.Timer.PrefixText,
		suffixText:   ov.Timer.SuffixText,
	})
	if err != nil {
		return fmt.Errorf("insert timer element: %w", err)
	}
	if err := saveTextStyle(tx, timerID, "main", &ov.Timer.Style); err != nil {
		return fmt.Errorf("save timer main text style: %w", err)
	}
	if err := saveTextStyle(tx, timerID, "label", &ov.Timer.LabelStyle); err != nil {
		return fmt.Errorf("save timer label text style: %w", err)
	}

	// Insert odds element with main + label text styles.
	oddsID, err := insertElement(tx, elementInsertParams{
		overlayID:        overlayID,
		elemType:         "odds",
		base:             &ov.Odds.OverlayElementBase,
		idleAnim:         ov.Odds.IdleAnimation,
		triggerEnter:     ov.Odds.TriggerEnter,
		triggerDecrement: ov.Odds.TriggerDecrement,
		showLabel:        ov.Odds.ShowLabel,
		labelText:        ov.Odds.LabelText,
		prefixText:       ov.Odds.PrefixText,
		suffixText:       ov.Odds.SuffixText,
		format:           ov.Odds.Format,
	})
	if err != nil {
		return fmt.Errorf("insert odds element: %w", err)
	}
	if err := saveTextStyle(tx, oddsID, "main", &ov.Odds.Style); err != nil {
		return fmt.Errorf("save odds main text style: %w", err)
	}
	if err := saveTextStyle(tx, oddsID, "label", &ov.Odds.LabelStyle); err != nil {
		return fmt.Errorf("save odds label text style: %w", err)
	}

	// Insert the phasing elements, which all share one struct and therefore
	// one insert path instead of three copied blocks.
	for _, e := range labeledTextElements(ov) {
		if err := insertLabeledTextElement(tx, overlayID, e.elemType, e.element); err != nil {
			return err
		}
	}

	return nil
}

// labeledTextElementRef pairs an element type with the OverlaySettings field
// that stores it, so save and load share one list of the phasing elements.
type labeledTextElementRef struct {
	elemType string
	element  *state.LabeledTextElement
}

// labeledTextElements returns the phasing text elements of an overlay in a
// stable order together with their element_type values.
func labeledTextElements(ov *state.OverlaySettings) []labeledTextElementRef {
	return []labeledTextElementRef{
		{elemType: "phase", element: &ov.Phase},
		{elemType: "total_counter", element: &ov.TotalCounter},
		{elemType: "total_timer", element: &ov.TotalTimer},
	}
}

// insertLabeledTextElement persists one LabeledTextElement row together with
// its main and label text styles.
func insertLabeledTextElement(tx *sql.Tx, overlayID int64, elemType string, el *state.LabeledTextElement) error {
	elementID, err := insertElement(tx, elementInsertParams{
		overlayID:        overlayID,
		elemType:         elemType,
		base:             &el.OverlayElementBase,
		idleAnim:         el.IdleAnimation,
		triggerEnter:     el.TriggerEnter,
		triggerDecrement: el.TriggerDecrement,
		showLabel:        el.ShowLabel,
		labelText:        el.LabelText,
		prefixText:       el.PrefixText,
		suffixText:       el.SuffixText,
	})
	if err != nil {
		return fmt.Errorf("insert %s element: %w", elemType, err)
	}
	if err := saveTextStyle(tx, elementID, "main", &el.Style); err != nil {
		return fmt.Errorf("save %s main text style: %w", elemType, err)
	}
	if err := saveTextStyle(tx, elementID, "label", &el.LabelStyle); err != nil {
		return fmt.Errorf("save %s label text style: %w", elemType, err)
	}
	return nil
}

// elementInsertParams groups all columns for an overlay_elements row,
// keeping the call sites readable and avoiding a 14-parameter function.
type elementInsertParams struct {
	overlayID        int64
	elemType         string
	base             *state.OverlayElementBase
	showGlow         int
	glowColor        string
	glowOpacity      float64
	glowBlur         int
	idleAnim         string
	triggerEnter     string
	triggerDecrement string
	showLabel        bool
	labelText        string
	prefixText       string
	suffixText       string
	format           string // populated only for "odds" elements
	// cyclePhaseTargets, cycleIntervalMs and cycleTransition are populated only
	// for "sprite".
	cyclePhaseTargets bool
	cycleIntervalMs   int
	cycleTransition   string
}

// labelBearingElementTypes is the set of element types whose rows carry the
// show_label, label_text, prefix_text and suffix_text columns. Every other type
// stores NULL there.
var labelBearingElementTypes = map[string]bool{
	"counter":       true,
	"timer":         true,
	"odds":          true,
	"phase":         true,
	"total_counter": true,
	"total_timer":   true,
}

// insertElement inserts one overlay_elements row and returns its auto-increment ID.
// showGlow/glowColor/glowOpacity/glowBlur and the cycle columns are nullable and
// only meaningful for sprite.
func insertElement(tx *sql.Tx, p elementInsertParams) (int64, error) {
	// Use sql.NullInt64/NullString for sprite-only and label-bearing fields.
	var glowShowVal, glowBlurVal sql.NullInt64
	var glowColorVal sql.NullString
	var glowOpacityVal sql.NullFloat64
	var showLabelVal sql.NullInt64
	var labelTextVal, prefixTextVal, suffixTextVal sql.NullString
	var cyclePhaseTargetsVal, cycleIntervalVal sql.NullInt64
	var cycleTransitionVal sql.NullString

	if p.elemType == "sprite" {
		glowShowVal = sql.NullInt64{Int64: int64(p.showGlow), Valid: true}
		glowColorVal = sql.NullString{String: p.glowColor, Valid: true}
		glowOpacityVal = sql.NullFloat64{Float64: p.glowOpacity, Valid: true}
		glowBlurVal = sql.NullInt64{Int64: int64(p.glowBlur), Valid: true}
		cyclePhaseTargetsVal = sql.NullInt64{Int64: int64(boolToInt(p.cyclePhaseTargets)), Valid: true}
		cycleIntervalVal = sql.NullInt64{Int64: int64(p.cycleIntervalMs), Valid: true}
		cycleTransitionVal = sql.NullString{String: p.cycleTransition, Valid: true}
	}
	if labelBearingElementTypes[p.elemType] {
		showLabelVal = sql.NullInt64{Int64: int64(boolToInt(p.showLabel)), Valid: true}
		labelTextVal = sql.NullString{String: p.labelText, Valid: true}
		prefixTextVal = sql.NullString{String: p.prefixText, Valid: true}
		suffixTextVal = sql.NullString{String: p.suffixText, Valid: true}
	}

	res, err := tx.Exec(`
		INSERT INTO overlay_elements (overlay_id, element_type, visible, x, y, width, height,
			z_index, show_glow, glow_color, glow_opacity, glow_blur,
			idle_animation, trigger_enter, trigger_decrement, show_label, label_text,
			prefix_text, suffix_text, format,
			cycle_phase_targets, cycle_interval_ms, cycle_transition)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.overlayID, p.elemType, boolToInt(p.base.Visible), p.base.X, p.base.Y, p.base.Width, p.base.Height,
		p.base.ZIndex, glowShowVal, glowColorVal, glowOpacityVal, glowBlurVal,
		p.idleAnim, p.triggerEnter, p.triggerDecrement, showLabelVal, labelTextVal,
		prefixTextVal, suffixTextVal, p.format,
		cyclePhaseTargetsVal, cycleIntervalVal, cycleTransitionVal,
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
			text_shadow_blur, text_shadow_x, text_shadow_y)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		elementID, role, style.FontFamily, style.FontSize, style.FontWeight,
		style.TextAlign, style.ColorType, style.Color, style.GradientAngle,
		style.OutlineType, style.OutlineWidth, style.OutlineColor, style.OutlineGradientAngle,
		boolToInt(style.TextShadow), style.TextShadowColor,
		style.TextShadowBlur, style.TextShadowX, style.TextShadowY,
	)
	if err != nil {
		return fmt.Errorf("insert text_style: %w", err)
	}
	styleID, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("get text_style id: %w", err)
	}

	// Insert gradient stops for both gradient types. The shadow has none: CSS
	// text-shadow paints one colour.
	if err := insertGradientStops(tx, styleID, "color", style.GradientStops); err != nil {
		return err
	}
	return insertGradientStops(tx, styleID, "outline", style.OutlineGradientStops)
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
