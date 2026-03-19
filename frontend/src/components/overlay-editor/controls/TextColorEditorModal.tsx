/** Modal for editing text color: solid color or gradient fill. */

import { useRef, useEffect, useState } from "react";
import { X } from "lucide-react";
import { ColorSwatch } from "./ColorSwatch";
import { useI18n } from "../../../contexts/I18nContext";
import type { GradientStop } from "../../../types";

interface TextColorEditorModalProps {
  readonly colorType: "solid" | "gradient";
  readonly color: string;
  readonly gradientStops: GradientStop[];
  readonly gradientAngle: number;
  readonly onConfirm: (colorType: "solid" | "gradient", color: string, gradientStops: GradientStop[], gradientAngle: number) => void;
  readonly onClose: () => void;
  readonly onOpenColorPicker: (currentColor: string, onPick: (color: string) => void) => void;
  readonly onOpenGradientEditor: (stops: GradientStop[], angle: number, onConfirm: (stops: GradientStop[], angle: number) => void) => void;
}

export function TextColorEditorModal({
  colorType: initialColorType,
  color: initialColor,
  gradientStops: initialGradientStops,
  gradientAngle: initialGradientAngle,
  onConfirm,
  onClose,
  onOpenColorPicker,
  onOpenGradientEditor,
}: TextColorEditorModalProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const [colorType, setColorType] = useState<"solid" | "gradient">(initialColorType);
  const [color, setColor] = useState(initialColor);
  const [gradientStops, setGradientStops] = useState<GradientStop[]>(initialGradientStops);
  const [gradientAngle, setGradientAngle] = useState(initialGradientAngle);

  /** Preview style: gradient uses background-clip text, solid uses plain color. */
  const previewStyle: React.CSSProperties = colorType === "gradient" && gradientStops.length >= 2
    ? {
        background: `linear-gradient(${gradientAngle}deg, ${gradientStops.map(s => `${s.color} ${s.position}%`).join(", ")})`,
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
      }
    : { color: color };

  return (
    <dialog
      ref={dialogRef}
      className="m-auto bg-bg-card border border-border-subtle rounded-2xl p-6 w-full max-w-sm backdrop:bg-black/70"
      onClose={onClose}
    >
      {/* --- Header --- */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs 2xl:text-sm text-text-secondary font-semibold">
          Textfarbe bearbeiten
        </h2>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors" title={t("tooltip.common.close")}>
          <X size={16} />
        </button>
      </div>

      {/* --- Preview --- */}
      <div className="w-full h-20 rounded-lg bg-bg-primary border border-border-subtle flex items-center justify-center mb-4">
        <span
          className="text-white text-[32px] select-none"
          style={previewStyle}
        >
          Abc
        </span>
      </div>

      {/* --- Type toggle --- */}
      <div className="mb-4">
        <p className="text-[10px] 2xl:text-xs text-text-muted mb-1">Typ</p>
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
      <div className="flex gap-3 mt-5">
        <button
          className="flex-1 py-2 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:border-text-muted transition-colors text-sm"
          onClick={onClose}
          title={t("tooltip.common.cancel")}
        >
          Abbrechen
        </button>
        <button
          className="flex-1 py-2 rounded-lg bg-accent-blue hover:bg-accent-blue/80 text-white font-semibold text-sm transition-colors"
          onClick={() => onConfirm(colorType, color, gradientStops, gradientAngle)}
          title={t("tooltip.common.apply")}
        >
          Übernehmen
        </button>
      </div>
    </dialog>
  );
}
