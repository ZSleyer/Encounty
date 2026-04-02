/** Modal for editing text outline (stroke) properties: type, color, and width. */

import { useRef, useEffect, useState } from "react";
import { X } from "lucide-react";
import { NumSlider } from "./NumSlider";
import { ColorSwatch } from "./ColorSwatch";
import { useI18n } from "../../../contexts/I18nContext";

interface OutlineEditorModalProps {
  readonly type: "none" | "solid";
  readonly color: string;
  readonly width: number;
  readonly onConfirm: (type: "none" | "solid", color: string, width: number) => void;
  readonly onClose: () => void;
  readonly onOpenColorPicker: (currentColor: string, onPick: (color: string) => void) => void;
}

export function OutlineEditorModal({
  type: initialType,
  color: initialColor,
  width: initialWidth,
  onConfirm,
  onClose,
  onOpenColorPicker,
}: OutlineEditorModalProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const [type, setType] = useState<"none" | "solid">(initialType);
  const [color, setColor] = useState(initialColor);
  const [width, setWidth] = useState(initialWidth);

  const isActive = type !== "none";
  const effectiveWidth = width * 2;

  const solidStroke = isActive
    ? `${effectiveWidth}px ${color}`
    : undefined;

  return (
    <dialog
      ref={dialogRef}
      className="m-auto bg-bg-card border border-border-subtle rounded-2xl p-6 w-full max-w-sm backdrop:bg-black/70"
      onCancel={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* --- Header --- */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs 2xl:text-sm text-text-secondary font-semibold">
          Outline bearbeiten
        </h2>
        <button title={t("tooltip.common.close")} onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* --- Preview --- */}
      <div className="w-full h-20 rounded-lg bg-bg-primary border border-border-subtle flex items-center justify-center mb-4">
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
        <p className="text-[10px] 2xl:text-xs text-text-muted mb-1">Typ</p>
        <div className="flex gap-2">
          {([["none", t("overlay.animNone")], ["solid", t("overlay.colorSolid")]] as const).map(([val, label]) => (
            <button
              key={val}
              className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
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
        <div className="mb-5">
          <p className="text-[10px] 2xl:text-xs text-text-muted mb-1">{t("overlay.color")}</p>
          <ColorSwatch
            color={color}
            className="w-6 h-4 rounded cursor-pointer"
            onClick={() => onOpenColorPicker(color, (c) => setColor(c))}
          />
        </div>
      )}

      {/* --- Buttons --- */}
      <div className="flex gap-3 mt-5">
        <button
          title={t("tooltip.common.cancel")}
          className="flex-1 py-2 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:border-text-muted transition-colors text-sm"
          onClick={onClose}
        >
          {t("tooltip.common.cancel")}
        </button>
        <button
          title={t("tooltip.common.apply")}
          className="flex-1 py-2 rounded-lg bg-accent-blue hover:bg-accent-blue/80 text-white font-semibold text-sm transition-colors"
          onClick={() => onConfirm(type, color, width)}
        >
          {t("tooltip.common.apply")}
        </button>
      </div>
    </dialog>
  );
}
