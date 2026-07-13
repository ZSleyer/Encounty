/**
 * TagChip.tsx — Small coloured pill displaying a user-defined tag string.
 *
 * The hue is derived deterministically from the tag text via a lightweight
 * hash so that the same tag always renders with the same colour across the
 * app without needing explicit user-configured colours per tag.
 */
import { X } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";

/**
 * Deterministic hue (0–359) derived from the tag string. Uses a fast
 * djb2-style hash so small changes still produce different colours but
 * identical strings always produce the same hue.
 */
function hueForTag(tag: string): number {
  let hash = 5381;
  for (let i = 0; i < tag.length; i++) {
    // Multiply-add mixes the characters into the hash.
    hash = (hash * 33) ^ tag.charCodeAt(i);
  }
  // Unsigned 32-bit to keep modulo positive.
  return Math.abs(hash) % 360;
}

interface TagChipProps {
  readonly tag: string;
  readonly active?: boolean;
  readonly size?: "sm" | "md";
  readonly onClick?: () => void;
  readonly removable?: boolean;
  readonly onRemove?: () => void;
}

/**
 * Renders a single tag pill. Clickable when onClick is set (filter toggle),
 * removable when onRemove is set (inline edit lists). Supports keyboard
 * activation (Enter/Space) when clickable.
 */
export function TagChip({
  tag,
  active = false,
  size = "sm",
  onClick,
  removable = false,
  onRemove,
}: TagChipProps) {
  const { t } = useI18n();
  const hue = hueForTag(tag);
  // Use HSL so we can derive a consistent pair (bg + border + text) from a
  // single hue. Dark keeps the original light pastel text on a soft tint;
  // light uses a much darker, more saturated text on a lighter tint so the
  // worst-case hue (yellow-green, ~60°) still clears WCAG AA (verified >=5:1).
  const bgActive = `light-dark(hsla(${hue}, 55%, 70%, 0.2), hsla(${hue}, 70%, 55%, 0.25))`;
  const bgIdle = `light-dark(hsla(${hue}, 45%, 40%, 0.12), hsla(${hue}, 40%, 45%, 0.18))`;
  const ringColor = `hsla(${hue}, 70%, 65%, 0.7)`;
  const textColor = `light-dark(hsl(${hue}, 90%, 22%), hsl(${hue}, 80%, 78%))`;

  const paddingClass = size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]";
  // Guarantee WCAG minimum target size (24×24) for clickable/removable chips.
  const minHeightClass = onClick || removable ? "min-h-[24px]" : "";

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!onClick) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  };

  const style: React.CSSProperties = {
    backgroundColor: active ? bgActive : bgIdle,
    color: textColor,
    boxShadow: active ? `inset 0 0 0 1px ${ringColor}` : "none",
  };

  const commonProps = {
    "data-testid": "tag-chip",
    "data-active": active ? "true" : "false",
    style,
    className: `inline-flex items-center gap-1 rounded-none font-medium leading-none whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue ${paddingClass} ${minHeightClass}`,
  };

  const label = `#${tag}`;

  // Removable + click: render as a group so the X button is a sibling button,
  // never nested inside another button (valid HTML + accessibility).
  if (removable) {
    return (
      <span {...commonProps} style={{ ...style, paddingRight: "0.25rem" }}>
        {onClick ? (
          <button
            type="button"
            onClick={onClick}
            onKeyDown={handleKeyDown}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue rounded-none"
            aria-pressed={active}
          >
            {label}
          </button>
        ) : (
          <span>{label}</span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
          className="p-0.5 rounded-none hover:bg-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
          aria-label={t("tag.remove", { tag })}
        >
          <X className="w-3 h-3" />
        </button>
      </span>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        onKeyDown={handleKeyDown}
        aria-pressed={active}
        {...commonProps}
      >
        {label}
      </button>
    );
  }

  return <span {...commonProps}>{label}</span>;
}
