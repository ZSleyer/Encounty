/** Modal for editing the text outline (stroke): type, width, color or gradient. */

import { useState } from "react";
import { NumSlider } from "./NumSlider";
import { ColorSwatch } from "./ColorSwatch";
import { useI18n } from "../../../contexts/I18nContext";
import type { GradientStop } from "../../../types";
import { ModalShell, ModalActions } from "../../shared/ModalShell";
import {
  buildFillPaint,
  buildOutlinePaint,
  effectiveOutlineWidth,
  outlinePadding,
  type OutlineStyleFields,
} from "../../../utils/textStyle";

/** The three outline modes an element can be set to. */
export type OutlineType = "none" | "solid" | "gradient";

interface OutlineEditorModalProps {
  readonly type: OutlineType;
  readonly color: string;
  readonly width: number;
  readonly gradientStops: GradientStop[];
  readonly gradientAngle: number;
  readonly onConfirm: (
    type: OutlineType,
    color: string,
    width: number,
    gradientStops: GradientStop[],
    gradientAngle: number,
  ) => void;
  readonly onClose: () => void;
  readonly onOpenColorPicker: (currentColor: string, onPick: (color: string) => void) => void;
  readonly onOpenGradientEditor: (
    stops: GradientStop[],
    angle: number,
    onConfirm: (stops: GradientStop[], angle: number) => void,
  ) => void;
}

/** Font size of the preview glyphs, in px. */
const PREVIEW_FONT_SIZE = 32;

/** Height the preview box has before the stroke padding is added, in px. */
const PREVIEW_MIN_HEIGHT = 80;

/** Modal dialog for editing text outline: stroke type, width, and color. */
export function OutlineEditorModal({
  type: initialType,
  color: initialColor,
  width: initialWidth,
  gradientStops: initialGradientStops,
  gradientAngle: initialGradientAngle,
  onConfirm,
  onClose,
  onOpenColorPicker,
  onOpenGradientEditor,
}: OutlineEditorModalProps) {
  const { t } = useI18n();

  const [type, setType] = useState<OutlineType>(initialType);
  const [color, setColor] = useState(initialColor);
  const [width, setWidth] = useState(initialWidth);
  const [gradientStops, setGradientStops] = useState<GradientStop[]>(initialGradientStops);
  const [gradientAngle, setGradientAngle] = useState(initialGradientAngle);

  const isActive = type !== "none";

  // The preview is built from the same CSS builders the overlay renderer uses,
  // so what the dialog shows cannot drift away from what OBS ends up painting.
  const outlineFields: OutlineStyleFields = {
    outline_type: type,
    outline_width: width,
    outline_color: color,
    outline_gradient_stops: gradientStops,
    outline_gradient_angle: gradientAngle,
  };
  const strokeWidth = effectiveOutlineWidth(outlineFields);
  // Reserving the stroke's own room keeps a thick outline from being cut off at
  // the top and bottom of the preview box.
  const pad = outlinePadding(outlineFields);
  const fillPaint = buildFillPaint({
    color_type: "solid",
    color: "#ffffff",
    gradient_stops: [],
    gradient_angle: 0,
  });

  return (
    <ModalShell
      title={t("overlay.outlineEditorTitle")}
      onClose={onClose}
      size="sm"
      titleSize="sm"
      footer={(requestClose) => (
        <ModalActions
          onConfirm={() => onConfirm(type, color, width, gradientStops, gradientAngle)}
          requestClose={requestClose}
          confirmLabel={t("common.apply")}
        />
      )}
    >
      {/* --- Preview --- */}
      <div
        className="canvas-checkered w-full rounded-none border border-border-subtle flex items-center justify-center mb-4"
        style={{ minHeight: PREVIEW_MIN_HEIGHT, paddingTop: pad, paddingBottom: pad }}
      >
        {strokeWidth === 0 ? (
          <span className="select-none" style={{ fontSize: PREVIEW_FONT_SIZE, ...fillPaint }}>
            Abc
          </span>
        ) : (
          <span
            className="select-none"
            style={{ position: "relative", display: "inline-block", fontSize: PREVIEW_FONT_SIZE }}
          >
            <span style={{ ...buildOutlinePaint(outlineFields, strokeWidth), display: "block" }}>
              Abc
            </span>
            {/* The stroke layer already carries the text, so the fill copy stays
                out of the accessibility tree. */}
            <span
              aria-hidden="true"
              style={{ ...fillPaint, position: "absolute", left: 0, top: 0, right: 0 }}
            >
              Abc
            </span>
          </span>
        )}
      </div>

      {/* --- Type toggle --- */}
      <div className="mb-4">
        <p className="text-[10px] 2xl:text-xs text-text-muted mb-1">{t("overlay.type")}</p>
        <div className="flex gap-2">
          {(
            [
              ["none", t("overlay.animNone")],
              ["solid", t("overlay.outlineSolid")],
              ["gradient", t("overlay.gradient")],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              className={`flex-1 py-1.5 rounded-none text-sm font-medium transition-colors ${
                type === val
                  ? "bg-accent-blue/20 text-accent-blue"
                  : "border border-border-subtle text-text-muted hover:text-text-primary"
              }`}
              aria-pressed={type === val}
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
          <NumSlider
            label={t("overlay.widthPx")}
            value={width}
            min={1}
            max={20}
            onChange={setWidth}
          />
        </div>
      )}

      {/* --- Color (when solid) --- */}
      {type === "solid" && (
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
      {type === "gradient" && (
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
