/**
 * test-utils.tsx, Re-exports @testing-library/react render wrapped with
 * all application providers and provides shared mock fixtures.
 */
import { ReactElement } from "react";
import { vi } from "vitest";
import { act, render, RenderOptions } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ThemeProvider } from "./contexts/ThemeContext";
import { I18nProvider } from "./contexts/I18nContext";
import { ToastProvider } from "./contexts/ToastContext";
import { CaptureServiceProvider } from "./contexts/CaptureServiceContext";
import type { AppState, LabeledTextElement, OverlaySettings, Pokemon } from "./types";

/** Wraps children with all application providers for component testing. */
function AllProviders({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <CaptureServiceProvider>
          <ToastProvider>{children}</ToastProvider>
        </CaptureServiceProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

/**
 * Custom render that wraps components with all providers + a data router.
 * Uses createMemoryRouter so useBlocker and other data-router hooks work.
 */
function customRender(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  const wrap = (node: ReactElement) => {
    const router = createMemoryRouter(
      [{ path: "*", element: <AllProviders>{node}</AllProviders> }],
      { initialEntries: ["/"] },
    );
    return <RouterProvider router={router} />;
  };
  const result = render(wrap(ui), options);
  // RTL's default rerender would replace the whole tree with the bare node,
  // dropping the providers; re-wrap so rerender keeps them (e.g. useToast).
  return { ...result, rerender: (next: ReactElement) => result.rerender(wrap(next)) };
}

/** Minimal default OverlaySettings fixture. */
export function makeOverlaySettings(overrides?: Partial<OverlaySettings>): OverlaySettings {
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
      trigger_decrement: "none",
      cycle_phase_targets: false,
      cycle_interval_ms: 3000,
      cycle_transition: "fade",
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
      trigger_decrement: "none",
    },
    title: {
      visible: true,
      x: 100,
      y: 50,
      width: 200,
      height: 30,
      z_index: 4,
      style: makeTextStyle(),
      idle_animation: "none",
      trigger_enter: "none",
      trigger_decrement: "none",
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
      prefix_text: "",
      suffix_text: "",
      idle_animation: "none",
      trigger_enter: "none",
      trigger_decrement: "none",
    },
    timer: {
      visible: false,
      x: 100,
      y: 90,
      width: 200,
      height: 30,
      z_index: 5,
      style: makeTextStyle(),
      show_label: false,
      label_text: "Timer",
      label_style: makeTextStyle(),
      prefix_text: "",
      suffix_text: "",
      idle_animation: "none",
    },
    odds: {
      visible: false,
      x: 100,
      y: 130,
      width: 200,
      height: 30,
      z_index: 6,
      style: makeTextStyle(),
      show_label: false,
      label_text: "Odds",
      label_style: makeTextStyle(),
      prefix_text: "",
      suffix_text: "",
      format: "fractional",
      idle_animation: "none",
      trigger_enter: "none",
      trigger_decrement: "none",
    },
    phase: makeLabeledTextElement({ y: 130, width: 80, z_index: 7, label_text: "Phase" }),
    total_counter: makeLabeledTextElement({
      y: 170,
      width: 80,
      z_index: 8,
      label_text: "Total Encounter",
    }),
    total_timer: makeLabeledTextElement({
      x: 200,
      y: 170,
      width: 180,
      z_index: 9,
      label_text: "Total Timer",
    }),
    ...overrides,
  };
}

/**
 * Builds a phasing text element fixture. Hidden by default, mirroring the
 * backend defaults, so existing overlay tests keep their DOM unchanged.
 */
function makeLabeledTextElement(overrides?: Partial<LabeledTextElement>): LabeledTextElement {
  return {
    visible: false,
    x: 10,
    y: 10,
    width: 120,
    height: 30,
    z_index: 7,
    style: makeTextStyle(),
    show_label: false,
    label_text: "",
    label_style: makeTextStyle(),
    prefix_text: "",
    suffix_text: "",
    idle_animation: "none",
    trigger_enter: "none",
    trigger_decrement: "none",
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
    outline_gradient_stops: [],
    outline_gradient_angle: 0,
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
    game: "pokemon-scarlet",
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
      game: "pokemon-violet",
    }),
  ];
  return {
    pokemon,
    sessions: [],
    active_id: pokemon.find((p) => p.is_active)?.id ?? "poke-1",
    active_group_id: "",
    hotkeys: { increment: "", decrement: "", reset: "", next_pokemon: "" },
    settings: {
      output_enabled: false,
      output_dir: "/tmp/encounty",
      auto_save: true,
      overlay: makeOverlaySettings(),
    },
    data_path: "/tmp/encounty",
    license_accepted: true,
    ...overrides,
  };
}

/**
 * Awaits the data a render kicks off, so assertions do not race it.
 *
 * `usePokedex` and `useCatchRefs` both load through `loadX().then(setState)`.
 * A `.then` is always a microtask, so the update lands after the synchronous
 * test body no matter how fast the mocked fetch answers, and React reports it
 * as happening outside `act(...)`. A macrotask tick drains the whole chain,
 * including the response and its `.json()`.
 *
 * Call it once after rendering anything that reaches those hooks. It is a no-op
 * for a tree that loads nothing.
 */
export async function settle(): Promise<void> {
  if (vi.isFakeTimers()) {
    // A real setTimeout never fires while the clock is faked, so drain the
    // queue the test itself controls rather than waiting on wall-clock time.
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    return;
  }
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

// Re-export testing library utilities for convenience
export * from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";
export { customRender as render };
