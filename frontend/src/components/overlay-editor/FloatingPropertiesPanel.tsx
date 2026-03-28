/**
 * FloatingPropertiesPanel — A draggable floating panel that delegates to
 * OverlayPropertyPanel for element and canvas properties.
 */

import type { ReactNode } from "react";
import { GripVertical, X, Upload, Trash2 } from "lucide-react";
import { OverlayPropertyPanel } from "./OverlayPropertyPanel";
import { NumSlider } from "./controls/NumSlider";
import { ColorSwatch } from "./controls/ColorSwatch";
import { useI18n } from "../../contexts/I18nContext";
import type {
  OverlaySettings,
  OverlayElementBase,
  GradientStop,
} from "../../types";
import type { ShadowConfirmParams } from "./controls/ShadowEditorModal";

/** Parameters for opening the shadow editor modal. */
interface OpenShadowEditorParams extends ShadowConfirmParams {
  readonly onConfirm: (params: ShadowConfirmParams) => void;
}

type ElementKey = "sprite" | "name" | "title" | "counter" | "canvas";


interface FloatingPropertiesPanelProps {
  /** Called when the user clicks the close button. */
  readonly onClose: () => void;

  /** Absolute position from useDraggableWindow hook. */
  readonly position: { x: number; y: number };
  /** Mouse-down handler to initiate drag (from useDraggableWindow). */
  readonly onDragStart: (e: React.MouseEvent) => void;

  // --- Element tab props (passed through to OverlayPropertyPanel) ---
  readonly localSettings: OverlaySettings;
  readonly selectedEl: ElementKey;
  readonly updateSelectedEl: (patch: Partial<OverlayElementBase>) => void;
  readonly readOnly?: boolean;
  readonly onUpdate: (settings: OverlaySettings) => void;
  readonly openColorPicker: (
    color: string,
    onPick: (c: string) => void,
    opts?: { opacity?: number; showOpacity?: boolean },
  ) => void;
  readonly openOutlineEditor: (
    type: "none" | "solid",
    color: string,
    width: number,
    onConfirm: (t: "none" | "solid", c: string, w: number) => void,
  ) => void;
  readonly openShadowEditor: (params: OpenShadowEditorParams) => void;
  readonly openTextColorEditor: (
    colorType: "solid" | "gradient",
    color: string,
    gradientStops: GradientStop[],
    gradientAngle: number,
    onConfirm: (
      ct: "solid" | "gradient",
      c: string,
      gs: GradientStop[],
      ga: number,
    ) => void,
  ) => void;
  readonly fireTest: (element: ElementKey, reverse?: boolean) => void;

  // --- Canvas props (passed through to OverlayPropertyPanel) ---
  readonly bgPreviewUrl: string;
  readonly bgUploading: boolean;
  readonly onBgUpload: () => void;
  readonly onBgRemove: () => void;

  /** Optional ReactNode rendered at the bottom of the element tab (e.g. OBS source hint). */
  readonly obsSourceHint?: ReactNode;
}

/** Floating, draggable properties panel for the overlay editor. */
export function FloatingPropertiesPanel({
  onClose,
  position,
  onDragStart,
  localSettings,
  selectedEl,
  updateSelectedEl,
  readOnly,
  onUpdate,
  openColorPicker,
  openOutlineEditor,
  openShadowEditor,
  openTextColorEditor,
  fireTest,
  bgPreviewUrl,
  bgUploading,
  onBgUpload,
  onBgRemove,
  obsSourceHint,
}: FloatingPropertiesPanelProps) {
  const { t } = useI18n();
  const ELEMENT_LABELS: Record<ElementKey, string> = {
    sprite: "Sprite",
    name: "Name",
    title: t("overlay.elementTitle"),
    counter: t("overlay.elementCounter"),
    canvas: "Canvas",
  };

  return (
    <div
      role="dialog"
      aria-label={t("aria.properties")}
      style={{ position: "fixed", left: position.x, top: position.y, zIndex: 50 }}
      className="w-72 bg-bg-secondary rounded-xl border border-border-subtle shadow-2xl flex flex-col max-h-[75vh]"
      data-tutorial="properties"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Title bar — draggable */}
      <div
        onMouseDown={onDragStart}
        className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle cursor-move select-none shrink-0"
      >
        <GripVertical className="w-3 h-3 text-text-faint" />

        <span className="text-xs text-text-secondary flex-1">
          {ELEMENT_LABELS[selectedEl] ?? "Element"}
        </span>

        {/* Close */}
        <button
          aria-label={t("aria.close")}
          onClick={onClose}
          className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scrollable content area */}
      <div className="overflow-y-auto flex-1 min-h-0">
        <div className="p-3">
          <OverlayPropertyPanel
            localSettings={localSettings}
            selectedEl={selectedEl}
            updateSelectedEl={updateSelectedEl}
            readOnly={readOnly}
            onUpdate={onUpdate}
            openColorPicker={openColorPicker}
            openOutlineEditor={openOutlineEditor}
            openShadowEditor={openShadowEditor}
            openTextColorEditor={openTextColorEditor}
            fireTest={fireTest}
            bgPreviewUrl={bgPreviewUrl}
            bgUploading={bgUploading}
            onBgUpload={onBgUpload}
            onBgRemove={onBgRemove}
          />

          {obsSourceHint && (
            <div className="mt-3 pt-3 border-t border-border-subtle">
              {obsSourceHint}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Canvas Tab ---

/** Internal component rendering all canvas-level overlay settings. */
function CanvasTab({
  localSettings,
  updateField,
  openColorPicker,
  bgPreviewUrl,
  bgUploading,
  onBgUpload,
  onBgRemove,
  t,
}: {
  localSettings: OverlaySettings;
  updateField: <K extends keyof OverlaySettings>(field: K, value: OverlaySettings[K]) => void;
  openColorPicker: (color: string, onPick: (c: string) => void, opts?: { opacity?: number; showOpacity?: boolean }) => void;
  bgPreviewUrl: string;
  bgUploading: boolean;
  onBgUpload: () => void;
  onBgRemove: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="p-3 space-y-2">
      {/* Canvas size */}
      <NumSlider
        label={t("overlay.width")}
        value={localSettings.canvas_width}
        min={100}
        max={1920}
        step={10}
        onChange={(v) => updateField("canvas_width", v)}
      />
      <NumSlider
        label={t("overlay.height")}
        value={localSettings.canvas_height}
        min={50}
        max={1080}
        step={10}
        onChange={(v) => updateField("canvas_height", v)}
      />

      {/* Background animation */}
      <label className="block">
        <span className="text-xs text-text-muted">
          {t("overlay.bgAnimation")}
        </span>
        <select
          value={localSettings.background_animation ?? "none"}
          onChange={(e) => updateField("background_animation", e.target.value)}
          className="w-full bg-bg-secondary border border-border-subtle rounded px-2.5 py-1.5 text-xs 2xl:text-sm text-text-primary outline-none mt-1"
        >
          <option value="none">{t("overlay.animNone")}</option>
          <option value="waves">{t("overlay.animWaves")}</option>
          <option value="gradient-shift">{t("overlay.animGradient")}</option>
          <option value="pulse-bg">{t("overlay.animPulse")}</option>
          <option value="shimmer-bg">{t("overlay.animShimmer")}</option>
          <option value="particles">{t("overlay.animParticles")}</option>
        </select>
      </label>

      {/* Animation speed — only visible when an animation is selected */}
      {(localSettings.background_animation ?? "none") !== "none" && (
        <NumSlider
          label={`${t("overlay.speed")} ${(localSettings.background_animation_speed ?? 1).toFixed(1)}×`}
          value={localSettings.background_animation_speed ?? 1}
          min={0.1}
          max={3}
          step={0.1}
          onChange={(v) => updateField("background_animation_speed", v)}
        />
      )}

      {/* Background image upload */}
      <div>
        <span className="text-xs text-text-muted">
          {t("overlay.bgImage")}
        </span>
        <div className="flex items-center gap-1.5 mt-1">
          <button
            title={t("tooltip.editor.uploadBackground")}
            onClick={onBgUpload}
            disabled={bgUploading}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-bg-primary hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
          >
            <Upload className="w-3 h-3" />
            {bgUploading ? "..." : t("overlay.upload")}
          </button>
          {localSettings.background_image && (
            <button
              title={t("tooltip.editor.removeBackground")}
              onClick={onBgRemove}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-bg-primary hover:bg-red-500/20 text-text-secondary hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              {t("overlay.remove")}
            </button>
          )}
        </div>
        {localSettings.background_image && (
          <>
            <div
              className="mt-1.5 w-full h-12 rounded border border-border-subtle bg-bg-primary overflow-hidden"
              style={{
                backgroundImage: `url(${bgPreviewUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
            <select
              value={localSettings.background_image_fit ?? "cover"}
              onChange={(e) =>
                updateField(
                  "background_image_fit",
                  e.target.value as "cover" | "contain" | "stretch" | "tile",
                )
              }
              className="w-full bg-bg-secondary border border-border-subtle rounded px-2.5 py-1.5 text-xs 2xl:text-sm text-text-primary outline-none mt-1"
            >
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
              <option value="stretch">Stretch</option>
              <option value="tile">{t("overlay.bgFitTile")}</option>
            </select>
          </>
        )}
      </div>

      {/* Background color, opacity, and blur */}
      <div className={localSettings.hidden ? "opacity-30 pointer-events-none" : ""}>
        <div>
          <span className="text-xs text-text-muted mb-1 block">
            {t("overlay.background")}
          </span>
          <ColorSwatch
            color={localSettings.background_color}
            label={localSettings.background_color}
            onClick={() =>
              openColorPicker(localSettings.background_color, (c) =>
                updateField("background_color", c),
              )
            }
          />
        </div>
        <div className="mt-2">
          <label htmlFor="fp-background-opacity" className="text-xs text-text-muted">
            {t("overlay.opacity")} {Math.round(localSettings.background_opacity * 100)}%
          </label>
          <input
            id="fp-background-opacity"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={localSettings.background_opacity}
            onChange={(e) => updateField("background_opacity", Number(e.target.value))}
            className="w-full h-1.5 accent-accent-blue"
          />
        </div>
        <div className="mt-2">
          <label htmlFor="fp-blur" className="text-xs text-text-muted">
            Blur {localSettings.blur}px
          </label>
          <input
            id="fp-blur"
            type="range"
            min={0}
            max={30}
            value={localSettings.blur}
            onChange={(e) => updateField("blur", Number(e.target.value))}
            className="w-full h-1.5 accent-accent-blue"
          />
        </div>
      </div>

      {/* Border radius */}
      <div>
        <label htmlFor="fp-border-radius" className="text-xs text-text-muted">
          {t("overlay.radius")} {localSettings.border_radius}px
        </label>
        <input
          id="fp-border-radius"
          type="range"
          min={0}
          max={60}
          value={localSettings.border_radius}
          onChange={(e) => updateField("border_radius", Number(e.target.value))}
          className="w-full h-1.5 accent-accent-blue"
        />
      </div>

      {/* Border toggle + settings */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={localSettings.show_border}
          onChange={(e) => updateField("show_border", e.target.checked)}
          className="accent-accent-blue"
        />
        <span className="text-xs text-text-secondary">{t("overlay.borderOutline")}</span>
      </label>
      {localSettings.show_border && (
        <div
          className={`space-y-2 pl-1 ${localSettings.hidden ? "opacity-30 pointer-events-none" : ""}`}
        >
          <div>
            <span className="text-xs text-text-muted mb-1 block">
              {t("overlay.borderColor")}
            </span>
            <ColorSwatch
              color={(() => {
                const c = localSettings.border_color;
                if (c?.startsWith("#")) return c;
                return "#ffffff";
              })()}
              label={localSettings.border_color}
              onClick={() =>
                openColorPicker(
                  (() => {
                    const c = localSettings.border_color;
                    if (c?.startsWith("#")) return c;
                    return "#ffffff";
                  })(),
                  (c) => updateField("border_color", c),
                )
              }
            />
          </div>
          <div>
            <label htmlFor="fp-border-width" className="text-xs text-text-muted">
              {t("overlay.borderWidth")} {localSettings.border_width ?? 2}px
            </label>
            <input
              id="fp-border-width"
              type="range"
              min={1}
              max={8}
              step={1}
              value={localSettings.border_width ?? 2}
              onChange={(e) => updateField("border_width", Number(e.target.value))}
              className="w-full h-1.5 accent-accent-blue"
            />
          </div>
        </div>
      )}

      {/* Hidden toggle */}
      <label className="flex items-center gap-2 cursor-pointer pt-1">
        <input
          type="checkbox"
          checked={localSettings.hidden ?? false}
          onChange={(e) => updateField("hidden", e.target.checked)}
          className="accent-accent-blue"
        />
        <span className="text-xs text-text-secondary">{t("overlay.hidden")}</span>
      </label>
    </div>
  );
}
