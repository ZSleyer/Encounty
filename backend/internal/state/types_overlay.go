// types_overlay.go defines the overlay data model: the sprite, text and counter
// layers the OBS browser source renders, the typography they share and the
// settings object that carries a whole layout. It sits apart from the core
// domain types because the overlay is the one part of the state the user edits
// visually, so its shape is driven by the editor rather than by the hunt.

package state

import "encoding/json"

// GradientStop defines one colour stop in a CSS-style linear gradient.
type GradientStop struct {
	Color    string  `json:"color"`
	Position float64 `json:"position"`
}

// TextStyle describes the typography and decoration for one text element
// in the OBS overlay (name label or encounter counter).
// Outlines support "none", "solid" and "gradient" modes; a gradient outline
// carries its own stops and angle. Any other value renders as no outline.
// The drop shadow carries exactly one colour, because CSS text-shadow cannot
// paint a gradient.
type TextStyle struct {
	FontFamily           string         `json:"font_family"`
	FontSize             int            `json:"font_size"`
	FontWeight           int            `json:"font_weight"`
	TextAlign            string         `json:"text_align"`
	ColorType            string         `json:"color_type"` // "solid" | "gradient"
	Color                string         `json:"color"`
	GradientStops        []GradientStop `json:"gradient_stops"`
	GradientAngle        int            `json:"gradient_angle"`
	OutlineType          string         `json:"outline_type"` // "none" | "solid" | "gradient"
	OutlineWidth         int            `json:"outline_width"`
	OutlineColor         string         `json:"outline_color"`
	OutlineGradientStops []GradientStop `json:"outline_gradient_stops"`
	OutlineGradientAngle int            `json:"outline_gradient_angle"`
	TextShadow           bool           `json:"text_shadow"`
	TextShadowColor      string         `json:"text_shadow_color"`
	TextShadowBlur       int            `json:"text_shadow_blur"`
	TextShadowX          int            `json:"text_shadow_x"`
	TextShadowY          int            `json:"text_shadow_y"`
}

// OverlayElementBase holds position and size fields shared by every overlay
// element. Coordinates are in canvas pixels (origin: top-left).
type OverlayElementBase struct {
	Visible bool `json:"visible"`
	X       int  `json:"x"`
	Y       int  `json:"y"`
	Width   int  `json:"width"`
	Height  int  `json:"height"`
	ZIndex  int  `json:"z_index"`
}

// SpriteElement configures the Pokémon sprite layer of the overlay,
// including optional glow effect and entry/idle animations.
type SpriteElement struct {
	OverlayElementBase
	ShowGlow         bool    `json:"show_glow"`
	GlowColor        string  `json:"glow_color"`
	GlowOpacity      float64 `json:"glow_opacity"`
	GlowBlur         int     `json:"glow_blur"`
	IdleAnimation    string  `json:"idle_animation"`
	TriggerEnter     string  `json:"trigger_enter"`
	TriggerDecrement string  `json:"trigger_decrement"`
	// CyclePhaseTargets makes the sprite rotate through the hunt's phase
	// targets instead of showing the hunted species only.
	CyclePhaseTargets bool `json:"cycle_phase_targets"`
	// CycleIntervalMs is the dwell time per sprite while cycling.
	CycleIntervalMs int `json:"cycle_interval_ms"`
	// CycleTransition names the effect played on a sprite swap while cycling:
	// "none", "fade", "wipe-lr" or "wipe-rl". An empty or unknown value renders
	// as "fade", the effect cycling shipped with.
	CycleTransition string `json:"cycle_transition"`
}

// NameElement configures the Pokémon name text layer of the overlay.
type NameElement struct {
	OverlayElementBase
	Style            TextStyle `json:"style"`
	IdleAnimation    string    `json:"idle_animation"`
	TriggerEnter     string    `json:"trigger_enter"`
	TriggerDecrement string    `json:"trigger_decrement"`
}

// TitleElement configures the custom title text layer of the overlay.
// It only appears when the Pokémon has a user-defined title set.
type TitleElement struct {
	OverlayElementBase
	Style            TextStyle `json:"style"`
	IdleAnimation    string    `json:"idle_animation"`
	TriggerEnter     string    `json:"trigger_enter"`
	TriggerDecrement string    `json:"trigger_decrement"`
}

// CounterElement configures the encounter-count text layer of the overlay,
// including an optional descriptive label rendered above or below the number.
// PrefixText and SuffixText render inline with the number in the number's own
// style, unlike the label, which has its own style; an empty string hides them.
type CounterElement struct {
	OverlayElementBase
	Style            TextStyle `json:"style"`
	ShowLabel        bool      `json:"show_label"`
	LabelText        string    `json:"label_text"`
	LabelStyle       TextStyle `json:"label_style"`
	PrefixText       string    `json:"prefix_text"`
	SuffixText       string    `json:"suffix_text"`
	IdleAnimation    string    `json:"idle_animation"`
	TriggerEnter     string    `json:"trigger_enter"`
	TriggerDecrement string    `json:"trigger_decrement"`
}

// TimerElement configures the hunt timer text layer of the overlay,
// including an optional descriptive label rendered above or below the time.
// PrefixText and SuffixText render inline with the time in the time's own
// style, unlike the label, which has its own style; an empty string hides them.
type TimerElement struct {
	OverlayElementBase
	Style         TextStyle `json:"style"`
	ShowLabel     bool      `json:"show_label"`
	LabelText     string    `json:"label_text"`
	LabelStyle    TextStyle `json:"label_style"`
	PrefixText    string    `json:"prefix_text"`
	SuffixText    string    `json:"suffix_text"`
	IdleAnimation string    `json:"idle_animation"`
}

// OddsElement configures the shiny-odds text layer of the overlay.
// Format toggles between a static fractional display (e.g. "1/4096")
// and a cumulative probability after the current encounter count
// (e.g. "63.2%"). An optional descriptive label mirrors CounterElement.
// PrefixText and SuffixText render inline with the value in the value's own
// style, unlike the label, which has its own style; an empty string hides them.
type OddsElement struct {
	OverlayElementBase
	Style            TextStyle `json:"style"`
	ShowLabel        bool      `json:"show_label"`
	LabelText        string    `json:"label_text"`
	LabelStyle       TextStyle `json:"label_style"`
	PrefixText       string    `json:"prefix_text"`
	SuffixText       string    `json:"suffix_text"`
	Format           string    `json:"format"` // "fractional" | "percent"
	IdleAnimation    string    `json:"idle_animation"`
	TriggerEnter     string    `json:"trigger_enter"`
	TriggerDecrement string    `json:"trigger_decrement"`
}

// LabeledTextElement configures a text layer of the overlay that renders one
// derived value with an optional descriptive label above or below it. It backs
// the phase, total-encounter and total-timer layers introduced with phasing.
// The older text elements deliberately keep their own structs: converting them
// would change no behaviour and only risk regressions in their editors.
//
// Elements that expose no trigger animations (total timer) still carry the
// trigger fields; they stay at "none" and no editor binds them.
//
// PrefixText and SuffixText render inline with the value in the value's own
// style, unlike the label, which has its own style; an empty string hides them.
type LabeledTextElement struct {
	OverlayElementBase
	Style            TextStyle `json:"style"`
	ShowLabel        bool      `json:"show_label"`
	LabelText        string    `json:"label_text"`
	LabelStyle       TextStyle `json:"label_style"`
	PrefixText       string    `json:"prefix_text"`
	SuffixText       string    `json:"suffix_text"`
	IdleAnimation    string    `json:"idle_animation"`
	TriggerEnter     string    `json:"trigger_enter"`
	TriggerDecrement string    `json:"trigger_decrement"`
}

// OverlaySettings is the complete configuration for the OBS Browser Source
// overlay. It uses an absolute-positioning canvas model: each element has its
// own x/y/width/height within a fixed canvas.
type OverlaySettings struct {
	CanvasWidth               int             `json:"canvas_width"`
	CanvasHeight              int             `json:"canvas_height"`
	Hidden                    bool            `json:"hidden"`
	BackgroundColor           string          `json:"background_color"`
	BackgroundOpacity         float64         `json:"background_opacity"`
	BackgroundAnimation       string          `json:"background_animation"`
	BackgroundAnimationSpeed  float64         `json:"background_animation_speed"`
	BackgroundAnimationConfig json.RawMessage `json:"background_animation_config,omitempty"`
	BackgroundImage           string          `json:"background_image"`
	BackgroundImageFit        string          `json:"background_image_fit"`
	Blur                      int             `json:"blur"`
	ShowBorder                bool            `json:"show_border"`
	BorderColor               string          `json:"border_color"`
	BorderWidth               int             `json:"border_width"`
	BorderRadius              int             `json:"border_radius"`
	Sprite                    SpriteElement   `json:"sprite"`
	Name                      NameElement     `json:"name"`
	Title                     TitleElement    `json:"title"`
	Counter                   CounterElement  `json:"counter"`
	Timer                     TimerElement    `json:"timer"`
	Odds                      OddsElement     `json:"odds"`
	// Phase renders the current phase number of the active hunt.
	Phase LabeledTextElement `json:"phase"`
	// TotalCounter renders the encounters of the hunt and all its phases.
	TotalCounter LabeledTextElement `json:"total_counter"`
	// TotalTimer renders the hunt time across all phases. Like Timer it offers
	// an idle animation only, which saves one animation channel.
	TotalTimer LabeledTextElement `json:"total_timer"`
}

// TutorialFlags tracks which tutorials the user has already completed.
type TutorialFlags struct {
	OverlayEditor bool `json:"overlay_editor"`
	AutoDetection bool `json:"auto_detection"`
}

// Settings holds user-configurable application preferences that are persisted
// alongside the Pokémon list in state.json.
type Settings struct {
	OutputEnabled bool            `json:"output_enabled"`
	OutputDir     string          `json:"output_dir"`
	AutoSave      bool            `json:"auto_save"`
	Languages     []string        `json:"languages"` // active game-name languages; default ["de","en"]
	CrispSprites  bool            `json:"crisp_sprites"`
	AccentColor   string          `json:"accent_color"` // preset key: violet|acid|crimson|cyan|blue|green|pink|orange
	Overlay       OverlaySettings `json:"overlay"`
	TutorialSeen  TutorialFlags   `json:"tutorial_seen"`
	ConfigPath    string          `json:"config_path,omitempty"` // custom data directory override
	// CaptureResolutions maps a camera deviceId to a preferred capture
	// resolution preset ("auto"|"720"|"1080"|"1440"). Per-device because the
	// resolution depends on the physical capture card. Always non-nil so the
	// JSON broadcast never emits null.
	CaptureResolutions map[string]string `json:"capture_resolutions"`
}
