/** Modal for editing text-shadow properties: offset, blur, color, color type, and enable toggle. */

import { useRef, useEffect, useState, useCallback } from "react";
import { X } from "lucide-react";
import { NumSlider } from "./NumSlider";
import { ColorSwatch } from "./ColorSwatch";
import { useI18n } from "../../../contexts/I18nContext";
import type { GradientStop } from "../../../types";

export interface ShadowConfirmParams {
  readonly enabled: boolean;
  readonly color: string;
  readonly colorType: "solid" | "gradient";
  readonly gradientStops: GradientStop[];
  readonly gradientAngle: number;
  readonly blur: number;
  readonly x: number;
  readonly y: number;
}

interface ShadowEditorModalProps {
  readonly enabled: boolean;
  readonly color: string;
  readonly colorType: "solid" | "gradient";
  readonly gradientStops: GradientStop[];
  readonly gradientAngle: number;
  readonly blur: number;
  readonly x: number;
  readonly y: number;
  readonly onConfirm: (params: ShadowConfirmParams) => void;
  readonly onClose: () => void;
  readonly onOpenColorPicker: (currentColor: string, onPick: (color: string) => void) => void;
  readonly onOpenGradientEditor: (stops: GradientStop[], angle: number, onConfirm: (stops: GradientStop[], angle: number) => void) => void;
}

/** Range for XY offset. */
const XY_MIN = -30;
const XY_MAX = 30;
const PAD_SIZE = 120;

export function ShadowEditorModal({
  enabled: initialEnabled,
  color: initialColor,
  colorType: initialColorType,
  gradientStops: initialGradientStops,
  gradientAngle: initialGradientAngle,
  blur: initialBlur,
  x: initialX,
  y: initialY,
  onConfirm,
  onClose,
  onOpenColorPicker,
  onOpenGradientEditor,
}: ShadowEditorModalProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const [enabled, setEnabled] = useState(initialEnabled);
  const [color, setColor] = useState(initialColor);
  const [colorType, setColorType] = useState<"solid" | "gradient">(initialColorType);
  const [gradientStops, setGradientStops] = useState<GradientStop[]>(initialGradientStops);
  const [gradientAngle, setGradientAngle] = useState(initialGradientAngle);
  const [blur, setBlur] = useState(initialBlur);
  const [sx, setSx] = useState(initialX);
  const [sy, setSy] = useState(initialY);

  const padRef = useRef<HTMLDivElement>(null);

  // --- XY pad drag logic ---
  const updateFromEvent = useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!padRef.current) return;
    const rect = padRef.current.getBoundingClientRect();
    const ratioX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ratioY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setSx(Math.round(XY_MIN + ratioX * (XY_MAX - XY_MIN)));
    setSy(Math.round(XY_MIN + ratioY * (XY_MAX - XY_MIN)));
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => updateFromEvent(e),
    [updateFromEvent],
  );

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

  /** Preview color: for gradient, use first stop color (CSS limitation). */
  const previewColor = colorType === "gradient"
    ? (gradientStops[0]?.color ?? "#ffffff")
    : color;

  const shadowCSS = enabled ? `${sx}px ${sy}px ${blur}px ${previewColor}` : "none";

  return (
    <dialog
      ref={dialogRef}
      className="m-auto bg-bg-card border border-border-subtle rounded-2xl p-6 w-full max-w-sm backdrop:bg-black/70"
      onClose={onClose}
    >
      {/* --- Header --- */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs 2xl:text-sm text-text-secondary font-semibold">
          Schatten bearbeiten
        </h2>
        <button title={t("tooltip.common.close")} onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* --- Preview --- */}
      <div className="w-full h-20 rounded-lg bg-bg-primary border border-border-subtle flex items-center justify-center mb-4">
        <span
          className="text-text-primary text-2xl select-none"
          style={{ textShadow: shadowCSS }}
        >
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
        <span className="text-[10px] 2xl:text-xs text-text-muted">Schatten aktiv</span>
      </label>

      {/* --- XY Offset pad --- */}
      <div className="mb-4">
        <p className="text-[10px] 2xl:text-xs text-text-muted mb-1">Offset</p>
        <div className="flex flex-col items-center">
          <div
            ref={padRef}
            className="relative bg-bg-primary border border-border-subtle rounded-lg cursor-crosshair"
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
          </div>
          <p className="text-[10px] 2xl:text-xs text-text-muted mt-1">
            X: {sx} &nbsp; Y: {sy}
          </p>
        </div>
      </div>

      {/* --- Blur --- */}
      <div className="mb-4">
        <NumSlider label="Blur (px)" value={blur} min={0} max={40} onChange={setBlur} />
      </div>

      {/* --- Color type toggle --- */}
      <div className="mb-4">
        <p className="text-[10px] 2xl:text-xs text-text-muted mb-1">Farbtyp</p>
        <div className="flex gap-2">
          {([["solid", "Einfarbig"], ["gradient", "Verlauf"]] as const).map(([val, label]) => (
            <button
              key={val}
              className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                colorType === val
                  ? "bg-accent-blue/20 text-accent-blue"
                  : "border border-border-subtle text-text-muted hover:text-text-primary"
              }`}
              onClick={() => setColorType(val)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* --- Color (when solid) --- */}
      {colorType === "solid" && (
        <div className="mb-5">
          <p className="text-[10px] 2xl:text-xs text-text-muted mb-1">Farbe</p>
          <ColorSwatch
            color={color}
            className="w-6 h-4 rounded cursor-pointer"
            onClick={() => onOpenColorPicker(color, (c) => setColor(c))}
          />
        </div>
      )}

      {/* --- Gradient swatch (when gradient) --- */}
      {colorType === "gradient" && (
        <div className="mb-5">
          <p className="text-[10px] 2xl:text-xs text-text-muted mb-1">Verlauf</p>
          <ColorSwatch
            color={gradientStops[0]?.color ?? "#ffffff"}
            gradient={{ stops: gradientStops, angle: gradientAngle }}
            className="w-6 h-4 rounded cursor-pointer"
            onClick={() =>
              onOpenGradientEditor(gradientStops, gradientAngle, (stops, angle) => {
                setGradientStops(stops);
                setGradientAngle(angle);
              })
            }
          />
        </div>
      )}

      {/* --- Buttons --- */}
      <div className="flex gap-3">
        <button
          title={t("tooltip.common.cancel")}
          className="flex-1 py-2 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:border-text-muted transition-colors text-sm"
          onClick={onClose}
        >
          Abbrechen
        </button>
        <button
          title={t("tooltip.common.apply")}
          className="flex-1 py-2 rounded-lg bg-accent-blue hover:bg-accent-blue/80 text-white font-semibold text-sm transition-colors"
          onClick={() => onConfirm({ enabled, color, colorType, gradientStops, gradientAngle, blur, x: sx, y: sy })}
        >
          Übernehmen
        </button>
      </div>
    </dialog>
  );
}
