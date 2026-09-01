/**
 * Modal for editing text-shadow properties: offset, blur, colour and the enable
 * toggle. CSS `text-shadow` paints a single colour, so the shadow deliberately
 * offers no gradient.
 */

import { useRef, useState, useCallback } from "react";
import { NumSlider } from "./NumSlider";
import { ColorSwatch } from "./ColorSwatch";
import { useI18n } from "../../../contexts/I18nContext";
import { ModalShell, ModalActions } from "../../shared/ModalShell";

/** Result payload passed to onConfirm when the shadow settings are applied. */
export interface ShadowConfirmParams {
  readonly enabled: boolean;
  readonly color: string;
  readonly blur: number;
  readonly x: number;
  readonly y: number;
}

interface ShadowEditorModalProps {
  readonly enabled: boolean;
  readonly color: string;
  readonly blur: number;
  readonly x: number;
  readonly y: number;
  readonly onConfirm: (params: ShadowConfirmParams) => void;
  readonly onClose: () => void;
  readonly onOpenColorPicker: (currentColor: string, onPick: (color: string) => void) => void;
}

/** Range for XY offset. */
const XY_MIN = -30;
const XY_MAX = 30;
const PAD_SIZE = 120;

/** Modal dialog for editing text-shadow: enable toggle, XY offset, blur, and colour. */
export function ShadowEditorModal({
  enabled: initialEnabled,
  color: initialColor,
  blur: initialBlur,
  x: initialX,
  y: initialY,
  onConfirm,
  onClose,
  onOpenColorPicker,
}: ShadowEditorModalProps) {
  const { t } = useI18n();

  const [enabled, setEnabled] = useState(initialEnabled);
  const [color, setColor] = useState(initialColor);
  const [blur, setBlur] = useState(initialBlur);
  const [sx, setSx] = useState(initialX);
  const [sy, setSy] = useState(initialY);

  const padRef = useRef<HTMLButtonElement>(null);

  // --- XY pad drag logic ---
  const updateFromEvent = useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!padRef.current) return;
    const rect = padRef.current.getBoundingClientRect();
    const ratioX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ratioY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setSx(Math.round(XY_MIN + ratioX * (XY_MAX - XY_MIN)));
    setSy(Math.round(XY_MIN + ratioY * (XY_MAX - XY_MIN)));
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => updateFromEvent(e), [updateFromEvent]);

  const handleMouseUp = useCallback(() => {
    globalThis.removeEventListener("mousemove", handleMouseMove);
    globalThis.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove]);

  const startPadDrag = (e: React.MouseEvent) => {
    updateFromEvent(e);
    globalThis.addEventListener("mousemove", handleMouseMove);
    globalThis.addEventListener("mouseup", handleMouseUp);
  };

  /** Map value from range to pixel position inside the pad. */
  const toPixel = (val: number) => ((val - XY_MIN) / (XY_MAX - XY_MIN)) * PAD_SIZE;

  const shadowCSS = enabled ? `${sx}px ${sy}px ${blur}px ${color}` : "none";

  return (
    <ModalShell
      title={t("overlay.shadowEditorTitle")}
      onClose={onClose}
      size="sm"
      titleSize="sm"
      footer={(requestClose) => (
        <ModalActions
          onConfirm={() => onConfirm({ enabled, color, blur, x: sx, y: sy })}
          requestClose={requestClose}
          confirmLabel={t("common.apply")}
        />
      )}
    >
      {/* --- Preview --- */}
      <div className="w-full h-20 rounded-none bg-bg-primary border border-border-subtle flex items-center justify-center mb-4">
        <span className="text-text-primary text-2xl select-none" style={{ textShadow: shadowCSS }}>
          Abc
        </span>
      </div>

      {/* --- Enable checkbox --- */}
      <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="accent-accent-blue w-4 h-4"
        />
        <span className="text-[10px] 2xl:text-xs text-text-muted">
          {t("overlay.shadowEnabled")}
        </span>
      </label>

      {/* --- XY Offset pad --- */}
      <div className="mb-4">
        <p className="text-[10px] 2xl:text-xs text-text-muted mb-1">{t("overlay.shadowOffset")}</p>
        <div className="flex flex-col items-center">
          <button
            type="button"
            ref={padRef}
            aria-label={t("aria.shadowOffsetPicker")}
            className="appearance-none p-0 m-0 block relative bg-bg-primary border border-border-subtle rounded-none cursor-crosshair"
            style={{ width: PAD_SIZE, height: PAD_SIZE }}
            onMouseDown={startPadDrag}
          >
            {/* Crosshair lines */}
            <div
              className="absolute top-0 bottom-0 left-1/2 w-px bg-text-muted/30"
              style={{ transform: "translateX(-0.5px)" }}
            />
            <div
              className="absolute left-0 right-0 top-1/2 h-px bg-text-muted/30"
              style={{ transform: "translateY(-0.5px)" }}
            />
            {/* Indicator */}
            <div
              className="absolute w-2.5 h-2.5 rounded-full bg-accent-blue border-2 border-white"
              style={{
                left: toPixel(sx),
                top: toPixel(sy),
                transform: "translate(-50%, -50%)",
              }}
            />
          </button>
          <p className="text-[10px] 2xl:text-xs text-text-muted mt-1">
            X: {sx} &nbsp; Y: {sy}
          </p>
        </div>
      </div>

      {/* --- Blur --- */}
      <div className="mb-4">
        <NumSlider label={t("overlay.blurPx")} value={blur} min={0} max={40} onChange={setBlur} />
      </div>

      {/* --- Colour --- */}
      <div>
        <p className="text-[10px] 2xl:text-xs text-text-muted mb-1">{t("overlay.color")}</p>
        <ColorSwatch
          color={color}
          className="w-6 h-4 rounded-none cursor-pointer"
          onClick={() => onOpenColorPicker(color, (c) => setColor(c))}
        />
      </div>
    </ModalShell>
  );
}
