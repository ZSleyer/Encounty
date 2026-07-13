/** Modal for editing text color: solid color or gradient fill. */

import { useState } from "react";
import { ColorSwatch } from "./ColorSwatch";
import { useI18n } from "../../../contexts/I18nContext";
import type { GradientStop } from "../../../types";
import { ModalShell, ModalActions } from "../../shared/ModalShell";

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

/** Modal dialog for editing text fill: solid color or gradient. */
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

  const [colorType, setColorType] = useState<"solid" | "gradient">(initialColorType);
  const [color, setColor] = useState(initialColor);
  const [gradientStops, setGradientStops] = useState<GradientStop[]>(initialGradientStops);
  const [gradientAngle, setGradientAngle] = useState(initialGradientAngle);

  /** Preview style: gradient uses background-clip text, solid uses plain color. */
  const gradientCssStops = gradientStops.map(s => `${s.color} ${s.position}%`).join(", ");
  const previewStyle: React.CSSProperties = colorType === "gradient" && gradientStops.length >= 2
    ? {
        background: `linear-gradient(${gradientAngle}deg, ${gradientCssStops})`,
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
      }
    : { color: color };

  return (
    <ModalShell
      title={t("overlay.textColorEditorTitle")}
      onClose={onClose}
      size="sm"
      titleSize="sm"
      footer={(requestClose) => (
        <ModalActions
          onConfirm={() => onConfirm(colorType, color, gradientStops, gradientAngle)}
          requestClose={requestClose}
          confirmLabel={t("common.apply")}
        />
      )}
    >
      {/* --- Preview --- */}
      <div className="w-full h-20 rounded-none bg-bg-primary border border-border-subtle flex items-center justify-center mb-4">
        <span
          className="text-white text-[32px] select-none"
          style={previewStyle}
        >
          Abc
        </span>
      </div>

      {/* --- Type toggle --- */}
      <div className="mb-4">
        <p className="text-[10px] 2xl:text-xs text-text-muted mb-1">{t("overlay.type")}</p>
        <div className="flex gap-2">
          {([["solid", t("overlay.outlineSolid")], ["gradient", t("overlay.gradient")]] as const).map(([val, label]) => (
            <button
              key={val}
              className={`flex-1 py-1.5 rounded-none text-sm font-medium transition-colors ${
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
        <div>
          <p className="text-[10px] 2xl:text-xs text-text-muted mb-1">{t("overlay.color")}</p>
          <ColorSwatch
            color={color}
            className="w-6 h-4 rounded-none cursor-pointer"
            onClick={() => onOpenColorPicker(color, (c) => setColor(c))}
          />
        </div>
      )}

      {/* --- Gradient swatch (when gradient) --- */}
      {colorType === "gradient" && (
        <div>
          <p className="text-[10px] 2xl:text-xs text-text-muted mb-1">{t("overlay.gradient")}</p>
          <ColorSwatch
            color={gradientStops[0]?.color ?? "#ffffff"}
            gradient={{ stops: gradientStops, angle: gradientAngle }}
            className="w-6 h-4 rounded-none cursor-pointer"
            onClick={() =>
              onOpenGradientEditor(gradientStops, gradientAngle, (stops, angle) => {
                setGradientStops(stops);
                setGradientAngle(angle);
              })
            }
          />
        </div>
      )}
    </ModalShell>
  );
}
