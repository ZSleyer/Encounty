/**
 * FloatingPropertiesPanel — A draggable floating panel that delegates to
 * OverlayPropertyPanel for element and canvas properties.
 */

import type { ReactNode } from "react";
import { GripVertical, X } from "lucide-react";
import { OverlayPropertyPanel } from "./OverlayPropertyPanel";
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
    <dialog
      open
      aria-label={t("aria.properties")}
      style={{ position: "fixed", left: position.x, top: position.y, zIndex: 50 }}
      className="w-72 bg-bg-secondary rounded-xl border border-border-subtle shadow-2xl flex flex-col max-h-[75vh] p-0 m-0"
      data-tutorial="properties"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {/* Title bar — draggable */}
      <div
        role="toolbar"
        tabIndex={0}
        onMouseDown={onDragStart}
        onKeyDown={(e) => e.stopPropagation()}
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
    </dialog>
  );
}