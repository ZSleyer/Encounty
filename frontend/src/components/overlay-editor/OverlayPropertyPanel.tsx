import { useId, type ReactNode } from "react";
import { Play, RotateCcw, AlignLeft, AlignCenter, AlignRight, Upload, Trash2 } from "lucide-react";
import {
  OverlaySettings,
  OverlayElementBase,
  LabeledTextElement,
  Pokemon,
  TextStyle,
  GradientStop,
} from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import type { DraggableElementKey, ElementKey } from "../../utils/overlayElements";
import { NumInput, NumSlider, PercentSlider } from "./controls/NumSlider";
import { ColorSwatch } from "./controls/ColorSwatch";
import { PanelSection } from "./controls/PanelSection";
import { FontFamilyPicker } from "./controls/FontFamilyPicker";
import type { ShadowConfirmParams } from "./controls/ShadowEditorModal";
import type { OutlineType } from "./controls/OutlineEditorModal";

/** Parameters for opening the shadow editor modal. */
interface OpenShadowEditorParams extends ShadowConfirmParams {
  readonly onConfirm: (params: ShadowConfirmParams) => void;
}

/** Current outline values plus the callback the outline editor confirms with. */
export interface OpenOutlineEditorParams {
  readonly type: OutlineType;
  readonly color: string;
  readonly width: number;
  readonly gradientStops: GradientStop[];
  readonly gradientAngle: number;
  readonly onConfirm: (
    type: OutlineType,
    color: string,
    width: number,
    gradientStops: GradientStop[],
    gradientAngle: number,
  ) => void;
}

/** Translation function signature, mirrored from the I18n context. */
type TranslateFn = (key: string, options?: Record<string, string | number>) => string;

/** One entry of an animation `<select>`. */
interface AnimationOption {
  readonly value: string;
  readonly label: string;
}

/** Callbacks that open the shared style editor modals. */
interface StyleEditorOpeners {
  readonly onOpenTextColorEditor: (
    colorType: "solid" | "gradient", color: string,
    gradientStops: GradientStop[], gradientAngle: number,
    onConfirm: (ct: "solid" | "gradient", c: string, gs: GradientStop[], ga: number) => void,
  ) => void;
  readonly onOpenOutlineEditor: (params: OpenOutlineEditorParams) => void;
  readonly onOpenShadowEditor: (params: OpenShadowEditorParams) => void;
}

/** Default milliseconds between two sprite swaps while cycling phase targets. */
const DEFAULT_CYCLE_INTERVAL_MS = 3000;

/** Shared CSS for the panel's `<select>` controls. */
const SELECT_CLASS =
  "w-full bg-bg-primary border border-border-subtle rounded-none px-2.5 py-1.5 text-xs text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue";

const DEFAULT_TEXT_STYLE: TextStyle = {
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

/** Swatch colour and optional gradient preview of the outline row. */
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
 * plus the raw colour value as muted secondary text.
 */
function outlineSwatchText(
  style: TextStyle,
  t: TranslateFn,
): { label: string; detail: string } {
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

/** Same split for the shadow row: readable summary first, raw colour second. */
function shadowSwatchText(
  style: TextStyle,
  t: TranslateFn,
): { label: string; detail: string } {
  if (!style.text_shadow) {
    return { label: `${t("overlay.shadow")} (${t("overlay.off")})`, detail: "" };
  }
  return {
    label: `${t("overlay.shadow")} ${style.text_shadow_blur}px ${style.text_shadow_x},${style.text_shadow_y}`,
    detail: style.text_shadow_color,
  };
}

/** Compact text style editor with swatch-based rows that open modal editors. */
function TextStyleEditor({
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
    colorType: "solid" | "gradient", color: string,
    gradientStops: GradientStop[], gradientAngle: number,
    onConfirm: (colorType: "solid" | "gradient", color: string, gradientStops: GradientStop[], gradientAngle: number) => void,
  ) => void;
  onOpenOutlineEditor: (params: OpenOutlineEditorParams) => void;
  onOpenShadowEditor: (params: OpenShadowEditorParams) => void;
}>) {
  const { t } = useI18n();
  const alignGroupId = useId();
  const u = (field: keyof TextStyle, value: unknown) =>
    onChange({ ...style, [field]: value });
  return (
    <div data-tutorial="text-style" className="space-y-2 border border-border-subtle/50 rounded-none p-2">
      <p className="text-xs 2xl:text-sm text-text-secondary font-semibold">{label}</p>

      {/* --- Font --- */}
      <FontFamilyPicker value={style.font_family} onChange={(f) => u("font_family", f)} />

      {/* --- Size --- */}
      <NumSlider label={t("overlay.size")} unit="px" value={style.font_size} min={6} max={200} onChange={(v) => u("font_size", v)} />

      {/* --- Weight, named the way a type tool names it --- */}
      <label className="block">
        <span className="text-xs text-text-muted">{t("overlay.fontWeight")}</span>
        <select
          value={style.font_weight}
          onChange={(e) => u("font_weight", Number(e.target.value))}
          className="w-full bg-bg-secondary border border-border-subtle rounded-none px-2.5 py-1.5 text-xs text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
        >
          {FONT_WEIGHTS.map((w) => (
            <option key={w.value} value={w.value}>{t(w.key)}</option>
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
            const centerOrRight = align === "center" ? t("tooltip.editor.alignCenter") : t("tooltip.editor.alignRight");
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
          color={style.color_type === "solid" ? style.color : (style.gradient_stops?.[0]?.color ?? "#ffffff")}
          gradient={style.color_type === "gradient" ? {
            stops: style.gradient_stops || [],
            angle: style.gradient_angle || 180,
          } : undefined}
          label={t("overlay.color")}
          detail={style.color_type === "solid" ? style.color : `(${t("overlay.gradient")})`}
          onClick={() =>
            onOpenTextColorEditor(
              style.color_type || "solid",
              style.color,
              style.gradient_stops || [{ color: "#ffffff", position: 0 }, { color: "#aaaaaa", position: 100 }],
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

/** buildIdleAnimations lists the continuous animations offered for text elements. */
function buildIdleAnimations(t: TranslateFn): AnimationOption[] {
  return [
    { value: "none", label: t("overlay.animNone") },
    { value: "breathe", label: t("overlay.animBreathe") },
    { value: "glow", label: t("overlay.animGlow") },
    { value: "shimmer", label: t("overlay.animShimmerIdle") },
    { value: "float", label: t("overlay.animFloat") },
  ];
}

/** buildSpriteIdleAnimations lists the continuous animations offered for the sprite. */
function buildSpriteIdleAnimations(t: TranslateFn): AnimationOption[] {
  return [
    { value: "none", label: t("overlay.animNone") },
    { value: "float", label: t("overlay.animFloat") },
    { value: "bob", label: t("overlay.animBob") },
    { value: "pulse", label: t("overlay.animPulseShort") },
    { value: "rock", label: t("overlay.animWobble") },
    { value: "wiggle", label: t("overlay.animBounce") },
    { value: "shimmer", label: t("overlay.animShimmerIdle") },
  ];
}

/** buildSpriteTriggerAnimations lists the one-shot animations offered for the sprite. */
function buildSpriteTriggerAnimations(t: TranslateFn): AnimationOption[] {
  return [
    { value: "none", label: t("overlay.animNone") },
    { value: "pop", label: t("overlay.pop") },
    { value: "bounce", label: t("overlay.bounce") },
    { value: "shake", label: t("overlay.shake") },
    { value: "spin", label: t("overlay.spin") },
    { value: "flip", label: t("overlay.flip") },
    { value: "rubber", label: t("overlay.rubber") },
    { value: "flash", label: t("overlay.flash") },
    { value: "jello", label: t("overlay.jello") },
    { value: "tada", label: t("overlay.tada") },
    { value: "swing", label: t("overlay.swing") },
  ];
}

/** buildTextTriggerAnimations lists the one-shot animations of the plain text elements. */
function buildTextTriggerAnimations(t: TranslateFn): AnimationOption[] {
  return [
    { value: "none", label: t("overlay.animNone") },
    { value: "fade-in", label: t("overlay.animFadeIn") },
    { value: "slide-in", label: t("overlay.animSlideIn") },
    { value: "pop", label: t("overlay.pop") },
    { value: "bounce", label: t("overlay.bounce") },
    { value: "shake", label: t("overlay.shake") },
    { value: "flip", label: t("overlay.flip") },
    { value: "rubber", label: t("overlay.rubber") },
    { value: "jello", label: t("overlay.jello") },
    { value: "tada", label: t("overlay.tada") },
    { value: "zoom-in", label: t("overlay.zoomIn") },
  ];
}

/**
 * buildCounterTriggerAnimations lists the counter's one-shot animations. "Slot"
 * and "Flip Digit" are digit render modes and only the counter can show them.
 */
function buildCounterTriggerAnimations(t: TranslateFn): AnimationOption[] {
  return [
    { value: "none", label: t("overlay.animNone") },
    { value: "pop", label: t("overlay.pop") },
    { value: "flash", label: t("overlay.flash") },
    { value: "bounce", label: t("overlay.bounce") },
    { value: "shake", label: t("overlay.shake") },
    { value: "slot", label: t("overlay.slot") },
    { value: "flip-digit", label: t("overlay.flipDigit") },
    { value: "slide-up", label: t("overlay.slideUp") },
    { value: "flip", label: t("overlay.flip") },
    { value: "rubber", label: t("overlay.rubber") },
    { value: "jello", label: t("overlay.jello") },
    { value: "tada", label: t("overlay.tada") },
    { value: "zoom-in", label: t("overlay.zoomIn") },
  ];
}

/** buildOddsTriggerAnimations lists the one-shot animations offered for the odds. */
function buildOddsTriggerAnimations(t: TranslateFn): AnimationOption[] {
  return [
    { value: "none", label: t("overlay.animNone") },
    { value: "fade-in", label: t("overlay.animFadeIn") },
    { value: "pop", label: t("overlay.pop") },
    { value: "flash", label: t("overlay.flash") },
    { value: "bounce", label: t("overlay.bounce") },
    { value: "shake", label: t("overlay.shake") },
    { value: "tada", label: t("overlay.tada") },
    { value: "zoom-in", label: t("overlay.zoomIn") },
  ];
}

/**
 * buildNumericTriggerAnimations lists the trigger animations offered for the
 * labeled text elements. "Slot" and "Flip Digit" are missing on purpose: they
 * are render modes rather than animations and only the counter renders them.
 */
function buildNumericTriggerAnimations(t: TranslateFn): AnimationOption[] {
  return [
    { value: "none", label: t("overlay.animNone") },
    { value: "pop", label: t("overlay.pop") },
    { value: "flash", label: t("overlay.flash") },
    { value: "bounce", label: t("overlay.bounce") },
    { value: "shake", label: t("overlay.shake") },
    { value: "slide-up", label: t("overlay.slideUp") },
    { value: "flip", label: t("overlay.flip") },
    { value: "rubber", label: t("overlay.rubber") },
    { value: "jello", label: t("overlay.jello") },
    { value: "tada", label: t("overlay.tada") },
    { value: "zoom-in", label: t("overlay.zoomIn") },
  ];
}

/**
 * Labeled animation select. The two one-shot rows also carry a test button that
 * plays the animation once, forward for an encounter and backwards for a
 * correction.
 */
function AnimationRow({
  id,
  label,
  value,
  options,
  test,
  onChange,
  onTest,
}: Readonly<{
  id: string;
  label: string;
  value: string;
  options: readonly AnimationOption[];
  /** Omitted for the continuous row, which has nothing to fire once. */
  test?: "play" | "rewind";
  onChange: (value: string) => void;
  onTest?: () => void;
}>) {
  const { t } = useI18n();
  const buttonClass =
    test === "rewind"
      ? "bg-accent-red/15 hover:bg-accent-red/40 text-accent-red"
      : "bg-accent-blue/20 hover:bg-accent-blue/40 text-accent-blue";
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-0.5 min-h-6">
        <label htmlFor={id} className="text-xs text-text-muted">
          {label}
        </label>
        {test && (
          <button
            type="button"
            onClick={onTest}
            aria-label={t("aria.testAnimation", { name: label })}
            className={`flex items-center gap-1 px-2 py-1 rounded-none text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue ${buttonClass}`}
          >
            {test === "rewind" ? (
              <RotateCcw className="w-2.5 h-2.5 2xl:w-3 2xl:h-3" aria-hidden="true" />
            ) : (
              <Play className="w-2.5 h-2.5 2xl:w-3 2xl:h-3" aria-hidden="true" />
            )}{" "}
            Test
          </button>
        )}
      </div>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT_CLASS}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

/**
 * fireTestFor binds the test callback to one element. The forward run passes
 * only the element key, the backwards run adds the reverse flag.
 */
function fireTestFor(
  fireTest: (element: ElementKey, reverse?: boolean) => void,
  key: ElementKey,
): (reverse?: boolean) => void {
  return (reverse) => (reverse ? fireTest(key, true) : fireTest(key));
}

/** One animation channel: current value, the options offered and its setter. */
interface AnimationChannel {
  readonly value: string;
  readonly options: readonly AnimationOption[];
  readonly onChange: (value: string) => void;
}

/**
 * AnimationGroup collects the animation rows of one element under a single
 * heading. Without the shared heading the renamed rows ("Always running", "On
 * encounter") would read as three unrelated settings.
 */
function AnimationGroup({
  idPrefix,
  idle,
  trigger,
  decrement,
  onTest,
}: Readonly<{
  /** Element key the row ids are derived from, so they stay unique per layer. */
  idPrefix: string;
  idle: AnimationChannel;
  /** Omitted for elements that tick on their own, such as the timers. */
  trigger?: AnimationChannel;
  decrement?: AnimationChannel;
  onTest: (reverse?: boolean) => void;
}>) {
  const { t } = useI18n();
  return (
    <fieldset className="border border-border-subtle rounded-none px-2.5 pb-2.5 space-y-2">
      <legend className="px-1 text-xs 2xl:text-sm text-text-secondary">
        {t("overlay.animationGroup")}
      </legend>
      <AnimationRow
        id={`${idPrefix}-idle-animation`}
        label={t("overlay.idleAnimation")}
        value={idle.value}
        options={idle.options}
        onChange={idle.onChange}
      />
      {trigger && (
        <AnimationRow
          id={`${idPrefix}-trigger-animation`}
          label={t("overlay.triggerAnimation")}
          value={trigger.value}
          options={trigger.options}
          test="play"
          onChange={trigger.onChange}
          onTest={() => onTest()}
        />
      )}
      {decrement && (
        <AnimationRow
          id={`${idPrefix}-trigger-decrement-animation`}
          label={t("overlay.triggerAnimationDecrement")}
          value={decrement.value}
          options={decrement.options}
          test="rewind"
          onChange={decrement.onChange}
          onTest={() => onTest(true)}
        />
      )}
    </fieldset>
  );
}

/** Shared class of the single-line text inputs in the property panel. */
const TEXT_INPUT_CLASS =
  "w-full bg-bg-primary border border-border-subtle rounded-none px-2.5 py-1.5 text-xs text-text-primary";

/**
 * AffixFields renders the optional prefix and suffix inputs of a value layer.
 * Both strings are drawn inside the value's own span, so they inherit its text
 * style instead of the label style. An empty field is the off state, which is
 * why the group carries no toggle.
 */
function AffixFields({
  idPrefix,
  prefixText,
  suffixText,
  onChange,
}: Readonly<{
  /** Element key the input ids are derived from, so they stay unique per layer. */
  idPrefix: string;
  prefixText: string;
  suffixText: string;
  onChange: (patch: { prefix_text?: string; suffix_text?: string }) => void;
}>) {
  const { t } = useI18n();
  const hintId = `${idPrefix}-affix-hint`;
  return (
    // The wrapper only exists to carry the tutorial anchor: the section itself
    // collapses, and the walkthrough still has to be able to point at it.
    <div data-tutorial="affixes">
      <PanelSection title={t("overlay.affixGroup")}>
        <div>
          <label htmlFor={`${idPrefix}-prefix-text`} className="text-xs text-text-muted">
            {t("overlay.prefixText")}
          </label>
          <input
            id={`${idPrefix}-prefix-text`}
            type="text"
            value={prefixText ?? ""}
            onChange={(e) => onChange({ prefix_text: e.target.value })}
            className={`${TEXT_INPUT_CLASS} mt-0.5`}
            placeholder={t("overlay.prefixText")}
            aria-label={t("aria.prefixText")}
            aria-describedby={hintId}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-suffix-text`} className="text-xs text-text-muted">
            {t("overlay.suffixText")}
          </label>
          <input
            id={`${idPrefix}-suffix-text`}
            type="text"
            value={suffixText ?? ""}
            onChange={(e) => onChange({ suffix_text: e.target.value })}
            className={`${TEXT_INPUT_CLASS} mt-0.5`}
            placeholder={t("overlay.suffixText")}
            aria-label={t("aria.suffixText")}
            aria-describedby={hintId}
          />
        </div>
        <p id={hintId} className="text-xs text-text-muted leading-snug">
          {t("overlay.affixHint")}
        </p>
      </PanelSection>
    </div>
  );
}

/**
 * LabelFields renders the optional label of a value layer: the toggle, and when
 * it is on the label text plus the label's own text style.
 */
function LabelFields({
  show,
  text,
  style,
  onChange,
  onOpenTextColorEditor,
  onOpenOutlineEditor,
  onOpenShadowEditor,
}: Readonly<
  StyleEditorOpeners & {
    show: boolean;
    text: string;
    style: TextStyle | undefined;
    onChange: (patch: { show_label?: boolean; label_text?: string; label_style?: TextStyle }) => void;
  }
>) {
  const { t } = useI18n();
  return (
    <>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={show}
          onChange={(e) => onChange({ show_label: e.target.checked })}
          className="accent-accent-blue"
        />
        <span className="text-xs 2xl:text-sm text-text-secondary">{t("overlay.showLabel")}</span>
      </label>
      {show && (
        <>
          <input
            type="text"
            value={text}
            onChange={(e) => onChange({ label_text: e.target.value })}
            className={TEXT_INPUT_CLASS}
            placeholder={t("overlay.labelText")}
            aria-label={t("aria.labelText")}
          />
          <TextStyleEditor
            style={style || DEFAULT_TEXT_STYLE}
            label={t("overlay.labelStyle")}
            onChange={(s) => onChange({ label_style: s })}
            onOpenTextColorEditor={onOpenTextColorEditor}
            onOpenOutlineEditor={onOpenOutlineEditor}
            onOpenShadowEditor={onOpenShadowEditor}
          />
        </>
      )}
    </>
  );
}

/**
 * LabeledTextLike is the structural shape every value layer with an optional
 * label shares: counter, timer, odds and the phasing elements. The timer has no
 * trigger animations, which is why both trigger fields are optional here.
 */
interface LabeledTextLike {
  style: TextStyle;
  show_label: boolean;
  label_text: string;
  label_style?: TextStyle;
  prefix_text: string;
  suffix_text: string;
  idle_animation: string;
  trigger_enter?: string;
  trigger_decrement?: string;
}

/**
 * LabeledTextElementEditor renders the property rows shared by every value
 * layer that can carry a label: text style, the text drawn before and after the
 * value, the label group, and the animation group. Omitting triggerAnimations
 * drops the one-shot rows, which is what the timers need.
 */
function LabeledTextElementEditor({
  elementKey,
  element,
  styleLabel,
  idleAnimations,
  triggerAnimations,
  extraRows,
  onChange,
  onOpenTextColorEditor,
  onOpenOutlineEditor,
  onOpenShadowEditor,
  fireTest,
}: Readonly<
  StyleEditorOpeners & {
    elementKey: DraggableElementKey;
    element: LabeledTextLike;
    styleLabel: string;
    idleAnimations: readonly AnimationOption[];
    /** Omitted for elements without trigger animations, such as the timers. */
    triggerAnimations?: readonly AnimationOption[];
    /** Element-specific rows, rendered right below the affix group. */
    extraRows?: ReactNode;
    onChange: (patch: Partial<LabeledTextElement>) => void;
    fireTest: (element: ElementKey, reverse?: boolean) => void;
  }
>) {
  const openers: StyleEditorOpeners = {
    onOpenTextColorEditor,
    onOpenOutlineEditor,
    onOpenShadowEditor,
  };
  return (
    <div className="space-y-3">
      <TextStyleEditor
        style={element.style || DEFAULT_TEXT_STYLE}
        label={styleLabel}
        onChange={(s) => onChange({ style: s })}
        {...openers}
      />
      <AffixFields
        idPrefix={elementKey}
        prefixText={element.prefix_text}
        suffixText={element.suffix_text}
        onChange={onChange}
      />
      {extraRows}
      <LabelFields
        show={element.show_label}
        text={element.label_text}
        style={element.label_style}
        onChange={onChange}
        {...openers}
      />
      <AnimationGroup
        idPrefix={elementKey}
        idle={{
          value: element.idle_animation,
          options: idleAnimations,
          onChange: (v) => onChange({ idle_animation: v }),
        }}
        trigger={
          triggerAnimations && {
            value: element.trigger_enter ?? "none",
            options: triggerAnimations,
            onChange: (v) => onChange({ trigger_enter: v }),
          }
        }
        decrement={
          triggerAnimations && {
            value: element.trigger_decrement || "none",
            options: triggerAnimations,
            onChange: (v) => onChange({ trigger_decrement: v }),
          }
        }
        onTest={fireTestFor(fireTest, elementKey)}
      />
    </div>
  );
}

/**
 * PlainTextElementEditor renders the rows of a text layer without a label:
 * the name and the title. Only a text style and the animation group.
 */
function PlainTextElementEditor({
  elementKey,
  style,
  idleAnimation,
  triggerEnter,
  triggerDecrement,
  styleLabel,
  idleAnimations,
  triggerAnimations,
  onChange,
  onOpenTextColorEditor,
  onOpenOutlineEditor,
  onOpenShadowEditor,
  fireTest,
}: Readonly<
  StyleEditorOpeners & {
    elementKey: DraggableElementKey;
    style: TextStyle | undefined;
    idleAnimation: string;
    triggerEnter: string;
    triggerDecrement: string;
    styleLabel: string;
    idleAnimations: readonly AnimationOption[];
    triggerAnimations: readonly AnimationOption[];
    onChange: (patch: {
      style?: TextStyle;
      idle_animation?: string;
      trigger_enter?: string;
      trigger_decrement?: string;
    }) => void;
    fireTest: (element: ElementKey, reverse?: boolean) => void;
  }
>) {
  return (
    <div className="space-y-3">
      <TextStyleEditor
        style={style || DEFAULT_TEXT_STYLE}
        label={styleLabel}
        onChange={(s) => onChange({ style: s })}
        onOpenTextColorEditor={onOpenTextColorEditor}
        onOpenOutlineEditor={onOpenOutlineEditor}
        onOpenShadowEditor={onOpenShadowEditor}
      />
      <AnimationGroup
        idPrefix={elementKey}
        idle={{
          value: idleAnimation,
          options: idleAnimations,
          onChange: (v) => onChange({ idle_animation: v }),
        }}
        trigger={{
          value: triggerEnter,
          options: triggerAnimations,
          onChange: (v) => onChange({ trigger_enter: v }),
        }}
        decrement={{
          value: triggerDecrement || "none",
          options: triggerAnimations,
          onChange: (v) => onChange({ trigger_decrement: v }),
        }}
        onTest={fireTestFor(fireTest, elementKey)}
      />
    </div>
  );
}

interface OverlayPropertyPanelProps {
  readonly localSettings: OverlaySettings;
  readonly selectedEl: ElementKey;
  readonly updateSelectedEl: (patch: Partial<OverlayElementBase>) => void;
  readonly readOnly?: boolean;
  readonly embedded?: boolean;
  readonly onUpdate: (settings: OverlaySettings) => void;
  readonly openColorPicker: (color: string, onPick: (c: string) => void, opts?: { opacity?: number; showOpacity?: boolean }) => void;
  readonly openOutlineEditor: (params: OpenOutlineEditorParams) => void;
  readonly openShadowEditor: (params: OpenShadowEditorParams) => void;
  readonly openTextColorEditor: (
    colorType: "solid" | "gradient", color: string,
    gradientStops: GradientStop[], gradientAngle: number,
    onConfirm: (ct: "solid" | "gradient", c: string, gs: GradientStop[], ga: number) => void,
  ) => void;
  readonly fireTest: (element: ElementKey, reverse?: boolean) => void;
  /** Hunt the editor previews; supplies the phase targets for the sprite cycling hint. */
  readonly activePokemon?: Pokemon;
  readonly bgPreviewUrl?: string;
  readonly bgUploading?: boolean;
  readonly onBgUpload?: () => void;
  readonly onBgRemove?: () => void;
}

export function OverlayPropertyPanel({
  localSettings,
  selectedEl,
  updateSelectedEl,
  readOnly: _readOnly,
  embedded,
  onUpdate,
  openTextColorEditor,
  openOutlineEditor,
  openShadowEditor,
  openColorPicker,
  fireTest,
  activePokemon,
  bgPreviewUrl,
  bgUploading,
  onBgUpload,
  onBgRemove,
}: OverlayPropertyPanelProps) {
  const { t } = useI18n();
  const ELEMENT_LABELS: Record<ElementKey, string> = {
    sprite: "Sprite",
    name: "Name",
    title: t("overlay.elementTitle"),
    counter: t("overlay.elementCounter"),
    timer: t("overlay.elementTimer"),
    odds: t("overlay.elementOdds"),
    phase: t("overlay.elementPhase"),
    total_counter: t("overlay.elementTotalCounter"),
    total_timer: t("overlay.elementTotalTimer"),
    canvas: "Canvas",
  };
  const update = (s: OverlaySettings) => {
    onUpdate(s);
  };

  const bgConfig = localSettings.background_animation_config ?? {};
  const setBgConfig = (key: string, value: unknown) =>
    update({ ...localSettings, background_animation_config: { ...bgConfig, [key]: value } });

  const idleAnimations = buildIdleAnimations(t);
  const numericTriggerAnimations = buildNumericTriggerAnimations(t);
  const spriteIdleAnimations = buildSpriteIdleAnimations(t);
  const spriteTriggerAnimations = buildSpriteTriggerAnimations(t);
  const textTriggerAnimations = buildTextTriggerAnimations(t);
  const counterTriggerAnimations = buildCounterTriggerAnimations(t);
  const oddsTriggerAnimations = buildOddsTriggerAnimations(t);
  const styleEditorOpeners: StyleEditorOpeners = {
    onOpenTextColorEditor: openTextColorEditor,
    onOpenOutlineEditor: openOutlineEditor,
    onOpenShadowEditor: openShadowEditor,
  };

  // Optional in the settings type, so the panel only renders what the state carries.
  const selectedBase =
    selectedEl === "canvas"
      ? undefined
      : (localSettings[selectedEl] as OverlayElementBase | undefined);

  /**
   * Renders one of the phasing text elements when it is selected and present in
   * the settings. Omitting triggerAnimations drops the trigger rows.
   */
  const renderLabeledText = (
    key: "phase" | "total_counter" | "total_timer",
    triggerAnimations?: readonly AnimationOption[],
  ) => {
    const element: LabeledTextElement | undefined = localSettings[key];
    if (selectedEl !== key || !element) return null;
    return (
      <LabeledTextElementEditor
        elementKey={key}
        element={element}
        styleLabel={t("overlay.textStyle")}
        idleAnimations={idleAnimations}
        triggerAnimations={triggerAnimations}
        onChange={(patch) => update({ ...localSettings, [key]: { ...element, ...patch } })}
        fireTest={fireTest}
        {...styleEditorOpeners}
      />
    );
  };

  const cycleIntervalSeconds =
    (localSettings.sprite.cycle_interval_ms ?? DEFAULT_CYCLE_INTERVAL_MS) / 1000;
  const phaseTargetCount = activePokemon?.phase_targets?.length ?? 0;

  // Named colours cannot drive a swatch preview, so anything but a hex falls
  // back to white the same way the colour picker does.
  const borderSwatchColor = localSettings.border_color?.startsWith("#")
    ? localSettings.border_color
    : "#ffffff";

  return (
    <div data-tutorial="properties" className={embedded ? "flex-1 min-h-0" : "bg-bg-secondary rounded-none border border-border-subtle p-3 flex-1 min-h-0 overflow-y-auto"}>
      <div className="mb-4">
        <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-0.5">
          {t("overlay.properties")}
        </h2>
        <p className="text-[11px] text-text-muted">
          {ELEMENT_LABELS[selectedEl]}
        </p>
      </div>

      {/* Canvas properties */}
      {selectedEl === "canvas" && (
        <div className="space-y-3">
          {/* --- Canvas size --- */}
          <fieldset className="border border-border-subtle rounded-none px-2.5 pb-2.5 space-y-2">
            <legend className="px-1 text-xs 2xl:text-sm text-text-secondary">
              {t("overlay.canvasSize")}
            </legend>
            <NumSlider
              label={t("overlay.width")}
              unit="px"
              value={localSettings.canvas_width}
              min={100}
              max={1920}
              step={10}
              onChange={(v) => update({ ...localSettings, canvas_width: v })}
            />
            <NumSlider
              label={t("overlay.height")}
              unit="px"
              value={localSettings.canvas_height}
              min={50}
              max={1080}
              step={10}
              onChange={(v) => update({ ...localSettings, canvas_height: v })}
            />
          </fieldset>

          {/* --- Background: fill, image and the shape of the box --- */}
          <fieldset className="border border-border-subtle rounded-none px-2.5 pb-2.5 space-y-2">
            <legend className="px-1 text-xs 2xl:text-sm text-text-secondary">
              {t("overlay.background")}
            </legend>

            <div className={localSettings.hidden ? "space-y-2 opacity-30 pointer-events-none" : "space-y-2"}>
              <ColorSwatch
                color={localSettings.background_color}
                label={t("overlay.color")}
                detail={localSettings.background_color}
                onClick={() =>
                  openColorPicker(localSettings.background_color, (c) =>
                    update({ ...localSettings, background_color: c }),
                  )
                }
              />
              <PercentSlider
                label={t("overlay.opacity")}
                value={localSettings.background_opacity}
                onChange={(v) => update({ ...localSettings, background_opacity: v })}
              />
              <NumSlider
                label={t("overlay.blur")}
                unit="px"
                value={localSettings.blur}
                min={0}
                max={30}
                onChange={(v) => update({ ...localSettings, blur: v })}
              />
            </div>

            <NumSlider
              label={t("overlay.radius")}
              unit="px"
              value={localSettings.border_radius}
              min={0}
              max={60}
              onChange={(v) => update({ ...localSettings, border_radius: v })}
            />

            {/* Background image upload */}
            {onBgUpload && (
              <div>
                <span className="text-xs text-text-muted">
                  {t("overlay.bgImage")}
                </span>
                <div className="flex items-center gap-1.5 mt-1">
                  <button
                    type="button"
                    title={t("tooltip.editor.uploadBackground")}
                    onClick={onBgUpload}
                    disabled={bgUploading}
                    className="flex items-center gap-1 px-2 py-1 rounded-none text-xs bg-bg-primary hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
                  >
                    <Upload className="w-3 h-3" aria-hidden="true" />
                    {bgUploading ? "..." : t("overlay.upload")}
                  </button>
                  {localSettings.background_image && onBgRemove && (
                    <button
                      type="button"
                      title={t("tooltip.editor.removeBackground")}
                      onClick={onBgRemove}
                      className="flex items-center gap-1 px-2 py-1 rounded-none text-xs bg-bg-primary hover:bg-accent-red/20 text-text-secondary hover:text-accent-red transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
                    >
                      <Trash2 className="w-3 h-3" aria-hidden="true" />
                      {t("overlay.remove")}
                    </button>
                  )}
                </div>
                {localSettings.background_image && bgPreviewUrl && (
                  <>
                    <div
                      className="mt-1.5 w-full h-12 rounded-none border border-border-subtle bg-bg-primary overflow-hidden"
                      style={{
                        backgroundImage: `url(${bgPreviewUrl})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }}
                    />
                    <label className="block mt-1" htmlFor="pp-bg-image-fit">
                      <span className="text-xs text-text-muted">{t("overlay.bgImageFit")}</span>
                      <select
                        id="pp-bg-image-fit"
                        value={localSettings.background_image_fit ?? "cover"}
                        onChange={(e) =>
                          update({
                            ...localSettings,
                            background_image_fit: e.target.value as "cover" | "contain" | "stretch" | "tile",
                          })
                        }
                        className={SELECT_CLASS}
                      >
                        <option value="cover">Cover</option>
                        <option value="contain">Contain</option>
                        <option value="stretch">Stretch</option>
                        <option value="tile">{t("overlay.bgFitTile")}</option>
                      </select>
                    </label>
                  </>
                )}
              </div>
            )}
          </fieldset>

          {/* --- Border --- */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={localSettings.show_border}
                onChange={(e) => update({ ...localSettings, show_border: e.target.checked })}
                className="accent-accent-blue"
              />
              <span className="text-xs text-text-secondary">{t("overlay.borderOutline")}</span>
            </label>
            {localSettings.show_border && (
              <div
                className={`space-y-2 pl-1 ${localSettings.hidden ? "opacity-30 pointer-events-none" : ""}`}
              >
                <ColorSwatch
                  color={borderSwatchColor}
                  label={t("overlay.borderColor")}
                  detail={localSettings.border_color}
                  onClick={() =>
                    openColorPicker(borderSwatchColor, (c) =>
                      update({ ...localSettings, border_color: c }),
                    )
                  }
                />
                <NumSlider
                  label={t("overlay.borderWidth")}
                  unit="px"
                  value={localSettings.border_width ?? 2}
                  min={1}
                  max={8}
                  onChange={(v) => update({ ...localSettings, border_width: v })}
                />
              </div>
            )}
          </div>

          {/* --- Background animation --- */}
          <div className="space-y-2">
            <label className="block" htmlFor="pp-bg-animation">
              <span className="text-xs text-text-muted">
                {t("overlay.bgAnimation")}
              </span>
              <select
                id="pp-bg-animation"
                value={localSettings.background_animation ?? "none"}
                onChange={(e) => update({ ...localSettings, background_animation: e.target.value })}
                className={`${SELECT_CLASS} mt-1`}
              >
                <option value="none">{t("overlay.animNone")}</option>
                <option value="waves">{t("overlay.animWaves")}</option>
                <option value="gradient-shift">{t("overlay.animGradient")}</option>
                <option value="shimmer-bg">{t("overlay.animShimmer")}</option>
              </select>
            </label>

            {/* Animation speed */}
            {(localSettings.background_animation ?? "none") !== "none" && (
              <NumSlider
                label={`${t("overlay.speed")} ${(localSettings.background_animation_speed ?? 1).toFixed(1)}×`}
                value={localSettings.background_animation_speed ?? 1}
                min={0.1}
                max={3}
                step={0.1}
                onChange={(v) => update({ ...localSettings, background_animation_speed: v })}
              />
            )}

            {/* Animation-specific settings */}
            {(localSettings.background_animation ?? "none") !== "none" && (
              <div className="space-y-2 pt-1 border-t border-border-subtle">
                <span className="text-[10px] font-medium text-text-faint uppercase tracking-wider">
                  {t("overlay.animSettings")}
                </span>

                {/* Waves: color, opacity */}
                {localSettings.background_animation === "waves" && (
                  <>
                    <label className="block">
                      <span className="text-xs text-text-muted">{t("overlay.animColor")}</span>
                      <input type="color" value={(bgConfig.wavesColor as string) ?? "#ffffff"}
                        onChange={(e) => setBgConfig("wavesColor", e.target.value)}
                        className="w-full h-7 mt-1 rounded-none border border-border-subtle cursor-pointer" />
                    </label>
                    <PercentSlider label={t("overlay.animOpacity")} value={(bgConfig.wavesOpacity as number) ?? 0.18}
                      onChange={(v) => setBgConfig("wavesOpacity", v)} />
                  </>
                )}

                {/* Gradient shift: 4 color stops */}
                {localSettings.background_animation === "gradient-shift" && (
                  <>
                    <label className="block">
                      <span className="text-xs text-text-muted">{t("overlay.animColor")} 1</span>
                      <input type="color" value={(bgConfig.gradientColor1 as string) ?? "#ff6b6b"}
                        onChange={(e) => setBgConfig("gradientColor1", e.target.value)}
                        className="w-full h-7 mt-1 rounded-none border border-border-subtle cursor-pointer" />
                    </label>
                    <label className="block">
                      <span className="text-xs text-text-muted">{t("overlay.animColor")} 2</span>
                      <input type="color" value={(bgConfig.gradientColor2 as string) ?? "#feca57"}
                        onChange={(e) => setBgConfig("gradientColor2", e.target.value)}
                        className="w-full h-7 mt-1 rounded-none border border-border-subtle cursor-pointer" />
                    </label>
                    <label className="block">
                      <span className="text-xs text-text-muted">{t("overlay.animColor")} 3</span>
                      <input type="color" value={(bgConfig.gradientColor3 as string) ?? "#48dbfb"}
                        onChange={(e) => setBgConfig("gradientColor3", e.target.value)}
                        className="w-full h-7 mt-1 rounded-none border border-border-subtle cursor-pointer" />
                    </label>
                    <label className="block">
                      <span className="text-xs text-text-muted">{t("overlay.animColor")} 4</span>
                      <input type="color" value={(bgConfig.gradientColor4 as string) ?? "#ff9ff3"}
                        onChange={(e) => setBgConfig("gradientColor4", e.target.value)}
                        className="w-full h-7 mt-1 rounded-none border border-border-subtle cursor-pointer" />
                    </label>
                  </>
                )}

                {/* Shimmer: color and intensity */}
                {localSettings.background_animation === "shimmer-bg" && (
                  <>
                    <label className="block">
                      <span className="text-xs text-text-muted">{t("overlay.animColor")}</span>
                      <input type="color" value={(bgConfig.shimmerColor as string) ?? "#ffffff"}
                        onChange={(e) => setBgConfig("shimmerColor", e.target.value)}
                        className="w-full h-7 mt-1 rounded-none border border-border-subtle cursor-pointer" />
                    </label>
                    <PercentSlider label={t("overlay.animIntensity")} value={(bgConfig.shimmerIntensity as number) ?? 0.12}
                      onChange={(v) => setBgConfig("shimmerIntensity", v)} />
                  </>
                )}

              </div>
            )}
          </div>
        </div>
      )}

      {/* Position & Size, compact Photoshop style */}
      {selectedBase && (
      <div className="space-y-1.5 mb-4">
        <div className="flex gap-2">
          <label className="flex items-center gap-1 flex-1">
            <span className="text-xs text-text-muted w-3">X</span>
            <NumInput
              value={selectedBase.x}
              min={0}
              max={localSettings.canvas_width}
              onChange={(v) => updateSelectedEl({ x: v })}
              className="flex-1"
            />
          </label>
          <label className="flex items-center gap-1 flex-1">
            <span className="text-xs text-text-muted w-3">Y</span>
            <NumInput
              value={selectedBase.y}
              min={0}
              max={localSettings.canvas_height}
              onChange={(v) => updateSelectedEl({ y: v })}
              className="flex-1"
            />
          </label>
        </div>
        <div className="flex gap-2">
          <label className="flex items-center gap-1 flex-1">
            <span className="text-xs text-text-muted w-3">W</span>
            <NumInput
              value={selectedBase.width}
              min={10}
              max={localSettings.canvas_width}
              onChange={(v) => updateSelectedEl({ width: v })}
              className="flex-1"
            />
          </label>
          <label className="flex items-center gap-1 flex-1">
            <span className="text-xs text-text-muted w-3">H</span>
            <NumInput
              value={selectedBase.height}
              min={10}
              max={localSettings.canvas_height}
              onChange={(v) => updateSelectedEl({ height: v })}
              className="flex-1"
            />
          </label>
        </div>
        <p className="text-[11px] text-text-muted mt-1">
          {t("overlay.arrowKeys")}
        </p>
      </div>
      )}

      {/* Element-specific properties */}
      {selectedEl === "sprite" && (
        <div className="space-y-3">
          {/* --- Glow --- */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={localSettings.sprite.show_glow}
              onChange={(e) =>
                update({
                  ...localSettings,
                  sprite: {
                    ...localSettings.sprite,
                    show_glow: e.target.checked,
                  },
                })
              }
              className="accent-accent-blue"
            />
            <span className="text-xs 2xl:text-sm text-text-secondary">Glow</span>
          </label>
          {localSettings.sprite.show_glow && (
            <div className="space-y-2">
              <ColorSwatch
                color={localSettings.sprite.glow_color || "#ffffff"}
                label={t("overlay.glowColor")}
                onClick={() =>
                  openColorPicker(
                    localSettings.sprite.glow_color || "#ffffff",
                    (c) =>
                      update({
                        ...localSettings,
                        sprite: { ...localSettings.sprite, glow_color: c },
                      }),
                    { opacity: localSettings.sprite.glow_opacity ?? 0.2, showOpacity: true },
                  )
                }
              />
              <PercentSlider
                label={t("overlay.opacity")}
                value={localSettings.sprite.glow_opacity ?? 0.2}
                onChange={(v) =>
                  update({
                    ...localSettings,
                    sprite: { ...localSettings.sprite, glow_opacity: v },
                  })
                }
              />
              <NumSlider
                label={t("overlay.blur")}
                unit="px"
                min={0}
                max={80}
                step={1}
                value={localSettings.sprite.glow_blur ?? 20}
                onChange={(v) =>
                  update({
                    ...localSettings,
                    sprite: { ...localSettings.sprite, glow_blur: v },
                  })
                }
              />
            </div>
          )}

          {/* --- Phase target cycling --- */}
          <div data-tutorial="sprite-cycle" className="space-y-2 border-t border-border-subtle pt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={localSettings.sprite.cycle_phase_targets ?? false}
                onChange={(e) =>
                  update({
                    ...localSettings,
                    sprite: {
                      ...localSettings.sprite,
                      cycle_phase_targets: e.target.checked,
                    },
                  })
                }
                className="accent-accent-blue"
              />
              <span className="text-xs 2xl:text-sm text-text-secondary">
                {t("overlay.cyclePhaseTargets")}
              </span>
            </label>
            {localSettings.sprite.cycle_phase_targets && (
              <>
                <NumSlider
                  label={t("overlay.cycleInterval")}
                  unit="s"
                  min={0.5}
                  max={60}
                  step={0.5}
                  value={cycleIntervalSeconds}
                  onChange={(v) =>
                    update({
                      ...localSettings,
                      sprite: {
                        ...localSettings.sprite,
                        cycle_interval_ms: Math.round(v * 1000),
                      },
                    })
                  }
                />
                <div>
                  <label
                    htmlFor="sprite-cycle-transition"
                    className="text-xs text-text-muted"
                  >
                    {t("overlay.cycleTransition")}
                  </label>
                  <select
                    id="sprite-cycle-transition"
                    value={localSettings.sprite.cycle_transition ?? "fade"}
                    onChange={(e) =>
                      update({
                        ...localSettings,
                        sprite: {
                          ...localSettings.sprite,
                          cycle_transition: e.target.value,
                        },
                      })
                    }
                    aria-label={t("aria.cycleTransition")}
                    className={`${SELECT_CLASS} mt-1`}
                  >
                    <option value="none">{t("overlay.cycleTransitionNone")}</option>
                    <option value="fade">{t("overlay.cycleTransitionFade")}</option>
                    <option value="wipe-lr">{t("overlay.cycleTransitionWipeLr")}</option>
                    <option value="wipe-rl">{t("overlay.cycleTransitionWipeRl")}</option>
                  </select>
                </div>
                {phaseTargetCount === 0 && (
                  <p className="text-[11px] text-accent-yellow">
                    {t("overlay.cycleNoTargets")}
                  </p>
                )}
              </>
            )}
          </div>

          <AnimationGroup
            idPrefix="sprite"
            idle={{
              value: localSettings.sprite.idle_animation,
              options: spriteIdleAnimations,
              onChange: (v) =>
                update({
                  ...localSettings,
                  sprite: { ...localSettings.sprite, idle_animation: v },
                }),
            }}
            trigger={{
              value: localSettings.sprite.trigger_enter,
              options: spriteTriggerAnimations,
              onChange: (v) =>
                update({
                  ...localSettings,
                  sprite: { ...localSettings.sprite, trigger_enter: v },
                }),
            }}
            decrement={{
              value: localSettings.sprite.trigger_decrement || "none",
              options: spriteTriggerAnimations,
              onChange: (v) =>
                update({
                  ...localSettings,
                  sprite: { ...localSettings.sprite, trigger_decrement: v },
                }),
            }}
            onTest={fireTestFor(fireTest, "sprite")}
          />
        </div>
      )}

      {selectedEl === "name" && (
        <PlainTextElementEditor
          elementKey="name"
          style={localSettings.name.style}
          idleAnimation={localSettings.name.idle_animation}
          triggerEnter={localSettings.name.trigger_enter}
          triggerDecrement={localSettings.name.trigger_decrement}
          styleLabel={t("overlay.textStyle")}
          idleAnimations={idleAnimations}
          triggerAnimations={textTriggerAnimations}
          onChange={(patch) => update({ ...localSettings, name: { ...localSettings.name, ...patch } })}
          fireTest={fireTest}
          {...styleEditorOpeners}
        />
      )}

      {selectedEl === "title" && localSettings.title && (
        <PlainTextElementEditor
          elementKey="title"
          style={localSettings.title.style}
          idleAnimation={localSettings.title.idle_animation || "none"}
          triggerEnter={localSettings.title.trigger_enter || "fade-in"}
          triggerDecrement={localSettings.title.trigger_decrement || "none"}
          styleLabel={t("overlay.titleStyle")}
          idleAnimations={idleAnimations}
          triggerAnimations={textTriggerAnimations}
          onChange={(patch) => update({ ...localSettings, title: { ...localSettings.title!, ...patch } })}
          fireTest={fireTest}
          {...styleEditorOpeners}
        />
      )}

      {selectedEl === "counter" && (
        <LabeledTextElementEditor
          elementKey="counter"
          element={localSettings.counter}
          styleLabel={t("overlay.counterStyle")}
          idleAnimations={idleAnimations}
          triggerAnimations={counterTriggerAnimations}
          onChange={(patch) => update({ ...localSettings, counter: { ...localSettings.counter, ...patch } })}
          fireTest={fireTest}
          {...styleEditorOpeners}
        />
      )}

      {selectedEl === "timer" && localSettings.timer && (
        <LabeledTextElementEditor
          elementKey="timer"
          element={localSettings.timer}
          styleLabel={t("overlay.timerStyle")}
          idleAnimations={idleAnimations}
          onChange={(patch) => update({ ...localSettings, timer: { ...localSettings.timer!, ...patch } })}
          fireTest={fireTest}
          {...styleEditorOpeners}
        />
      )}

      {selectedEl === "odds" && localSettings.odds && (
        <LabeledTextElementEditor
          elementKey="odds"
          element={localSettings.odds}
          styleLabel={t("overlay.oddsStyle")}
          idleAnimations={idleAnimations}
          triggerAnimations={oddsTriggerAnimations}
          extraRows={
            <div>
              <label htmlFor="odds-format" className="text-xs text-text-muted">
                {t("overlay.odds.formatLabel")}
              </label>
              <select
                id="odds-format"
                value={localSettings.odds.format}
                onChange={(e) =>
                  update({
                    ...localSettings,
                    odds: {
                      ...localSettings.odds!,
                      format: e.target.value as "fractional" | "percent",
                    },
                  })
                }
                aria-label={t("aria.oddsFormat")}
                className={`${SELECT_CLASS} mt-1`}
              >
                <option value="fractional">{t("overlay.odds.formatFractional")}</option>
                <option value="percent">{t("overlay.odds.formatPercent")}</option>
              </select>
            </div>
          }
          onChange={(patch) => update({ ...localSettings, odds: { ...localSettings.odds!, ...patch } })}
          fireTest={fireTest}
          {...styleEditorOpeners}
        />
      )}

      {renderLabeledText("phase", numericTriggerAnimations)}
      {renderLabeledText("total_counter", numericTriggerAnimations)}
      {/* Like the timer, the total timer ticks on its own and gets no trigger animations. */}
      {renderLabeledText("total_timer")}
    </div>
  );
}
