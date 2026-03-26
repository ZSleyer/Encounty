import { Play, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import {
  OverlaySettings,
  OverlayElementBase,
  TextStyle,
  GradientStop,
} from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { NumInput, NumSlider } from "./controls/NumSlider";
import { ColorSwatch } from "./controls/ColorSwatch";
import type { ShadowConfirmParams } from "./controls/ShadowEditorModal";

/** Parameters for opening the shadow editor modal. */
interface OpenShadowEditorParams extends ShadowConfirmParams {
  readonly onConfirm: (params: ShadowConfirmParams) => void;
}

type ElementKey = "sprite" | "name" | "title" | "counter";

const ELEMENT_LABELS: Record<ElementKey, string> = {
  sprite: "Sprite",
  name: "Name",
  title: "Titel",
  counter: "Zähler",
};

const POPULAR_FONTS = [
  "sans", "serif", "monospace", "pokemon",
  "Roboto", "Open Sans", "Lato", "Montserrat", "Oswald", "Raleway",
  "Poppins", "Nunito", "Ubuntu", "Merriweather", "Playfair Display",
  "Bebas Neue", "Cinzel", "Exo 2", "Orbitron", "Press Start 2P",
];

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
  text_shadow_color_type: "solid",
  text_shadow_gradient_stops: [
    { color: "#ffffff", position: 0 },
    { color: "#000000", position: 100 },
  ],
  text_shadow_gradient_angle: 180,
  text_shadow_blur: 4,
  text_shadow_x: 1,
  text_shadow_y: 1,
};

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
  onOpenOutlineEditor: (
    type: "none" | "solid", color: string, width: number,
    onConfirm: (type: "none" | "solid", color: string, width: number) => void,
  ) => void;
  onOpenShadowEditor: (params: OpenShadowEditorParams) => void;
}>) {
  const { t } = useI18n();
  const u = (field: keyof TextStyle, value: unknown) =>
    onChange({ ...style, [field]: value });
  return (
    <div className="space-y-2 border border-border-subtle/50 rounded p-2">
      <p className="text-xs 2xl:text-sm text-text-secondary font-semibold">{label}</p>

      {/* --- Font --- */}
      <label className="block">
        <span className="text-xs text-text-muted">Schriftart</span>
        <select
          value={style.font_family}
          onChange={(e) => u("font_family", e.target.value)}
          className="w-full bg-bg-secondary border border-border-subtle rounded px-2.5 py-1.5 text-xs text-text-primary"
        >
          {POPULAR_FONTS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </label>

      {/* --- Size --- */}
      <NumSlider label="Größe (px)" value={style.font_size} min={6} max={200} onChange={(v) => u("font_size", v)} />

      {/* --- Weight --- */}
      <label className="block">
        <span className="text-xs text-text-muted">Gewicht</span>
        <select
          value={style.font_weight}
          onChange={(e) => u("font_weight", Number(e.target.value))}
          className="w-full bg-bg-secondary border border-border-subtle rounded px-2.5 py-1.5 text-xs text-text-primary"
        >
          {[100, 300, 400, 500, 700, 900].map((w) => (
            <option key={w} value={w}>{w}</option>
          ))}
        </select>
      </label>

      {/* --- Alignment --- */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-text-muted w-14 2xl:w-16">Ausrichtung</span>
        <div className="flex border border-border-subtle rounded overflow-hidden">
          {(["left", "center", "right"] as const).map((align) => {
            const centerOrRight = align === "center" ? t("tooltip.editor.alignCenter") : t("tooltip.editor.alignRight");
            const alignTitle = align === "left" ? t("tooltip.editor.alignLeft") : centerOrRight;

            return (
            <button
              key={align}
              onClick={() => u("text_align", align)}
              className={`px-2.5 py-1.5 flex items-center justify-center ${
                (style.text_align || "left") === align
                  ? "bg-accent-blue/20 text-accent-blue"
                  : "text-text-muted hover:bg-bg-hover"
              }`}
              title={alignTitle}
            >
              {align === "left" && <AlignLeft size={12} />}
              {align === "center" && <AlignCenter size={12} />}
              {align === "right" && <AlignRight size={12} />}
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
          label={style.color_type === "solid" ? `Farbe ${style.color}` : "Farbe (Verlauf)"}
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
          color={style.outline_type === "solid" ? style.outline_color : "#00000000"}
          label={
            style.outline_type === "solid"
              ? `Kontur ${style.outline_width}px ${style.outline_color}`
              : "Kontur (Kein)"
          }
          onClick={() =>
            onOpenOutlineEditor(
              style.outline_type === "solid" ? "solid" : "none",
              style.outline_color,
              style.outline_width,
              (type, color, width) => {
                onChange({
                  ...style,
                  outline_type: type, outline_color: color, outline_width: width,
                });
              },
            )
          }
        />
      </div>

      {/* --- Shadow swatch row --- */}
      <div className="border-t border-border-subtle/50 pt-2">
        <ColorSwatch
          color={style.text_shadow ? style.text_shadow_color : "#00000000"}
          gradient={
            style.text_shadow && (style.text_shadow_color_type === "gradient")
              ? {
                  stops: style.text_shadow_gradient_stops || [{ color: "#ffffff", position: 0 }, { color: "#000000", position: 100 }],
                  angle: style.text_shadow_gradient_angle || 180,
                }
              : undefined
          }
          label={
            style.text_shadow
              ? `Schatten ${style.text_shadow_blur}px ${style.text_shadow_x},${style.text_shadow_y}`
              : "Schatten (Aus)"
          }
          onClick={() =>
            onOpenShadowEditor({
              enabled: style.text_shadow,
              color: style.text_shadow_color,
              colorType: style.text_shadow_color_type || "solid",
              gradientStops: style.text_shadow_gradient_stops || [{ color: "#ffffff", position: 0 }, { color: "#000000", position: 100 }],
              gradientAngle: style.text_shadow_gradient_angle || 180,
              blur: style.text_shadow_blur,
              x: style.text_shadow_x,
              y: style.text_shadow_y,
              onConfirm: (p) => {
                onChange({
                  ...style,
                  text_shadow: p.enabled,
                  text_shadow_color: p.color,
                  text_shadow_color_type: p.colorType,
                  text_shadow_gradient_stops: p.gradientStops,
                  text_shadow_gradient_angle: p.gradientAngle,
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

interface OverlayPropertyPanelProps {
  readonly localSettings: OverlaySettings;
  readonly selectedEl: ElementKey;
  readonly updateSelectedEl: (patch: Partial<OverlayElementBase>) => void;
  readonly readOnly?: boolean;
  readonly embedded?: boolean;
  readonly onUpdate: (settings: OverlaySettings) => void;
  readonly openColorPicker: (color: string, onPick: (c: string) => void, opts?: { opacity?: number; showOpacity?: boolean }) => void;
  readonly openOutlineEditor: (
    type: "none" | "solid", color: string, width: number,
    onConfirm: (t: "none" | "solid", c: string, w: number) => void,
  ) => void;
  readonly openShadowEditor: (params: OpenShadowEditorParams) => void;
  readonly openTextColorEditor: (
    colorType: "solid" | "gradient", color: string,
    gradientStops: GradientStop[], gradientAngle: number,
    onConfirm: (ct: "solid" | "gradient", c: string, gs: GradientStop[], ga: number) => void,
  ) => void;
  readonly fireTest: (element: ElementKey, reverse?: boolean) => void;
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
}: OverlayPropertyPanelProps) {
  const { t } = useI18n();
  const update = (s: OverlaySettings) => {
    onUpdate(s);
  };

  return (
    <div data-tutorial="properties" className={embedded ? "flex-1 min-h-0" : "bg-bg-secondary rounded-xl border border-border-subtle p-3 flex-1 min-h-0 overflow-y-auto"}>
      <div className="mb-4">
        <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-0.5">
          Eigenschaften
        </h2>
        <p className="text-[11px] text-text-muted">
          {ELEMENT_LABELS[selectedEl]}
        </p>
      </div>

      {/* Position & Size — compact Photoshop style */}
      <div className="space-y-1.5 mb-4">
        <div className="flex gap-2">
          <label className="flex items-center gap-1 flex-1">
            <span className="text-xs text-text-muted w-3">X</span>
            <NumInput
              value={(localSettings[selectedEl] as OverlayElementBase).x}
              min={0}
              max={localSettings.canvas_width}
              onChange={(v) => updateSelectedEl({ x: v })}
              className="flex-1"
            />
          </label>
          <label className="flex items-center gap-1 flex-1">
            <span className="text-xs text-text-muted w-3">Y</span>
            <NumInput
              value={(localSettings[selectedEl] as OverlayElementBase).y}
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
              value={
                (localSettings[selectedEl] as OverlayElementBase).width
              }
              min={10}
              max={localSettings.canvas_width}
              onChange={(v) => updateSelectedEl({ width: v })}
              className="flex-1"
            />
          </label>
          <label className="flex items-center gap-1 flex-1">
            <span className="text-xs text-text-muted w-3">H</span>
            <NumInput
              value={
                (localSettings[selectedEl] as OverlayElementBase).height
              }
              min={10}
              max={localSettings.canvas_height}
              onChange={(v) => updateSelectedEl({ height: v })}
              className="flex-1"
            />
          </label>
        </div>
        <p className="text-[11px] text-text-muted mt-1">
          Pfeiltasten: 1px | Shift: 10px | Tab: wechseln
        </p>
      </div>

      {/* Element-specific properties */}
      {selectedEl === "sprite" && (
        <div className="space-y-3">
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
              <div className="flex gap-2 items-center">
                <ColorSwatch
                  color={localSettings.sprite.glow_color || "#ffffff"}
                  label="Glow Farbe"
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
              </div>
              <NumSlider
                label="Deckkraft"
                min={0}
                max={1}
                step={0.05}
                value={localSettings.sprite.glow_opacity ?? 0.2}
                onChange={(v) =>
                  update({
                    ...localSettings,
                    sprite: { ...localSettings.sprite, glow_opacity: v },
                  })
                }
              />
              <NumSlider
                label="Blur"
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
          <div>
            <label htmlFor="sprite-idle-animation" className="text-xs text-text-muted">
              Idle Animation
            </label>
            <select
              id="sprite-idle-animation"
              value={localSettings.sprite.idle_animation}
              onChange={(e) =>
                update({
                  ...localSettings,
                  sprite: {
                    ...localSettings.sprite,
                    idle_animation: e.target.value,
                  },
                })
              }
              className="w-full bg-bg-primary border border-border-subtle rounded px-2.5 py-1.5 text-xs text-text-primary"
            >
              <option value="none">Keine</option>
              <option value="float">Schweben</option>
              <option value="bob">Bob</option>
              <option value="pulse">Puls</option>
              <option value="rock">Wackeln</option>
              <option value="wiggle">Wippen</option>
              <option value="shimmer">Schimmern</option>
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <label htmlFor="sprite-trigger-animation" className="text-xs text-text-muted">
                Trigger Animation
              </label>
              <button
                onClick={() => fireTest("sprite")}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-accent-blue/20 hover:bg-accent-blue/40 text-accent-blue transition-colors"
              >
                <Play className="w-2.5 h-2.5 2xl:w-3 2xl:h-3" /> Test
              </button>
            </div>
            <select
              id="sprite-trigger-animation"
              value={localSettings.sprite.trigger_enter}
              onChange={(e) =>
                update({
                  ...localSettings,
                  sprite: {
                    ...localSettings.sprite,
                    trigger_enter: e.target.value,
                  },
                })
              }
              className="w-full bg-bg-primary border border-border-subtle rounded px-2.5 py-1.5 text-xs text-text-primary"
            >
              <option value="none">Keine</option>
              <option value="pop">Pop</option>
              <option value="bounce">Bounce (Hüpfen)</option>
              <option value="shake">Shake</option>
              <option value="spin">Spin</option>
              <option value="flip">Flip</option>
              <option value="rubber">Rubber Band</option>
              <option value="flash">Flash</option>
              <option value="jello">Jello</option>
              <option value="tada">Tada</option>
              <option value="swing">Swing</option>
            </select>
          </div>
        </div>
      )}

      {selectedEl === "name" && (
        <div className="space-y-3">
          <TextStyleEditor
            style={localSettings.name.style || DEFAULT_TEXT_STYLE}
            label="Text-Stil"
            onChange={(s) =>
              update({
                ...localSettings,
                name: { ...localSettings.name, style: s },
              })
            }
            onOpenTextColorEditor={openTextColorEditor}
            onOpenOutlineEditor={openOutlineEditor}
            onOpenShadowEditor={openShadowEditor}
          />
          <div>
            <label htmlFor="name-idle-animation" className="text-xs text-text-muted">
              Idle Animation
            </label>
            <select
              id="name-idle-animation"
              value={localSettings.name.idle_animation}
              onChange={(e) =>
                update({
                  ...localSettings,
                  name: {
                    ...localSettings.name,
                    idle_animation: e.target.value,
                  },
                })
              }
              className="w-full bg-bg-primary border border-border-subtle rounded px-2.5 py-1.5 text-xs text-text-primary"
            >
              <option value="none">Keine</option>
              <option value="breathe">Atmen</option>
              <option value="glow">Glühen</option>
              <option value="shimmer">Schimmern</option>
              <option value="float">Schweben</option>
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <label htmlFor="name-trigger-animation" className="text-xs text-text-muted">
                Trigger Animation
              </label>
              <button
                onClick={() => fireTest("name")}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-accent-blue/20 hover:bg-accent-blue/40 text-accent-blue transition-colors"
              >
                <Play className="w-2.5 h-2.5 2xl:w-3 2xl:h-3" /> Test
              </button>
            </div>
            <select
              id="name-trigger-animation"
              value={localSettings.name.trigger_enter}
              onChange={(e) =>
                update({
                  ...localSettings,
                  name: {
                    ...localSettings.name,
                    trigger_enter: e.target.value,
                  },
                })
              }
              className="w-full bg-bg-primary border border-border-subtle rounded px-2.5 py-1.5 text-xs text-text-primary"
            >
              <option value="none">Keine</option>
              <option value="fade-in">Einblenden</option>
              <option value="slide-in">Einsliden</option>
              <option value="pop">Pop</option>
              <option value="bounce">Bounce</option>
              <option value="shake">Shake</option>
              <option value="flip">Flip</option>
              <option value="rubber">Rubber Band</option>
              <option value="jello">Jello</option>
              <option value="tada">Tada</option>
              <option value="zoom-in">Zoom In</option>
            </select>
          </div>
        </div>
      )}

      {selectedEl === "title" && localSettings.title && (
        <div className="space-y-3">
          <TextStyleEditor
            style={localSettings.title.style || DEFAULT_TEXT_STYLE}
            label="Titel-Stil"
            onChange={(s) =>
              update({
                ...localSettings,
                title: { ...localSettings.title, style: s },
              })
            }
            onOpenTextColorEditor={openTextColorEditor}
            onOpenOutlineEditor={openOutlineEditor}
            onOpenShadowEditor={openShadowEditor}
          />
          <div>
            <label htmlFor="title-idle-animation" className="text-xs text-text-muted">
              Idle Animation
            </label>
            <select
              id="title-idle-animation"
              value={localSettings.title.idle_animation || "none"}
              onChange={(e) =>
                update({
                  ...localSettings,
                  title: {
                    ...localSettings.title,
                    idle_animation: e.target.value,
                  },
                })
              }
              className="w-full bg-bg-primary border border-border-subtle rounded px-2.5 py-1.5 text-xs text-text-primary"
            >
              <option value="none">Keine</option>
              <option value="breathe">Atmen</option>
              <option value="glow">Glühen</option>
              <option value="shimmer">Schimmern</option>
              <option value="float">Schweben</option>
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <label htmlFor="title-trigger-animation" className="text-xs text-text-muted">
                Trigger Animation
              </label>
              <button
                onClick={() => fireTest("title")}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-accent-blue/20 hover:bg-accent-blue/40 text-accent-blue transition-colors"
              >
                <Play className="w-2.5 h-2.5 2xl:w-3 2xl:h-3" /> Test
              </button>
            </div>
            <select
              id="title-trigger-animation"
              value={localSettings.title.trigger_enter || "fade-in"}
              onChange={(e) =>
                update({
                  ...localSettings,
                  title: {
                    ...localSettings.title,
                    trigger_enter: e.target.value,
                  },
                })
              }
              className="w-full bg-bg-primary border border-border-subtle rounded px-2.5 py-1.5 text-xs text-text-primary"
            >
              <option value="none">Keine</option>
              <option value="fade-in">Einblenden</option>
              <option value="slide-in">Einsliden</option>
              <option value="pop">Pop</option>
              <option value="bounce">Bounce</option>
              <option value="shake">Shake</option>
              <option value="flip">Flip</option>
              <option value="rubber">Rubber Band</option>
              <option value="jello">Jello</option>
              <option value="tada">Tada</option>
              <option value="zoom-in">Zoom In</option>
            </select>
          </div>
        </div>
      )}

      {selectedEl === "counter" && (
        <div className="space-y-3">
          <TextStyleEditor
            style={localSettings.counter.style || DEFAULT_TEXT_STYLE}
            label="Zähler-Stil"
            onChange={(s) =>
              update({
                ...localSettings,
                counter: { ...localSettings.counter, style: s },
              })
            }
            onOpenTextColorEditor={openTextColorEditor}
            onOpenOutlineEditor={openOutlineEditor}
            onOpenShadowEditor={openShadowEditor}
          />
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={localSettings.counter.show_label}
              onChange={(e) =>
                update({
                  ...localSettings,
                  counter: {
                    ...localSettings.counter,
                    show_label: e.target.checked,
                  },
                })
              }
              className="accent-accent-blue"
            />
            <span className="text-xs 2xl:text-sm text-text-secondary">Label anzeigen</span>
          </label>
          {localSettings.counter.show_label && (
            <>
              <input
                type="text"
                value={localSettings.counter.label_text}
                onChange={(e) =>
                  update({
                    ...localSettings,
                    counter: {
                      ...localSettings.counter,
                      label_text: e.target.value,
                    },
                  })
                }
                className="w-full bg-bg-primary border border-border-subtle rounded px-2.5 py-1.5 text-xs text-text-primary"
                placeholder="Label-Text"
                aria-label={t("aria.labelText")}
              />
              <TextStyleEditor
                style={
                  localSettings.counter.label_style || DEFAULT_TEXT_STYLE
                }
                label="Label-Stil"
                onChange={(s) =>
                  update({
                    ...localSettings,
                    counter: { ...localSettings.counter, label_style: s },
                  })
                }
                onOpenTextColorEditor={openTextColorEditor}
                onOpenOutlineEditor={openOutlineEditor}
                onOpenShadowEditor={openShadowEditor}
              />
            </>
          )}
          <div>
            <label htmlFor="counter-idle-animation" className="text-xs text-text-muted">
              Idle Animation
            </label>
            <select
              id="counter-idle-animation"
              value={localSettings.counter.idle_animation}
              onChange={(e) =>
                update({
                  ...localSettings,
                  counter: {
                    ...localSettings.counter,
                    idle_animation: e.target.value,
                  },
                })
              }
              className="w-full bg-bg-primary border border-border-subtle rounded px-2.5 py-1.5 text-xs text-text-primary"
            >
              <option value="none">Keine</option>
              <option value="breathe">Atmen</option>
              <option value="glow">Glühen</option>
              <option value="shimmer">Schimmern</option>
              <option value="float">Schweben</option>
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <label htmlFor="counter-trigger-animation" className="text-xs text-text-muted">
                Trigger Animation
              </label>
              <button
                onClick={() => fireTest("counter")}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-accent-blue/20 hover:bg-accent-blue/40 text-accent-blue transition-colors"
              >
                <Play className="w-2.5 h-2.5 2xl:w-3 2xl:h-3" /> Test
              </button>
            </div>
            <select
              id="counter-trigger-animation"
              value={localSettings.counter.trigger_enter}
              onChange={(e) =>
                update({
                  ...localSettings,
                  counter: {
                    ...localSettings.counter,
                    trigger_enter: e.target.value,
                  },
                })
              }
              className="w-full bg-bg-primary border border-border-subtle rounded px-2.5 py-1.5 text-xs text-text-primary"
            >
              <option value="none">Keine</option>
              <option value="pop">Pop</option>
              <option value="flash">Flash</option>
              <option value="bounce">Bounce (Hüpfen)</option>
              <option value="shake">Shake</option>
              <option value="slot">Slot (Ziffern slide)</option>
              <option value="flip-digit">Flip (Ziffern, Wecker)</option>
              <option value="slide-up">Slide Up (gesamt)</option>
              <option value="flip">Flip (gesamt, Wecker)</option>
              <option value="rubber">Rubber Band</option>
              <option value="jello">Jello</option>
              <option value="tada">Tada</option>
              <option value="zoom-in">Zoom In</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
