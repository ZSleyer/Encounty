/**
 * textStyle.ts holds the CSS builders that turn a stored `TextStyle` into the
 * inline styles of a text element. The live overlay renderer and the editor
 * modals both read from here, so a preview in the editor cannot drift away from
 * what the overlay actually paints.
 *
 * Every builder takes the narrowest slice of `TextStyle` it needs, which lets
 * the editor pass a partial draft while the renderer passes a full style.
 */

import type { CSSProperties } from "react";
import type { GradientStop, TextStyle } from "../types";

// --- Style slices ---

/** Fields that decide the paint of the glyph interior. */
export type FillStyleFields = Pick<
  TextStyle,
  "color_type" | "color" | "gradient_stops" | "gradient_angle"
>;

/** Fields that decide the paint and the width of the outline. */
export type OutlineStyleFields = Pick<
  TextStyle,
  | "outline_type"
  | "outline_width"
  | "outline_color"
  | "outline_gradient_stops"
  | "outline_gradient_angle"
>;

/** Fields shared by every layer of a text element. */
export type BaseStyleFields = Pick<
  TextStyle,
  | "font_family"
  | "font_size"
  | "font_weight"
  | "text_align"
  | "text_shadow"
  | "text_shadow_color"
  | "text_shadow_x"
  | "text_shadow_y"
  | "text_shadow_blur"
>;

// --- Font ---

/** Maps the stored family alias to a CSS font stack. */
export function resolveFont(family: string): string {
  if (family === "pokemon") return "'Press Start 2P', cursive";
  if (family === "sans") return "'Inter', sans-serif";
  if (family === "serif") return "serif";
  if (family === "monospace") return "monospace";
  return `'${family}', sans-serif`;
}

// --- Outline geometry ---

/** Outline modes that paint a stroke. Anything else renders no outline at all. */
const OUTLINE_MODES = new Set(["solid", "gradient"]);

/**
 * Builds a CSS linear-gradient from the given stops, or an empty string when
 * there are fewer than the two stops a gradient needs. Callers treat the empty
 * string as "no gradient" and fall back to their solid color.
 */
export function buildGradient(stops: GradientStop[] | undefined, angle: number): string {
  if (!stops || stops.length < 2) return "";
  const list = stops.map((s) => `${s.color} ${s.position}%`).join(", ");
  return `linear-gradient(${angle}deg, ${list})`;
}

/**
 * Effective stroke width in px. `-webkit-text-stroke` centers the stroke on the
 * glyph outline, so the configured width is doubled to keep the visible outer
 * half at the width the user asked for. Unknown or legacy outline types (and a
 * width of zero) paint nothing, which keeps old profiles rendering instead of
 * crashing.
 */
export function effectiveOutlineWidth(style: OutlineStyleFields): number {
  if (!OUTLINE_MODES.has(style.outline_type)) return 0;
  return Math.max(0, style.outline_width) * 2;
}

/**
 * Room the stroke needs outside the glyph box: half the effective width, since
 * the inner half is covered by the fill. Rounded up so half a pixel is never
 * clipped away.
 */
export function outlinePadding(style: OutlineStyleFields): number {
  return Math.ceil(effectiveOutlineWidth(style) / 2);
}

/**
 * Horizontal room a text element needs around its glyphs so neither the stroke
 * nor the shadow is cut off by the element box.
 */
export function textDecorationPadding(style: OutlineStyleFields & BaseStyleFields): number {
  const shadowPad = style.text_shadow ? Math.abs(style.text_shadow_x) + style.text_shadow_blur : 0;
  return Math.max(2, outlinePadding(style) + 1, shadowPad);
}

// --- Layer paints ---

/**
 * Font, alignment and shadow properties every layer of a text element shares.
 * The fill paint is deliberately left out: the stroke layer paints the outline
 * instead, and only the fill layer paints the interior.
 */
export function buildBaseTextStyle(style: BaseStyleFields): CSSProperties {
  return {
    fontFamily: resolveFont(style.font_family),
    fontSize: `${style.font_size}px`,
    fontWeight: style.font_weight,
    textAlign: (style.text_align || "left") as CSSProperties["textAlign"],
    textShadow: style.text_shadow
      ? `${style.text_shadow_x}px ${style.text_shadow_y}px ${style.text_shadow_blur}px ${style.text_shadow_color}`
      : undefined,
  };
}

/**
 * Paint of the glyph interior: a solid color, or a gradient clipped to the
 * glyph shape. A gradient with too few stops falls back to the solid color.
 */
export function buildFillPaint(style: FillStyleFields): CSSProperties {
  const gradient =
    style.color_type === "gradient"
      ? buildGradient(style.gradient_stops, style.gradient_angle)
      : "";
  if (!gradient) return { color: style.color };
  return {
    background: gradient,
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  };
}

/**
 * Paint of the outline layer. A solid outline strokes in its own color. A
 * gradient outline strokes in `transparent`: the stroke still widens the region
 * `background-clip: text` paints into, so the gradient fills the widened
 * silhouette and the fill layer on top leaves exactly the outline visible.
 */
export function buildOutlinePaint(style: OutlineStyleFields, width: number): CSSProperties {
  const gradient =
    style.outline_type === "gradient"
      ? buildGradient(style.outline_gradient_stops, style.outline_gradient_angle)
      : "";
  const paint: CSSProperties = {
    WebkitTextStroke: `${width}px ${gradient ? "transparent" : style.outline_color}`,
    WebkitTextFillColor: "transparent",
    paintOrder: "stroke fill",
  };
  if (gradient) {
    paint.background = gradient;
    paint.WebkitBackgroundClip = "text";
  }
  return paint;
}
