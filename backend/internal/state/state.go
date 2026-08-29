// Package state defines all application data types and the in-memory state
// manager. The Manager is the single source of truth for mutable runtime
// state and coordinates safe concurrent access via a read/write mutex.
// Persistence is handled in persist.go; type definitions live here.
package state

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"log/slog"

	"github.com/google/uuid"
)

// Shared string literals used in default overlay settings and overlay resolution.
const (
	colorBlack          = "#000000"
	colorTypeSolid      = "solid"
	outlineTypeNone     = "none"
	animationNone       = "none"
	fontSans            = "sans"
	overlayLinkedPrefix = "linked:"
)

// Tempest design-system colours baked into the default overlay layout. The
// overlay stores plain hex rather than a CSS custom property: the editor's
// colour picker only round-trips 6-digit hex, and the OBS browser source keeps
// its own theme and accent preset. The token each value came from is recorded
// here so a later theme change stays traceable.
const (
	colorBgPrimary     = "#0d1117" // --bg-primary
	colorBorderSubtle  = "#2a3644" // --border-subtle
	colorTextPrimary   = "#eef3f8" // --text-primary
	colorTextSecondary = "#b7c5d3" // --text-secondary
	colorTextMuted     = "#8fa3b5" // --text-muted
	colorAccentViolet  = "#a685f0" // --accent-blue, violet preset (the default accent)
)

// defaultSpriteCycleIntervalMs is the dwell time per sprite when the overlay
// cycles through the phase targets.
const defaultSpriteCycleIntervalMs = 3000

// defaultSpriteCycleTransition is the effect played on a sprite swap while
// cycling. Cycling shipped with the crossfade as its only behaviour, so it is
// both the default and the fallback for an overlay that carries no choice.
const defaultSpriteCycleTransition = "fade"

// Sentinel errors returned by the phase transitions so HTTP handlers can map
// them to status codes without string matching.
var (
	// ErrPhaseParentNotFound reports that the hunt a phase operation refers to
	// does not exist (unknown id, or an orphaned phase entry whose parent hunt
	// has been deleted).
	ErrPhaseParentNotFound = errors.New("phase parent not found")
	// ErrNotPhaseable reports that the referenced entry cannot take part in the
	// requested phase transition: a completed hunt or a phase entry cannot end a
	// phase, and only the newest phase of a hunt can be undone.
	ErrNotPhaseable = errors.New("entry is not phaseable")
)

// Pokemon represents a single shiny-hunt session for one Pokémon species.
// It stores display metadata (name, sprite), the running encounter count,
// and an optional per-Pokémon overlay configuration.
type Pokemon struct {
	ID                 string           `json:"id"`
	Name               string           `json:"name"` // Display name (localized)
	BaseName           string           `json:"base_name,omitempty"`
	FormName           string           `json:"form_name,omitempty"`
	Nickname           string           `json:"nickname,omitempty"`
	Title              string           `json:"title,omitempty"` // User-defined custom title
	CanonicalName      string           `json:"canonical_name"`  // English PokéAPI slug
	Gender             string           `json:"gender,omitempty"`
	SpriteURL          string           `json:"sprite_url"`
	SpriteType         string           `json:"sprite_type"`            // "normal" | "shiny"
	SpriteStyle        string           `json:"sprite_style,omitempty"` // "classic" | "animated" | "3d" | "artwork"
	Encounters         int              `json:"encounters"`
	Step               int              `json:"step,omitempty"` // Increment/decrement step size (default 1)
	IsActive           bool             `json:"is_active"`
	CreatedAt          time.Time        `json:"created_at"`
	Language           string           `json:"language"` // "de" | "en"
	Game               string           `json:"game"`     // key from games.json
	CompletedAt        *time.Time       `json:"completed_at,omitempty"`
	Failed             bool             `json:"failed"`
	Overlay            *OverlaySettings `json:"overlay,omitempty"` // Pokemon-specific overlay settings
	OverlayMode        string           `json:"overlay_mode"`      // "default" | "custom" | "linked:<pokemon-id>"
	HuntType           string           `json:"hunt_type,omitempty"`
	ShinyCharm         bool             `json:"shiny_charm"`
	SparklingPower     int              `json:"sparkling_power"`         // Gen 9 Sparkling Power level (0..3) from a sandwich
	ShinyVariant       string           `json:"shiny_variant,omitempty"` // "" (any) | "star" | "square"; Sword/Shield specific
	DetectorConfig     *DetectorConfig  `json:"detector_config,omitempty"`
	TimerStartedAt     *time.Time       `json:"timer_started_at,omitempty"`
	TimerAccumulatedMs int64            `json:"timer_accumulated_ms"`
	HuntMode           string           `json:"hunt_mode"`   // "both" | "timer" | "detector" (default "both")
	GroupID            string           `json:"group_id"`    // Empty string means "no group" (shown in "Ohne Gruppe" section)
	Tags               []string         `json:"tags"`        // Arbitrary short labels; always a JSON array, never null
	PokedexIDs         []string         `json:"pokedex_ids"` // User Pokédexes this hunt/catch belongs to.
	SortOrder          int              `json:"sort_order"`  // Manual ordering position (ascending); assigned via ReorderPokemon
	// PhaseOf is the ID of the hunt this entry is a phase of. Empty means the
	// entry is a hunt of its own. Immutable after creation.
	PhaseOf string `json:"phase_of,omitempty"`
	// PhaseNumber is the frozen number of this phase within its parent hunt
	// (1-based). Zero for entries that are not phases. Immutable after creation.
	PhaseNumber int `json:"phase_number,omitempty"`
	// PhaseTargets lists the species the hunter expects as off-target shinies.
	// Always a JSON array, never null.
	PhaseTargets []PhaseTarget `json:"phase_targets"`
	// Catch holds the optional details recorded for this catch. Nil means
	// nothing was recorded, which is the state of every entry predating the
	// feature and of every hunt that is not finished yet.
	Catch *CatchMeta `json:"catch,omitempty"`
	// EntrySource records how the entry came to be: "" means the hunt was
	// tracked in this app, "manual" means it was entered by hand after the
	// fact. Immutable after creation.
	EntrySource string `json:"entry_source,omitempty"`
}

// PhaseTarget is one species a hunter expects to run into as an off-target
// shiny. Targets are optional: they drive the quick-select chips when ending a
// phase and the sprite cycling in the overlay.
type PhaseTarget struct {
	CanonicalName string `json:"canonical_name"` // English PokéAPI slug, unique per hunt
	Name          string `json:"name"`           // Display name (localized)
	SpriteURL     string `json:"sprite_url"`
	Gender        string `json:"gender,omitempty"`
}

// PhaseCatch describes the off-target shiny that ended a phase. It only carries
// the species identity; every other field of the resulting archive entry is
// inherited from the parent hunt. CanonicalName may be empty so a phase can be
// ended with a free-text name when no Pokédex entry is available.
type PhaseCatch struct {
	CanonicalName string `json:"canonical_name"`
	Name          string `json:"name"`
	BaseName      string `json:"base_name"`
	FormName      string `json:"form_name"`
	SpriteURL     string `json:"sprite_url"`
	Gender        string `json:"gender,omitempty"`
}

// CatchMeta records the optional details a hunter notes down for a caught
// shiny: where it was met, its nature, ability, ball and mark, its level,
// its individual values and the ribbons it carries. Every field is optional.
type CatchMeta struct {
	Nickname string `json:"nickname,omitempty"`
	Location string `json:"location,omitempty"`
	Nature   string `json:"nature,omitempty"`
	Ability  string `json:"ability,omitempty"`
	Ball     string `json:"ball,omitempty"`
	// Mark holds at most one mark slug: a Pokemon can never carry two.
	Mark string `json:"mark,omitempty"`
	// ShinyVariant records which shiny sparkle the individual showed:
	// "" (any/unrecorded), "star" or "square". Sword/Shield specific.
	ShinyVariant string `json:"shiny_variant,omitempty"`
	// Level and the six values below are pointers because 0 is a legal DV: a
	// Pokemon with 0 Speed and one whose Speed was never noted down are
	// different facts and both must round-trip unchanged.
	Level *int `json:"level,omitempty"`
	HP    *int `json:"hp,omitempty"`
	Atk   *int `json:"atk,omitempty"`
	Def   *int `json:"def,omitempty"`
	SpAtk *int `json:"sp_atk,omitempty"`
	SpDef *int `json:"sp_def,omitempty"`
	Speed *int `json:"speed,omitempty"`
	// Ribbons holds ribbon slugs. Always a JSON array, never null, matching
	// the contract of Pokemon.Tags.
	Ribbons []string `json:"ribbons"`
	// Evolutions records every later species or form this individual reached,
	// in order. The original catch remains Pokemon.CanonicalName.
	Evolutions []EvolutionStep `json:"evolutions,omitempty"`
}

// EvolutionStep identifies one visited species or form in a caught
// individual's evolution history.
type EvolutionStep struct {
	CanonicalName string `json:"canonical_name"`
	Gender        string `json:"gender,omitempty"`
}

// IsEmpty reports whether the metadata carries no information at all, which is
// the case for a nil receiver and for a value whose every field is unset. Such
// a value is stored as "no metadata" rather than as an empty record.
func (c *CatchMeta) IsEmpty() bool {
	if c == nil {
		return true
	}
	return c.Nickname == "" && c.Location == "" && c.Nature == "" && c.Ability == "" && c.Ball == "" && c.Mark == "" &&
		c.ShinyVariant == "" && c.Level == nil && c.HP == nil && c.Atk == nil && c.Def == nil &&
		c.SpAtk == nil && c.SpDef == nil && c.Speed == nil && len(c.Ribbons) == 0 && len(c.Evolutions) == 0
}

// Group organizes Pokémon into collapsible Sidebar sections.
// Groups are purely organizational metadata; membership is one-to-many
// (each Pokémon has at most one group via Pokemon.GroupID).
type Group struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Color     string `json:"color"` // Hex string like "#3b82f6"; empty means default color
	SortOrder int    `json:"sort_order"`
	Collapsed bool   `json:"collapsed"`
}

// GroupPatch carries optional field updates for UpdateGroup.
// Only non-nil fields are applied; nil fields are left unchanged.
type GroupPatch struct {
	Name      *string `json:"name,omitempty"`
	Color     *string `json:"color,omitempty"`
	SortOrder *int    `json:"sort_order,omitempty"`
	Collapsed *bool   `json:"collapsed,omitempty"`
}

// Session records one time-boxed encounter run for a single Pokémon.
// Sessions are append-only; an open session has EndedAt == nil.
type Session struct {
	ID         string     `json:"id"`
	StartedAt  time.Time  `json:"started_at"`
	EndedAt    *time.Time `json:"ended_at"`
	PokemonID  string     `json:"pokemon_id"`
	Encounters int        `json:"encounters"`
}

// HotkeyMap holds the key-combo string for each counter action.
// Each value is a human-readable combo such as "F1" or "Ctrl+Shift+A".
type HotkeyMap struct {
	Increment   string `json:"increment"`
	Decrement   string `json:"decrement"`
	Reset       string `json:"reset"`
	NextPokemon string `json:"next_pokemon"`
	// HuntToggle starts or stops the hunt (timer + detector) for the active Pokémon.
	HuntToggle string `json:"hunt_toggle"`
}

// MatchedRegion defines a bounding box within a template and its match criteria.
type MatchedRegion struct {
	Type         string       `json:"type"`          // "image" | "text"
	ExpectedText string       `json:"expected_text"` // used if Type == "text"
	Rect         DetectorRect `json:"rect"`
	// Category is the optional counting group a region belongs to. Regions
	// sharing a category are AND-combined and counted independently from other
	// categories. Empty means the default category (legacy single-counter).
	Category string `json:"category,omitempty"`
}

// DetectorTemplate bundles a saved screenshot and its defined regions.
// ImageData holds the raw PNG bytes loaded from the database on demand;
// it is excluded from JSON serialisation to avoid bloating WebSocket messages.
type DetectorTemplate struct {
	TemplateDBID int64           `json:"template_db_id,omitempty"` // DB primary key
	Name         string          `json:"name"`                     // user-visible template name
	ImageData    []byte          `json:"-"`                        // PNG bytes, loaded on demand
	Regions      []MatchedRegion `json:"regions"`
	Enabled      *bool           `json:"enabled,omitempty"` // nil = true (backward compat)
	// Calibration holds frontend-computed stability calibration as an opaque
	// JSON object. The backend only persists and forwards it; the detection
	// engine in the frontend owns its shape.
	Calibration json.RawMessage `json:"calibration,omitempty"`
	// Precision is this template's own NCC match threshold (0.0-1.0). nil
	// means no explicit value has been set yet; the detection engine falls
	// back to a hardcoded default.
	Precision *float64 `json:"precision,omitempty"`
	// HysteresisFactor is this template's own hysteresis exit-threshold
	// multiplier. nil falls back to a hardcoded default.
	HysteresisFactor *float64 `json:"hysteresis_factor,omitempty"`
	// ConsecutiveHits is this template's own required consecutive matching
	// frames before counting an encounter. nil falls back to a hardcoded default.
	ConsecutiveHits *int `json:"consecutive_hits,omitempty"`
	// CooldownSec is this template's own minimum seconds between counts.
	// nil falls back to a hardcoded default.
	CooldownSec *int `json:"cooldown_sec,omitempty"`
	// PollIntervalMs is this template's own base adaptive-polling interval.
	// nil falls back to a hardcoded default.
	PollIntervalMs *int `json:"poll_interval_ms,omitempty"`
	// MinPollMs is this template's own fastest adaptive-polling interval.
	// nil falls back to a hardcoded default.
	MinPollMs *int `json:"min_poll_ms,omitempty"`
	// MaxPollMs is this template's own slowest adaptive-polling interval.
	// nil falls back to a hardcoded default.
	MaxPollMs *int `json:"max_poll_ms,omitempty"`
	// HysteresisMode selects how the detection engine re-arms after a match.
	// nil or "score" means the legacy score-based hysteresis exit; "region"
	// makes the detector watch the matched regions' pixel content and re-arm
	// only when it actually changes (for 3D games). The backend only validates
	// and persists this value; the frontend detection engine owns the semantics.
	HysteresisMode *string `json:"hysteresis_mode,omitempty"`
}

// DetectorRect defines a rectangular screen region in absolute pixel coordinates.
type DetectorRect struct {
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
}

// DetectorConfig holds all auto-detection settings for a single Pokémon hunt.
// A nil DetectorConfig means auto-detection is disabled for that hunt.
type DetectorConfig struct {
	Enabled     bool               `json:"enabled"`
	SourceType  string             `json:"source_type"` // "screen_region" | "window" | "camera"
	Region      DetectorRect       `json:"region"`
	WindowTitle string             `json:"window_title"`
	Templates   []DetectorTemplate `json:"templates"` // replaces TemplatePaths

	// ChangeThreshold is the pixel-delta fraction required to leave MATCH
	// state. Unlike precision/hysteresis/cooldown/hits/polling, this stays a
	// hunt-level setting; it is not exposed as a per-template control.
	ChangeThreshold     float64             `json:"change_threshold"`
	AdaptiveCooldown    bool                `json:"adaptive_cooldown"`
	AdaptiveCooldownMin int                 `json:"adaptive_cooldown_min"`   // Minimum seconds, default 3
	DetectionLog        []DetectionLogEntry `json:"detection_log,omitempty"` // last maxDetectionLog confirmed matches
}

// DefaultDetectorConfig returns a DetectorConfig with sensible defaults
// matching the database schema defaults and frontend expectations.
func DefaultDetectorConfig() *DetectorConfig {
	return &DetectorConfig{
		ChangeThreshold:     0.15,
		AdaptiveCooldownMin: 3,
	}
}

// DetectionLogEntry records a single confirmed auto-detection match.
type DetectionLogEntry struct {
	// At is the UTC timestamp when the match was confirmed.
	At time.Time `json:"at"`
	// Confidence is the NCC score that triggered the match (0.0–1.0).
	Confidence float64 `json:"confidence"`
	// Category is the counting category that fired, empty for the default one.
	Category string `json:"category,omitempty"`
}

// maxDetectionLog is the maximum number of log entries retained per hunt.
const maxDetectionLog = 20

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

// AppState is the complete serialisable snapshot of the application. It is
// sent to the frontend on every WebSocket connection and after every mutation.
type AppState struct {
	Pokemon         []Pokemon `json:"pokemon"`
	Sessions        []Session `json:"sessions"`
	Groups          []Group   `json:"groups"` // Organizational Sidebar sections; always an array, never null
	ActiveID        string    `json:"active_id"`
	ActiveGroupID   string    `json:"active_group_id"`
	Hotkeys         HotkeyMap `json:"hotkeys"`
	Settings        Settings  `json:"settings"`
	DataPath        string    `json:"data_path"`
	LicenseAccepted bool      `json:"license_accepted"`
}

// PokemonCounters carries the scalar counter and timer fields that the fast
// persistence path updates without rewriting the entire Pokémon row. It is used
// by the counter-only save path taken for hot-path mutations (increment,
// decrement, timer ticks) that touch no structural data.
type PokemonCounters struct {
	ID                 string
	Encounters         int
	TimerStartedAt     *time.Time
	TimerAccumulatedMs int64
}

// StateStore abstracts the database operations needed for state persistence.
// The database.DB type satisfies this interface implicitly.
type StateStore interface {
	// Normalized state persistence (v2 schema).
	SaveFullState(st *AppState) error
	LoadFullState() (*AppState, error)
	HasState() bool

	// UpdatePokemonCounters writes only the encounter and timer columns for the
	// given Pokémon rows. It is the fast path used when a mutation changed only
	// counter or timer scalars and no structural data.
	UpdatePokemonCounters(counters []PokemonCounters) error

	// Template image BLOB operations (used by detector API).
	SaveTemplateImage(pokemonID string, imageData []byte, sortOrder int) (int64, error)
	LoadTemplateImage(templateDBID int64) ([]byte, error)
	DeleteTemplateImage(templateDBID int64) error
}

// Manager holds all in-memory application state and coordinates safe
// concurrent access. All mutations go through Manager methods, which
// hold the appropriate lock and then dispatch onChange callbacks so
// that the WebSocket hub can broadcast the updated state.
type Manager struct {
	mu           sync.RWMutex
	state        AppState
	configDir    string
	dbDir        string
	db           StateStore
	onChange     []func(AppState)
	dirty        chan struct{}
	stopNotifier chan struct{}

	// Debounced-save state (guarded by saveMu, per-instance so multiple
	// Managers never cancel each other's saves). saveDeadline caps how long a
	// continuous stream of mutations can defer a flush.
	//
	// structuralDirty forces the next flush to rewrite the full state;
	// counterDirty accumulates the IDs of Pokémon whose counter/timer scalars
	// changed and are eligible for the fast UpdatePokemonCounters path. When
	// structuralDirty is set the counter set is ignored and a full save runs,
	// so correctness never depends on the fast path being taken.
	saveMu          sync.Mutex
	saveTimer       *time.Timer
	saveDeadline    time.Time
	structuralDirty bool
	counterDirty    map[string]struct{}
}

// overlayValueStyle returns the value typography shared by every text layer of
// the default overlay: one sans face at the given size, --text-primary on the
// panel, no stroke, and the minimal shadow floor. The shadow is invisible on
// the plate but keeps the text readable for users who drop the background
// opacity to 0 or hide the canvas layer entirely. The stroke colour is the
// panel rather than black, so a user who switches the stroke on gets a halo
// against the plate instead of a cartoon key line.
func overlayValueStyle(size int) TextStyle {
	return TextStyle{
		FontFamily:      fontSans,
		FontSize:        size,
		FontWeight:      700,
		TextAlign:       "left",
		ColorType:       colorTypeSolid,
		Color:           colorTextPrimary,
		OutlineType:     outlineTypeNone,
		OutlineWidth:    2,
		OutlineColor:    colorBgPrimary,
		TextShadow:      true,
		TextShadowColor: colorBlack,
		TextShadowX:     0,
		TextShadowY:     1,
		TextShadowBlur:  3,
	}
}

// overlayLabelStyle returns the caption typography of the label channel, the
// single caption rule of the default layout: every stat captions itself with a
// label, none of them with an inline prefix.
func overlayLabelStyle() TextStyle {
	return TextStyle{
		FontFamily: fontSans,
		FontSize:   11,
		FontWeight: 600,
		TextAlign:  "left",
		ColorType:  colorTypeSolid,
		Color:      colorTextMuted,
	}
}

// overlayLabelSet holds the six captions the default overlay writes into its
// label channels, in one language.
type overlayLabelSet struct {
	Encounters      string
	Time            string
	Odds            string
	Phase           string
	TotalEncounters string
	TotalTime       string
}

// overlayLabels maps a language code to the captions the seeded default overlay
// uses. A caption is stored text, not rendered text: it is written into the
// overlay once, on first run, and belongs to the user afterwards, so it has to
// be in their language from the start.
//
// The values are the `overlay.label*` keys of frontend/src/locales/*.json.
// Keeping a small table here rather than reading those files keeps the backend
// free of the frontend's assets; the frontend test in overlayTemplates.test.ts
// and the table test in state_test.go guard the two copies.
//
// German keeps the English loan words the Pokémon community uses (Encounter,
// Odds), which is why "ENCOUNTER" and "ODDS" are not translated there.
var overlayLabels = map[string]overlayLabelSet{
	"de": {"ENCOUNTER", "ZEIT", "ODDS", "PHASE", "ENCOUNTER GESAMT", "ZEIT GESAMT"},
	"en": {"ENCOUNTERS", "TIME", "ODDS", "PHASE", "TOTAL ENCOUNTERS", "TOTAL TIME"},
	"es": {"ENCUENTROS", "TIEMPO", "PROBABILIDAD", "FASE", "ENCUENTROS TOTALES", "TIEMPO TOTAL"},
	"fr": {"RENCONTRES", "TEMPS", "PROBABILITÉ", "PHASE", "RENCONTRES TOTALES", "TEMPS TOTAL"},
	"ja": {"エンカウント", "タイム", "確率", "フェーズ", "合計エンカウント", "合計タイム"},
}

// overlayLabelsFor picks the caption set for the first configured language.
// Anything the table does not know, including an empty configuration, falls
// back to English.
func overlayLabelsFor(languages []string) overlayLabelSet {
	if len(languages) > 0 {
		if labels, ok := overlayLabels[languages[0]]; ok {
			return labels
		}
	}
	return overlayLabels["en"]
}

// overlayStripStat returns one of the three phasing slots of the default stat
// strip. They differ only in position, z-index and caption, and all three ship
// hidden: a phase number, a total encounter count and a total time say nothing
// until the user actually phases.
func overlayStripStat(x, zIndex int, label string) LabeledTextElement {
	return LabeledTextElement{
		OverlayElementBase: OverlayElementBase{Visible: false, X: x, Y: 196, Width: 144, Height: 44, ZIndex: zIndex},
		Style:              overlayValueStyle(20),
		ShowLabel:          true,
		LabelText:          label,
		LabelStyle:         overlayLabelStyle(),
		PrefixText:         "",
		SuffixText:         "",
		IdleAnimation:      animationNone,
		TriggerEnter:       animationNone,
		TriggerDecrement:   animationNone,
	}
}

// defaultOverlaySettings returns the default overlay layout: an 800x264 panel
// on a 24px margin, read as three bands (sprite plus identity header, hero
// counter, stat strip). The strip runs along the bottom margin as five 144px
// slots with 8px gutters, so the two stats that ship visible bracket it against
// both page margins and the three hidden phasing stats grow inward without
// moving a single coordinate.
//
// It is kept in sync with `buildDefaultOverlaySettings` in
// frontend/src/components/overlay-editor/overlayTemplates.ts so the initial
// overlay (created in NewManager) is identical to the layout the "reset
// overlay" button produces. The migrations in persist.go fill absent elements
// from here as well, so the three copies cannot drift apart.
//
// The captions come from the configured languages because the backend has no
// translator: the first entry decides, English fills in for anything the label
// table does not cover.
func defaultOverlaySettings(languages []string) OverlaySettings {
	labels := overlayLabelsFor(languages)
	return OverlaySettings{
		CanvasWidth:     800,
		CanvasHeight:    264,
		BackgroundColor: colorBgPrimary,
		// 0.9 rather than the old 0.6: every text colour has to clear 4.5:1 even
		// over a fully white game capture.
		BackgroundOpacity:   0.9,
		BackgroundAnimation: animationNone,
		Blur:                0,
		ShowBorder:          true,
		BorderColor:         colorBorderSubtle,
		BorderWidth:         1,
		BorderRadius:        0,
		Sprite: SpriteElement{
			OverlayElementBase: OverlayElementBase{Visible: true, X: 24, Y: 24, Width: 152, Height: 152, ZIndex: 1},
			ShowGlow:           true,
			GlowColor:          colorTextPrimary,
			// A backlight that lifts a dark sprite off the panel, not a soft bloom.
			GlowOpacity:   0.1,
			GlowBlur:      24,
			IdleAnimation: animationNone,
			// Motion on the counting hotkeys is feedback that the key fired, not
			// decoration, so both triggers stay on.
			TriggerEnter:      "bounce",
			TriggerDecrement:  "shake",
			CyclePhaseTargets: false,
			CycleIntervalMs:   defaultSpriteCycleIntervalMs,
			CycleTransition:   defaultSpriteCycleTransition,
		},
		Name: NameElement{
			OverlayElementBase: OverlayElementBase{Visible: true, X: 200, Y: 24, Width: 576, Height: 34, ZIndex: 2},
			Style:              overlayValueStyle(26),
			IdleAnimation:      animationNone,
			TriggerEnter:       animationNone,
			TriggerDecrement:   animationNone,
		},
		Title: TitleElement{
			// The renderer only paints the title when the hunt has one, so shipping
			// it visible costs an untitled hunt nothing and saves a trip to the
			// layer list for everyone else.
			OverlayElementBase: OverlayElementBase{Visible: true, X: 200, Y: 62, Width: 576, Height: 22, ZIndex: 4},
			Style:              titleStyle(),
			IdleAnimation:      animationNone,
			TriggerEnter:       animationNone,
			TriggerDecrement:   animationNone,
		},
		Counter: CounterElement{
			OverlayElementBase: OverlayElementBase{Visible: true, X: 200, Y: 92, Width: 576, Height: 88, ZIndex: 3},
			Style:              overlayValueStyle(64),
			ShowLabel:          true,
			LabelText:          labels.Encounters,
			LabelStyle:         overlayLabelStyle(),
			// The caption lives in the label channel, not in the prefix: a prefix
			// renders inline in the value's own style, so at 64px it would
			// overflow the card.
			PrefixText:       "",
			SuffixText:       "",
			IdleAnimation:    animationNone,
			TriggerEnter:     "slot",
			TriggerDecrement: "slot",
		},
		Timer: TimerElement{
			OverlayElementBase: OverlayElementBase{Visible: true, X: 24, Y: 196, Width: 144, Height: 44, ZIndex: 5},
			Style:              overlayValueStyle(20),
			ShowLabel:          true,
			LabelText:          labels.Time,
			LabelStyle:         overlayLabelStyle(),
			PrefixText:         "",
			SuffixText:         "",
			IdleAnimation:      animationNone,
		},
		Odds: OddsElement{
			OverlayElementBase: OverlayElementBase{Visible: true, X: 632, Y: 196, Width: 144, Height: 44, ZIndex: 6},
			Style:              oddsStyle(),
			ShowLabel:          true,
			LabelText:          labels.Odds,
			LabelStyle:         overlayLabelStyle(),
			PrefixText:         "",
			SuffixText:         "",
			Format:             "fractional",
			IdleAnimation:      animationNone,
			TriggerEnter:       animationNone,
			TriggerDecrement:   animationNone,
		},
		Phase:        overlayStripStat(176, 7, labels.Phase),
		TotalCounter: overlayStripStat(328, 8, labels.TotalEncounters),
		TotalTimer:   overlayStripStat(480, 9, labels.TotalTime),
	}
}

// titleStyle returns the typography of the title layer: one step below the name
// in both size and colour, so the header column reads as a hierarchy.
func titleStyle() TextStyle {
	s := overlayValueStyle(13)
	s.FontWeight = 600
	s.Color = colorTextSecondary
	return s
}

// oddsStyle returns the typography of the odds layer. It carries the single
// accent of the layout and is the only right-aligned element, so its value and
// label both hug the right page margin.
func oddsStyle() TextStyle {
	s := overlayValueStyle(20)
	s.Color = colorAccentViolet
	s.TextAlign = "right"
	return s
}

// NewManager creates a Manager with sensible defaults for all settings.
// The defaults are used as-is until Load() overwrites them from disk.
func NewManager(configDir string) *Manager {
	// Hoisted out of the literal below because the seeded overlay reads it:
	// the first entry decides which language the overlay captions are in.
	languages := []string{"de", "en"}
	m := &Manager{
		configDir:    configDir,
		dbDir:        configDir,
		dirty:        make(chan struct{}, 1),
		stopNotifier: make(chan struct{}),
		state: AppState{
			DataPath: configDir,
			Pokemon:  []Pokemon{},
			Sessions: []Session{},
			Groups:   []Group{},
			Settings: Settings{
				OutputEnabled:      false,
				OutputDir:          filepath.Join(configDir, "output"),
				AutoSave:           true,
				Languages:          languages,
				CrispSprites:       true,
				AccentColor:        "violet",
				CaptureResolutions: map[string]string{},
				Overlay:            defaultOverlaySettings(languages),
			},
			Hotkeys: HotkeyMap{
				Increment:   "F1",
				Decrement:   "F2",
				Reset:       "F3",
				NextPokemon: "F4",
			},
		},
	}
	return m
}

// SetDB injects the database-backed store used for state persistence.
func (m *Manager) SetDB(store StateStore) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.db = store
}

// OnChange registers a callback that is invoked (in its own goroutine) after
// every state mutation. The callback receives a value copy of the state so it
// is safe to read without holding the lock.
func (m *Manager) OnChange(fn func(AppState)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.onChange = append(m.onChange, fn)
}

// notifyChange signals the notifier goroutine that state has changed.
// Multiple rapid calls are coalesced into a single notification cycle.
// Safe to call without holding any lock.
func (m *Manager) notifyChange() {
	select {
	case m.dirty <- struct{}{}:
	default:
		// Already marked dirty — coalescing
	}
}

// markDirty records a structural state change: it schedules a broadcast and
// forces the next scheduled save to rewrite the full state. It is the default
// signal for every mutation; the counter/timer hot path calls markCounterDirty
// instead to stay eligible for the fast counter-only save path. Safe to call
// without holding m.mu.
func (m *Manager) markDirty() {
	m.saveMu.Lock()
	m.structuralDirty = true
	m.saveMu.Unlock()
	m.notifyChange()
}

// markCounterDirty records a counter/timer-only change to the given Pokémon
// IDs, scheduling a broadcast while keeping the change eligible for the fast
// counter-only save path. It never sets structuralDirty, so if a structural
// change is also pending the next flush still performs a full save.
func (m *Manager) markCounterDirty(ids ...string) {
	m.saveMu.Lock()
	if m.counterDirty == nil {
		m.counterDirty = make(map[string]struct{})
	}
	for _, id := range ids {
		m.counterDirty[id] = struct{}{}
	}
	m.saveMu.Unlock()
	m.notifyChange()
}

// StartNotifier launches the background goroutine that coalesces rapid
// state mutations into batched onChange dispatches. It should be called
// once during application startup, after all OnChange callbacks are
// registered.
func (m *Manager) StartNotifier() {
	go func() {
		for {
			select {
			case <-m.stopNotifier:
				return
			case <-m.dirty:
				// Coalesce: keep waiting while more mutations arrive
				// within 50 ms windows, then dispatch once.
				m.coalesceAndDispatch()
			}
		}
	}()
	slog.Debug("State notifier started")
}

// coalesceAndDispatch waits for a 50 ms quiet period, draining any
// additional dirty signals, then reads the current state under RLock
// and dispatches all onChange callbacks.
func (m *Manager) coalesceAndDispatch() {
	timer := time.NewTimer(50 * time.Millisecond)
	defer timer.Stop()

	for {
		select {
		case <-m.dirty:
			// Reset the timer on each new dirty signal
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(50 * time.Millisecond)
		case <-timer.C:
			// 50 ms elapsed with no new mutations — dispatch now
			m.mu.RLock()
			state := cloneState(m.state)
			callbacks := m.onChange
			m.mu.RUnlock()

			for _, fn := range callbacks {
				go fn(state)
			}
			return
		case <-m.stopNotifier:
			return
		}
	}
}

// StopNotifier shuts down the background notifier goroutine.
// It should be called during graceful application shutdown.
func (m *Manager) StopNotifier() {
	close(m.stopNotifier)
	slog.Debug("State notifier stopped")
}

// GetState returns a value copy of the current application state with the
// Pokémon slice sorted ascending by SortOrder (stable). Sorting operates on a
// copy so the underlying storage order is never mutated. Safe to call
// concurrently; acquires a read lock.
func (m *Manager) GetState() AppState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	st := cloneState(m.state)
	sort.SliceStable(st.Pokemon, func(i, j int) bool {
		return st.Pokemon[i].SortOrder < st.Pokemon[j].SortOrder
	})
	return st
}

// cloneState returns a snapshot of s that is safe to read (marshal, persist)
// after the caller releases the state lock, without racing in-place mutations
// of the live state. The slices that are mutated in place (Pokemon and each
// Pokemon's Tags and PhaseTargets) and the CaptureResolutions map receive fresh
// backing storage; Sessions, Groups and Languages are also cloned since they are
// appended to. Pointer fields (Overlay, DetectorConfig, *time.Time) are replaced
// wholesale under Lock rather than mutated in place, so sharing those pointers
// is safe.
func cloneState(s AppState) AppState {
	s.Pokemon = slices.Clone(s.Pokemon)
	for i := range s.Pokemon {
		s.Pokemon[i].Tags = slices.Clone(s.Pokemon[i].Tags)
		s.Pokemon[i].PhaseTargets = slices.Clone(s.Pokemon[i].PhaseTargets)
	}
	s.Sessions = slices.Clone(s.Sessions)
	s.Groups = slices.Clone(s.Groups)
	s.Settings.Languages = slices.Clone(s.Settings.Languages)
	s.Settings.CaptureResolutions = maps.Clone(s.Settings.CaptureResolutions)
	return s
}

// GetActivePokemon returns a pointer to a copy of the currently active
// Pokémon, or nil if no Pokémon is active. The returned value is safe to
// read after the lock is released because it is a copy.
func (m *Manager) GetActivePokemon() *Pokemon {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == m.state.ActiveID {
			p := m.state.Pokemon[i]
			return &p
		}
	}
	return nil
}

// AddPokemon appends p to the Pokémon list. If the list was empty before and p
// is not already finished, p is automatically set as the active Pokémon. Tags
// and PhaseTargets are normalised to non-nil slices so JSON serialisation never
// emits null.
func (m *Manager) AddPokemon(p Pokemon) {
	if p.Tags == nil {
		p.Tags = []string{}
	}
	p.PhaseTargets = normalizePhaseTargets(p.PhaseTargets)
	m.mu.Lock()
	m.state.Pokemon = append(m.state.Pokemon, p)
	// An entry that arrives with a CompletedAt is history, not a hunt in
	// progress. Without this guard the first hand-entered catch on a fresh
	// install would become the running hunt and take the hotkeys with it.
	if m.state.ActiveID == "" && m.state.ActiveGroupID == "" && p.CompletedAt == nil {
		m.state.ActiveID = p.ID
		for i := range m.state.Pokemon {
			m.state.Pokemon[i].IsActive = m.state.Pokemon[i].ID == p.ID
		}
	}
	m.mu.Unlock()
	m.markDirty()
}

// applyPokemonUpdate merges non-zero fields from update into dst. Only
// user-editable fields are touched; immutable fields like ID, CreatedAt and the
// phase link (PhaseOf, PhaseNumber) are preserved.
func applyPokemonUpdate(dst *Pokemon, update Pokemon) {
	applyBasicFields(dst, update)
	applyOverlayUpdate(dst, update)
	// Always update Step (0 means default of 1)
	dst.Step = update.Step
	// Always update SortOrder (0 is a valid first position)
	dst.SortOrder = update.SortOrder
}

// applyBasicFields copies non-zero basic fields from update to dst.
func applyBasicFields(dst *Pokemon, update Pokemon) {
	if update.Name != "" {
		dst.Name = update.Name
		dst.Nickname = strings.TrimSpace(update.Nickname)
	}
	// Always update Title (allow clearing to "")
	dst.Title = update.Title
	if update.CanonicalName != "" {
		dst.CanonicalName = update.CanonicalName
	}
	if update.Gender != "" {
		dst.Gender = update.Gender
	}
	if update.SpriteURL != "" {
		dst.SpriteURL = update.SpriteURL
	}
	if update.SpriteType != "" {
		dst.SpriteType = update.SpriteType
	}
	// Always update SpriteStyle (allow clearing to "" which means "classic")
	dst.SpriteStyle = update.SpriteStyle
	if update.Language != "" {
		dst.Language = update.Language
	}
	if update.Game != "" {
		dst.Game = update.Game
	}
	if update.HuntType != "" {
		dst.HuntType = update.HuntType
	}
	// Always update HuntMode (allow clearing to "" which means "both")
	dst.HuntMode = update.HuntMode
	// Always update ShinyCharm (bool zero-value = false is a valid state)
	dst.ShinyCharm = update.ShinyCharm
	// Always update SparklingPower (0 = no sandwich boost is a valid state)
	dst.SparklingPower = update.SparklingPower
	// Always update ShinyVariant so an entry can be reset to "" (any) again.
	dst.ShinyVariant = update.ShinyVariant
	// Always update GroupID (empty string means "no group").
	dst.GroupID = update.GroupID
	// Always replace Tags when the caller supplied them (non-nil). A nil Tags
	// slice on update indicates the caller did not touch tags and preserves
	// existing values. Empty slice explicitly clears all tags.
	if update.Tags != nil {
		dst.Tags = normalizeTags(update.Tags)
	}
	// Same contract as Tags: nil means "not touched", empty clears the list.
	// PhaseOf and PhaseNumber are intentionally absent here; a phase link is
	// established by EndPhase alone and must survive every edit of the entry.
	// Catch is absent for the same reason: it is written by SetCatchMeta alone,
	// so an edit form that never loaded it cannot wipe it.
	if update.PhaseTargets != nil {
		dst.PhaseTargets = normalizePhaseTargets(update.PhaseTargets)
	}
	if update.PokedexIDs != nil {
		dst.PokedexIDs = normalizeTags(update.PokedexIDs)
	}
}

// normalizeTags trims whitespace, drops empty entries, and removes duplicates
// while preserving the first-seen order. Returns a non-nil slice so JSON
// serialisation produces [] rather than null.
func normalizeTags(raw []string) []string {
	seen := make(map[string]struct{}, len(raw))
	out := make([]string, 0, len(raw))
	for _, t := range raw {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		if _, dup := seen[t]; dup {
			continue
		}
		seen[t] = struct{}{}
		out = append(out, t)
	}
	return out
}

// normalizePhaseTargets trims every field, drops targets without a canonical
// name and removes duplicates by canonical name while preserving the first-seen
// order. The canonical name is the identity of a target: it is the second half
// of the phase_targets primary key, so a duplicate or empty one would collide in
// the database. Returns a non-nil slice so JSON serialisation produces []
// rather than null.
func normalizePhaseTargets(raw []PhaseTarget) []PhaseTarget {
	seen := make(map[string]struct{}, len(raw))
	out := make([]PhaseTarget, 0, len(raw))
	for _, t := range raw {
		t.CanonicalName = strings.TrimSpace(t.CanonicalName)
		t.Name = strings.TrimSpace(t.Name)
		t.SpriteURL = strings.TrimSpace(t.SpriteURL)
		if t.CanonicalName == "" {
			continue
		}
		if _, dup := seen[t.CanonicalName]; dup {
			continue
		}
		seen[t.CanonicalName] = struct{}{}
		out = append(out, t)
	}
	return out
}

// applyOverlayUpdate handles overlay and overlay-mode changes, clearing the
// per-pokemon overlay when switching away from "custom" mode.
func applyOverlayUpdate(dst *Pokemon, update Pokemon) {
	dst.Overlay = update.Overlay
	if update.OverlayMode != "" {
		dst.OverlayMode = update.OverlayMode
		if update.OverlayMode != "custom" {
			dst.Overlay = nil
		}
	}
}

// UpdatePokemon applies non-zero fields from update to the Pokémon with the
// given id. Returns false if no matching Pokémon was found.
// Only user-editable fields are updated; immutable fields like ID and
// CreatedAt are always preserved.
func (m *Manager) UpdatePokemon(id string, update Pokemon) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			applyPokemonUpdate(&m.state.Pokemon[i], update)
			m.markDirty()
			return true
		}
	}
	return false
}

// ClearPokemonSprite resets sprite_url to empty for the Pokémon with the given
// id. UpdatePokemon cannot do this itself since it treats an empty SpriteURL
// as "leave unchanged" so uploads are never accidentally wiped by unrelated
// field patches. Returns false if no matching Pokémon was found.
func (m *Manager) ClearPokemonSprite(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			m.state.Pokemon[i].SpriteURL = ""
			m.markDirty()
			return true
		}
	}
	return false
}

// ReorderPokemon assigns each Pokémon in orderedIDs a zero-based SortOrder
// matching its position. It returns an error if any id is unknown.
func (m *Manager) ReorderPokemon(orderedIDs []string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	// Index existing Pokémon by id so we can validate before mutating.
	indexByID := make(map[string]int, len(m.state.Pokemon))
	for i := range m.state.Pokemon {
		indexByID[m.state.Pokemon[i].ID] = i
	}
	for _, id := range orderedIDs {
		if _, ok := indexByID[id]; !ok {
			return fmt.Errorf("unknown pokemon id: %s", id)
		}
	}
	for order, id := range orderedIDs {
		m.state.Pokemon[indexByID[id]].SortOrder = order
	}
	m.markDirty()
	return nil
}

// resetLinkedOverlays resets any Pokemon whose overlay is linked to the given id back to "default".
func (m *Manager) resetLinkedOverlays(id string) {
	linked := overlayLinkedPrefix + id
	for j := range m.state.Pokemon {
		if m.state.Pokemon[j].OverlayMode == linked {
			m.state.Pokemon[j].OverlayMode = "default"
		}
	}
}

// DeletePokemon removes the Pokémon with the given id. If it was the active
// Pokémon, the first remaining entry becomes active. Returns false if not found.
//
// Deliberately keeps PhaseOf on the deleted hunt's phase entries instead of
// clearing it: an orphaned phase keeps its "phase N" marking (the frontend just
// omits the link back to the hunt). Clearing it would silently rewrite those
// entries into ordinary hunts and erase the fact that they were phases.
func (m *Manager) DeletePokemon(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, p := range m.state.Pokemon {
		if p.ID == id {
			m.state.Pokemon = append(m.state.Pokemon[:i], m.state.Pokemon[i+1:]...)
			if m.state.ActiveID == id {
				m.state.ActiveID = ""
				if len(m.state.Pokemon) > 0 {
					m.state.ActiveID = m.state.Pokemon[0].ID
					m.state.Pokemon[0].IsActive = true
				}
			}
			m.resetLinkedOverlays(id)
			m.markDirty()
			return true
		}
	}
	return false
}

// Increment adds step encounters to the Pokémon with the given id.
// Step defaults to 1 when not set.
// Returns the new count and true, or (0, false) if not found.
func (m *Manager) Increment(id string) (int, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			step := m.state.Pokemon[i].Step
			if step <= 0 {
				step = 1
			}
			m.state.Pokemon[i].Encounters += step
			count := m.state.Pokemon[i].Encounters
			m.markCounterDirty(id)
			return count, true
		}
	}
	return 0, false
}

// Decrement subtracts step encounters from the Pokémon with the given id,
// flooring at zero to prevent negative counts.
// Returns the new count and true, or (0, false) if not found.
func (m *Manager) Decrement(id string) (int, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			step := m.state.Pokemon[i].Step
			if step <= 0 {
				step = 1
			}
			if m.state.Pokemon[i].Encounters >= step {
				m.state.Pokemon[i].Encounters -= step
			} else {
				m.state.Pokemon[i].Encounters = 0
			}
			count := m.state.Pokemon[i].Encounters
			m.markCounterDirty(id)
			return count, true
		}
	}
	return 0, false
}

// Reset sets the encounter counter for the given Pokémon to zero.
// Returns false if the Pokémon was not found.
func (m *Manager) Reset(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			m.state.Pokemon[i].Encounters = 0
			m.markCounterDirty(id)
			return true
		}
	}
	return false
}

// IncrementGroup increments all running Pokémon in the given group by their
// step value. Completed entries are skipped: phase entries inherit the group of
// their hunt, and their counters are frozen history.
func (m *Manager) IncrementGroup(groupID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var changed []string
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].GroupID != groupID || m.state.Pokemon[i].CompletedAt != nil {
			continue
		}
		step := m.state.Pokemon[i].Step
		if step <= 0 {
			step = 1
		}
		m.state.Pokemon[i].Encounters += step
		changed = append(changed, m.state.Pokemon[i].ID)
	}
	m.markCounterDirty(changed...)
}

// DecrementGroup decrements all running Pokémon in the given group by their
// step value, flooring at zero. Completed entries are skipped for the same
// reason as in IncrementGroup.
func (m *Manager) DecrementGroup(groupID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var changed []string
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].GroupID != groupID || m.state.Pokemon[i].CompletedAt != nil {
			continue
		}
		step := m.state.Pokemon[i].Step
		if step <= 0 {
			step = 1
		}
		if m.state.Pokemon[i].Encounters >= step {
			m.state.Pokemon[i].Encounters -= step
		} else {
			m.state.Pokemon[i].Encounters = 0
		}
		changed = append(changed, m.state.Pokemon[i].ID)
	}
	m.markCounterDirty(changed...)
}

// ResetGroup resets the encounter count of all running Pokémon in the given
// group to 0. Completed entries are skipped: without that guard a group reset
// would wipe the encounter counts of every phase entry in the group and destroy
// the hunt history irrecoverably.
func (m *Manager) ResetGroup(groupID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var changed []string
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].GroupID == groupID && m.state.Pokemon[i].CompletedAt == nil {
			m.state.Pokemon[i].Encounters = 0
			changed = append(changed, m.state.Pokemon[i].ID)
		}
	}
	m.markCounterDirty(changed...)
}

// SetEncounters sets the encounter counter for the given Pokémon to an exact
// value (floored at 0). Returns the new count and true, or (0, false) if not found.
func (m *Manager) SetEncounters(id string, count int) (int, bool) {
	if count < 0 {
		count = 0
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			m.state.Pokemon[i].Encounters = count
			m.markCounterDirty(id)
			return count, true
		}
	}
	return 0, false
}

// StartTimer sets TimerStartedAt for the Pokémon, beginning time accumulation.
// No-ops if the timer is already running. Returns false if not found.
func (m *Manager) StartTimer(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			if m.state.Pokemon[i].TimerStartedAt == nil {
				now := time.Now()
				m.state.Pokemon[i].TimerStartedAt = &now
			}
			m.markCounterDirty(id)
			return true
		}
	}
	return false
}

// StopTimer calculates elapsed time since TimerStartedAt, adds it to
// TimerAccumulatedMs, and clears TimerStartedAt. Returns false if not found.
func (m *Manager) StopTimer(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			if m.state.Pokemon[i].TimerStartedAt != nil {
				elapsed := time.Since(*m.state.Pokemon[i].TimerStartedAt)
				m.state.Pokemon[i].TimerAccumulatedMs += elapsed.Milliseconds()
				m.state.Pokemon[i].TimerStartedAt = nil
			}
			m.markCounterDirty(id)
			return true
		}
	}
	return false
}

// ToggleHunt flips the timer state for the Pokémon with the given id.
// If the timer is running, it is stopped and the elapsed segment is folded
// into TimerAccumulatedMs; running is false (now stopped).
// If the timer is not running, it is started; running is true (now running).
// huntMode carries the Pokémon's current hunt_mode so callers can include it
// in the broadcast without a second lookup. ok is false only when no Pokémon
// with the given id exists.
//
// The detector loop runs in-browser — this method intentionally only toggles
// the backend-owned timer. Callers broadcast a typed WebSocket event so the
// frontend can start or stop its detection loop in lockstep.
func (m *Manager) ToggleHunt(id string) (running bool, huntMode string, ok bool) {
	m.mu.Lock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID != id {
			continue
		}
		mode := m.state.Pokemon[i].HuntMode
		if m.state.Pokemon[i].TimerStartedAt != nil {
			elapsed := time.Since(*m.state.Pokemon[i].TimerStartedAt)
			m.state.Pokemon[i].TimerAccumulatedMs += elapsed.Milliseconds()
			m.state.Pokemon[i].TimerStartedAt = nil
			m.mu.Unlock()
			m.markCounterDirty(id)
			return false, mode, true
		}
		now := time.Now()
		m.state.Pokemon[i].TimerStartedAt = &now
		m.mu.Unlock()
		m.markCounterDirty(id)
		return true, mode, true
	}
	m.mu.Unlock()
	return false, "", false
}

// StopAllTimers folds elapsed time into accumulated for every running timer
// and clears TimerStartedAt. Used during graceful shutdown.
func (m *Manager) StopAllTimers() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].TimerStartedAt != nil {
			elapsed := time.Since(*m.state.Pokemon[i].TimerStartedAt)
			m.state.Pokemon[i].TimerAccumulatedMs += elapsed.Milliseconds()
			m.state.Pokemon[i].TimerStartedAt = nil
		}
	}
}

// ResetTimer clears both TimerStartedAt and TimerAccumulatedMs.
// Returns false if not found.
func (m *Manager) ResetTimer(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			m.state.Pokemon[i].TimerStartedAt = nil
			m.state.Pokemon[i].TimerAccumulatedMs = 0
			m.markCounterDirty(id)
			return true
		}
	}
	return false
}

// SetTimer sets TimerAccumulatedMs to the given value. If the timer is
// currently running, the running segment is discarded (not folded) because
// the caller is explicitly overriding the total. Returns false if not found.
func (m *Manager) SetTimer(id string, ms int64) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			m.state.Pokemon[i].TimerStartedAt = nil
			if ms < 0 {
				ms = 0
			}
			m.state.Pokemon[i].TimerAccumulatedMs = ms
			m.markCounterDirty(id)
			return true
		}
	}
	return false
}

// SetActive marks the Pokémon with the given id as active and clears the
// IsActive flag on all others. Returns false if no matching Pokémon exists.
func (m *Manager) SetActive(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	found := false
	for _, p := range m.state.Pokemon {
		if p.ID == id {
			found = true
			break
		}
	}
	if !found {
		return false
	}
	m.state.ActiveID = id
	m.state.ActiveGroupID = ""
	for i := range m.state.Pokemon {
		m.state.Pokemon[i].IsActive = m.state.Pokemon[i].ID == id
	}
	m.markDirty()
	return true
}

// SetActiveGroup marks the group with the given ID as the active hotkey target.
// It clears ActiveID so individual-pokemon hotkeys do not fire simultaneously.
// Returns false if groupID is not found.
func (m *Manager) SetActiveGroup(groupID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if groupID != "" {
		found := false
		for _, g := range m.state.Groups {
			if g.ID == groupID {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	m.state.ActiveGroupID = groupID
	m.state.ActiveID = ""
	for i := range m.state.Pokemon {
		m.state.Pokemon[i].IsActive = false
	}
	m.markDirty()
	return true
}

// GetActiveGroupID returns the ID of the currently active group, or "" if none.
func (m *Manager) GetActiveGroupID() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.state.ActiveGroupID
}

// CompletePokemon stamps the Pokémon's CompletedAt field with the current
// time, marking the hunt as finished. Returns false if not found.
func (m *Manager) CompletePokemon(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			now := time.Now()
			// Finalize a running timer so elapsed ms are preserved and the
			// counter stops advancing after completion.
			if m.state.Pokemon[i].TimerStartedAt != nil {
				elapsed := now.Sub(*m.state.Pokemon[i].TimerStartedAt)
				m.state.Pokemon[i].TimerAccumulatedMs += elapsed.Milliseconds()
				m.state.Pokemon[i].TimerStartedAt = nil
			}
			m.state.Pokemon[i].CompletedAt = &now
			m.markDirty()
			return true
		}
	}
	return false
}

// SetCompletedAt re-dates an entry that is already finished, overwriting its
// CompletedAt with at. Returns false for an unknown id and for an entry whose
// CompletedAt is still nil: finishing a running hunt goes through
// CompletePokemon, which also finalizes the timer.
func (m *Manager) SetCompletedAt(id string, at time.Time) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID != id {
			continue
		}
		if m.state.Pokemon[i].CompletedAt == nil {
			return false
		}
		stamped := at
		m.state.Pokemon[i].CompletedAt = &stamped
		m.markDirty()
		return true
	}
	return false
}

// FailPokemon stamps the Pokémon's CompletedAt field with the current time
// and marks it as failed, archiving the hunt as "shiny sighted, not caught"
// instead of a regular catch. Returns false if not found.
//
// Phase entries are refused: a phase can only be failed through EndPhase,
// which archives it as a new child instead of mutating the phase itself.
func (m *Manager) FailPokemon(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			if m.state.Pokemon[i].PhaseOf != "" {
				return false
			}
			now := time.Now()
			// Finalize a running timer so elapsed ms are preserved and the
			// counter stops advancing after completion.
			if m.state.Pokemon[i].TimerStartedAt != nil {
				elapsed := now.Sub(*m.state.Pokemon[i].TimerStartedAt)
				m.state.Pokemon[i].TimerAccumulatedMs += elapsed.Milliseconds()
				m.state.Pokemon[i].TimerStartedAt = nil
			}
			m.state.Pokemon[i].CompletedAt = &now
			m.state.Pokemon[i].Failed = true
			m.markDirty()
			return true
		}
	}
	return false
}

// SetCatchMeta replaces the recorded catch details of the Pokémon with the
// given id. A nil meta, or one that carries nothing once its ribbons are
// normalized, clears the record. Returns false if not found.
func (m *Manager) SetCatchMeta(id string, meta *CatchMeta, nickname, gender string, spriteURL *string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID != id {
			continue
		}
		var stored *CatchMeta
		if meta != nil {
			normalized := *meta
			normalized.Nickname = ""
			normalized.Ribbons = normalizeTags(normalized.Ribbons)
			if !normalized.IsEmpty() {
				stored = &normalized
			}
		}
		m.state.Pokemon[i].Catch = stored
		m.state.Pokemon[i].Nickname = strings.TrimSpace(nickname)
		m.state.Pokemon[i].Gender = gender
		if spriteURL != nil {
			m.state.Pokemon[i].SpriteURL = *spriteURL
		}
		m.markDirty()
		return true
	}
	return false
}

// UncompletePokemon clears the CompletedAt timestamp, moving the Pokémon
// back to active-hunt status. It also clears Failed, so reactivating a failed
// hunt lifts the fail state without a separate "unfail" action. Returns false
// if not found.
//
// Phase entries are refused: a reactivated phase would keep counting while its
// frozen encounters and time still flow into the totals of its parent hunt.
// UndoPhase is the supported way to take a phase back.
func (m *Manager) UncompletePokemon(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			if m.state.Pokemon[i].PhaseOf != "" {
				return false
			}
			m.state.Pokemon[i].CompletedAt = nil
			m.state.Pokemon[i].Failed = false
			m.markDirty()
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

// indexOfPokemon returns the position of the Pokémon with the given id in list,
// or -1 when it is not present.
func indexOfPokemon(list []Pokemon, id string) int {
	for i := range list {
		if list[i].ID == id {
			return i
		}
	}
	return -1
}

// EndPhase closes the running phase of the hunt with parentID. The off-target
// shiny described by catch becomes a completed child entry that freezes the
// hunt's encounters and elapsed time, and the hunt itself restarts at zero
// while a running timer keeps running. failed marks the resulting child entry
// as a sighted-but-not-caught phase instead of a regular catch.
//
// Returns the created child entry, ErrPhaseParentNotFound when parentID is
// unknown, or ErrNotPhaseable when the target is itself a phase or is already
// completed.
//
// The whole transition runs under a single lock and reimplements the pieces of
// CompletePokemon, Reset and AddPokemon it needs instead of calling them: each
// of those takes the lock itself, so a broadcast or save could observe the hunt
// already reset but the phase entry not yet inserted. Reset also only raises
// markCounterDirty, which would let the fast counter-only save path write the
// zeroed hunt without ever inserting the new row.
func (m *Manager) EndPhase(parentID string, catch PhaseCatch, failed bool) (Pokemon, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	idx := indexOfPokemon(m.state.Pokemon, parentID)
	if idx < 0 {
		return Pokemon{}, ErrPhaseParentNotFound
	}
	parent := m.state.Pokemon[idx]
	// Guard EndPhase adds on top of the shared link rules: a hunt that is
	// already archived cannot start another phase.
	if parent.CompletedAt != nil {
		return Pokemon{}, ErrNotPhaseable
	}
	// The link itself is validated by the single phase-link validator so the
	// hunt API and EndPhase cannot disagree about what a valid parent is.
	if _, err := ResolvePhaseLink(m.state.Pokemon, "", parentID, 0); err != nil {
		if errors.Is(err, ErrPhaseParentNotFound) {
			return Pokemon{}, ErrPhaseParentNotFound
		}
		return Pokemon{}, ErrNotPhaseable
	}

	now := time.Now()
	child := buildPhaseChild(m.state.Pokemon, parent, catch, now, failed)

	// Reset the hunt before appending: append may reallocate the slice, so the
	// index must still refer to the live backing array.
	m.state.Pokemon[idx].Encounters = 0
	m.state.Pokemon[idx].TimerAccumulatedMs = 0
	if m.state.Pokemon[idx].TimerStartedAt != nil {
		// The timer keeps running across the phase change; only its origin moves
		// so the new phase starts at zero.
		started := now
		m.state.Pokemon[idx].TimerStartedAt = &started
	}
	m.state.Pokemon = append(m.state.Pokemon, child)

	m.markDirty()
	return child, nil
}

// buildPhaseChild assembles the completed archive entry for a finished phase.
// It inherits the hunt context (game, language, method, charm, hunt mode, sprite
// style, group) and freezes the hunt's encounters and elapsed time, including a
// currently running timer segment measured up to now. failed marks the entry as
// a sighted-but-not-caught phase instead of a regular catch.
//
// DetectorConfig stays nil on purpose: copying it would duplicate every template
// image of the hunt for each phase. Overlay, IsActive, Tags and PhaseTargets are
// not inherited either; they describe the running hunt, not its history.
func buildPhaseChild(all []Pokemon, parent Pokemon, catch PhaseCatch, now time.Time, failed bool) Pokemon {
	frozenMs := parent.TimerAccumulatedMs
	if parent.TimerStartedAt != nil {
		frozenMs += now.Sub(*parent.TimerStartedAt).Milliseconds()
	}
	completedAt := now
	return Pokemon{
		ID:                 uuid.NewString(),
		Name:               catch.Name,
		BaseName:           catch.BaseName,
		FormName:           catch.FormName,
		CanonicalName:      catch.CanonicalName,
		Gender:             catch.Gender,
		SpriteURL:          catch.SpriteURL,
		SpriteType:         "shiny",
		SpriteStyle:        parent.SpriteStyle,
		Encounters:         parent.Encounters,
		CreatedAt:          phaseStartedAt(all, parent),
		Language:           parent.Language,
		Game:               parent.Game,
		CompletedAt:        &completedAt,
		Failed:             failed,
		OverlayMode:        "default",
		HuntType:           parent.HuntType,
		ShinyCharm:         parent.ShinyCharm,
		SparklingPower:     parent.SparklingPower,
		TimerAccumulatedMs: frozenMs,
		HuntMode:           parent.HuntMode,
		GroupID:            parent.GroupID,
		Tags:               []string{},
		SortOrder:          len(all),
		PhaseOf:            parent.ID,
		PhaseNumber:        PhaseNumber(all, parent.ID),
		PhaseTargets:       []PhaseTarget{},
		PokedexIDs:         append([]string(nil), parent.PokedexIDs...),
	}
}

// phaseStartedAt returns the start of the phase that is ending: the moment the
// previous phase was caught, or the creation of the hunt for the first phase.
// Storing it as the child's CreatedAt keeps the phase duration derivable and
// the archive sorted in the order the phases actually happened.
func phaseStartedAt(all []Pokemon, parent Pokemon) time.Time {
	children := PhaseChildren(all, parent.ID)
	if len(children) > 0 {
		if last := children[len(children)-1]; last.CompletedAt != nil {
			return *last.CompletedAt
		}
	}
	return parent.CreatedAt
}

// UndoPhase takes back the most recent phase change of a hunt: the phase entry
// with childID returns its encounters and accumulated time to its parent hunt
// and is removed. Returns the updated parent hunt.
//
// Only the newest phase can be undone, because any older one would leave a hole
// that the max(phase_number)+1 numbering cannot express. Returns
// ErrPhaseParentNotFound when childID is unknown or its parent hunt no longer
// exists, and ErrNotPhaseable when the entry is not a phase or not the newest
// one.
func (m *Manager) UndoPhase(childID string) (Pokemon, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	ci := indexOfPokemon(m.state.Pokemon, childID)
	if ci < 0 {
		return Pokemon{}, ErrPhaseParentNotFound
	}
	child := m.state.Pokemon[ci]
	if child.PhaseOf == "" {
		return Pokemon{}, ErrNotPhaseable
	}
	for _, sibling := range m.state.Pokemon {
		if sibling.PhaseOf == child.PhaseOf && sibling.PhaseNumber > child.PhaseNumber {
			return Pokemon{}, ErrNotPhaseable
		}
	}
	pi := indexOfPokemon(m.state.Pokemon, child.PhaseOf)
	if pi < 0 {
		return Pokemon{}, ErrPhaseParentNotFound
	}

	// The parent keeps its own running timer; only the frozen milliseconds of
	// the phase flow back, so an undo during a running hunt loses no time.
	m.state.Pokemon[pi].Encounters += child.Encounters
	m.state.Pokemon[pi].TimerAccumulatedMs += child.TimerAccumulatedMs

	m.state.Pokemon = append(m.state.Pokemon[:ci], m.state.Pokemon[ci+1:]...)
	m.resetLinkedOverlays(childID)
	if m.state.ActiveID == childID {
		// Hand the selection to the hunt the phase belonged to rather than
		// leaving a dangling active id behind.
		m.state.ActiveID = child.PhaseOf
		for i := range m.state.Pokemon {
			m.state.Pokemon[i].IsActive = m.state.Pokemon[i].ID == child.PhaseOf
		}
	}

	m.markDirty()
	// Re-resolve the index: removing the phase entry shifted everything after it.
	return m.state.Pokemon[indexOfPokemon(m.state.Pokemon, child.PhaseOf)], nil
}

// NextPokemon advances the active Pokémon to the next entry in the list,
// wrapping around at the end. No-ops when the list is empty.
func (m *Manager) NextPokemon() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.state.Pokemon) == 0 {
		return
	}
	idx := 0
	for i, p := range m.state.Pokemon {
		if p.ID == m.state.ActiveID {
			idx = (i + 1) % len(m.state.Pokemon)
			break
		}
	}
	m.state.ActiveID = m.state.Pokemon[idx].ID
	for i := range m.state.Pokemon {
		m.state.Pokemon[i].IsActive = m.state.Pokemon[i].ID == m.state.ActiveID
	}
	m.markDirty()
}

// UpdateSettings replaces the application settings atomically and notifies
// all listeners so the frontend and file-output writer stay in sync.
func (m *Manager) UpdateSettings(s Settings) {
	m.mu.Lock()
	// Preserve per-device capture resolutions when a settings payload omits
	// them (the dedicated /api/capture/resolution endpoint owns that map).
	if s.CaptureResolutions == nil {
		s.CaptureResolutions = m.state.Settings.CaptureResolutions
	}
	if s.CaptureResolutions == nil {
		s.CaptureResolutions = map[string]string{}
	}
	m.state.Settings = s
	m.mu.Unlock()
	m.markDirty()
}

// SetCaptureResolution stores the preferred capture resolution for a single
// camera deviceId and notifies listeners. An empty resolution removes the
// entry (falling back to the frontend default). The map is created lazily so
// older state loaded without it stays valid.
func (m *Manager) SetCaptureResolution(deviceKey, resolution string) {
	m.mu.Lock()
	if m.state.Settings.CaptureResolutions == nil {
		m.state.Settings.CaptureResolutions = map[string]string{}
	}
	if resolution == "" {
		delete(m.state.Settings.CaptureResolutions, deviceKey)
	} else {
		m.state.Settings.CaptureResolutions[deviceKey] = resolution
	}
	m.mu.Unlock()
	m.markDirty()
}

// UpdateHotkeys replaces the full hotkey map and notifies listeners.
func (m *Manager) UpdateHotkeys(h HotkeyMap) {
	m.mu.Lock()
	m.state.Hotkeys = h
	m.mu.Unlock()
	m.markDirty()
}

// UpdateSingleHotkey updates one field of the HotkeyMap and notifies listeners.
// Returns false if action is not a recognised key name.
func (m *Manager) UpdateSingleHotkey(action, key string) bool {
	m.mu.Lock()
	switch action {
	case "increment":
		m.state.Hotkeys.Increment = key
	case "decrement":
		m.state.Hotkeys.Decrement = key
	case "reset":
		m.state.Hotkeys.Reset = key
	case "next_pokemon":
		m.state.Hotkeys.NextPokemon = key
	case "hunt_toggle":
		m.state.Hotkeys.HuntToggle = key
	default:
		m.mu.Unlock()
		return false
	}
	m.mu.Unlock()
	m.markDirty()
	return true
}

// AcceptLicense records that the user has accepted the AGPLv3 license.
// The flag is persisted so the dialog is not shown again on future launches.
func (m *Manager) AcceptLicense() {
	m.mu.Lock()
	m.state.LicenseAccepted = true
	m.mu.Unlock()
	m.markDirty()
}

// AddSession appends a new session record. Sessions are informational only
// and are not currently used to drive encounter counts.
func (m *Manager) AddSession(sess Session) {
	m.mu.Lock()
	m.state.Sessions = append(m.state.Sessions, sess)
	m.mu.Unlock()
	m.markDirty()
}

// EndSession sets the EndedAt timestamp on the open session with the given id.
func (m *Manager) EndSession(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	for i := range m.state.Sessions {
		if m.state.Sessions[i].ID == id && m.state.Sessions[i].EndedAt == nil {
			m.state.Sessions[i].EndedAt = &now
			break
		}
	}
	m.markDirty()
}

// SetDetectorConfig replaces the DetectorConfig for the Pokémon with the given id.
// Pass nil to disable auto-detection for that hunt.
// Returns false if no matching Pokémon was found.
func (m *Manager) SetDetectorConfig(id string, cfg *DetectorConfig) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			m.state.Pokemon[i].DetectorConfig = cfg
			m.markDirty()
			return true
		}
	}
	return false
}

// GetConfigDir returns the directory used for state persistence
// (e.g. ~/.config/encounty on Linux).
func (m *Manager) GetConfigDir() string {
	return m.configDir
}

// SetDBDir points the manager at the directory holding the database. It also
// updates the state snapshot so a broadcast after a relocation reports the new
// location instead of the one the app started with.
func (m *Manager) SetDBDir(dir string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.dbDir = dir
	m.state.DataPath = dir
}

// SetOutputDir points the OBS text output at dir. UpdateSettings replaces the
// whole settings object and would clobber concurrent edits, so a relocation
// that only concerns this one path uses its own setter.
func (m *Manager) SetOutputDir(dir string) {
	m.mu.Lock()
	m.state.Settings.OutputDir = dir
	m.mu.Unlock()
	m.markDirty()
}

// GetDBDir returns the directory holding the database. It equals the
// configuration directory unless the user relocated the database.
func (m *Manager) GetDBDir() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.dbDir
}

// ResolveOverlay returns the effective OverlaySettings for a Pokemon,
// following links and falling back to the default layout.
func (m *Manager) ResolveOverlay(pokemonID string) OverlaySettings {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.resolveOverlayLocked(pokemonID, make(map[string]bool))
}

// resolveOverlayLocked recursively resolves the overlay for a Pokemon,
// using a visited set to break cycles in linked overlays.
func (m *Manager) resolveOverlayLocked(pokemonID string, visited map[string]bool) OverlaySettings {
	if visited[pokemonID] {
		return m.state.Settings.Overlay // break cycle
	}
	visited[pokemonID] = true
	for _, p := range m.state.Pokemon {
		if p.ID == pokemonID {
			switch {
			case strings.HasPrefix(p.OverlayMode, overlayLinkedPrefix):
				targetID := strings.TrimPrefix(p.OverlayMode, overlayLinkedPrefix)
				return m.resolveOverlayLocked(targetID, visited)
			case p.OverlayMode == "custom" && p.Overlay != nil:
				return *p.Overlay
			default:
				return m.state.Settings.Overlay
			}
		}
	}
	return m.state.Settings.Overlay
}

// UnlinkOverlay copies the resolved overlay settings for a Pokemon
// and sets its mode to "custom", breaking any link.
func (m *Manager) UnlinkOverlay(pokemonID string) bool {
	resolved := m.ResolveOverlay(pokemonID)
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, p := range m.state.Pokemon {
		if p.ID == pokemonID {
			m.state.Pokemon[i].OverlayMode = "custom"
			m.state.Pokemon[i].Overlay = &resolved
			m.markDirty()
			return true
		}
	}
	return false
}

// AppendDetectionLog records a confirmed auto-detection match for the Pokémon
// with the given id. Only the last maxDetectionLog entries are retained; older
// entries are dropped (FIFO). No-ops silently if the Pokémon has no DetectorConfig.
func (m *Manager) AppendDetectionLog(id string, confidence float64, category string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		p := &m.state.Pokemon[i]
		if p.ID != id || p.DetectorConfig == nil {
			continue
		}
		entry := DetectionLogEntry{At: time.Now().UTC(), Confidence: confidence, Category: category}
		p.DetectorConfig.DetectionLog = append(p.DetectorConfig.DetectionLog, entry)
		if len(p.DetectorConfig.DetectionLog) > maxDetectionLog {
			p.DetectorConfig.DetectionLog = p.DetectorConfig.DetectionLog[len(p.DetectorConfig.DetectionLog)-maxDetectionLog:]
		}
		m.markDirty()
		return
	}
}

// ClearDetectionLog removes all detection log entries for the given Pokemon.
// No-ops silently if the Pokémon or its DetectorConfig does not exist.
func (m *Manager) ClearDetectionLog(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		p := &m.state.Pokemon[i]
		if p.ID == id && p.DetectorConfig != nil {
			p.DetectorConfig.DetectionLog = nil
			m.markDirty()
			return
		}
	}
}

// ClearAllTemplates removes all templates for the given Pokemon.
// No-ops silently if the Pokémon or its DetectorConfig does not exist.
func (m *Manager) ClearAllTemplates(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		p := &m.state.Pokemon[i]
		if p.ID == id && p.DetectorConfig != nil {
			p.DetectorConfig.Templates = nil
			m.markDirty()
			return
		}
	}
}

// ---------------------------------------------------------------------------
// Groups and tags
// ---------------------------------------------------------------------------

// ListGroups returns a copy of all groups in their current sort order.
// The returned slice is safe to mutate without affecting state.
func (m *Manager) ListGroups() []Group {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]Group, len(m.state.Groups))
	copy(out, m.state.Groups)
	return out
}

// CreateGroup appends a new Group with a generated UUID. Name is trimmed and
// must be non-empty. The new group is placed at the end of the sort order.
// Returns the created Group or an error when the name is empty.
func (m *Manager) CreateGroup(name, color string) (Group, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Group{}, fmt.Errorf("group name must not be empty")
	}
	g := Group{
		ID:    uuid.NewString(),
		Name:  name,
		Color: strings.TrimSpace(color),
	}
	m.mu.Lock()
	g.SortOrder = len(m.state.Groups)
	m.state.Groups = append(m.state.Groups, g)
	m.mu.Unlock()
	m.markDirty()
	return g, nil
}

// UpdateGroup applies the non-nil fields of patch to the group with the given
// id. Returns the updated group, or an error when the group is not found or
// the patched name would become empty.
func (m *Manager) UpdateGroup(id string, patch GroupPatch) (Group, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Groups {
		if m.state.Groups[i].ID != id {
			continue
		}
		if patch.Name != nil {
			trimmed := strings.TrimSpace(*patch.Name)
			if trimmed == "" {
				return Group{}, fmt.Errorf("group name must not be empty")
			}
			m.state.Groups[i].Name = trimmed
		}
		if patch.Color != nil {
			m.state.Groups[i].Color = strings.TrimSpace(*patch.Color)
		}
		if patch.SortOrder != nil {
			m.state.Groups[i].SortOrder = *patch.SortOrder
		}
		if patch.Collapsed != nil {
			m.state.Groups[i].Collapsed = *patch.Collapsed
		}
		updated := m.state.Groups[i]
		m.markDirty()
		return updated, nil
	}
	return Group{}, fmt.Errorf("group %q not found", id)
}

// DeleteGroup removes the group with the given id and clears GroupID on any
// Pokémon that referenced it. Returns false when the group is not found.
func (m *Manager) DeleteGroup(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Groups {
		if m.state.Groups[i].ID == id {
			m.state.Groups = append(m.state.Groups[:i], m.state.Groups[i+1:]...)
			for j := range m.state.Pokemon {
				if m.state.Pokemon[j].GroupID == id {
					m.state.Pokemon[j].GroupID = ""
				}
			}
			m.markDirty()
			return true
		}
	}
	return false
}

// SetPokemonGroup assigns the given group to the Pokémon with pokemonID.
// Pass an empty groupID to clear the group. Returns false when the Pokémon is
// not found or when a non-empty groupID does not refer to an existing group.
func (m *Manager) SetPokemonGroup(pokemonID, groupID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if groupID != "" {
		found := false
		for _, g := range m.state.Groups {
			if g.ID == groupID {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == pokemonID {
			m.state.Pokemon[i].GroupID = groupID
			m.markDirty()
			return true
		}
	}
	return false
}

// SetPokemonTags replaces the tag list on the Pokémon with pokemonID. Tags are
// trimmed, deduplicated, and empty entries are dropped. Returns false when the
// Pokémon does not exist.
func (m *Manager) SetPokemonTags(pokemonID string, tags []string) bool {
	normalised := normalizeTags(tags)
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == pokemonID {
			m.state.Pokemon[i].Tags = normalised
			m.markDirty()
			return true
		}
	}
	return false
}
