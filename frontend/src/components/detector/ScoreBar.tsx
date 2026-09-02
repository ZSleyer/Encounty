/**
 * ScoreBar.tsx -- Horizontal score bar with the precision threshold marker.
 */
import { DEFAULT_PRECISION } from "../../engine/detectorDefaults";
import { formatPercent } from "../../utils/format";

/** Score bar with precision threshold marker. */
export function ScoreBar({
  label,
  score,
  precision,
  precisionLabel,
}: Readonly<{
  label: string;
  score: number;
  precision?: number;
  precisionLabel?: string;
}>) {
  const threshold = precision ?? DEFAULT_PRECISION;
  const isMatch = score >= threshold;
  const pct = formatPercent(score, 0);
  const thresholdPct = formatPercent(threshold, 0);
  return (
    <div className="flex items-center gap-3 text-sm text-text-primary">
      <meter
        className="sr-only"
        value={score * 100}
        min={0}
        max={100}
        aria-label={`${label}: ${pct}%`}
      />
      <span className="w-28 truncate text-text-muted text-xs 2xl:text-sm">{label}</span>
      <div className="relative flex-1 h-2 rounded-none bg-bg-hover border border-border-subtle">
        <div
          className={`h-full rounded-none transition-all ${isMatch ? "bg-accent-green" : "bg-accent-blue/60"}`}
          style={{ width: `${score * 100}%` }}
        />
        {/* Precision threshold marker */}
        <div
          className="absolute -top-1 -bottom-1 w-px bg-text-faint"
          style={{ left: `${threshold * 100}%` }}
          aria-label={`${precisionLabel ?? "Precision"}: ${thresholdPct}%`}
        >
          <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[8px] 2xl:text-[9px] text-text-faint font-mono whitespace-nowrap pointer-events-none">
            {thresholdPct}%
          </div>
        </div>
      </div>
      <span
        className={`w-12 text-right font-mono text-xs font-bold ${isMatch ? "text-accent-green" : "text-text-muted"}`}
      >
        {pct}%
      </span>
    </div>
  );
}
