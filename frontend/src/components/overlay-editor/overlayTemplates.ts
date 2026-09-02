/**
 * overlayTemplates.ts: the ready-made overlay layouts the editor can apply
 * with one click, including the default one.
 *
 * Every template is a complete OverlaySettings value: applying one replaces
 * the working settings wholesale, exactly like the reset button does. The
 * templates therefore have to be self-contained and internally consistent.
 *
 * Nothing here is a constant, because the captions are translated. A German
 * user must get "ZEIT", not "TIME", baked into the overlay they start from, so
 * both the default layout and every template are built from the translator the
 * caller passes in.
 *
 * Geometry contract, enforced by overlayTemplates.test.ts:
 *  - all nine elements are present,
 *  - every element box lies inside its own canvas,
 *  - no two visible elements overlap,
 *  - no element carries a prefix or a suffix,
 *  - every font is an engine alias or a curated Google family, never a family
 *    that happens to be installed on the author's machine.
 *
 * The layouts here go one step further than the contract: hidden elements are
 * parked in free slots as well, so switching one on never moves another
 * element. All arithmetic is stated per template in the comment above it.
 */
import type {
  LabeledTextElement,
  NameElement,
  OverlaySettings,
  SpriteElement,
  TextStyle,
} from "../../types";

/**
 * Translate is the slice of the i18n context the templates need. Declared here
 * rather than imported so the module stays free of React and can be built and
 * tested on its own.
 */
export type Translate = (key: string, options?: Record<string, string | number>) => string;

/**
 * LABEL_KEYS are the i18n keys of every caption a template can put in a label
 * channel. Listed in one place so the test can assert that all five locales
 * translate all of them.
 */
export const LABEL_KEYS = {
  encounters: "overlay.labelEncounters",
  time: "overlay.labelTime",
  odds: "overlay.labelOdds",
  phase: "overlay.labelPhase",
  total: "overlay.labelTotal",
  totalEncounters: "overlay.labelTotalEncounters",
  totalTime: "overlay.labelTotalTime",
  phaseEncounters: "overlay.labelPhaseEncounters",
  phaseTime: "overlay.labelPhaseTime",
} as const;

/** Neutral text style every template style derives from. */
export const BASE_TEXT_STYLE: TextStyle = {
  font_family: "sans",
  font_size: 16,
  font_weight: 400,
  text_align: "left",
  color_type: "solid",
  color: "#ffffff",
  gradient_stops: [
    { color: "#ffffff", position: 0 },
    { color: "#aaaaaa", position: 100 },
  ],
  gradient_angle: 180,
  outline_type: "none",
  outline_width: 2,
  outline_color: "#000000",
  outline_gradient_stops: [
    { color: "#ffffff", position: 0 },
    { color: "#000000", position: 100 },
  ],
  outline_gradient_angle: 180,
  text_shadow: false,
  text_shadow_color: "#000000",
  text_shadow_blur: 4,
  text_shadow_x: 1,
  text_shadow_y: 1,
};

/**
 * Tempest palette values baked into the overlay templates, with the design
 * token each one came from. They are stored as plain hex on purpose: the
 * color picker only round-trips 6-digit hex, and the OBS browser source
 * carries its own theme and accent preset, so a `var(--token)` reference
 * would not survive an edit and would flip with the browser source's stored
 * theme.
 */
export const OVERLAY_BG = "#0d1117"; // --bg-primary
export const OVERLAY_BORDER = "#2a3644"; // --border-subtle
export const OVERLAY_TEXT_PRIMARY = "#eef3f8"; // --text-primary
export const OVERLAY_TEXT_SECONDARY = "#b7c5d3"; // --text-secondary
export const OVERLAY_TEXT_MUTED = "#8fa3b5"; // --text-muted
export const OVERLAY_ACCENT = "#a685f0"; // --accent-blue, violet preset (the default accent)

/** Second stop of the two gradients in this file, chosen to read against the accent. */
const OVERLAY_ACCENT_COOL = "#5ad1e6";

/** Value typography shared by every text layer of the default layout. */
const DEFAULT_VALUE_STYLE: TextStyle = {
  ...BASE_TEXT_STYLE,
  font_family: "sans",
  font_weight: 700,
  color: OVERLAY_TEXT_PRIMARY,
  outline_type: "none",
  outline_width: 2,
  // Panel-colored instead of black: a user who switches the stroke on gets a
  // halo against the plate rather than a cartoon key line.
  outline_color: OVERLAY_BG,
  // Minimal shadow floor. Invisible on the plate, but it keeps the text legible
  // for users who drop background_opacity to 0 or hide the canvas entirely.
  text_shadow: true,
  text_shadow_color: "#000000",
  text_shadow_x: 0,
  text_shadow_y: 1,
  text_shadow_blur: 3,
};

/** Caption typography of the label channel, the single caption rule of the layout. */
const DEFAULT_LABEL_STYLE: TextStyle = {
  ...BASE_TEXT_STYLE,
  font_family: "sans",
  font_size: 11,
  font_weight: 600,
  color: OVERLAY_TEXT_MUTED,
};

/** Value typography of the five stat-strip slots along the bottom margin. */
const STRIP_VALUE_STYLE: TextStyle = { ...DEFAULT_VALUE_STYLE, font_size: 20 };

// --- Element factories -------------------------------------------------------

/** Box is the absolute geometry and stacking order every element needs. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
  visible: boolean;
}

/**
 * makeSprite builds a sprite layer. Motion on the counting hotkeys is feedback
 * that the key fired, not decoration, so the triggers default to on.
 */
function makeSprite(box: Box, extra: Partial<SpriteElement> = {}): SpriteElement {
  return {
    ...box,
    show_glow: false,
    glow_color: OVERLAY_TEXT_PRIMARY,
    glow_opacity: 0.1,
    glow_blur: 24,
    idle_animation: "none",
    trigger_enter: "bounce",
    trigger_decrement: "shake",
    cycle_phase_targets: false,
    cycle_interval_ms: 3000,
    cycle_transition: "fade",
    ...extra,
  };
}

/** makeText builds a label-less text layer (name, title). */
function makeText(box: Box, style: TextStyle, extra: Partial<NameElement> = {}): NameElement {
  return {
    ...box,
    style,
    idle_animation: "none",
    trigger_enter: "none",
    trigger_decrement: "none",
    ...extra,
  };
}

/**
 * makeLabeled builds a value layer with its own caption channel. The result is
 * assignable to counter, timer, odds and the three phasing elements, which all
 * share this shape (odds adds its format on top).
 */
function makeLabeled(
  box: Box,
  style: TextStyle,
  labelText: string,
  labelStyle: TextStyle,
  showLabel = true,
  extra: Partial<LabeledTextElement> = {},
): LabeledTextElement {
  return {
    ...box,
    style,
    show_label: showLabel,
    label_text: labelText,
    label_style: labelStyle,
    // The caption lives in the label channel, not in the prefix: a prefix
    // renders inline in the value's own style, so at counter sizes it would
    // overflow the card. No template ships either affix, the capability is
    // there for the user, not for the defaults.
    prefix_text: "",
    suffix_text: "",
    idle_animation: "none",
    trigger_enter: "none",
    trigger_decrement: "none",
    ...extra,
  };
}

// --- Default: 800x264 dashboard panel ---------------------------------------

/**
 * buildDefaultOverlaySettings returns the default overlay layout: an 800x264
 * panel on a 24px margin, composed as three bands (sprite plus identity header,
 * hero counter, stat strip). The strip is five 144px slots with 8px gutters, so
 * the two stats that ship visible bracket it against both page margins and the
 * three phasing stats grow into the gap without moving a single coordinate.
 *
 * Geometry: sprite 24..176 x 24..176, identity column 200..776, counter band
 * 92..180, strip 196..240. Right edge 776 + 24 margin = 800, bottom edge
 * 240 + 24 margin = 264.
 *
 * Kept in sync with `defaultOverlaySettings` in
 * backend/internal/state/state.go, which seeds the same layout on first run.
 * The captions there come from a small language table instead of this
 * translator, because the backend has none.
 */
export function buildDefaultOverlaySettings(t: Translate): OverlaySettings {
  return {
    canvas_width: 800,
    canvas_height: 264,
    hidden: false,
    background_color: OVERLAY_BG,
    // 0.9 rather than the old 0.6: every text color needs to clear 4.5:1 even
    // over a fully white game capture.
    background_opacity: 0.9,
    background_animation: "none",
    blur: 0,
    show_border: true,
    border_color: OVERLAY_BORDER,
    border_width: 1,
    border_radius: 0,
    sprite: makeSprite(
      { x: 24, y: 24, width: 152, height: 152, z_index: 1, visible: true },
      {
        show_glow: true,
        // A backlight that lifts a dark sprite off the panel, not a soft bloom.
        glow_opacity: 0.1,
        glow_blur: 24,
      },
    ),
    name: makeText(
      { x: 200, y: 24, width: 576, height: 34, z_index: 2, visible: true },
      { ...DEFAULT_VALUE_STYLE, font_size: 26 },
    ),
    // The renderer only paints the title when the hunt has one, so shipping it
    // visible costs an untitled hunt nothing and saves a trip to the layer list.
    title: makeText(
      { x: 200, y: 62, width: 576, height: 22, z_index: 4, visible: true },
      {
        ...DEFAULT_VALUE_STYLE,
        font_size: 13,
        font_weight: 600,
        color: OVERLAY_TEXT_SECONDARY, // --text-secondary
      },
    ),
    counter: makeLabeled(
      { x: 200, y: 92, width: 576, height: 88, z_index: 3, visible: true },
      { ...DEFAULT_VALUE_STYLE, font_size: 64 },
      t(LABEL_KEYS.encounters),
      DEFAULT_LABEL_STYLE,
      true,
      { trigger_enter: "slot", trigger_decrement: "slot" },
    ),
    timer: makeLabeled(
      { x: 24, y: 196, width: 144, height: 44, z_index: 5, visible: true },
      STRIP_VALUE_STYLE,
      t(LABEL_KEYS.time),
      DEFAULT_LABEL_STYLE,
    ),
    odds: {
      ...makeLabeled(
        { x: 632, y: 196, width: 144, height: 44, z_index: 6, visible: true },
        {
          ...STRIP_VALUE_STYLE,
          // The single accent of the layout, and the only right-aligned element,
          // so value and label both hug the right margin.
          color: OVERLAY_ACCENT,
          text_align: "right",
        },
        t(LABEL_KEYS.odds),
        DEFAULT_LABEL_STYLE,
      ),
      format: "fractional",
    },
    // Hidden until the user actually phases, but each one holds a real slot in
    // the strip, so switching it on moves no other coordinate.
    phase: makeLabeled(
      { x: 176, y: 196, width: 144, height: 44, z_index: 7, visible: false },
      STRIP_VALUE_STYLE,
      t(LABEL_KEYS.phase),
      DEFAULT_LABEL_STYLE,
    ),
    // Outside a phased hunt this is the hero counter a second time in small type.
    total_counter: makeLabeled(
      { x: 328, y: 196, width: 144, height: 44, z_index: 8, visible: false },
      STRIP_VALUE_STYLE,
      t(LABEL_KEYS.totalEncounters),
      DEFAULT_LABEL_STYLE,
    ),
    // Without phases this equals the plain timer above.
    total_timer: makeLabeled(
      { x: 480, y: 196, width: 144, height: 44, z_index: 9, visible: false },
      STRIP_VALUE_STYLE,
      t(LABEL_KEYS.totalTime),
      DEFAULT_LABEL_STYLE,
    ),
  };
}

// --- Minimal: 480x96 counter strip -------------------------------------------

/** Value typography of the minimal strip: one weight, two sizes, no captions. */
const MINIMAL_STAT_STYLE: TextStyle = { ...DEFAULT_VALUE_STYLE, font_size: 15 };

/**
 * buildMinimalTemplate returns the smallest layout on offer: a sprite, a
 * counter, nothing else. Meant for a streamer who wants the number on screen
 * and the rest of the canvas back.
 *
 * Geometry: 480x96 on a 12px margin. Sprite 12..84 x 12..84, counter
 * 96..252 x 12..84, and a parking column at 264..468 split into three rows
 * (12..34, 37..59, 62..84) that holds every hidden layer without collisions.
 * Right edge 468 + 12 = 480, bottom edge 84 + 12 = 96.
 */
function buildMinimalTemplate(t: Translate): OverlaySettings {
  return {
    canvas_width: 480,
    canvas_height: 96,
    hidden: false,
    background_color: OVERLAY_BG,
    background_opacity: 0.9,
    background_animation: "none",
    blur: 0,
    show_border: true,
    border_color: OVERLAY_BORDER,
    border_width: 1,
    border_radius: 0,
    sprite: makeSprite({ x: 12, y: 12, width: 72, height: 72, z_index: 1, visible: true }),
    // The counter carries the whole layout, so it gets the full band height and
    // no caption: at this size the word "ENCOUNTERS" would be the loudest thing
    // on screen.
    counter: makeLabeled(
      { x: 96, y: 12, width: 156, height: 72, z_index: 3, visible: true },
      { ...DEFAULT_VALUE_STYLE, font_size: 44 },
      t(LABEL_KEYS.encounters),
      DEFAULT_LABEL_STYLE,
      false,
      { trigger_enter: "pop", trigger_decrement: "pop" },
    ),
    name: makeText(
      { x: 264, y: 12, width: 120, height: 22, z_index: 2, visible: false },
      { ...DEFAULT_VALUE_STYLE, font_size: 14 },
    ),
    title: makeText(
      { x: 388, y: 12, width: 80, height: 22, z_index: 4, visible: false },
      { ...DEFAULT_VALUE_STYLE, font_size: 12, color: OVERLAY_TEXT_SECONDARY },
    ),
    timer: makeLabeled(
      { x: 264, y: 37, width: 100, height: 22, z_index: 5, visible: false },
      MINIMAL_STAT_STYLE,
      t(LABEL_KEYS.time),
      DEFAULT_LABEL_STYLE,
      false,
    ),
    odds: {
      ...makeLabeled(
        { x: 368, y: 37, width: 100, height: 22, z_index: 6, visible: false },
        { ...MINIMAL_STAT_STYLE, color: OVERLAY_ACCENT, text_align: "right" },
        t(LABEL_KEYS.odds),
        DEFAULT_LABEL_STYLE,
        false,
      ),
      format: "fractional",
    },
    phase: makeLabeled(
      { x: 264, y: 62, width: 64, height: 22, z_index: 7, visible: false },
      MINIMAL_STAT_STYLE,
      t(LABEL_KEYS.phase),
      DEFAULT_LABEL_STYLE,
      false,
    ),
    total_counter: makeLabeled(
      { x: 332, y: 62, width: 68, height: 22, z_index: 8, visible: false },
      MINIMAL_STAT_STYLE,
      t(LABEL_KEYS.total),
      DEFAULT_LABEL_STYLE,
      false,
    ),
    total_timer: makeLabeled(
      { x: 404, y: 62, width: 64, height: 22, z_index: 9, visible: false },
      MINIMAL_STAT_STYLE,
      t(LABEL_KEYS.totalTime),
      DEFAULT_LABEL_STYLE,
      false,
    ),
  };
}

// --- Retro: 720x288 pixel card ----------------------------------------------

/**
 * Pixel typography. "pokemon" is an engine alias the overlay resolves to the
 * bundled Press Start 2P, which has a single weight, so the hierarchy is
 * carried by size and by the chunky key line instead. Press Start 2P advances
 * roughly one em per glyph, which is what sizes the slots below.
 */
const RETRO_VALUE_STYLE: TextStyle = {
  ...BASE_TEXT_STYLE,
  font_family: "pokemon",
  font_weight: 400,
  color: OVERLAY_TEXT_PRIMARY,
  outline_type: "solid",
  outline_width: 3,
  outline_color: "#000000",
  // The outline already separates the glyphs from anything behind them, so a
  // shadow on top would only smear the pixel edges.
  text_shadow: false,
};

/** Caption typography of the retro card: same face, half the stroke, 8px pixel grid. */
const RETRO_LABEL_STYLE: TextStyle = {
  ...RETRO_VALUE_STYLE,
  font_size: 8,
  color: OVERLAY_TEXT_SECONDARY,
  outline_width: 1,
};

/** Value typography of the five-slot stat band along the bottom margin. */
const RETRO_STAT_STYLE: TextStyle = { ...RETRO_VALUE_STYLE, font_size: 14 };

/**
 * buildRetroTemplate returns the loud one: pixel face, 4px frame, hard key
 * lines, and the counter stroked with a gradient outline instead of a flat
 * one. Applying it is the fastest way to see what a gradient outline does.
 *
 * Geometry: 720x288 on a 24px margin. Sprite 24..152 x 24..152, identity
 * column 168..696 (name 24..56, title 64..88), counter band 96..184, and a
 * five-slot stat band at 200..264 with 128px slots and 8px gutters
 * (5 * 128 + 4 * 8 = 672 = 696 - 24). Right edge 696 + 24 = 720, bottom edge
 * 264 + 24 = 288. At 8px the widest caption of any locale stays under the
 * 128px slot, so no label spills into its neighbor.
 */
function buildRetroTemplate(t: Translate): OverlaySettings {
  return {
    canvas_width: 720,
    canvas_height: 288,
    hidden: false,
    background_color: OVERLAY_BG,
    // Fully opaque: the pixel face lives on flat color, not on a capture
    // shining through it.
    background_opacity: 1,
    background_animation: "none",
    blur: 0,
    show_border: true,
    // The one place a template leaves the hairline rule: the frame is part of
    // the retro look, so it is a 4px key line in the text color.
    border_color: OVERLAY_TEXT_PRIMARY,
    border_width: 4,
    border_radius: 0,
    sprite: makeSprite({ x: 24, y: 24, width: 128, height: 128, z_index: 1, visible: true }),
    name: makeText(
      { x: 168, y: 24, width: 528, height: 32, z_index: 2, visible: true },
      { ...RETRO_VALUE_STYLE, font_size: 18 },
    ),
    // Hidden by default: a second line of pixel type under the name turns the
    // header into noise, and most retro users run the card without a title.
    title: makeText(
      { x: 168, y: 64, width: 528, height: 24, z_index: 4, visible: false },
      { ...RETRO_VALUE_STYLE, font_size: 12, color: OVERLAY_TEXT_SECONDARY },
    ),
    counter: makeLabeled(
      { x: 168, y: 96, width: 528, height: 88, z_index: 3, visible: true },
      {
        ...RETRO_VALUE_STYLE,
        font_size: 48,
        // The showpiece: a stroke that runs violet to cyan across the digits.
        // A gradient stroke paints through the widened glyph silhouette, so it
        // needs the fill to stay solid to read as an outline at all.
        outline_type: "gradient",
        outline_width: 4,
        outline_gradient_stops: [
          { color: OVERLAY_ACCENT, position: 0 },
          { color: OVERLAY_ACCENT_COOL, position: 100 },
        ],
        outline_gradient_angle: 90,
      },
      t(LABEL_KEYS.encounters),
      RETRO_LABEL_STYLE,
      true,
      { trigger_enter: "flip-digit", trigger_decrement: "flip-digit" },
    ),
    timer: makeLabeled(
      { x: 24, y: 200, width: 128, height: 64, z_index: 5, visible: true },
      RETRO_STAT_STYLE,
      t(LABEL_KEYS.time),
      RETRO_LABEL_STYLE,
    ),
    phase: makeLabeled(
      { x: 160, y: 200, width: 128, height: 64, z_index: 7, visible: false },
      RETRO_STAT_STYLE,
      t(LABEL_KEYS.phase),
      RETRO_LABEL_STYLE,
    ),
    // The short caption on purpose: the pixel face is one em per glyph, so the
    // full "total encounters" of some locales would run past the slot.
    total_counter: makeLabeled(
      { x: 296, y: 200, width: 128, height: 64, z_index: 8, visible: false },
      RETRO_STAT_STYLE,
      t(LABEL_KEYS.total),
      RETRO_LABEL_STYLE,
    ),
    total_timer: makeLabeled(
      { x: 432, y: 200, width: 128, height: 64, z_index: 9, visible: false },
      RETRO_STAT_STYLE,
      t(LABEL_KEYS.totalTime),
      RETRO_LABEL_STYLE,
    ),
    odds: {
      ...makeLabeled(
        { x: 568, y: 200, width: 128, height: 64, z_index: 6, visible: true },
        { ...RETRO_STAT_STYLE, color: OVERLAY_ACCENT, text_align: "right" },
        t(LABEL_KEYS.odds),
        RETRO_LABEL_STYLE,
      ),
      format: "fractional",
    },
  };
}

// --- Sidebar: 320x744 vertical rail -----------------------------------------

/** Value typography of the sidebar: the whole rail is centered on one axis. */
const SIDEBAR_VALUE_STYLE: TextStyle = { ...DEFAULT_VALUE_STYLE, text_align: "center" };

/** Caption typography of the sidebar, centered like everything else. */
const SIDEBAR_LABEL_STYLE: TextStyle = { ...DEFAULT_LABEL_STYLE, text_align: "center" };

/** Value typography of the five stacked stat rows. */
const SIDEBAR_STAT_STYLE: TextStyle = { ...SIDEBAR_VALUE_STYLE, font_size: 22 };

/**
 * buildSidebarTemplate returns a tall rail for the side of a scene rather than
 * a bar under it. Everything is centered on a single column, and the five stats
 * stack instead of sharing a strip, so a phasing hunt grows downwards. The
 * counter is painted with a gradient fill on a free angle, the second of the
 * two new paint capabilities.
 *
 * Geometry: 320x744 on a 20px margin, content column 20..300 (280 wide),
 * sprite centered at 84..236 ((320 - 152) / 2 = 84). Bands: sprite 20..172,
 * name 188..218, title 222..242, counter 258..354, then five 56px rows on a
 * 72px pitch at 380, 452, 524, 596 and 668, the last ending at 724 = 744 - 20.
 */
function buildSidebarTemplate(t: Translate): OverlaySettings {
  return {
    canvas_width: 320,
    canvas_height: 744,
    hidden: false,
    background_color: OVERLAY_BG,
    background_opacity: 0.9,
    background_animation: "none",
    blur: 0,
    show_border: true,
    border_color: OVERLAY_BORDER,
    border_width: 1,
    border_radius: 0,
    sprite: makeSprite(
      { x: 84, y: 20, width: 152, height: 152, z_index: 1, visible: true },
      { show_glow: true, glow_opacity: 0.1, glow_blur: 24 },
    ),
    name: makeText(
      { x: 20, y: 188, width: 280, height: 30, z_index: 2, visible: true },
      { ...SIDEBAR_VALUE_STYLE, font_size: 24 },
    ),
    title: makeText(
      { x: 20, y: 222, width: 280, height: 20, z_index: 4, visible: true },
      { ...SIDEBAR_VALUE_STYLE, font_size: 13, font_weight: 600, color: OVERLAY_TEXT_SECONDARY },
    ),
    counter: makeLabeled(
      { x: 20, y: 258, width: 280, height: 96, z_index: 3, visible: true },
      {
        ...SIDEBAR_VALUE_STYLE,
        font_size: 60,
        color_type: "gradient",
        gradient_stops: [
          { color: OVERLAY_TEXT_PRIMARY, position: 0 },
          { color: OVERLAY_ACCENT, position: 100 },
        ],
        // Not one of the four cardinal presets: the angle dial takes any value,
        // and a diagonal is what makes the gradient read as one at all.
        gradient_angle: 135,
        // A gradient fill clips a background to the glyphs, and a text shadow
        // paints on top of a background, so the two cannot be combined.
        text_shadow: false,
      },
      t(LABEL_KEYS.encounters),
      SIDEBAR_LABEL_STYLE,
      true,
      { trigger_enter: "slot", trigger_decrement: "slot" },
    ),
    timer: makeLabeled(
      { x: 20, y: 380, width: 280, height: 56, z_index: 5, visible: true },
      SIDEBAR_STAT_STYLE,
      t(LABEL_KEYS.time),
      SIDEBAR_LABEL_STYLE,
    ),
    odds: {
      ...makeLabeled(
        { x: 20, y: 452, width: 280, height: 56, z_index: 6, visible: true },
        { ...SIDEBAR_STAT_STYLE, color: OVERLAY_ACCENT },
        t(LABEL_KEYS.odds),
        SIDEBAR_LABEL_STYLE,
      ),
      format: "fractional",
    },
    phase: makeLabeled(
      { x: 20, y: 524, width: 280, height: 56, z_index: 7, visible: false },
      SIDEBAR_STAT_STYLE,
      t(LABEL_KEYS.phase),
      SIDEBAR_LABEL_STYLE,
    ),
    total_counter: makeLabeled(
      { x: 20, y: 596, width: 280, height: 56, z_index: 8, visible: false },
      SIDEBAR_STAT_STYLE,
      t(LABEL_KEYS.totalEncounters),
      SIDEBAR_LABEL_STYLE,
    ),
    total_timer: makeLabeled(
      { x: 20, y: 668, width: 280, height: 56, z_index: 9, visible: false },
      SIDEBAR_STAT_STYLE,
      t(LABEL_KEYS.totalTime),
      SIDEBAR_LABEL_STYLE,
    ),
  };
}

// --- Phase hunt: 720x304 panel ----------------------------------------------

/** Value typography of the phase panel's four-slot totals band. */
const PHASE_STAT_STYLE: TextStyle = { ...DEFAULT_VALUE_STYLE, font_size: 20 };

/**
 * buildPhaseTemplate returns the layout for a phase hunt: phase number, total
 * encounters and total time are first-class and visible from the start, the
 * counter and the timer are relabeled as the phase's own, and the sprite
 * cycles through the hunt's phase targets instead of showing one static
 * species. It is the only template where nothing ships hidden.
 *
 * Geometry: 720x304 on a 24px margin. Sprite 24..184 x 24..184, phase counter
 * 200..440 x 24..88, identity column 456..696 (name 24..56, title 58..80),
 * hero counter 200..696 x 104..192, and a four-slot totals band at 216..280
 * with 162px slots and 8px gutters (4 * 162 + 3 * 8 = 672 = 696 - 24). Right
 * edge 696 + 24 = 720, bottom edge 280 + 24 = 304.
 */
function buildPhaseTemplate(t: Translate): OverlaySettings {
  return {
    canvas_width: 720,
    canvas_height: 304,
    hidden: false,
    background_color: OVERLAY_BG,
    background_opacity: 0.9,
    background_animation: "none",
    blur: 0,
    show_border: true,
    border_color: OVERLAY_BORDER,
    border_width: 1,
    border_radius: 0,
    sprite: makeSprite(
      { x: 24, y: 24, width: 160, height: 160, z_index: 1, visible: true },
      {
        show_glow: true,
        glow_opacity: 0.1,
        glow_blur: 24,
        // The point of the layout: the sprite rotates through the species that
        // would end the phase.
        cycle_phase_targets: true,
        cycle_interval_ms: 3000,
      },
    ),
    phase: makeLabeled(
      { x: 200, y: 24, width: 240, height: 64, z_index: 7, visible: true },
      { ...DEFAULT_VALUE_STYLE, font_size: 40, color: OVERLAY_ACCENT },
      t(LABEL_KEYS.phase),
      DEFAULT_LABEL_STYLE,
      true,
      { trigger_enter: "pop", trigger_decrement: "pop" },
    ),
    name: makeText(
      { x: 456, y: 24, width: 240, height: 32, z_index: 2, visible: true },
      { ...DEFAULT_VALUE_STYLE, font_size: 22, text_align: "right" },
    ),
    title: makeText(
      { x: 456, y: 58, width: 240, height: 22, z_index: 4, visible: true },
      {
        ...DEFAULT_VALUE_STYLE,
        font_size: 13,
        font_weight: 600,
        text_align: "right",
        color: OVERLAY_TEXT_SECONDARY,
      },
    ),
    counter: makeLabeled(
      { x: 200, y: 104, width: 496, height: 88, z_index: 3, visible: true },
      { ...DEFAULT_VALUE_STYLE, font_size: 60 },
      t(LABEL_KEYS.phaseEncounters),
      DEFAULT_LABEL_STYLE,
      true,
      { trigger_enter: "slot", trigger_decrement: "slot" },
    ),
    total_counter: makeLabeled(
      { x: 24, y: 216, width: 162, height: 64, z_index: 8, visible: true },
      PHASE_STAT_STYLE,
      t(LABEL_KEYS.totalEncounters),
      DEFAULT_LABEL_STYLE,
    ),
    total_timer: makeLabeled(
      { x: 194, y: 216, width: 162, height: 64, z_index: 9, visible: true },
      PHASE_STAT_STYLE,
      t(LABEL_KEYS.totalTime),
      DEFAULT_LABEL_STYLE,
    ),
    timer: makeLabeled(
      { x: 364, y: 216, width: 162, height: 64, z_index: 5, visible: true },
      PHASE_STAT_STYLE,
      t(LABEL_KEYS.phaseTime),
      DEFAULT_LABEL_STYLE,
    ),
    odds: {
      ...makeLabeled(
        { x: 534, y: 216, width: 162, height: 64, z_index: 6, visible: true },
        { ...PHASE_STAT_STYLE, color: OVERLAY_ACCENT, text_align: "right" },
        t(LABEL_KEYS.odds),
        DEFAULT_LABEL_STYLE,
      ),
      format: "fractional",
    },
  };
}

// --- Template list -----------------------------------------------------------

/** One ready-made layout the editor can apply in a single step. */
export interface OverlayTemplate {
  /** Stable identifier, used as React key and in tests. */
  readonly id: string;
  /** i18n key of the display name. */
  readonly nameKey: string;
  /** i18n key of the one-line description shown in the picker. */
  readonly descriptionKey: string;
  /** The complete settings this template applies, captions already translated. */
  readonly settings: OverlaySettings;
}

/**
 * buildTemplates returns every layout offered by the picker, the default
 * first. Applying one replaces the working settings, so the editor's
 * unsaved-changes guard covers it exactly like the reset button.
 *
 * It takes the translator because the captions inside the layouts are stored
 * text, not rendered text: they are written into the overlay once and then
 * belong to the user, so they have to be in the user's language at the moment
 * the template is applied.
 */
export function buildTemplates(t: Translate): readonly OverlayTemplate[] {
  return [
    {
      id: "default",
      nameKey: "overlay.templateDefaultName",
      descriptionKey: "overlay.templateDefaultDesc",
      settings: buildDefaultOverlaySettings(t),
    },
    {
      id: "minimal",
      nameKey: "overlay.templateMinimalName",
      descriptionKey: "overlay.templateMinimalDesc",
      settings: buildMinimalTemplate(t),
    },
    {
      id: "retro",
      nameKey: "overlay.templateRetroName",
      descriptionKey: "overlay.templateRetroDesc",
      settings: buildRetroTemplate(t),
    },
    {
      id: "sidebar",
      nameKey: "overlay.templateSidebarName",
      descriptionKey: "overlay.templateSidebarDesc",
      settings: buildSidebarTemplate(t),
    },
    {
      id: "phase",
      nameKey: "overlay.templatePhaseName",
      descriptionKey: "overlay.templatePhaseDesc",
      settings: buildPhaseTemplate(t),
    },
  ];
}
