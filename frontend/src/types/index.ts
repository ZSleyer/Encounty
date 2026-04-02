/**
 * index.ts — TypeScript types that mirror the Go structs in internal/state/state.go.
 * Keep these in sync whenever the Go model changes.
 */

/** Pokemon represents one shiny-hunt entry. */
export interface Pokemon {
  id: string;
  name: string; // Display name (localized)
  title?: string; // User-defined custom title
  canonical_name: string; // English PokéAPI slug
  sprite_url: string;
  sprite_type: "normal" | "shiny";
  sprite_style?: "box" | "animated" | "3d" | "artwork" | "classic";
  encounters: number;
  step?: number; // Increment/decrement step size (default 1)
  is_active: boolean;
  created_at: string;
  language: string; // "de" | "en"
  game: string; // key from games.json
  completed_at?: string; // ISO timestamp when hunt completed
  overlay_mode: OverlayMode;
  overlay?: OverlaySettings; // Pokemon-specific overlay settings
  hunt_type?: string;
  detector_config?: DetectorConfig;
  timer_started_at?: string; // ISO timestamp when timer was started
  timer_accumulated_ms?: number; // Accumulated timer in milliseconds
  hunt_mode?: "both" | "timer" | "detector";
}

/** GameEntry is one Pokémon game as returned by GET /api/games. */
export interface GameEntry {
  key: string;
  names: Record<string, string>; // lang code → localised name
  generation: number;
  platform: string;
}

export type OverlayMode = "default" | "custom" | `linked:${string}`;


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

/** WindowInfo represents a native window available for capture. */
export interface WindowInfo {
  hwnd: number;
  title: string;
  class: string;
  w: number;
  h: number;
}

/** CameraInfo represents a native camera device available for capture. */
export interface CameraInfo {
  device_path: string;
  name: string;
  driver: string;
}

/** SourceInfo describes a capture source (screen, window, camera). */
export interface SourceInfo {
  id: string;
  title: string;
  source_type: string;
  w: number;
  h: number;
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
  polarity?: "positive" | "negative";
}

/** DetectorTemplate bundles the saved screenshot and its defined regions. */
export interface DetectorTemplate {
  template_db_id?: number;
  image_path: string;
  regions: MatchedRegion[];
  enabled?: boolean;
  name?: string;
}

/** DetectorConfig holds all auto-detection settings for a single Pokémon hunt. */
export interface DetectorConfig {
  enabled: boolean;
  source_type: "screen_region" | "window" | "camera" | "browser_display" | "browser_camera" | "dev_video";
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
  adaptive_cooldown?: boolean;
  adaptive_cooldown_min?: number;
  adaptive_threshold?: boolean;        // auto-adjust precision based on region size (default: true)
  hysteresis_factor?: number;          // 0.0–1.0, hysteresis exit threshold multiplier (default 0.7)
  detection_log?: DetectionLogEntry[]; // last N confirmed matches
  ocr_backend?: "tesseract";  // OCR engine (only tesseract supported)
}

/** DetectorCapabilities reports which capture backends the server supports. */
export interface DetectorCapabilities {
  platform: string;
  display_server: string;
  supports_window_capture: boolean;
  supports_screen_capture: boolean;
  supports_camera: boolean;
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
  trigger_decrement: string;
}

export interface NameElement extends OverlayElementBase {
  style: TextStyle;
  idle_animation: string; // "none" | "shimmer"
  trigger_enter: string; // "none" | "slide-in" | "fade-in"
  trigger_decrement: string;
}

export interface TitleElement extends OverlayElementBase {
  style: TextStyle;
  idle_animation: string;
  trigger_enter: string;
  trigger_decrement: string;
}

export interface CounterElement extends OverlayElementBase {
  style: TextStyle;
  show_label: boolean;
  label_text: string;
  label_style: TextStyle;
  idle_animation: string; // "none"
  trigger_enter: string; // "none" | "pop" | "count-flash"
  trigger_decrement: string;
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
  background_animation_config?: Record<string, unknown>;
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
  title: TitleElement;
  counter: CounterElement;

  // Editor Tools
  snap_enabled?: boolean;
  snap_grid_size?: number;
}

/** TutorialFlags tracks which tutorials the user has already completed. */
export interface TutorialFlags {
  overlay_editor?: boolean;
  auto_detection?: boolean;
}

/** Settings holds all user-configurable application preferences. */
export interface Settings {
  output_enabled: boolean;
  output_dir: string;
  auto_save: boolean;
  languages: string[]; // active language codes for game names
  crisp_sprites?: boolean;
  ui_animations?: boolean;
  overlay: OverlaySettings;
  tutorial_seen?: TutorialFlags;
  config_path?: string; // Custom data directory override
}

/** AppState is the complete serialisable snapshot broadcast by the server. */
export interface AppState {
  pokemon: Pokemon[];
  sessions: Session[];
  active_id: string;
  hotkeys: HotkeyMap;
  settings: Settings;
  data_path: string;
  license_accepted: boolean;
}

/** EncounterEvent records one encounter count change in the database. */
export interface EncounterEvent {
  id: number;
  pokemon_id: string;
  pokemon_name: string;
  timestamp: string;
  delta: number;
  count_after: number;
  source: string;
}

/** EncounterStats holds aggregated encounter statistics for one Pokemon. */
export interface EncounterStats {
  total: number;
  today: number;
  rate_per_hour: number;
  first_at?: string;
  last_at?: string;
}

/** ChartPoint is one data point for the encounter chart. */
export interface ChartPoint {
  label: string;
  count: number;
}

/** OverviewStats holds global statistics across all Pokemon. */
export interface OverviewStats {
  total_encounters: number;
  total_pokemon: number;
  today: number;
}

/** WSMessage is the envelope for all WebSocket messages in both directions. */
export interface WSMessage {
  type: string;
  payload: unknown;
}
