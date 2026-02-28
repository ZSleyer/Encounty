export interface Pokemon {
  id: string;
  name: string; // Display name (localized)
  canonical_name: string; // English PokéAPI slug
  sprite_url: string;
  sprite_type: "normal" | "shiny";
  encounters: number;
  is_active: boolean;
  created_at: string;
  language: Language; // "de" | "en"
  game: string; // key from games.json
}

export interface GameEntry {
  key: string;
  name_de: string;
  name_en: string;
  generation: number;
  platform: string;
}

export type Language = "de" | "en";

export interface Session {
  id: string;
  started_at: string;
  ended_at: string | null;
  pokemon_id: string;
  encounters: number;
}

export interface HotkeyMap {
  increment: string;
  decrement: string;
  reset: string;
  next_pokemon: string;
}

export interface OverlaySettings {
  layout: "horizontal" | "vertical" | "classic";
  sprite_position: "top" | "bottom" | "left" | "right" | "hidden";
  font_size: number;
  sprite_size: number;
  font_family: string;
  text_color: string;
  outline_color: string;
  outline_width: number;
  show_name: boolean;
  // show_phase removed
  show_encounter: boolean;
  show_border: boolean;
  gap: number;
  custom_font: string;
  gradient_enabled: boolean;
  gradient_color: string;
  background_color: string;
  opacity: number;
  blur: number;
  animation_increment: string;
  animation_decrement: string;
  animation_reset: string;
  show_sprite_glow: boolean;
  sprite_on_top: boolean;
  animation_target: "both" | "sprite" | "counter";
  inner_layout: "horizontal" | "vertical";
  outer_element: "sprite" | "name" | "counter" | "none";
  layer_order: string[];
  // Name styling
  name_size: number;
  name_color: string;
  name_outline_color: string;
  name_outline_width: number;
  name_gradient_enabled: boolean;
  name_gradient_color: string;
  name_font_family: string;
  name_custom_font: string;
}

export interface Settings {
  output_dir: string;
  auto_save: boolean;
  browser_port: number;
  overlay: OverlaySettings;
}

export interface AppState {
  pokemon: Pokemon[];
  sessions: Session[];
  active_id: string;
  hotkeys: HotkeyMap;
  settings: Settings;
}

export interface WSMessage {
  type: string;
  payload: unknown;
}
