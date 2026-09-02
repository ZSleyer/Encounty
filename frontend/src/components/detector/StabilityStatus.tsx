/**
 * StabilityStatus.tsx -- Stability analysis status button and details dialog.
 *
 * Shown during the test step: a compact status button that opens a modal with
 * the score distribution, the recommended settings and the toggle that
 * persists the calibration on save.
 */
import React, { useId, useRef, useState } from "react";
import { AlertTriangle, BarChart3, Check, CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import { useModalDialog } from "../../hooks/useModalDialog";
import { Toggle } from "../shared/Toggle";
import { type PollingRecommendation, type StabilityStats } from "../../engine/templateStability";
import { type SweepResult } from "../../engine/parameterSweep";
import { formatPercent } from "../../utils/format";

/** Icon and i18n label key for a stability rating. */
function ratingPresentation(rating: StabilityStats["rating"]): {
  Icon: typeof CheckCircle2;
  labelKey: string;
  colorClass: string;
} {
  if (rating === "good") {
    return {
      Icon: CheckCircle2,
      labelKey: "templateEditor.stabilityGood",
      colorClass: "text-emerald-400",
    };
  }
  if (rating === "ok") {
    return {
      Icon: AlertTriangle,
      labelKey: "templateEditor.stabilityOk",
      colorClass: "text-accent-yellow",
    };
  }
  return { Icon: XCircle, labelKey: "templateEditor.stabilityPoor", colorClass: "text-accent-red" };
}

/**
 * Stability analysis details: score distribution summary, the recommended
 * settings (a finished sweep supersedes the analytic values) and the toggle
 * that persists the calibration on save. Rendered inside StabilityStatus's
 * modal.
 */
function StabilityDetails({
  stats,
  polling,
  sweep,
  sweepRunning,
  applyCalibration,
  onToggleApply,
  t,
}: Readonly<{
  stats: StabilityStats;
  polling: PollingRecommendation | null;
  /** Finished parameter-sweep result; supersedes the analytic values when present. */
  sweep: SweepResult | null;
  /** True while the parameter sweep is still simulating combinations. */
  sweepRunning: boolean;
  applyCalibration: boolean;
  onToggleApply: (v: boolean) => void;
  t: (k: string) => string;
}>) {
  const applyId = useId();
  const pct = (v: number) => `${formatPercent(v, 0)}%`;
  const statsLine = t("templateEditor.stabilityStats")
    .replace("{count}", String(stats.sampleCount))
    .replace("{median}", pct(stats.matchMedian))
    .replace("{p10}", pct(stats.matchP10))
    .replace("{noise}", pct(stats.noiseP90));
  // The finished sweep replaces the analytic recommendation in the display.
  const shownPrecision = sweep ? sweep.precision : stats.recommendedPrecision;
  const shownHysteresis = sweep ? sweep.hysteresisFactor : stats.recommendedHysteresis;
  let pollingValues: { min: number; base: number; max: number } | null = null;
  if (sweep) {
    pollingValues = { min: sweep.minPollMs, base: sweep.pollIntervalMs, max: sweep.maxPollMs };
  } else if (polling) {
    pollingValues = { min: polling.minPollMs, base: polling.basePollMs, max: polling.maxPollMs };
  }
  const pollingLine = pollingValues
    ? t("templateEditor.stabilityPolling")
        .replace("{min}", String(pollingValues.min))
        .replace("{base}", String(pollingValues.base))
        .replace("{max}", String(pollingValues.max))
    : null;

  return (
    <>
      <p className="text-xs 2xl:text-sm text-text-muted">{statsLine}</p>
      {sweepRunning && (
        <p className="flex items-center gap-2 text-xs 2xl:text-sm text-text-muted">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />
          <span>{t("templateEditor.stabilitySweeping")}</span>
        </p>
      )}
      <p className="text-xs 2xl:text-sm text-text-muted">
        {t("templateEditor.stabilityRecommended").replace("{value}", pct(shownPrecision))}
      </p>
      <p className="text-xs 2xl:text-sm text-text-muted">
        {t("templateEditor.stabilityHysteresis").replace("{value}", pct(shownHysteresis))}
      </p>
      {sweep && (
        <p className="text-xs 2xl:text-sm text-text-muted">
          {t("templateEditor.stabilityHits").replace("{value}", String(sweep.consecutiveHits))}
        </p>
      )}
      {pollingLine && (
        <>
          <p className="text-xs 2xl:text-sm text-text-muted">{pollingLine}</p>
          <p className="text-[11px] 2xl:text-xs text-text-muted">
            {t("templateEditor.stabilityPollingHint")}
          </p>
        </>
      )}
      {sweep && !sweep.perfect && (
        <p className="text-xs 2xl:text-sm text-accent-yellow">
          {t("templateEditor.stabilitySweepImperfect")}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Toggle
          id={applyId}
          enabled={applyCalibration}
          onChange={() => onToggleApply(!applyCalibration)}
          label={t("templateEditor.stabilityApply")}
        />
        <label htmlFor={applyId} className="text-xs 2xl:text-sm text-text-primary cursor-pointer">
          {t("templateEditor.stabilityApply")}
        </label>
      </div>
      <p className="text-[11px] 2xl:text-xs text-text-muted">{t("templateEditor.stabilityHint")}</p>
    </>
  );
}

/**
 * Compact stability status button shown during the test step, anchored to the
 * right edge so appearing after the batch test never shifts the editor layout.
 * Shows a spinner while the batch test or the parameter sweep is running and
 * the color-coded rating once the analysis is done; a small check marks that
 * the calibration will be applied on save. Clicking it opens a centered modal
 * with the full stability details.
 */
export function StabilityStatus({
  stats,
  polling,
  sweep,
  sweepRunning,
  batchRunning,
  applyCalibration,
  onToggleApply,
  t,
}: Readonly<{
  stats: StabilityStats | null;
  polling: PollingRecommendation | null;
  /** Finished parameter-sweep result; supersedes the analytic values when present. */
  sweep: SweepResult | null;
  /** True while the parameter sweep is still simulating combinations. */
  sweepRunning: boolean;
  /** True while the batch test is still scoring frames (no stats yet). */
  batchRunning: boolean;
  applyCalibration: boolean;
  onToggleApply: (v: boolean) => void;
  t: (k: string) => string;
}>) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const running = batchRunning || sweepRunning;
  const rating = stats ? ratingPresentation(stats.rating) : null;
  const showApplied = !running && applyCalibration && stats !== null;

  // Accessible name carries the full status so the rating icon color and the
  // applied check are not the only carriers of information.
  let buttonLabel: string;
  if (running) {
    buttonLabel = t("templateEditor.stabilityAnalyzing");
  } else if (rating) {
    buttonLabel = `${t("templateEditor.stabilityTitle")}: ${t(rating.labelKey)}`;
    if (showApplied) buttonLabel += `. ${t("templateEditor.stabilityApplied")}`;
  } else {
    buttonLabel = t("templateEditor.stabilityTitle");
  }

  let buttonIcon: React.ReactNode;
  if (running) {
    buttonIcon = (
      <Loader2 className="w-4 h-4 2xl:w-5 2xl:h-5 animate-spin shrink-0" aria-hidden="true" />
    );
  } else if (rating) {
    buttonIcon = (
      <rating.Icon
        className={`w-4 h-4 2xl:w-5 2xl:h-5 shrink-0 ${rating.colorClass}`}
        aria-hidden="true"
      />
    );
  } else {
    buttonIcon = (
      <BarChart3 className="w-4 h-4 2xl:w-5 2xl:h-5 shrink-0 text-text-muted" aria-hidden="true" />
    );
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={!stats}
        onClick={() => setDetailsOpen(true)}
        aria-label={buttonLabel}
        aria-haspopup="dialog"
        title={showApplied ? t("templateEditor.stabilityApplied") : undefined}
        className="flex items-center justify-center gap-2 px-4 py-4 2xl:py-5 rounded-none border border-border-subtle bg-bg-card text-text-primary hover:bg-bg-hover text-sm 2xl:text-base font-bold whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {buttonIcon}
        <span>
          {running ? t("templateEditor.stabilityAnalyzing") : t("templateEditor.stabilityTitle")}
        </span>
        {showApplied && (
          <Check
            className="w-3.5 h-3.5 2xl:w-4 2xl:h-4 text-emerald-400 shrink-0"
            aria-hidden="true"
          />
        )}
      </button>
      {detailsOpen && stats && rating && (
        <StabilityDialog
          rating={rating}
          stats={stats}
          polling={polling}
          sweep={sweep}
          sweepRunning={sweepRunning}
          applyCalibration={applyCalibration}
          onToggleApply={onToggleApply}
          onClose={() => {
            setDetailsOpen(false);
            buttonRef.current?.focus();
          }}
          t={t}
        />
      )}
    </>
  );
}

/**
 * Centered modal with the full stability details, opened from the status
 * button. Mounted only while open so useModalDialog can drive showModal()
 * on mount, backdrop click and the CRT close transition.
 */
function StabilityDialog({
  rating,
  stats,
  polling,
  sweep,
  sweepRunning,
  applyCalibration,
  onToggleApply,
  onClose,
  t,
}: Readonly<{
  rating: ReturnType<typeof ratingPresentation>;
  stats: StabilityStats;
  polling: PollingRecommendation | null;
  sweep: SweepResult | null;
  sweepRunning: boolean;
  applyCalibration: boolean;
  onToggleApply: (v: boolean) => void;
  /** Called after the close transition finishes; unmounts the dialog. */
  onClose: () => void;
  t: (k: string) => string;
}>) {
  const titleId = useId();
  const { dialogRef, requestClose } = useModalDialog({ onClose });

  return (
    <dialog
      ref={dialogRef}
      onCancel={requestClose}
      aria-labelledby={titleId}
      className="t-panel m-auto max-w-md max-h-[85vh] overflow-y-auto p-4 space-y-2 text-sm 2xl:text-base backdrop:bg-black/60"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 id={titleId} className={`flex items-center gap-2 font-semibold ${rating.colorClass}`}>
          <rating.Icon className="w-4 h-4 2xl:w-5 2xl:h-5 shrink-0" aria-hidden="true" />
          <span>
            {t("templateEditor.stabilityTitle")}: {t(rating.labelKey)}
          </span>
        </h3>
        <button
          type="button"
          onClick={requestClose}
          aria-label={t("templateEditor.close")}
          className="p-1 rounded-none text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors shrink-0"
        >
          <X className="w-4 h-4 2xl:w-5 2xl:h-5" aria-hidden="true" />
        </button>
      </div>
      <StabilityDetails
        stats={stats}
        polling={polling}
        sweep={sweep}
        sweepRunning={sweepRunning}
        applyCalibration={applyCalibration}
        onToggleApply={onToggleApply}
        t={t}
      />
    </dialog>
  );
}
