/**
 * test-utils.tsx — Re-exports @testing-library/react render wrapped with
 * all application providers and provides shared mock fixtures.
 */
import { ReactElement } from "react";
import { render, RenderOptions } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { ThemeProvider } from "./contexts/ThemeContext";
import { I18nProvider } from "./contexts/I18nContext";
import { ToastProvider } from "./contexts/ToastContext";
import type { AppState, Pokemon, OverlaySettings } from "./types";

/** Wraps children with all application providers for component testing. */
function AllProviders({ children }: { children: React.ReactNode }) {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <I18nProvider>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

/** Custom render that wraps components with all providers. */
function customRender(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, { wrapper: AllProviders, ...options });
}

/** Minimal default OverlaySettings fixture. */
export function makeOverlaySettings(
  overrides?: Partial<OverlaySettings>,
): OverlaySettings {
  return {
    canvas_width: 400,
    canvas_height: 200,
    background_color: "#000000",
    background_opacity: 1,
    blur: 0,
    show_border: false,
    border_color: "#ffffff",
    border_radius: 0,
    sprite: {
      visible: true,
      x: 10,
      y: 10,
      width: 80,
      height: 80,
      z_index: 1,
      show_glow: false,
      glow_color: "#ffffff",
      glow_opacity: 0.5,
      glow_blur: 10,
      idle_animation: "none",
      trigger_enter: "none",
      trigger_exit: "none",
    },
    name: {
      visible: true,
      x: 100,
      y: 10,
      width: 200,
      height: 30,
      z_index: 2,
      style: makeTextStyle(),
      idle_animation: "none",
      trigger_enter: "none",
    },
    counter: {
      visible: true,
      x: 100,
      y: 50,
      width: 200,
      height: 30,
      z_index: 3,
      style: makeTextStyle(),
      show_label: true,
      label_text: "Encounters:",
      label_style: makeTextStyle(),
      idle_animation: "none",
      trigger_enter: "none",
    },
    ...overrides,
  };
}

function makeTextStyle() {
  return {
    font_family: "sans",
    font_size: 16,
    font_weight: 400,
    text_align: "left" as const,
    color_type: "solid" as const,
    color: "#ffffff",
    gradient_stops: [],
    gradient_angle: 0,
    outline_type: "none" as const,
    outline_width: 0,
    outline_color: "#000000",
    text_shadow: false,
    text_shadow_color: "#000000",
    text_shadow_blur: 0,
    text_shadow_x: 0,
    text_shadow_y: 0,
  };
}

/** Minimal Pokemon fixture. */
export function makePokemon(overrides?: Partial<Pokemon>): Pokemon {
  return {
    id: "poke-1",
    name: "Bisasam",
    canonical_name: "bulbasaur",
    sprite_url: "",
    sprite_type: "normal",
    encounters: 42,
    is_active: true,
    created_at: "2024-01-01T00:00:00Z",
    language: "de",
    game: "red",
    overlay_mode: "default",
    ...overrides,
  };
}

/** Minimal AppState fixture. */
export function makeAppState(overrides?: Partial<AppState>): AppState {
  const pokemon = overrides?.pokemon ?? [
    makePokemon({ id: "poke-1", is_active: true }),
    makePokemon({
      id: "poke-2",
      name: "Glumanda",
      canonical_name: "charmander",
      encounters: 7,
      is_active: false,
      game: "blue",
    }),
  ];
  return {
    pokemon,
    sessions: [],
    active_id: pokemon.find((p) => p.is_active)?.id ?? "poke-1",
    hotkeys: { increment: "", decrement: "", reset: "", next_pokemon: "" },
    settings: {
      output_enabled: false,
      output_dir: "/tmp/encounty",
      auto_save: true,
      browser_port: 8080,
      languages: ["de", "en"],
      overlay: makeOverlaySettings(),
    },
    data_path: "/tmp/encounty",
    ...overrides,
  };
}

// Re-export testing library utilities for convenience
export * from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";
export { customRender as render };
