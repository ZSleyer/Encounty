/** Clickable color or gradient preview swatch with checkerboard transparency background. */

interface GradientDef {
  stops: { color: string; position: number }[];
  angle: number;
}

interface ColorSwatchProps {
  color: string;
  gradient?: GradientDef;
  label?: string;
  onClick?: () => void;
  className?: string;
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
  onClick,
  className,
}: ColorSwatchProps) {
  const foreground = gradient
    ? `linear-gradient(${gradient.angle}deg, ${gradient.stops
        .map((s) => `${s.color} ${s.position}%`)
        .join(", ")})`
    : color;

  return (
    <button
      type="button"
      title={label || "Farbe bearbeiten"}
      onClick={onClick}
      className={`flex items-center gap-2 group ${className ?? ""}`}
    >
      {/* Swatch container */}
      <span
        className="relative w-6 h-4 rounded border border-border-subtle shrink-0 overflow-hidden"
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

      {/* Optional label + hex code */}
      {label && (
        <span className="text-[10px] 2xl:text-xs text-text-muted group-hover:text-text-primary transition-colors truncate">
          {label}{" "}
          <span className="text-text-secondary">
            {gradient ? "Verlauf" : color}
          </span>
        </span>
      )}
    </button>
  );
}
