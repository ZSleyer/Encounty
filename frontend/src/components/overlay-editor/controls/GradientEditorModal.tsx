/** Modal for editing gradient stops (colors + positions) and angle. */

import { useRef, useState, useCallback } from "react";
import { X, Plus } from "lucide-react";
import { NumSlider } from "./NumSlider";
import { ColorSwatch } from "./ColorSwatch";
import { useI18n } from "../../../contexts/I18nContext";
import type { GradientStop } from "../../../types";
import { ModalShell, ModalActions } from "../../shared/ModalShell";

interface GradientEditorModalProps {
  readonly stops: GradientStop[];
  readonly angle: number;
  readonly onConfirm: (stops: GradientStop[], angle: number) => void;
  readonly onClose: () => void;
  readonly onOpenColorPicker: (currentColor: string, onPick: (color: string) => void) => void;
}

/** Interpolate hex color between two hex strings at ratio t (0-1). */
function interpolateColor(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const h = hex.replace("#", "");
    return [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
    ];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const c = (v1: number, v2: number) =>
    Math.round(v1 + (v2 - v1) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

/** Build a CSS linear-gradient string from stops and angle. */
function buildGradientCSS(stops: GradientStop[], angle: number): string {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const parts = sorted.map((s) => `${s.color} ${s.position}%`).join(", ");
  return `linear-gradient(${angle}deg, ${parts})`;
}

/** Compute the color that would appear at `pct` (0-100) along the current stops. */
function colorAtPosition(stops: GradientStop[], pct: number): string {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  let color = "#ffffff";
  if (sorted.length >= 2) {
    const before = [...sorted].reverse().find((s) => s.position <= pct);
    const after = sorted.find((s) => s.position >= pct);
    if (before && after && before !== after) {
      const t = (pct - before.position) / (after.position - before.position);
      color = interpolateColor(before.color, after.color, t);
    } else if (before) {
      color = before.color;
    } else if (after) {
      color = after.color;
    }
  }
  return color;
}

/** Modal dialog for editing a linear gradient: stop colors, positions, and angle. */
export function GradientEditorModal({
  stops: initialStops,
  angle: initialAngle,
  onConfirm,
  onClose,
  onOpenColorPicker,
}: GradientEditorModalProps) {
  const { t } = useI18n();

  const [stops, setStops] = useState<GradientStop[]>(() => {
    const s = initialStops.map((s) => ({ ...s }));
    if (s.length < 2) {
      return [
        { color: "#ffffff", position: 0 },
        { color: "#000000", position: 100 },
      ];
    }
    return s;
  });
  const [angle, setAngle] = useState(initialAngle);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const barRef = useRef<HTMLButtonElement>(null);

  // --- Drag handle logic ---
  const draggingIdx = useRef<number | null>(null);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (draggingIdx.current === null || !barRef.current) return;
      const rect = barRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      setStops((prev) =>
        prev.map((s, i) => (i === draggingIdx.current ? { ...s, position: Math.round(pct) } : s)),
      );
    },
    [],
  );

  const handleMouseUp = useCallback(() => {
    draggingIdx.current = null;
    globalThis.removeEventListener("mousemove", handleMouseMove);
    globalThis.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove]);

  const startDrag = (idx: number) => {
    draggingIdx.current = idx;
    setSelectedIdx(idx);
    globalThis.addEventListener("mousemove", handleMouseMove);
    globalThis.addEventListener("mouseup", handleMouseUp);
  };

  // --- Add stop on bar click ---
  const handleBarClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const color = colorAtPosition(stops, pct);
    setStops((prev) => [...prev, { color, position: Math.round(pct) }]);
  };

  // --- Add stop via keyboard-accessible button (midpoint, interpolated color) ---
  const handleAddStopClick = () => {
    const pct = 50;
    const color = colorAtPosition(stops, pct);
    setStops((prev) => [...prev, { color, position: pct }]);
  };

  const updateStopColor = (idx: number, color: string) => {
    setStops((prev) => prev.map((s, i) => (i === idx ? { ...s, color } : s)));
  };

  const updateStopPosition = (idx: number, pos: number) => {
    setStops((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, position: Math.max(0, Math.min(100, pos)) } : s)),
    );
  };

  const deleteStop = (idx: number) => {
    if (stops.length <= 2) return;
    setStops((prev) => prev.filter((_, i) => i !== idx));
    if (selectedIdx === idx) setSelectedIdx(null);
  };

  return (
    <ModalShell
      title={t("overlay.gradientEditorTitle")}
      onClose={onClose}
      size="sm"
      titleSize="sm"
      footer={(requestClose) => (
        <ModalActions
          onConfirm={() => onConfirm(stops, angle)}
          requestClose={requestClose}
          confirmLabel={t("common.apply")}
        />
      )}
    >
      {/* --- Preview bar --- */}
      <div className="flex items-center gap-2 mb-1">
        <button
          ref={barRef}
          type="button"
          className="w-full h-8 rounded-none cursor-crosshair border-0 p-0"
          style={{ background: buildGradientCSS(stops, angle) }}
          onClick={handleBarClick}
        />
        <button
          type="button"
          title={t("modal.tooltipAddStop")}
          aria-label={t("modal.tooltipAddStop")}
          onClick={handleAddStopClick}
          className="shrink-0 text-text-muted hover:text-text-primary transition-colors relative after:absolute after:-inset-2 after:content-['']"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* --- Stop handles --- */}
      <div className="relative w-full h-5 mb-4">
        {stops.map((stop, idx) => (
          <div
            key={`handle-${stop.color}-${stop.position}-${idx}`}
            role="slider"
            tabIndex={0}
            aria-label={`Stop ${idx + 1}`}
            aria-valuenow={stop.position}
            aria-valuemin={0}
            aria-valuemax={100}
            className={`absolute -translate-x-1/2 top-0 w-3 h-3 rounded-none cursor-grab border-2 ${
              selectedIdx === idx ? "border-accent-blue" : "border-border-subtle"
            }`}
            style={{
              left: `${stop.position}%`,
              backgroundColor: stop.color,
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              startDrag(idx);
            }}
            onKeyDown={(e) => {
              switch (e.key) {
                case "ArrowLeft":
                case "ArrowDown":
                  e.preventDefault();
                  setSelectedIdx(idx);
                  updateStopPosition(idx, stop.position - 1);
                  break;
                case "ArrowRight":
                case "ArrowUp":
                  e.preventDefault();
                  setSelectedIdx(idx);
                  updateStopPosition(idx, stop.position + 1);
                  break;
                default:
                  break;
              }
            }}
          />
        ))}
      </div>

      {/* --- Stop list --- */}
      <div className="space-y-2 mb-4 max-h-40 overflow-y-auto">
        {stops.map((stop, idx) => (
          <div
            key={`stop-${stop.color}-${stop.position}-${idx}`}
            className={`flex items-center gap-2 p-1.5 rounded-none w-full ${
              selectedIdx === idx ? "bg-accent-blue/10" : ""
            }`}
          >
            <ColorSwatch
              color={stop.color}
              className="w-6 h-4 rounded-none cursor-pointer shrink-0"
              onClick={() => {
                setSelectedIdx(idx);
                onOpenColorPicker(stop.color, (c) => updateStopColor(idx, c));
              }}
            />
            <input
              type="number"
              min={0}
              max={100}
              value={stop.position}
              onFocus={() => setSelectedIdx(idx)}
              onChange={(e) => updateStopPosition(idx, Number(e.target.value))}
              className="w-14 bg-bg-primary border border-border-subtle rounded-none px-1.5 py-0.5 text-xs text-text-primary text-center"
            />
            <span className="text-[10px] 2xl:text-xs text-text-muted">%</span>
            {stops.length > 2 && (
              <button
                title={t("modal.tooltipRemoveStop")}
                onClick={() => deleteStop(idx)}
                onFocus={() => setSelectedIdx(idx)}
                className="ml-auto text-text-muted hover:text-accent-red transition-colors"
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* --- Angle --- */}
      <div>
        <NumSlider label={t("overlay.angleDeg")} value={angle} min={0} max={360} onChange={setAngle} />
      </div>
    </ModalShell>
  );
}
