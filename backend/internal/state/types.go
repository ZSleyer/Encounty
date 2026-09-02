// types.go defines the core domain types the application is built on: the hunt
// entry itself, its phases and catch metadata, groups, sessions, hotkeys and the
// detector configuration attached to a hunt. They are pure data carrying the
// JSON tags that the API, the WebSocket broadcast and the persisted state all
// share, so any behavior beyond inspecting a value belongs on the Manager.

package state

import (
	"encoding/json"
	"time"
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
// it is excluded from JSON serialization to avoid bloating WebSocket messages.
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
