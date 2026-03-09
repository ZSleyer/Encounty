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
  overlay?: OverlaySettings; // Pokemon-specific overlay settings
}

/** GameEntry is one Pokémon game as returned by GET /api/games. */
export interface GameEntry {
  key: string;
  names: Record<string, string>; // lang code → localised name
  generation: number;
  platform: string;
}

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

export interface GradientStop {
  color: string;
  position: number; // 0-100
}

export interface TextStyle {
  font_family: string; // Google Font name or "sans"/"serif"/"monospace"/"pokemon"
  font_size: number;
  font_weight: number; // 100–900
  color_type: "solid" | "gradient";
  color: string;
  gradient_stops: GradientStop[];
  gradient_angle: number;
  outline_type: "none" | "solid";
  outline_width: number;
  outline_color: string;
  text_shadow: boolean;
  text_shadow_color: string;
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
