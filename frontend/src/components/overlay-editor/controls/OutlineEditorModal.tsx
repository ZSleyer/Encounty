/** Modal for editing text outline (stroke) properties: type, color, and width. */

import { useState } from "react";
import { NumSlider } from "./NumSlider";
import { ColorSwatch } from "./ColorSwatch";
import { useI18n } from "../../../contexts/I18nContext";
import { ModalShell, ModalActions } from "../../shared/ModalShell";

interface OutlineEditorModalProps {
  readonly type: "none" | "solid";
  readonly color: string;
  readonly width: number;
  readonly onConfirm: (type: "none" | "solid", color: string, width: number) => void;
  readonly onClose: () => void;
  readonly onOpenColorPicker: (currentColor: string, onPick: (color: string) => void) => void;
}

/** Modal dialog for editing text outline: stroke type, width, and color. */
export function OutlineEditorModal({
  type: initialType,
  color: initialColor,
  width: initialWidth,
  onConfirm,
  onClose,
  onOpenColorPicker,
}: OutlineEditorModalProps) {
  const { t } = useI18n();

  const [type, setType] = useState<"none" | "solid">(initialType);
  const [color, setColor] = useState(initialColor);
  const [width, setWidth] = useState(initialWidth);

  const isActive = type !== "none";
  const effectiveWidth = width * 2;

  const solidStroke = isActive
    ? `${effectiveWidth}px ${color}`
    : undefined;

  return (
    <ModalShell
      title={t("overlay.outlineEditorTitle")}
      onClose={onClose}
      size="sm"
      titleSize="sm"
      footer={(requestClose) => (
        <ModalActions
          onConfirm={() => onConfirm(type, color, width)}
          requestClose={requestClose}
          confirmLabel={t("common.apply")}
        />
      )}
    >
      {/* --- Preview --- */}
      <div className="canvas-checkered w-full h-20 rounded-none border border-border-subtle flex items-center justify-center mb-4">
        <span
          className="text-white text-[32px] select-none"
          style={{
            WebkitTextStroke: solidStroke,
            paintOrder: solidStroke ? "stroke fill" : undefined,
          }}
        >
          Abc
        </span>
      </div>

      {/* --- Type toggle --- */}
      <div className="mb-4">
        <p className="text-[10px] 2xl:text-xs text-text-muted mb-1">{t("overlay.type")}</p>
        <div className="flex gap-2">
          {([["none", t("overlay.animNone")], ["solid", t("overlay.colorSolid")]] as const).map(([val, label]) => (
            <button
              key={val}
              className={`flex-1 py-1.5 rounded-none text-sm font-medium transition-colors ${
                type === val
                  ? "bg-accent-blue/20 text-accent-blue"
                  : "border border-border-subtle text-text-muted hover:text-text-primary"
              }`}
              onClick={() => setType(val)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* --- Width (when active) --- */}
      {isActive && (
        <div className="mb-4">
          <NumSlider label={t("overlay.widthPx")} value={width} min={1} max={20} onChange={setWidth} />
        </div>
      )}

      {/* --- Color (when solid) --- */}
      {isActive && (
        <div>
          <p className="text-[10px] 2xl:text-xs text-text-muted mb-1">{t("overlay.color")}</p>
          <ColorSwatch
            color={color}
            className="w-6 h-4 rounded-none cursor-pointer"
            onClick={() => onOpenColorPicker(color, (c) => setColor(c))}
          />
        </div>
      )}
    </ModalShell>
  );
}
