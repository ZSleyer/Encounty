/** Modal for editing gradient stops (colors + positions) and angle. */

import { useRef, useEffect, useState, useCallback } from "react";
import { X } from "lucide-react";
import { NumSlider } from "./NumSlider";
import { ColorSwatch } from "./ColorSwatch";
import { useI18n } from "../../contexts/I18nContext";
import type { GradientStop } from "../../types";

interface GradientEditorModalProps {
  stops: GradientStop[];
  angle: number;
  onConfirm: (stops: GradientStop[], angle: number) => void;
  onClose: () => void;
  onOpenColorPicker: (currentColor: string, onPick: (color: string) => void) => void;
}

/** Interpolate hex color between two hex strings at ratio t (0-1). */
function interpolateColor(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const h = hex.replace("#", "");
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
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

export function GradientEditorModal({
  stops: initialStops,
  angle: initialAngle,
  onConfirm,
  onClose,
  onOpenColorPicker,
}: GradientEditorModalProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

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

  const barRef = useRef<HTMLDivElement>(null);

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
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove]);

  const startDrag = (idx: number) => {
    draggingIdx.current = idx;
    setSelectedIdx(idx);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // --- Add stop on bar click ---
  const handleBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
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
    setStops((prev) => [...prev, { color, position: Math.round(pct) }]);
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
    <dialog
      ref={dialogRef}
      className="m-auto bg-bg-card border border-border-subtle rounded-2xl p-6 w-full max-w-sm backdrop:bg-black/70"
      onClose={onClose}
    >
      {/* --- Header --- */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs 2xl:text-sm text-text-secondary font-semibold">
          Gradient bearbeiten
        </h2>
        <button title={t("tooltip.common.close")} onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* --- Preview bar --- */}
      <div
        ref={barRef}
        className="w-full h-8 rounded-lg cursor-crosshair mb-1"
        style={{ background: buildGradientCSS(stops, angle) }}
        onClick={handleBarClick}
      />

      {/* --- Stop handles --- */}
      <div className="relative w-full h-5 mb-4">
        {stops.map((stop, idx) => (
          <div
            key={idx}
            className={`absolute -translate-x-1/2 top-0 w-3 h-3 rounded-full cursor-grab border-2 ${
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
          />
        ))}
      </div>

      {/* --- Stop list --- */}
      <div className="space-y-2 mb-4 max-h-40 overflow-y-auto">
        {stops.map((stop, idx) => (
          <div
            key={idx}
            className={`flex items-center gap-2 p-1.5 rounded-lg ${
              selectedIdx === idx ? "bg-accent-blue/10" : ""
            }`}
            onClick={() => setSelectedIdx(idx)}
          >
            <ColorSwatch
              color={stop.color}
              className="w-6 h-4 rounded cursor-pointer shrink-0"
              onClick={() =>
                onOpenColorPicker(stop.color, (c) => updateStopColor(idx, c))
              }
            />
            <input
              type="number"
              min={0}
              max={100}
              value={stop.position}
              onChange={(e) => updateStopPosition(idx, Number(e.target.value))}
              className="w-14 bg-bg-primary border border-border-subtle rounded px-1.5 py-0.5 text-xs text-text-primary text-center"
            />
            <span className="text-[10px] 2xl:text-xs text-text-muted">%</span>
            {stops.length > 2 && (
              <button
                title={t("modal.tooltipRemoveStop")}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteStop(idx);
                }}
                className="ml-auto text-text-muted hover:text-red-400 transition-colors"
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* --- Angle --- */}
      <div className="mb-5">
        <NumSlider label="Winkel (°)" value={angle} min={0} max={360} onChange={setAngle} />
      </div>

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
          onClick={() => onConfirm(stops, angle)}
        >
          Übernehmen
        </button>
      </div>
    </dialog>
  );
}
