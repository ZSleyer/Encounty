/**
 * ReplayTimeline — Scrubbar over frozen replay buffer frames for template creation.
 *
 * Shows a slider for frame navigation, the current frame as an image,
 * and buttons to use the current frame as a template or close the timeline.
 */
import { useEffect, useCallback, useRef } from "react";
import { X, Check } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";

// ── Props ────────────────────────────────────────────────────────────────────

interface ReplayTimelineProps {
  frameCount: number;
  durationSec: number;
  currentIndex: number;
  currentFrameUrl: string | null;
  onSeek: (index: number) => void;
  onUseAsTemplate: () => void;
  onClose: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a frame index to a human-readable timestamp (e.g. "2.5s"). */
function formatTimestamp(index: number, frameCount: number, durationSec: number): string {
  if (frameCount <= 1) return "0.0s";
  const seconds = (index / (frameCount - 1)) * durationSec;
  return `${seconds.toFixed(1)}s`;
}

// ── Component ────────────────────────────────────────────────────────────────

/** ReplayTimeline displays a scrubbar over frozen replay frames for template selection. */
export function ReplayTimeline({
  frameCount,
  durationSec,
  currentIndex,
  currentFrameUrl,
  onSeek,
  onUseAsTemplate,
  onClose,
}: Readonly<ReplayTimelineProps>) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Keyboard navigation ──────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const step = e.shiftKey ? 5 : 1;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onSeek(currentIndex - step);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onSeek(currentIndex + step);
      }
    },
    [currentIndex, onSeek],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("keydown", handleKeyDown);
    return () => el.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Auto-focus the container so keyboard events work immediately
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  const frameLabel = t("detector.frameOf")
    .replace("{current}", String(currentIndex + 1))
    .replace("{total}", String(frameCount));
  const timestamp = formatTimestamp(currentIndex, frameCount, durationSec);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="bg-bg-card border border-border-subtle rounded-xl shadow-sm p-4 space-y-3 outline-none"
    >
      {/* ── Frame preview ─────────────────────────────────────────────────── */}
      <div className="relative rounded-lg overflow-hidden bg-bg-primary aspect-video flex items-center justify-center">
        {currentFrameUrl ? (
          <img
            src={currentFrameUrl}
            alt={frameLabel}
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <div className="text-xs text-text-muted animate-pulse">
            Loading...
          </div>
        )}
      </div>

      {/* ── Slider ────────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <input
          type="range"
          min={0}
          max={Math.max(frameCount - 1, 0)}
          value={currentIndex}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="w-full accent-accent-blue h-1.5 cursor-pointer"
        />
        <div className="flex items-center justify-between text-[11px] text-text-muted font-mono">
          <span>{frameLabel}</span>
          <span>{timestamp}</span>
        </div>
      </div>

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-faint">
          {t("detector.timelineHint")}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onUseAsTemplate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent-blue text-white hover:bg-accent-blue/90 transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            {t("detector.useAsTemplate")}
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-bg-primary border border-border-subtle text-text-muted hover:text-text-primary hover:border-red-500/30 transition-colors"
            title={t("detector.closeTimeline")}
          >
            <X className="w-3.5 h-3.5" />
            {t("detector.closeTimeline")}
          </button>
        </div>
      </div>
    </div>
  );
}
