/**
 * Compact text style editor of the overlay property panel plus the swatch
 * summaries it renders: font, size, weight, alignment and the three color rows
 * that open the shared modal editors.
 */
import { useId } from "react";
import { AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { TextStyle, GradientStop } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { NumSlider } from "./controls/NumSlider";
import { ColorSwatch } from "./controls/ColorSwatch";
import { FontFamilyPicker } from "./controls/FontFamilyPicker";
import type {
  OpenOutlineEditorParams,
  OpenShadowEditorParams,
  TranslateFn,
} from "./propertyPanelTypes";

/** Fallback stops for a style that carries no gradient of its own yet. */
const FALLBACK_GRADIENT_STOPS: GradientStop[] = [
  { color: "#ffffff", position: 0 },
  { color: "#000000", position: 100 },
];

/** Default gradient angle for a style that carries none yet. */
const FALLBACK_GRADIENT_ANGLE = 180;

/**
 * Named font weights, in the wording type tools use. The stored value stays the
 * CSS number, only the option text changes.
 */
const FONT_WEIGHTS: readonly { readonly value: number; readonly key: string }[] = [
  { value: 100, key: "overlay.weightThin" },
  { value: 300, key: "overlay.weightLight" },
  { value: 400, key: "overlay.weightRegular" },
  { value: 500, key: "overlay.weightMedium" },
  { value: 700, key: "overlay.weightBold" },
  { value: 900, key: "overlay.weightBlack" },
];

/** Swatch color and optional gradient preview of the outline row. */
function outlineSwatchPaint(style: TextStyle): {
  color: string;
  gradient?: { stops: GradientStop[]; angle: number };
} {
  if (style.outline_type === "solid") return { color: style.outline_color };
  if (style.outline_type === "gradient") {
    const stops = style.outline_gradient_stops?.length
      ? style.outline_gradient_stops
      : FALLBACK_GRADIENT_STOPS;
    return {
      color: stops[0].color,
      gradient: { stops, angle: style.outline_gradient_angle || FALLBACK_GRADIENT_ANGLE },
    };
  }
  return { color: "#00000000" };
}

/**
 * Summary the outline swatch row shows next to its preview: a readable label
 * plus the raw color value as muted secondary text.
 */
function outlineSwatchText(style: TextStyle, t: TranslateFn): { label: string; detail: string } {
  if (style.outline_type === "solid") {
    return {
      label: `${t("overlay.outline")} ${style.outline_width}px`,
      detail: style.outline_color,
    };
  }
  if (style.outline_type === "gradient") {
    return {
      label: `${t("overlay.outline")} ${style.outline_width}px`,
      detail: `(${t("overlay.gradient")})`,
    };
  }
  return { label: `${t("overlay.outline")} (${t("overlay.animNone")})`, detail: "" };
}

/** Same split for the shadow row: readable summary first, raw color second. */
function shadowSwatchText(style: TextStyle, t: TranslateFn): { label: string; detail: string } {
  if (!style.text_shadow) {
    return { label: `${t("overlay.shadow")} (${t("overlay.off")})`, detail: "" };
  }
  return {
    label: `${t("overlay.shadow")} ${style.text_shadow_blur}px ${style.text_shadow_x},${style.text_shadow_y}`,
    detail: style.text_shadow_color,
  };
}

/** Compact text style editor with swatch-based rows that open modal editors. */
export function TextStyleEditor({
  style,
  onChange,
  label,
  onOpenTextColorEditor,
  onOpenOutlineEditor,
  onOpenShadowEditor,
}: Readonly<{
  style: TextStyle;
  onChange: (s: TextStyle) => void;
  label: string;
  onOpenTextColorEditor: (
    colorType: "solid" | "gradient",
    color: string,
    gradientStops: GradientStop[],
    gradientAngle: number,
    onConfirm: (
      colorType: "solid" | "gradient",
      color: string,
      gradientStops: GradientStop[],
      gradientAngle: number,
    ) => void,
  ) => void;
  onOpenOutlineEditor: (params: OpenOutlineEditorParams) => void;
  onOpenShadowEditor: (params: OpenShadowEditorParams) => void;
}>) {
  const { t } = useI18n();
  const alignGroupId = useId();
  const u = (field: keyof TextStyle, value: unknown) => onChange({ ...style, [field]: value });
  return (
    <div
      data-tutorial="text-style"
      className="space-y-2 border border-border-subtle/50 rounded-none p-2"
    >
      <p className="text-xs 2xl:text-sm text-text-secondary font-semibold">{label}</p>

      {/* --- Font --- */}
      <FontFamilyPicker value={style.font_family} onChange={(f) => u("font_family", f)} />

      {/* --- Size --- */}
      <NumSlider
        label={t("overlay.size")}
        unit="px"
        value={style.font_size}
        min={6}
        max={200}
        onChange={(v) => u("font_size", v)}
      />

      {/* --- Weight, named the way a type tool names it --- */}
      <label className="block">
        <span className="text-xs text-text-muted">{t("overlay.fontWeight")}</span>
        <select
          value={style.font_weight}
          onChange={(e) => u("font_weight", Number(e.target.value))}
          className="w-full bg-bg-secondary border border-border-subtle rounded-none px-2.5 py-1.5 text-xs text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
        >
          {FONT_WEIGHTS.map((w) => (
            <option key={w.value} value={w.value}>
              {t(w.key)}
            </option>
          ))}
        </select>
      </label>

      {/* --- Alignment --- */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-text-muted w-14 2xl:w-16" id={`${alignGroupId}-label`}>
          {t("overlay.textAlign")}
        </span>
        <div
          role="group"
          aria-labelledby={`${alignGroupId}-label`}
          className="flex border border-border-subtle rounded-none overflow-hidden"
        >
          {(["left", "center", "right"] as const).map((align) => {
            const centerOrRight =
              align === "center" ? t("tooltip.editor.alignCenter") : t("tooltip.editor.alignRight");
            const alignTitle = align === "left" ? t("tooltip.editor.alignLeft") : centerOrRight;
            const active = (style.text_align || "left") === align;

            return (
              <button
                key={align}
                type="button"
                onClick={() => u("text_align", align)}
                aria-pressed={active}
                className={`px-2.5 py-1.5 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue ${
                  active
                    ? "bg-accent-blue/20 text-accent-blue"
                    : "text-text-muted hover:bg-bg-hover"
                }`}
                title={alignTitle}
                aria-label={alignTitle}
              >
                {align === "left" && <AlignLeft size={12} aria-hidden="true" />}
                {align === "center" && <AlignCenter size={12} aria-hidden="true" />}
                {align === "right" && <AlignRight size={12} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* --- Color swatch row (opens TextColorEditorModal) --- */}
      <div className="border-t border-border-subtle/50 pt-2">
        <ColorSwatch
          color={
            style.color_type === "solid"
              ? style.color
              : (style.gradient_stops?.[0]?.color ?? "#ffffff")
          }
          gradient={
            style.color_type === "gradient"
              ? {
                  stops: style.gradient_stops || [],
                  angle: style.gradient_angle || 180,
                }
              : undefined
          }
          label={t("overlay.color")}
          detail={style.color_type === "solid" ? style.color : `(${t("overlay.gradient")})`}
          onClick={() =>
            onOpenTextColorEditor(
              style.color_type || "solid",
              style.color,
              style.gradient_stops || [
                { color: "#ffffff", position: 0 },
                { color: "#aaaaaa", position: 100 },
              ],
              style.gradient_angle || 180,
              (colorType, color, gradientStops, gradientAngle) => {
                onChange({
                  ...style,
                  color_type: colorType,
                  color,
                  gradient_stops: gradientStops,
                  gradient_angle: gradientAngle,
                });
              },
            )
          }
        />
      </div>

      {/* --- Outline swatch row --- */}
      <div className="border-t border-border-subtle/50 pt-2">
        <ColorSwatch
          {...outlineSwatchPaint(style)}
          {...outlineSwatchText(style, t)}
          onClick={() =>
            onOpenOutlineEditor({
              type: style.outline_type ?? "none",
              color: style.outline_color,
              width: style.outline_width,
              gradientStops: style.outline_gradient_stops?.length
                ? style.outline_gradient_stops
                : FALLBACK_GRADIENT_STOPS,
              gradientAngle: style.outline_gradient_angle || FALLBACK_GRADIENT_ANGLE,
              onConfirm: (type, color, width, gradientStops, gradientAngle) => {
                onChange({
                  ...style,
                  outline_type: type,
                  outline_color: color,
                  outline_width: width,
                  outline_gradient_stops: gradientStops,
                  outline_gradient_angle: gradientAngle,
                });
              },
            })
          }
        />
      </div>

      {/* --- Shadow swatch row --- */}
      <div className="border-t border-border-subtle/50 pt-2">
        <ColorSwatch
          color={style.text_shadow ? style.text_shadow_color : "#00000000"}
          {...shadowSwatchText(style, t)}
          onClick={() =>
            onOpenShadowEditor({
              enabled: style.text_shadow,
              color: style.text_shadow_color,
              blur: style.text_shadow_blur,
              x: style.text_shadow_x,
              y: style.text_shadow_y,
              onConfirm: (p) => {
                onChange({
                  ...style,
                  text_shadow: p.enabled,
                  text_shadow_color: p.color,
                  text_shadow_blur: p.blur,
                  text_shadow_x: p.x,
                  text_shadow_y: p.y,
                });
              },
            })
          }
        />
      </div>
    </div>
  );
}
