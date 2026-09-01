// state_load_overlay.go reads the overlay tables (overlay_settings,
// overlay_elements, text_styles and gradient_stops) with one query each and
// reassembles every OverlaySettings from them. It is the load half of the
// overlay persistence, mirroring state_save_overlay.go.

package database

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// ---------------------------------------------------------------------------
// Overlay batching
// ---------------------------------------------------------------------------

// elemRow holds the raw column values for a single overlay_elements row,
// used as an intermediate representation before dispatching to typed fields.
type elemRow struct {
	id                                 int64
	elemType                           string
	base                               state.OverlayElementBase
	showGlow, showLabel, glowBlur      sql.NullInt64
	glowColor, idleAnim, triggerEnter  sql.NullString
	triggerDecrement, labelText        sql.NullString
	prefixText, suffixText             sql.NullString
	format                             sql.NullString
	glowOpacity                        sql.NullFloat64
	cyclePhaseTargets, cycleIntervalMs sql.NullInt64
	cycleTransition                    sql.NullString
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

	byKey := map[string]*state.OverlaySettings{}
	byID := map[int64]*state.OverlaySettings{}
	err = scanRows(rows, func(rows *sql.Rows) error {
		var ov state.OverlaySettings
		var overlayID int64
		var ownerType, ownerID string
		var hidden, showBorder int
		var bgAnimConfig string
		if err := rows.Scan(&overlayID, &ownerType, &ownerID, &ov.CanvasWidth, &ov.CanvasHeight, &hidden, &ov.BackgroundColor,
			&ov.BackgroundOpacity, &ov.BackgroundAnimation, &ov.BackgroundAnimationSpeed,
			&bgAnimConfig, &ov.BackgroundImage, &ov.BackgroundImageFit, &ov.Blur, &showBorder,
			&ov.BorderColor, &ov.BorderWidth, &ov.BorderRadius); err != nil {
			return fmt.Errorf("scan overlay_settings: %w", err)
		}
		ov.Hidden = hidden != 0
		ov.ShowBorder = showBorder != 0
		if bgAnimConfig != "" {
			ov.BackgroundAnimationConfig = json.RawMessage(bgAnimConfig)
		}
		stored := ov
		byKey[overlayKey(ownerType, ownerID)] = &stored
		byID[overlayID] = &stored
		return nil
	})
	return byKey, byID, err
}

// loadAllOverlayElements reads every overlay_elements row into a map keyed by
// overlay_id.
func loadAllOverlayElements(db *sql.DB) (map[int64][]elemRow, error) {
	rows, err := db.Query(`SELECT overlay_id, id, element_type, visible, x, y, width, height, z_index,
		show_glow, glow_color, glow_opacity, glow_blur, idle_animation, trigger_enter,
		trigger_decrement, show_label, label_text, prefix_text, suffix_text, format,
		cycle_phase_targets, cycle_interval_ms, cycle_transition
		FROM overlay_elements`)
	if err != nil {
		return nil, fmt.Errorf("query overlay_elements: %w", err)
	}

	elems := map[int64][]elemRow{}
	err = scanRows(rows, func(rows *sql.Rows) error {
		var overlayID int64
		var e elemRow
		var visible int
		if err := rows.Scan(&overlayID, &e.id, &e.elemType, &visible, &e.base.X, &e.base.Y, &e.base.Width,
			&e.base.Height, &e.base.ZIndex, &e.showGlow, &e.glowColor, &e.glowOpacity, &e.glowBlur,
			&e.idleAnim, &e.triggerEnter, &e.triggerDecrement, &e.showLabel, &e.labelText,
			&e.prefixText, &e.suffixText, &e.format,
			&e.cyclePhaseTargets, &e.cycleIntervalMs, &e.cycleTransition); err != nil {
			return fmt.Errorf("scan overlay_element: %w", err)
		}
		e.base.Visible = visible != 0
		elems[overlayID] = append(elems[overlayID], e)
		return nil
	})
	return elems, err
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
		outline_gradient_angle, text_shadow, text_shadow_color,
		text_shadow_blur, text_shadow_x, text_shadow_y
		FROM text_styles`)
	if err != nil {
		return nil, fmt.Errorf("query text_styles: %w", err)
	}

	styles := map[int64]map[string]state.TextStyle{}
	err = scanRows(rows, func(rows *sql.Rows) error {
		var ts state.TextStyle
		var styleID, elementID int64
		var role string
		var textShadow int
		if err := rows.Scan(&styleID, &elementID, &role, &ts.FontFamily, &ts.FontSize, &ts.FontWeight, &ts.TextAlign,
			&ts.ColorType, &ts.Color, &ts.GradientAngle, &ts.OutlineType, &ts.OutlineWidth, &ts.OutlineColor,
			&ts.OutlineGradientAngle, &textShadow, &ts.TextShadowColor,
			&ts.TextShadowBlur, &ts.TextShadowX, &ts.TextShadowY); err != nil {
			return fmt.Errorf("scan text_style: %w", err)
		}
		ts.TextShadow = textShadow != 0
		ts.GradientStops = gradientStopsOrEmpty(stops, styleID, "color")
		ts.OutlineGradientStops = gradientStopsOrEmpty(stops, styleID, "outline")
		if styles[elementID] == nil {
			styles[elementID] = map[string]state.TextStyle{}
		}
		styles[elementID][role] = ts
		return nil
	})
	return styles, err
}

// loadAllGradientStops reads every gradient_stops row into a nested map keyed
// by text_style_id then gradient_type, preserving sort_order.
func loadAllGradientStops(db *sql.DB) (map[int64]map[string][]state.GradientStop, error) {
	rows, err := db.Query(`SELECT text_style_id, gradient_type, color, position FROM gradient_stops
		ORDER BY text_style_id, gradient_type, sort_order`)
	if err != nil {
		return nil, fmt.Errorf("query gradient_stops: %w", err)
	}

	stops := map[int64]map[string][]state.GradientStop{}
	err = scanRows(rows, func(rows *sql.Rows) error {
		var styleID int64
		var gradientType string
		var gs state.GradientStop
		if err := rows.Scan(&styleID, &gradientType, &gs.Color, &gs.Position); err != nil {
			return err
		}
		if stops[styleID] == nil {
			stops[styleID] = map[string][]state.GradientStop{}
		}
		stops[styleID][gradientType] = append(stops[styleID][gradientType], gs)
		return nil
	})
	return stops, err
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
		GradientStops:        []state.GradientStop{},
		OutlineGradientStops: []state.GradientStop{},
	}
}

// labeledTextTarget returns the OverlaySettings field that stores the given
// phasing element type, or nil for every other element type. It walks the same
// list the save path uses, keeping both directions on one source of truth.
func labeledTextTarget(ov *state.OverlaySettings, elemType string) *state.LabeledTextElement {
	for _, ref := range labeledTextElements(ov) {
		if ref.elemType == elemType {
			return ref.element
		}
	}
	return nil
}

// applyOverlayElement dispatches a single element row to the appropriate field
// on the OverlaySettings, resolving text styles via the given lookup.
func applyOverlayElement(ov *state.OverlaySettings, e elemRow, style func(elementID int64, role string) state.TextStyle) {
	idleAnimStr := nullStr(e.idleAnim)
	triggerEnterStr := nullStr(e.triggerEnter)
	triggerDecrementStr := nullStr(e.triggerDecrement)

	// The phasing elements share one struct, so one table-driven branch covers
	// all of them instead of three identical switch cases.
	if target := labeledTextTarget(ov, e.elemType); target != nil {
		*target = state.LabeledTextElement{
			OverlayElementBase: e.base,
			Style:              style(e.id, "main"),
			ShowLabel:          e.showLabel.Valid && e.showLabel.Int64 != 0,
			LabelText:          nullStr(e.labelText),
			LabelStyle:         style(e.id, "label"),
			PrefixText:         nullStr(e.prefixText),
			SuffixText:         nullStr(e.suffixText),
			IdleAnimation:      idleAnimStr,
			TriggerEnter:       triggerEnterStr,
			TriggerDecrement:   triggerDecrementStr,
		}
		return
	}

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
			TriggerDecrement:   triggerDecrementStr,
			CyclePhaseTargets:  e.cyclePhaseTargets.Valid && e.cyclePhaseTargets.Int64 != 0,
			CycleIntervalMs:    int(nullInt(e.cycleIntervalMs)),
			CycleTransition:    nullStr(e.cycleTransition),
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
			PrefixText:         nullStr(e.prefixText),
			SuffixText:         nullStr(e.suffixText),
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
			PrefixText:         nullStr(e.prefixText),
			SuffixText:         nullStr(e.suffixText),
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
			PrefixText:         nullStr(e.prefixText),
			SuffixText:         nullStr(e.suffixText),
			Format:             format,
			IdleAnimation:      idleAnimStr,
			TriggerEnter:       triggerEnterStr,
			TriggerDecrement:   triggerDecrementStr,
		}
	}
}
