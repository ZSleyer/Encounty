/**
 * Property panel of the overlay editor: the rows shown for whichever layer is
 * selected. The per-element editors, the canvas rows and the animation tables
 * live in their own modules, so this file only picks the right one and wires
 * the settings updates.
 */
import {
  OverlaySettings,
  OverlayElementBase,
  LabeledTextElement,
  Pokemon,
  GradientStop,
} from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { getElementLabels, type ElementKey } from "../../utils/overlayElements";
import { NumInput, NumSlider, PercentSlider } from "./controls/NumSlider";
import { ColorSwatch } from "./controls/ColorSwatch";
import { SELECT_CLASS } from "./panelStyles";
import { CanvasProperties } from "./CanvasProperties";
import { AnimationGroup, fireTestFor } from "./AnimationGroup";
import { LabeledTextElementEditor, PlainTextElementEditor } from "./TextElementEditors";
import {
  buildCounterTriggerAnimations,
  buildIdleAnimations,
  buildNumericTriggerAnimations,
  buildOddsTriggerAnimations,
  buildSpriteIdleAnimations,
  buildSpriteTriggerAnimations,
  buildTextTriggerAnimations,
} from "./animationOptions";
import type {
  AnimationOption,
  OpenOutlineEditorParams,
  OpenShadowEditorParams,
  StyleEditorOpeners,
} from "./propertyPanelTypes";

export type { OpenOutlineEditorParams } from "./propertyPanelTypes";

/** Default milliseconds between two sprite swaps while cycling phase targets. */
const DEFAULT_CYCLE_INTERVAL_MS = 3000;

interface OverlayPropertyPanelProps {
  readonly localSettings: OverlaySettings;
  readonly selectedEl: ElementKey;
  readonly updateSelectedEl: (patch: Partial<OverlayElementBase>) => void;
  readonly readOnly?: boolean;
  readonly embedded?: boolean;
  readonly onUpdate: (settings: OverlaySettings) => void;
  readonly openColorPicker: (
    color: string,
    onPick: (c: string) => void,
    opts?: { opacity?: number; showOpacity?: boolean },
  ) => void;
  readonly openOutlineEditor: (params: OpenOutlineEditorParams) => void;
  readonly openShadowEditor: (params: OpenShadowEditorParams) => void;
  readonly openTextColorEditor: (
    colorType: "solid" | "gradient",
    color: string,
    gradientStops: GradientStop[],
    gradientAngle: number,
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

/**
 * OverlayPropertyPanel renders the settings of the layer that is currently
 * selected in the editor.
 */
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
  const ELEMENT_LABELS = getElementLabels(t);
  const update = (s: OverlaySettings) => {
    onUpdate(s);
  };

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

  return (
    <div
      data-tutorial="properties"
      className={
        embedded
          ? "flex-1 min-h-0"
          : "bg-bg-secondary rounded-none border border-border-subtle p-3 flex-1 min-h-0 overflow-y-auto"
      }
    >
      <div className="mb-4">
        <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-0.5">
          {t("overlay.properties")}
        </h2>
        <p className="text-[11px] text-text-muted">{ELEMENT_LABELS[selectedEl]}</p>
      </div>

      {/* Canvas properties */}
      {selectedEl === "canvas" && (
        <CanvasProperties
          localSettings={localSettings}
          update={update}
          openColorPicker={openColorPicker}
          bgPreviewUrl={bgPreviewUrl}
          bgUploading={bgUploading}
          onBgUpload={onBgUpload}
          onBgRemove={onBgRemove}
        />
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
          <p className="text-[11px] text-text-muted mt-1">{t("overlay.arrowKeys")}</p>
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
          <div
            data-tutorial="sprite-cycle"
            className="space-y-2 border-t border-border-subtle pt-2"
          >
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
                  <label htmlFor="sprite-cycle-transition" className="text-xs text-text-muted">
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
                  <p className="text-[11px] text-accent-yellow">{t("overlay.cycleNoTargets")}</p>
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
          onChange={(patch) =>
            update({ ...localSettings, name: { ...localSettings.name, ...patch } })
          }
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
          onChange={(patch) =>
            update({ ...localSettings, title: { ...localSettings.title!, ...patch } })
          }
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
          onChange={(patch) =>
            update({ ...localSettings, counter: { ...localSettings.counter, ...patch } })
          }
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
          onChange={(patch) =>
            update({ ...localSettings, timer: { ...localSettings.timer!, ...patch } })
          }
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
          onChange={(patch) =>
            update({ ...localSettings, odds: { ...localSettings.odds!, ...patch } })
          }
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
