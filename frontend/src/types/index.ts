/**
 * index.ts — TypeScript types that mirror the Go structs in internal/state/state.go.
 * Keep these in sync whenever the Go model changes.
 */

/** Pokemon represents one shiny-hunt entry. */
export interface Pokemon {
  id: string;
  name: string; // Display name (localized)
  canonical_name: string; // English PokéAPI slug
  sprite_url: string;
  sprite_type: "normal" | "shiny";
  sprite_style?: "classic" | "animated" | "3d" | "artwork";
  encounters: number;
  is_active: boolean;
  created_at: string;
  language: Language; // "de" | "en"
  game: string; // key from games.json
  completed_at?: string; // ISO timestamp when hunt completed
  overlay_mode: OverlayMode;
  overlay?: OverlaySettings; // Pokemon-specific overlay settings
  hunt_type?: string;
  detector_config?: DetectorConfig;
}

/** GameEntry is one Pokémon game as returned by GET /api/games. */
export interface GameEntry {
  key: string;
  names: Record<string, string>; // lang code → localised name
  generation: number;
  platform: string;
}

export type OverlayMode = "default" | "custom" | `linked:${string}`;

export type Language = string;

export interface Session {
  id: string;
  started_at: string;
  ended_at: string | null;
  pokemon_id: string;
  encounters: number;
}

/** HotkeyMap holds the key-combo string for each counter action. */
export interface HotkeyMap {
  increment: string;
  decrement: string;
  reset: string;
  next_pokemon: string;
}

/** DetectorRect defines a rectangular screen region in absolute pixel coordinates. */
export interface DetectorRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** DetectionLogEntry records one confirmed auto-detection match. */
export interface DetectionLogEntry {
  at: string;          // ISO timestamp
  confidence: number;  // 0.0–1.0
}

/** MatchedRegion defines a bounding box within a template and its match criteria. */
export interface MatchedRegion {
  type: "image" | "text";
  expected_text: string;
  rect: DetectorRect;
}

/** DetectorTemplate bundles the saved screenshot and its defined regions. */
export interface DetectorTemplate {
  image_path: string;
  regions: MatchedRegion[];
}

/** DetectorConfig holds all auto-detection settings for a single Pokémon hunt. */
export interface DetectorConfig {
  enabled: boolean;
  source_type: "screen_region" | "window" | "browser_camera" | "browser_display";
  region: DetectorRect;
  window_title: string;
  templates: DetectorTemplate[];
  precision: number;        // 0.0–1.0
  consecutive_hits: number;
  cooldown_sec: number;
  change_threshold: number;
  poll_interval_ms: number;  // base interval (adaptive centre point)
  min_poll_ms: number;       // fastest adaptive interval (high activity)
  max_poll_ms: number;       // slowest adaptive interval (static screen)
  detection_log?: DetectionLogEntry[]; // last N confirmed matches
}

/** HuntTypePreset is metadata for one shiny hunting method, returned by the server. */
export interface HuntTypePreset {
  key: string;
  name_de: string;
  name_en: string;
  odds_numer: number;
  odds_denom: number;
  default_cooldown_sec: number;
  default_consecutive_hits: number;
  template_tip: string;
}

export interface GradientStop {
  color: string;
  position: number; // 0-100
}

export interface TextStyle {
  font_family: string; // Google Font name or "sans"/"serif"/"monospace"/"pokemon"
  font_size: number;
  font_weight: number; // 100–900
  text_align: "left" | "center" | "right";
  color_type: "solid" | "gradient";
  color: string;
  gradient_stops: GradientStop[];
  gradient_angle: number;
  outline_type: "none" | "solid";
  outline_width: number;
  outline_color: string;
  outline_gradient_stops: GradientStop[];
  outline_gradient_angle: number;
  text_shadow: boolean;
  text_shadow_color: string;
  text_shadow_color_type: "solid" | "gradient";
  text_shadow_gradient_stops: GradientStop[];
  text_shadow_gradient_angle: number;
  text_shadow_blur: number;
  text_shadow_x: number;
  text_shadow_y: number;
}

export interface OverlayElementBase {
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
}

export interface SpriteElement extends OverlayElementBase {
  show_glow: boolean;
  glow_color: string; // hex "#rrggbb"
  glow_opacity: number; // 0–1
  glow_blur: number; // px
  idle_animation: string;
  trigger_enter: string;
  trigger_exit: string;
}

export interface NameElement extends OverlayElementBase {
  style: TextStyle;
  idle_animation: string; // "none" | "shimmer"
  trigger_enter: string; // "none" | "slide-in" | "fade-in"
}

export interface CounterElement extends OverlayElementBase {
  style: TextStyle;
  show_label: boolean;
  label_text: string;
  label_style: TextStyle;
  idle_animation: string; // "none"
  trigger_enter: string; // "none" | "pop" | "count-flash"
}

/**
 * OverlaySettings is the complete configuration for the OBS Browser Source
 * overlay, using an absolute-positioning canvas model.
 */
export interface OverlaySettings {
  // Canvas
  canvas_width: number;
  canvas_height: number;
  hidden?: boolean;
  background_color: string;
  background_opacity: number;
  background_animation?: string;
  background_animation_speed?: number; // multiplier, 1 = default, 0.5 = slow, 2 = fast
  background_image?: string;
  background_image_fit?: "cover" | "contain" | "stretch" | "tile";
  blur: number;
  show_border: boolean;
  border_color: string;
  border_width?: number;
  border_radius: number;

  // Elements
  sprite: SpriteElement;
  name: NameElement;
  counter: CounterElement;

  // Editor Tools
  snap_enabled?: boolean;
  snap_grid_size?: number;
}

/** Settings holds all user-configurable application preferences. */
export interface Settings {
  output_enabled: boolean;
  output_dir: string;
  auto_save: boolean;
  browser_port: number;
  languages: string[]; // active language codes for game names
  crisp_sprites?: boolean;
  overlay: OverlaySettings;
}

/** AppState is the complete serialisable snapshot broadcast by the server. */
export interface AppState {
  pokemon: Pokemon[];
  sessions: Session[];
  active_id: string;
  hotkeys: HotkeyMap;
  settings: Settings;
  data_path: string;
}

/** WSMessage is the envelope for all WebSocket messages in both directions. */
export interface WSMessage {
  type: string;
  payload: unknown;
}
