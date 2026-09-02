/** Clickable color or gradient preview swatch with checkerboard transparency background. */

import { useI18n } from "../../../contexts/I18nContext";

interface GradientDef {
  stops: { color: string; position: number }[];
  angle: number;
}

interface ColorSwatchProps {
  readonly color: string;
  readonly gradient?: GradientDef;
  /** Primary text of the row, e.g. "Outline 3px". */
  readonly label?: string;
  /**
   * Secondary muted text after the label. Defaults to the hex code, or to the
   * word for a gradient when one is previewed. Pass "" to drop it entirely.
   */
  readonly detail?: string;
  readonly onClick?: () => void;
  readonly className?: string;
}

/** Checkerboard pattern for transparency indication (8px tiles). */
const checkerboardBg =
  "linear-gradient(45deg, #808080 25%, transparent 25%), " +
  "linear-gradient(-45deg, #808080 25%, transparent 25%), " +
  "linear-gradient(45deg, transparent 75%, #808080 75%), " +
  "linear-gradient(-45deg, transparent 75%, #808080 75%)";

/** Small rectangular swatch showing a color or gradient preview. */
export function ColorSwatch({
  color,
  gradient,
  label,
  detail,
  onClick,
  className,
}: ColorSwatchProps) {
  const { t } = useI18n();
  const foreground = gradient
    ? `linear-gradient(${gradient.angle}deg, ${gradient.stops
        .map((s) => `${s.color} ${s.position}%`)
        .join(", ")})`
    : color;

  // The hex is deliberately secondary: the swatch itself is the answer to
  // "what color is this", the code is only there for people who need it.
  const detailText = detail ?? (gradient ? t("overlay.gradient") : color);
  const title = label ? [label, detailText].filter(Boolean).join(" ") : t("modal.tooltipColorEdit");

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex items-center gap-2 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue ${className ?? ""}`}
    >
      {/* Swatch container */}
      <span
        className="relative w-6 h-4 rounded-none border border-border-subtle shrink-0 overflow-hidden"
        style={{
          background: checkerboardBg,
          backgroundSize: "8px 8px",
          backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0px",
        }}
      >
        <span
          className="absolute inset-0"
          style={{
            background: foreground,
          }}
        />
      </span>

      {/* Optional label with the hex code as muted secondary text */}
      {label && (
        <span className="text-[10px] 2xl:text-xs text-text-muted group-hover:text-text-primary transition-colors truncate">
          {label}
          {detailText && (
            <>
              {" "}
              <span className="text-text-faint">{detailText}</span>
            </>
          )}
        </span>
      )}
    </button>
  );
}
