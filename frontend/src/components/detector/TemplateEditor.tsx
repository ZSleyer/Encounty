/**
 * TemplateEditor.tsx — Template creation and region editing for auto-detection.
 *
 * In new-template mode, shows a live preview from the CaptureService stream,
 * lets the user take a replay-buffer snapshot via useReplayBuffer, scrub through
 * frames to pick the best one, then draw detection regions on it.
 * In edit mode, loads an existing template image for region editing.
 */
import React, { useState, useRef, useEffect, useCallback, useMemo, useId } from "react";
import { createPortal } from "react-dom";
import {
  X, Camera, Save, RefreshCw, Trash2, Image as ImageIcon,
  Type, Loader2, ScanText, Play, ArrowRight, BarChart3, ArrowLeft, HelpCircle,
  CheckCircle2, AlertTriangle, XCircle, Check,
} from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { useModalDialog } from "../../hooks/useModalDialog";
import { MatchedRegion, TemplateCalibration } from "../../types";
import { useOCR } from "../../hooks/useOCR";
import { useReplayBuffer } from "../../hooks/useReplayBuffer";
import { useTemplateTest } from "../../hooks/useTemplateTest";
import { analyzeStability, recommendPolling, toCalibration, type PollingRecommendation, type StabilityStats } from "../../engine/templateStability";
import { applyNoiseFloor, newCategoryState, updateMatchState, type MatchStateSettings } from "../../engine/matchStateMachine";
import { createSweepRunner, type SweepResult } from "../../engine/parameterSweep";
import { preprocessForOCR } from "../../engine/ocrPreprocess";
import {
  DEFAULT_PRECISION, DEFAULT_HYSTERESIS_FACTOR, DEFAULT_CONSECUTIVE_HITS,
  DEFAULT_COOLDOWN_SEC, DEFAULT_POLL_MS, MIN_POLL_MS, MAX_POLL_MS,
} from "../../engine/detectorDefaults";

// --- Props -------------------------------------------------------------------

export type TemplateEditorProps = Readonly<{
  /** Live video stream for new-template mode. If omitted, edit mode is assumed. */
  stream?: MediaStream;
  onClose: () => void;
  /** Called when saving a new template (new-template mode). */
  onSaveTemplate?: (payload: {
    imageBase64: string; regions: MatchedRegion[]; name?: string; calibration?: TemplateCalibration;
    precision?: number; hysteresisFactor?: number; consecutiveHits?: number; cooldownSec?: number;
    pollIntervalMs?: number; minPollMs?: number; maxPollMs?: number;
  }) => Promise<void>;
  /** Called when updating regions of an existing template (edit mode). */
  onUpdateRegions?: (regions: MatchedRegion[], opts?: {
    name?: string; precision?: number; hysteresisFactor?: number; consecutiveHits?: number;
    cooldownSec?: number; pollIntervalMs?: number; minPollMs?: number; maxPollMs?: number;
  }) => void | Promise<void>;
  /** Pre-load an existing template image by URL (edit mode). */
  initialImageUrl?: string;
  /** Pre-load existing regions (edit mode). */
  initialRegions?: MatchedRegion[];
  /** Initial template name for edit mode. */
  initialName?: string;
  /** Pokemon name -- pre-fills expected_text when switching a region to type "text". */
  pokemonName?: string;
  /** Tesseract language code for OCR auto-recognition (e.g. "deu", "eng"). */
  ocrLang?: string;
  /** This template's own precision override, if it already has one (edit mode). Falls back to a hardcoded default when absent. */
  initialPrecision?: number;
  /** This template's own hysteresis factor override, if it already has one (edit mode). Falls back to a hardcoded default when absent. */
  initialHysteresisFactor?: number;
  /** This template's own consecutive-hits override, if it already has one (edit mode). Falls back to a hardcoded default when absent. */
  initialConsecutiveHits?: number;
  /** This template's own cooldown override in seconds, if it already has one (edit mode). Falls back to a hardcoded default when absent. */
  initialCooldownSec?: number;
  /** This template's own base adaptive-polling interval (ms), if it already has one (edit mode). Falls back to a hardcoded default when absent. */
  initialPollIntervalMs?: number;
  /** This template's own fastest adaptive-polling interval (ms), if it already has one (edit mode). Falls back to a hardcoded default when absent. */
  initialMinPollMs?: number;
  /** This template's own slowest adaptive-polling interval (ms), if it already has one (edit mode). Falls back to a hardcoded default when absent. */
  initialMaxPollMs?: number;
}>;

type Phase = "video" | "replay" | "snapshot" | "test" | "confirm";

// --- Flow Controls -----------------------------------------------------------

/** Flow controls for creating a new template (all 5 phases). */
function NewTemplateControls({
  phase, isSaving, hasRegions,
  onTakeSnapshot, onResetSnapshot, onSave,
  onUseFrame, onBackToLive,
  onGoToTest, onPickFrame, onAdjustRegions, onLooksGood, onBackToTest,
  stabilityStatus,
  t,
}: Readonly<{
  phase: Phase;
  isSaving: boolean;
  hasRegions: boolean;
  /** Stability-analysis status button, rendered inside the test-phase control row. */
  stabilityStatus?: React.ReactNode;
  onTakeSnapshot: () => void;
  onResetSnapshot: () => void;
  onSave: () => void;
  onUseFrame: () => void;
  onBackToLive: () => void;
  onGoToTest: () => void;
  onPickFrame: () => void;
  onAdjustRegions: () => void;
  onLooksGood: () => void;
  onBackToTest: () => void;
  t: (k: string) => string;
}>) {
  if (phase === "video") {
    return (
      <button
        onClick={onTakeSnapshot}
        className="t-cut flex items-center justify-center gap-2 w-full px-6 py-4 2xl:py-5 rounded-none text-sm 2xl:text-base font-bold whitespace-nowrap bg-accent-blue text-bg-primary hover:bg-accent-blue/90 transition-colors"
      >
        <Camera className="w-5 h-5 2xl:w-6 2xl:h-6 shrink-0" />
        {t("templateEditor.takeSnapshot")}
      </button>
    );
  }

  if (phase === "replay") {
    return (
      <div className="flex w-full gap-3">
        <button
          onClick={onBackToLive}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-4 2xl:py-5 rounded-none border border-border-subtle bg-bg-card text-text-primary hover:bg-bg-hover text-sm 2xl:text-base font-bold whitespace-nowrap transition-colors"
        >
          <Play className="w-4 h-4 2xl:w-5 2xl:h-5 shrink-0" />
          {t("templateEditor.backToLive")}
        </button>
        <button
          onClick={onUseFrame}
          className="t-cut flex-2 flex items-center justify-center gap-2 px-6 py-4 2xl:py-5 rounded-none text-sm 2xl:text-base font-bold whitespace-nowrap bg-accent-blue text-bg-primary hover:bg-accent-blue/90 transition-colors"
        >
          <Camera className="w-5 h-5 2xl:w-6 2xl:h-6 shrink-0" />
          {t("templateEditor.useFrame")}
        </button>
      </div>
    );
  }

  if (phase === "snapshot") {
    return (
      <div className="flex w-full gap-3">
        <button
          onClick={onResetSnapshot}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-4 2xl:py-5 rounded-none border border-border-subtle bg-bg-card text-text-primary hover:bg-bg-hover text-sm 2xl:text-base font-bold whitespace-nowrap transition-colors"
        >
          <RefreshCw className="w-4 h-4 2xl:w-5 2xl:h-5 shrink-0" />
          {t("templateEditor.retake")}
        </button>
        <button
          onClick={onGoToTest}
          disabled={!hasRegions}
          className="t-cut flex-2 flex items-center justify-center gap-2 px-6 py-4 2xl:py-5 rounded-none text-sm 2xl:text-base font-bold whitespace-nowrap bg-accent-blue text-bg-primary hover:bg-accent-blue/90 transition-colors disabled:opacity-50"
        >
          <BarChart3 className="w-5 h-5 2xl:w-6 2xl:h-6 shrink-0" />
          {t("templateEditor.next")}
          <ArrowRight className="w-4 h-4 shrink-0" />
        </button>
      </div>
    );
  }

  if (phase === "test") {
    // w-max instead of w-full: four nowrap buttons overflow the max-w-md
    // parent, and content width lets the items-center parent keep the row
    // horizontally centered instead of overflowing to the right only.
    return (
      <div className="flex w-max max-w-none gap-3">
        {stabilityStatus}
        <button
          onClick={onPickFrame}
          className="flex items-center justify-center gap-2 px-4 py-4 2xl:py-5 rounded-none border border-border-subtle bg-bg-card text-text-primary hover:bg-bg-hover text-sm 2xl:text-base font-bold whitespace-nowrap transition-colors"
        >
          <Camera className="w-4 h-4 2xl:w-5 2xl:h-5 shrink-0" />
          {t("templateEditor.pickFrame")}
        </button>
        <button
          onClick={onAdjustRegions}
          className="flex items-center justify-center gap-2 px-4 py-4 2xl:py-5 rounded-none border border-border-subtle bg-bg-card text-text-primary hover:bg-bg-hover text-sm 2xl:text-base font-bold whitespace-nowrap transition-colors"
        >
          <RefreshCw className="w-4 h-4 2xl:w-5 2xl:h-5 shrink-0" />
          {t("templateEditor.adjustRegions")}
        </button>
        <button
          onClick={onLooksGood}
          className="t-cut flex-1 flex items-center justify-center gap-2 px-6 py-4 2xl:py-5 rounded-none text-sm 2xl:text-base font-bold whitespace-nowrap bg-accent-blue text-bg-primary hover:bg-accent-blue/90 transition-colors"
        >
          {t("templateEditor.next")}
          <ArrowRight className="w-5 h-5 2xl:w-6 2xl:h-6 shrink-0" />
        </button>
      </div>
    );
  }

  // confirm phase
  return (
    <div className="flex w-full gap-3">
      <button
        onClick={onBackToTest}
        className="flex-1 flex items-center justify-center gap-2 px-4 py-4 2xl:py-5 rounded-none border border-border-subtle bg-bg-card text-text-primary hover:bg-bg-hover text-sm 2xl:text-base font-bold whitespace-nowrap transition-colors"
      >
        <ArrowLeft className="w-4 h-4 2xl:w-5 2xl:h-5 shrink-0" />
        {t("templateEditor.back")}
      </button>
      <button
        onClick={onSave}
        disabled={isSaving}
        className="t-cut flex-2 flex items-center justify-center gap-2 px-6 py-4 2xl:py-5 rounded-none text-sm 2xl:text-base font-bold whitespace-nowrap bg-accent-blue text-bg-primary hover:bg-accent-blue/90 transition-colors disabled:opacity-50"
      >
        <Save className="w-5 h-5 2xl:w-6 2xl:h-6 shrink-0" />
        {isSaving ? t("templateEditor.saving") : t("templateEditor.saveTemplate")}
      </button>
    </div>
  );
}

// --- Helpers -----------------------------------------------------------------

/** Compute relative mouse/touch position within the snapshot container. */
function computeRelativePos(
  e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>,
  container: HTMLDivElement | null,
  bounds: { offsetX: number; offsetY: number; renderedW: number; renderedH: number } | null,
): { x: number; y: number } {
  if (!container) return { x: 0, y: 0 };
  const rect = container.getBoundingClientRect();
  const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
  const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

  if (bounds?.renderedW && bounds.renderedH > 0) {
    const x = Math.max(0, Math.min(1, (clientX - rect.left - bounds.offsetX) / bounds.renderedW));
    const y = Math.max(0, Math.min(1, (clientY - rect.top - bounds.offsetY) / bounds.renderedH));
    return { x, y };
  }

  return {
    x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
  };
}

/** Compute and set image bounds for object-contain letterboxing. */
function computeImageBounds(
  container: HTMLDivElement | null,
  snapshotW: number,
  snapshotH: number,
  setImageBounds: React.Dispatch<React.SetStateAction<{
    offsetX: number; offsetY: number; renderedW: number; renderedH: number;
  } | null>>,
) {
  if (!container || snapshotW === 0 || snapshotH === 0) {
    setImageBounds(null);
    return;
  }
  const rect = container.getBoundingClientRect();
  const scale = Math.min(rect.width / snapshotW, rect.height / snapshotH);
  const renderedW = snapshotW * scale;
  const renderedH = snapshotH * scale;
  setImageBounds({
    offsetX: (rect.width - renderedW) / 2,
    offsetY: (rect.height - renderedH) / 2,
    renderedW,
    renderedH,
  });
}

/** Handle arrow key navigation in replay phase. */
function handleReplayKeyDown(
  e: KeyboardEvent,
  frameCount: number,
  setIndex: React.Dispatch<React.SetStateAction<number>>,
) {
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    setIndex((prev) => Math.max(0, prev - step));
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    setIndex((prev) => Math.min(frameCount - 1, prev + step));
  }
}

/** Convert a relative bounding box to a pixel region, clamped to canvas bounds. */
function boxToRegion(box: { x: number; y: number; w: number; h: number }, canvas: HTMLCanvasElement): MatchedRegion | null {
  const cw = canvas.width;
  const ch = canvas.height;
  // Clamp origin to [0, canvas size)
  const pxX = Math.max(0, Math.min(cw - 1, Math.floor(box.x * cw)));
  const pxY = Math.max(0, Math.min(ch - 1, Math.floor(box.y * ch)));
  // Clamp dimensions so region never exceeds canvas bounds
  const pxW = Math.max(1, Math.min(cw - pxX, Math.floor(box.w * cw)));
  const pxH = Math.max(1, Math.min(ch - pxY, Math.floor(box.h * ch)));
  if (pxW <= 5 || pxH <= 5) return null;
  return { type: "image", expected_text: "", rect: { x: pxX, y: pxY, w: pxW, h: pxH } };
}

/** Renders a single region overlay marker on the snapshot preview. */
function RegionOverlayMarker({ region, index, snapshotWidth, snapshotHeight, scoreBadge, chipColor }: Readonly<{
  region: MatchedRegion; index: number; snapshotWidth: number; snapshotHeight: number;
  scoreBadge?: number;
  /** Category chip color, or null when the region has no category. */
  chipColor?: string | null;
}>) {
  const isText = region.type === "text";
  const accent = isText ? "#3fd4e0" : "var(--accent-blue)";
  const borderStyle = isText ? "border-[#3fd4e0] bg-[#3fd4e0]/10" : "border-accent-blue bg-accent-blue/10";
  const regionIcon = isText
    ? <Type className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />
    : <ImageIcon className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />;

  return (
    <div
      className={`absolute border-2 border-dashed rounded-none pointer-events-none transition-colors ${borderStyle}`}
      style={{
        left: `${(region.rect.x / snapshotWidth) * 100}%`,
        top: `${(region.rect.y / snapshotHeight) * 100}%`,
        width: `${(region.rect.w / snapshotWidth) * 100}%`,
        height: `${(region.rect.h / snapshotHeight) * 100}%`,
      }}
    >
      {/* Identity tag: solid accent fill (design system's .t-region .tag),
          dark text for contrast. Carries index, type, category, expected
          text — richer than the mockup's static label, same visual idiom. */}
      <div
        className="absolute -top-6 left-0 flex items-center gap-1 px-1.5 py-0.5 2xl:px-2 2xl:py-1 rounded-none font-bold font-mono text-xs 2xl:text-sm whitespace-nowrap text-bg-primary"
        style={{ backgroundColor: accent }}
      >
        <strong>#{index + 1}</strong>
        {chipColor && (
          <span
            aria-hidden="true"
            className="w-2 h-2 rounded-full shrink-0 ring-1 ring-bg-primary/40"
            style={{ backgroundColor: chipColor }}
          />
        )}
        {regionIcon}
        {isText && region.expected_text ? (
          <span className="opacity-80 ml-1 truncate max-w-15">"{region.expected_text}"</span>
        ) : null}
      </div>
      {/* Live match score: separate status readout, own semantic color, so
          it isn't washed out against the identity tag's solid accent fill. */}
      {scoreBadge !== undefined && (() => {
        let scoreColor: string;
        if (scoreBadge >= 0.8) scoreColor = "text-accent-green border-accent-green/40";
        else if (scoreBadge >= 0.5) scoreColor = "text-accent-yellow border-accent-yellow/40";
        else scoreColor = "text-accent-red border-accent-red/40";
        return (
          <div className={`absolute -top-6 right-0 bg-bg-primary/90 border px-1.5 py-0.5 2xl:px-2 2xl:py-1 rounded-none font-bold font-mono text-xs 2xl:text-sm whitespace-nowrap ${scoreColor}`}>
            {(scoreBadge * 100).toFixed(0)}%
          </div>
        );
      })()}
    </div>
  );
}

// --- Score Display Components ------------------------------------------------

/** Score bar with precision threshold marker. */
function ScoreBar({ label, score, precision, precisionLabel }: Readonly<{
  label: string; score: number; precision?: number; precisionLabel?: string;
}>) {
  const threshold = precision ?? DEFAULT_PRECISION;
  const isMatch = score >= threshold;
  const pct = (score * 100).toFixed(0);
  const thresholdPct = (threshold * 100).toFixed(0);
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
      <span className={`w-12 text-right font-mono text-xs font-bold ${isMatch ? "text-accent-green" : "text-text-muted"}`}>
        {pct}%
      </span>
    </div>
  );
}

/** Detection flow state for each frame. */
export type FlowState = "searching" | "match" | "hysteresis" | "cooldown";

/** Zone span in the sparkline. */
export interface FlowZone { startIdx: number; endIdx: number; type: "hysteresis" | "cooldown" }

/** Milliseconds per replay-buffer frame (~60fps capture), drives the virtual flow clock. */
const FLOW_FRAME_MS = 1000 / 60;

/**
 * Simulate the runtime detection flow (Searching → Match → Hysteresis →
 * Cooldown → Searching) over the batch-test score timeline.
 *
 * Every transition is delegated to the shared matchStateMachine so the
 * sparkline preview can never diverge from the real detection loop: scores
 * pass through the same noise floor, hysteresis exits use the per-template
 * factor, consecutive hits are honored, and the cooldown timer runs on a
 * virtual clock derived from the ~60fps replay buffer.
 *
 * Exported for direct unit testing (TemplateEditor.flow.test.ts).
 */
export function simulateDetectionFlow(
  entries: [number, { overallScore: number }][],
  settings: MatchStateSettings,
): { states: Map<number, FlowState>; zones: FlowZone[] } {
  const states = new Map<number, FlowState>();
  const zones: FlowZone[] = [];
  const state = newCategoryState();
  let zoneStart = -1;

  for (const [idx, r] of entries) {
    const wasInHysteresis = state.inHysteresis;
    const wasInCooldown = state.inCooldown;
    updateMatchState(state, applyNoiseFloor(r.overallScore), settings, idx * FLOW_FRAME_MS);

    if (!wasInHysteresis && state.inHysteresis) {
      // Confirmation frame: the machine just entered hysteresis.
      states.set(idx, "match");
      zoneStart = idx;
    } else if (state.inHysteresis) {
      states.set(idx, "hysteresis");
    } else if (wasInHysteresis && state.inCooldown) {
      // Hysteresis exit: close the hysteresis zone, open the cooldown zone.
      zones.push({ startIdx: zoneStart, endIdx: idx, type: "hysteresis" });
      states.set(idx, "cooldown");
      zoneStart = idx;
    } else if (state.inCooldown) {
      states.set(idx, "cooldown");
    } else if (wasInCooldown) {
      // Cooldown expiry frame: the runtime machine skips hit counting on this
      // tick, so the frame renders as searching even at a high score.
      zones.push({ startIdx: zoneStart, endIdx: idx, type: "cooldown" });
      states.set(idx, "searching");
      zoneStart = -1;
    } else {
      states.set(idx, "searching");
    }
  }

  // Close the trailing zone when the timeline ends mid-hysteresis/cooldown.
  if ((state.inHysteresis || state.inCooldown) && zoneStart >= 0 && entries.length > 0) {
    const lastIdx = entries[entries.length - 1][0];
    zones.push({ startIdx: zoneStart, endIdx: lastIdx, type: state.inHysteresis ? "hysteresis" : "cooldown" });
  }

  return { states, zones };
}

/** CSS color for a flow state, matching the DetectorPanel runtime dot palette. */
function flowStateColor(state: FlowState): string {
  switch (state) {
    case "match": return "var(--accent-green)";
    // A visibly more yellow-green than match (still unmistakably "green
    // family") — the diagonal hatch overlay carries the rest of the
    // distinction so the two never rely on hue alone.
    case "hysteresis": return "color-mix(in srgb, var(--accent-green) 45%, #d9f560)";
    case "cooldown": return "#a855f7";
    default: return "color-mix(in srgb, var(--accent-blue) 40%, transparent)";
  }
}

/**
 * Builds a hard-stop CSS gradient of contiguous same-state runs, so the
 * timeline reads as unbroken colored segments instead of a per-frame bar
 * grid. Returns null when there's nothing to visualize yet.
 */
/** Segments narrower than this (in %) get widened so brief hits stay visible. */
const MIN_SEGMENT_PCT = 1.5;

/**
 * Widens narrow non-"searching" segments (a single-frame match spike can be
 * under a pixel wide) by pushing their shared boundary with a neighboring
 * "searching" run, so a brief hit still reads as a visible band instead of
 * vanishing into a hairline. Boundaries stay monotonic — segments share
 * edges by construction, so growing one side always shrinks its neighbor's,
 * never creating a gap or overlap.
 */
function widenNarrowSegments(bounds: number[], states: FlowState[]): number[] {
  const widened = [...bounds];
  for (let i = 0; i < states.length; i++) {
    if (states[i] === "searching") continue;
    const width = widened[i + 1] - widened[i];
    if (width >= MIN_SEGMENT_PCT) continue;
    const grow = (MIN_SEGMENT_PCT - width) / 2;
    if (i > 0 && states[i - 1] === "searching") {
      widened[i] = Math.max(widened[i - 1], widened[i] - grow);
    }
    if (i + 1 < states.length && states[i + 1] === "searching") {
      widened[i + 1] = Math.min(widened[i + 2] ?? 100, widened[i + 1] + grow);
    }
  }
  return widened;
}

function buildFlowGradient(
  entries: [number, { overallScore: number }][],
  settings: MatchStateSettings,
  maxFrame: number,
): {
  gradient: string;
  matchCount: number;
  hasHysteresis: boolean;
  hasCooldown: boolean;
  /** Percent ranges of "hysteresis" segments, for the hatch overlay. */
  hysteresisRanges: { x1: number; x2: number }[];
} | null {
  if (entries.length === 0) return null;
  const { states } = simulateDetectionFlow(entries, settings);
  const sorted = Array.from(states.entries()).sort(([a], [b]) => a - b);
  if (sorted.length === 0) return null;

  // Merge consecutive same-state frames into segments first.
  const segStates: FlowState[] = [];
  const segBoundsFrame: number[] = [sorted[0][0]];
  let segState = sorted[0][1];
  for (let i = 1; i < sorted.length; i++) {
    const [idx, state] = sorted[i];
    if (state !== segState) {
      segStates.push(segState);
      segBoundsFrame.push(sorted[i - 1][0]);
      segState = state;
    }
  }
  segStates.push(segState);
  segBoundsFrame.push(sorted[sorted.length - 1][0]);

  // segBoundsFrame has one more entry than segStates (shared edges); convert
  // to percent boundaries, then widen any too-narrow non-searching segment.
  const boundsPct = segBoundsFrame.map((f) => (f / maxFrame) * 100);
  boundsPct[0] = 0;
  boundsPct[boundsPct.length - 1] = 100;
  const widened = widenNarrowSegments(boundsPct, segStates);

  const stops: string[] = [];
  const hysteresisRanges: { x1: number; x2: number }[] = [];
  for (let i = 0; i < segStates.length; i++) {
    // Hysteresis segments are fully transparent in the gradient itself —
    // the hatch overlay underneath (painted first, same range) supplies the
    // actual opaque color *and* the stripe pattern, so it renders pixel-for-
    // pixel like the legend swatch instead of a washed-out transparent mix.
    // No z-index/notch tricks needed either: the native thumb (part of the
    // input's own top layer) is never at risk of being covered.
    const color = segStates[i] === "hysteresis" ? "transparent" : flowStateColor(segStates[i]);
    stops.push(`${color} ${widened[i]}%`, `${color} ${widened[i + 1]}%`);
    if (segStates[i] === "hysteresis") {
      hysteresisRanges.push({ x1: widened[i], x2: widened[i + 1] });
    }
  }

  const stateValues = Array.from(states.values());
  return {
    gradient: `linear-gradient(to right, ${stops.join(", ")})`,
    matchCount: stateValues.filter((s) => s === "match").length,
    hasHysteresis: stateValues.includes("hysteresis"),
    hasCooldown: stateValues.includes("cooldown"),
    hysteresisRanges,
  };
}

/** Legend row for the flow timeline: state colors, match count, precision. */
function FlowLegend({ batchResults, settings, t }: Readonly<{
  batchResults: Map<number, { overallScore: number }>;
  /** Draft per-template settings driving the flow preview. */
  settings: MatchStateSettings;
  t: (k: string) => string;
}>) {
  if (batchResults.size === 0) return null;
  const entries = Array.from(batchResults.entries()).sort(([a], [b]) => a - b) as [number, { overallScore: number }][];
  const { states, zones } = simulateDetectionFlow(entries, settings);
  const matchCount = Array.from(states.values()).filter((s) => s === "match").length;
  const hasHysteresis = zones.some((z) => z.type === "hysteresis");
  const hasCooldown = zones.some((z) => z.type === "cooldown");

  return (
    <div className="flex items-center justify-between text-[10px] 2xl:text-xs px-1">
      <div className="flex items-center gap-3 text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-none inline-block" style={{ backgroundColor: flowStateColor("searching") }} />
          {t("detector.stateIdle")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-none inline-block" style={{ backgroundColor: flowStateColor("match") }} />
          {t("detector.stateMatch")}
        </span>
        {hasHysteresis && (
          <span className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-none inline-block"
              style={{
                backgroundColor: flowStateColor("hysteresis"),
                backgroundImage: "repeating-linear-gradient(135deg, transparent 0 1.5px, color-mix(in srgb, var(--bg-primary) 55%, transparent) 1.5px 2px)",
              }}
            />
            {t("detector.stateHysteresis")}
          </span>
        )}
        {hasCooldown && (
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-none inline-block" style={{ backgroundColor: flowStateColor("cooldown") }} />
            {t("detector.stateCooldown")}
          </span>
        )}
      </div>
      <span className="text-text-muted font-mono">
        {matchCount}× {t("detector.stateMatch")} · {t("detector.precision")} {(settings.precision * 100).toFixed(0)}%
      </span>
    </div>
  );
}

/** Maps each phase to its step number (1-indexed). */
function phaseToStep(phase: Phase): number {
  switch (phase) {
    case "video": return 1;
    case "replay": return 2;
    case "snapshot": return 3;
    case "test": return 4;
    case "confirm": return 5;
  }
}

/** Returns the heading and hint text for the current editor phase. */
function getHeadingAndHint(
  isEditMode: boolean,
  phase: Phase,
  t: (key: string) => string,
): { heading: string; hint: string } {
  if (isEditMode && phase === "snapshot") {
    return { heading: t("templateEditor.editTitle"), hint: t("templateEditor.editHint") };
  }
  const step = phaseToStep(phase);
  return {
    heading: t(`templateEditor.step${step}Title`),
    hint: t(`templateEditor.step${step}Hint`),
  };
}

/** Returns the label-text classes for a step based on active/done state. */
function getStepTextStyle(isActive: boolean, isDone: boolean): string {
  if (isActive) return "text-accent-blue";
  if (isDone) return "text-text-muted";
  return "text-text-faint";
}

/** Returns the number-badge classes for a step based on active/done state; done steps render as filled checkmarks (`.t-step.done .n` in the design system). */
function getStepBadgeStyle(isActive: boolean, isDone: boolean): string {
  if (isActive) return "border-accent-blue text-accent-blue";
  if (isDone) return "bg-accent-blue border-accent-blue text-bg-primary";
  return "border-border-subtle text-text-faint";
}

/** Visual step indicator showing progress through the 5-step template flow. */
function StepIndicator({ phase, t }: Readonly<{ phase: Phase; t: (k: string) => string }>) {
  const currentStep = phaseToStep(phase);
  const steps = [
    { step: 1, label: t("templateEditor.step1Title") },
    { step: 2, label: t("templateEditor.step2Title") },
    { step: 3, label: t("templateEditor.step3Title") },
    { step: 4, label: t("templateEditor.step4Title") },
    { step: 5, label: t("templateEditor.step5Title") },
  ];

  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {steps.map(({ step, label }) => {
        const isActive = step === currentStep;
        const isDone = step < currentStep;
        const stepLabel = label.replace(/^.*?:\s*/, "");

        const textStyle = getStepTextStyle(isActive, isDone);
        const badgeStyle = getStepBadgeStyle(isActive, isDone);

        return (
          <React.Fragment key={step}>
            {step > 1 && (
              <div className={`hidden sm:block w-6 h-px ${isDone ? "bg-accent-blue" : "bg-border-subtle"}`} />
            )}
            <div className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${textStyle}`}>
              <span className={`w-[18px] h-[18px] flex items-center justify-center rounded-none border font-bold text-[10px] leading-none shrink-0 ${badgeStyle}`}>
                {isDone ? "✓" : step}
              </span>
              <span className="hidden sm:inline whitespace-nowrap">{stepLabel}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// --- Stability Panel -----------------------------------------------------------

/** Icon and i18n label key for a stability rating. */
function ratingPresentation(rating: StabilityStats["rating"]): {
  Icon: typeof CheckCircle2;
  labelKey: string;
  colorClass: string;
} {
  if (rating === "good") {
    return { Icon: CheckCircle2, labelKey: "templateEditor.stabilityGood", colorClass: "text-emerald-400" };
  }
  if (rating === "ok") {
    return { Icon: AlertTriangle, labelKey: "templateEditor.stabilityOk", colorClass: "text-amber-400" };
  }
  return { Icon: XCircle, labelKey: "templateEditor.stabilityPoor", colorClass: "text-red-400" };
}

/**
 * Stability analysis details: score distribution summary, the recommended
 * settings (a finished sweep supersedes the analytic values) and the toggle
 * that persists the calibration on save. Rendered inside StabilityStatus's
 * modal.
 */
function StabilityDetails({ stats, polling, sweep, sweepRunning, applyCalibration, onToggleApply, t }: Readonly<{
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
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
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
          <p className="text-[11px] 2xl:text-xs text-text-muted">{t("templateEditor.stabilityPollingHint")}</p>
        </>
      )}
      {sweep && !sweep.perfect && (
        <p className="text-xs 2xl:text-sm text-amber-400">{t("templateEditor.stabilitySweepImperfect")}</p>
      )}
      <label className="flex items-center gap-2 text-xs 2xl:text-sm text-text-primary cursor-pointer">
        <input
          type="checkbox"
          checked={applyCalibration}
          onChange={(e) => onToggleApply(e.target.checked)}
          className="w-4 h-4 accent-accent-blue"
        />
        <span>{t("templateEditor.stabilityApply")}</span>
      </label>
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
function StabilityStatus({ stats, polling, sweep, sweepRunning, batchRunning, applyCalibration, onToggleApply, t }: Readonly<{
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
    buttonIcon = <Loader2 className="w-4 h-4 2xl:w-5 2xl:h-5 animate-spin shrink-0" aria-hidden="true" />;
  } else if (rating) {
    buttonIcon = <rating.Icon className={`w-4 h-4 2xl:w-5 2xl:h-5 shrink-0 ${rating.colorClass}`} aria-hidden="true" />;
  } else {
    buttonIcon = <BarChart3 className="w-4 h-4 2xl:w-5 2xl:h-5 shrink-0 text-text-muted" aria-hidden="true" />;
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
        <span>{running ? t("templateEditor.stabilityAnalyzing") : t("templateEditor.stabilityTitle")}</span>
        {showApplied && (
          <Check className="w-3.5 h-3.5 2xl:w-4 2xl:h-4 text-emerald-400 shrink-0" aria-hidden="true" />
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
function StabilityDialog({ rating, stats, polling, sweep, sweepRunning, applyCalibration, onToggleApply, onClose, t }: Readonly<{
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
          <span>{t("templateEditor.stabilityTitle")}: {t(rating.labelKey)}</span>
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

/** All detection settings owned by a single template, edited in the confirm step. */
export interface TemplateSettingsValues {
  precision: number;
  hysteresisFactor: number;
  consecutiveHits: number;
  cooldownSec: number;
  pollIntervalMs: number;
  minPollMs: number;
  maxPollMs: number;
}

/** Persists the current template (new or updated regions). */
async function saveTemplate(opts: {
  canvas: HTMLCanvasElement | null;
  regions: MatchedRegion[];
  templateName: string;
  calibration?: TemplateCalibration;
  settings: TemplateSettingsValues;
  onUpdateRegions: TemplateEditorProps["onUpdateRegions"];
  onSaveTemplate: TemplateEditorProps["onSaveTemplate"];
  setIsSaving: (v: boolean) => void;
  setErrorMsg: (v: string | null) => void;
}) {
  const { canvas, regions, templateName, calibration, settings, onUpdateRegions, onSaveTemplate, setIsSaving, setErrorMsg } = opts;
  if (!canvas) return;

  const {
    precision, hysteresisFactor, consecutiveHits, cooldownSec, pollIntervalMs, minPollMs, maxPollMs,
  } = settings;

  setIsSaving(true);
  setErrorMsg(null);
  try {
    const trimmedName = templateName.trim() || undefined;
    if (onUpdateRegions) {
      await onUpdateRegions(regions, {
        name: trimmedName, precision, hysteresisFactor, consecutiveHits, cooldownSec, pollIntervalMs, minPollMs, maxPollMs,
      });
    } else if (onSaveTemplate) {
      const base64Data = canvas.toDataURL("image/png");
      await onSaveTemplate({
        imageBase64: base64Data, regions, name: trimmedName, calibration,
        precision, hysteresisFactor, consecutiveHits, cooldownSec, pollIntervalMs, minPollMs, maxPollMs,
      });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to save template";
    setErrorMsg(msg);
  } finally {
    setIsSaving(false);
  }
}

/** Wires a MediaStream to the video element when in video phase. */
function wireStreamToVideo(phase: Phase, videoEl: HTMLVideoElement | null, stream: MediaStream | undefined) {
  if (phase === "video" && videoEl && videoEl.srcObject !== stream) {
    videoEl.srcObject = stream ?? null;
    videoEl.play().catch(() => {});
  }
}

/** Loads an existing template image into the canvas for edit mode. */
function loadInitialImage(
  url: string | undefined,
  canvas: HTMLCanvasElement | null,
  initialRegions: MatchedRegion[] | undefined,
  setSnapshotWidth: (w: number) => void,
  setSnapshotHeight: (h: number) => void,
  setPhase: (p: Phase) => void,
  setRegions: (r: MatchedRegion[]) => void,
) {
  if (!url || !canvas) return;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    setSnapshotWidth(img.naturalWidth);
    setSnapshotHeight(img.naturalHeight);
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(img, 0, 0);
    setPhase("snapshot");
    if ((initialRegions?.length ?? 0) > 0) {
      setRegions(initialRegions!);
    }
  };
  img.src = url;
}

/** Renders a replay buffer frame onto the canvas, updating dimensions if needed. */
function renderReplayFrame(
  frame: ImageData | null,
  canvas: HTMLCanvasElement | null,
  setSnapshotWidth: (w: number) => void,
  setSnapshotHeight: (h: number) => void,
) {
  if (!frame || !canvas) return;
  if (canvas.width !== frame.width) {
    canvas.width = frame.width;
    setSnapshotWidth(frame.width);
  }
  if (canvas.height !== frame.height) {
    canvas.height = frame.height;
    setSnapshotHeight(frame.height);
  }
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.putImageData(frame, 0, 0);
}

/** Restores the stored match frame onto the canvas so scrubbing previews don't leak into the saved template. */
function restoreMatchFrame(matchFrame: ImageData | null, canvas: HTMLCanvasElement | null) {
  if (!matchFrame || !canvas) return;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.putImageData(matchFrame, 0, 0);
}

/** Sets up a ResizeObserver for image bounds tracking in snapshot/replay phases. */
function observeImageBounds(
  phase: Phase,
  snapshotWidth: number,
  snapshotHeight: number,
  container: HTMLDivElement | null,
  updateBounds: () => void,
  setImageBounds: (v: null) => void,
): (() => void) | undefined {
  if ((phase !== "snapshot" && phase !== "replay" && phase !== "test" && phase !== "confirm") || snapshotWidth === 0 || snapshotHeight === 0) {
    setImageBounds(null);
    return;
  }
  updateBounds();
  if (!container) return;
  const observer = new ResizeObserver(updateBounds);
  observer.observe(container);
  return () => observer.disconnect();
}

/** Crops a region from the canvas and runs OCR on it, returning the recognized text or null. */
async function runRegionOCR(
  region: MatchedRegion | undefined,
  sourceCanvas: HTMLCanvasElement | null,
  recognize: (canvas: HTMLCanvasElement, lang: string) => Promise<string | null>,
  lang: string,
): Promise<string | null> {
  if (region?.type !== "text" || !sourceCanvas) return null;
  const crop = document.createElement("canvas");
  crop.width = region.rect.w;
  crop.height = region.rect.h;
  const ctx = crop.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(sourceCanvas, region.rect.x, region.rect.y, region.rect.w, region.rect.h, 0, 0, region.rect.w, region.rect.h);
  // Upscale and binarize the crop first; raw game-font crops are usually too
  // small and low-contrast for tesseract to read reliably.
  return recognize(preprocessForOCR(crop), lang);
}

/** Captures the current video frame directly onto the canvas. */
function captureVideoFrame(
  videoEl: HTMLVideoElement | null, canvas: HTMLCanvasElement | null,
  setW: (w: number) => void, setH: (h: number) => void,
  setPhase: (p: Phase) => void, onReset: () => void,
) {
  if (!videoEl || !canvas) return;
  if (videoEl.videoWidth === 0 || videoEl.videoHeight === 0) return;
  setW(videoEl.videoWidth);
  setH(videoEl.videoHeight);
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.drawImage(videoEl, 0, 0, videoEl.videoWidth, videoEl.videoHeight);
  setPhase("snapshot");
  onReset();
}

/** Draws an ImageData frame onto the canvas, entering snapshot phase. */
function drawFrameToCanvas(
  frame: ImageData | null, canvas: HTMLCanvasElement | null,
  setW: (w: number) => void, setH: (h: number) => void,
  setPhase: (p: Phase) => void, onReset: () => void,
) {
  if (!frame || !canvas) return;
  setW(frame.width);
  setH(frame.height);
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.putImageData(frame, 0, 0);
  setPhase("snapshot");
  onReset();
}

/** Applies an update to a single region, pre-filling text fields with the pokemon name. */
function applyRegionUpdate(
  regions: MatchedRegion[], index: number, updates: Partial<MatchedRegion>, pokemonName?: string,
): MatchedRegion[] {
  const newReg = [...regions];
  const merged = { ...newReg[index], ...updates };
  if (updates.type === "text" && !merged.expected_text && pokemonName) {
    merged.expected_text = pokemonName;
  }
  newReg[index] = merged;
  return newReg;
}

/** Commits a drawn bounding box as a new region if large enough. */
function commitDrawnRegion(
  box: { x: number; y: number; w: number; h: number } | null,
  canvas: HTMLCanvasElement | null,
  setRegions: React.Dispatch<React.SetStateAction<MatchedRegion[]>>,
) {
  if (box && box.w > 0.01 && box.h > 0.01 && canvas) {
    const region = boxToRegion(box, canvas);
    if (region) setRegions((prev) => [...prev, region]);
  }
}

// --- Keyboard-driven region drawing (parallel path to mouse/touch drag) ------

/** Step size (relative fraction) applied per arrow-key press when moving or resizing a box. */
const REGION_KEY_STEP = 0.02;

/** Default centered box used when a keyboard user starts drawing with Enter. */
const REGION_DEFAULT_BOX = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };

const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/** Moves a box by one keyboard step in the arrow-key direction, clamped to the 0..1 image area. */
function moveBoxByKey(
  box: { x: number; y: number; w: number; h: number },
  key: string,
): { x: number; y: number; w: number; h: number } {
  let x = box.x;
  let y = box.y;
  if (key === "ArrowLeft") x -= REGION_KEY_STEP;
  else if (key === "ArrowRight") x += REGION_KEY_STEP;
  else if (key === "ArrowUp") y -= REGION_KEY_STEP;
  else if (key === "ArrowDown") y += REGION_KEY_STEP;
  x = Math.min(Math.max(x, 0), 1 - box.w);
  y = Math.min(Math.max(y, 0), 1 - box.h);
  return { x, y, w: box.w, h: box.h };
}

/** Resizes a box by one keyboard step in the arrow-key direction, clamped within the 0..1 image area. */
function resizeBoxByKey(
  box: { x: number; y: number; w: number; h: number },
  key: string,
): { x: number; y: number; w: number; h: number } {
  let w = box.w;
  let h = box.h;
  if (key === "ArrowLeft") w -= REGION_KEY_STEP;
  else if (key === "ArrowRight") w += REGION_KEY_STEP;
  else if (key === "ArrowUp") h -= REGION_KEY_STEP;
  else if (key === "ArrowDown") h += REGION_KEY_STEP;
  w = Math.min(Math.max(w, 0.02), 1 - box.x);
  h = Math.min(Math.max(h, 0.02), 1 - box.y);
  return { x: box.x, y: box.y, w, h };
}

/** Fixed palette for category chips. Regions sharing a category get the same hue. */
const CATEGORY_COLORS = [
  "#60a5fa", "#a78bfa", "#34d399", "#fbbf24", "#f472b6",
  "#22d3ee", "#fb923c", "#a3e635", "#f87171", "#c084fc",
] as const;

/**
 * Returns a stable chip color for a category name, or null for the default
 * (empty) category so unset regions render no chip and behave as before.
 */
function categoryColor(category: string | undefined, order: string[]): string | null {
  const name = (category ?? "").trim();
  if (!name) return null;
  const idx = order.indexOf(name);
  const slot = idx >= 0 ? idx : order.length;
  return CATEGORY_COLORS[slot % CATEGORY_COLORS.length];
}

/** Single region editor card shown below the snapshot preview. */
function RegionEditCard({ region: r, index: i, onUpdate, onDelete, onRunOCR, isRecognizing, categoryNames, t }: Readonly<{
  region: MatchedRegion; index: number;
  onUpdate: (i: number, u: Partial<MatchedRegion>) => void;
  onDelete: (i: number) => void;
  onRunOCR: (i: number) => void;
  isRecognizing: boolean;
  /** Distinct category names already used in this template, for autocomplete and chip colors. */
  categoryNames: string[];
  t: (key: string) => string;
}>) {
  const labelColor = r.type === "text" ? "text-[#3fd4e0]" : "text-accent-blue";
  const datalistId = `region-categories-${i}`;
  const chipColor = categoryColor(r.category, categoryNames);
  const [showHelp, setShowHelp] = useState(false);
  return (
    <div className="flex items-center gap-2 bg-bg-card border border-border-subtle rounded-none px-3 py-2 transition-colors hover:border-accent-blue/50">
      <span className={`font-mono font-bold w-5 shrink-0 ${labelColor}`}>
        #{i + 1}
      </span>
      <select
        className="bg-bg-primary text-xs 2xl:text-sm p-1 2xl:p-1.5 rounded-none border border-border-subtle outline-none min-w-25 2xl:min-w-30"
        aria-label={t("templateEditor.regionType")}
        value={r.type}
        onChange={(e) => onUpdate(i, { type: e.target.value as "image" | "text" })}
      >
        <option value="image">{t("templateEditor.regionImage")}</option>
        <option value="text">{t("templateEditor.regionText")} (OCR)</option>
      </select>
      {r.type === "text" && (
        <>
          <input
            type="text"
            placeholder={t("templateEditor.expectedText")}
            value={r.expected_text}
            onChange={(e) => onUpdate(i, { expected_text: e.target.value })}
            className="bg-bg-primary text-xs 2xl:text-sm p-1 2xl:p-1.5 rounded-none border border-border-subtle outline-none min-w-30 2xl:min-w-35 focus:border-[#3fd4e0]"
          />
          <button
            title="Auto-recognize text (OCR)"
            onClick={() => onRunOCR(i)}
            disabled={isRecognizing}
            className="text-amber-400 hover:text-amber-300 disabled:opacity-40 transition-colors p-1"
          >
            {isRecognizing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ScanText className="w-4 h-4 2xl:w-5 2xl:h-5" />
            )}
          </button>
        </>
      )}
      <div className="w-px h-6 bg-border-subtle mx-1"></div>
      <div className="flex items-center gap-1.5">
        {chipColor && (
          <span
            aria-hidden="true"
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: chipColor }}
          />
        )}
        <input
          type="text"
          list={datalistId}
          aria-label={t("templateEditor.category")}
          placeholder={t("templateEditor.category")}
          value={r.category ?? ""}
          onChange={(e) => onUpdate(i, { category: e.target.value })}
          className="bg-bg-primary text-xs 2xl:text-sm p-1 2xl:p-1.5 rounded-none border border-border-subtle outline-none w-24 2xl:w-28 focus:border-accent-blue"
        />
        <datalist id={datalistId}>
          {categoryNames.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={() => setShowHelp(true)}
          aria-label={t("templateEditor.categoryHelpTitle")}
          className="text-text-muted hover:text-accent-blue transition-colors shrink-0"
        >
          <HelpCircle className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />
        </button>
        {showHelp && createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
            onClick={() => setShowHelp(false)}
            onKeyDown={(e) => { if (e.key === "Escape") setShowHelp(false); }}
            role="presentation"
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t("templateEditor.categoryHelpTitle")}
              className="max-w-sm bg-bg-card border border-border-subtle rounded-none p-4 text-left"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-2 text-text-primary font-semibold text-sm">
                <HelpCircle className="w-4 h-4 text-accent-blue" />
                <span>{t("templateEditor.categoryHelpTitle")}</span>
              </div>
              <p className="text-xs 2xl:text-sm text-text-secondary leading-relaxed">
                {t("templateEditor.categoryHelp")}
              </p>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowHelp(false)}
                  className="t-cut px-3 py-1.5 rounded-none bg-accent-blue text-bg-primary text-xs font-semibold hover:bg-accent-blue/90 transition-colors"
                >
                  {t("templateEditor.close")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      </div>
      <div className="w-px h-6 bg-border-subtle mx-1"></div>
      <button
        title={t("templateEditor.deleteRegion")}
        onClick={() => onDelete(i)}
        className="text-text-muted hover:text-red-400 transition-colors p-1"
      >
         <Trash2 className="w-4 h-4 2xl:w-5 2xl:h-5" />
      </button>
    </div>
  );
}

// --- Main Component ----------------------------------------------------------

/** Template editor for creating new templates or editing existing ones. */
export function TemplateEditor({
  stream,
  onClose,
  onSaveTemplate,
  onUpdateRegions,
  initialImageUrl,
  initialRegions,
  initialName,
  pokemonName,
  ocrLang = "eng",
  initialPrecision,
  initialHysteresisFactor,
  initialConsecutiveHits,
  initialCooldownSec,
  initialPollIntervalMs,
  initialMinPollMs,
  initialMaxPollMs,
}: TemplateEditorProps) {
  const { t } = useI18n();
  // Callback ref so React triggers a re-render when the video element mounts,
  // which lets useReplayBuffer receive the actual element instead of null.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const videoRef = useCallback((el: HTMLVideoElement | null) => { setVideoEl(el); }, []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Stores the original match frame ImageData so scrubbing in the test phase cannot overwrite it. */
  const matchFrameDataRef = useRef<ImageData | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("video");
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(0);
  const [templateName, setTemplateName] = useState(initialName ?? "");

  const templateTest = useTemplateTest();

  // Stability analysis over the completed batch run (null while running/empty)
  const stabilityStats = useMemo(
    () =>
      !templateTest.isRunning && templateTest.batchResults.size > 0
        ? analyzeStability([...templateTest.batchResults.values()])
        : null,
    [templateTest.isRunning, templateTest.batchResults],
  );

  // Adaptive-polling recommendation from the measured scoring cost (worst
  // case: 10 parallel hunts on half the CPU cores of this machine)
  const pollingRecommendation = useMemo(
    () => (stabilityStats ? recommendPolling(stabilityStats, templateTest.avgScoreMs) : null),
    [stabilityStats, templateTest.avgScoreMs],
  );

  // Whether the calibration is persisted on save; defaults to on unless the
  // analysis rates the template poor.
  const [applyCalibration, setApplyCalibration] = useState(false);

  // Simulation-based parameter sweep over the batch timeline; runs
  // incrementally after the batch test finishes so the UI stays responsive.
  const [sweepResult, setSweepResult] = useState<SweepResult | null>(null);
  const [sweepRunning, setSweepRunning] = useState(false);
  // Generation guard: bumping it invalidates any pending pump callback of an
  // outdated sweep (unmount or a new batch run).
  const sweepGenRef = useRef(0);

  // This template's own detection settings, always maintained per template
  // (not a hunt-level default). Seeded from the template's existing values in
  // edit mode, otherwise from hardcoded defaults.
  const [templateSettings, setTemplateSettings] = useState<TemplateSettingsValues>({
    precision: initialPrecision ?? DEFAULT_PRECISION,
    hysteresisFactor: initialHysteresisFactor ?? DEFAULT_HYSTERESIS_FACTOR,
    consecutiveHits: initialConsecutiveHits ?? DEFAULT_CONSECUTIVE_HITS,
    cooldownSec: initialCooldownSec ?? DEFAULT_COOLDOWN_SEC,
    pollIntervalMs: initialPollIntervalMs ?? DEFAULT_POLL_MS,
    minPollMs: initialMinPollMs ?? MIN_POLL_MS,
    maxPollMs: initialMaxPollMs ?? MAX_POLL_MS,
  });

  // Draft values captured before a recommendation overwrote them, so toggling
  // the apply checkbox off restores what the user had.
  const preApplyRef = useRef<TemplateSettingsValues | null>(null);

  /**
   * Overwrite the draft settings with a recommendation, capturing the previous
   * draft once so toggling apply off can restore it. The capture lives inside
   * the updater (idempotent via ??=) so it always snapshots the latest draft.
   */
  const writeRecommendation = (patch: Partial<TemplateSettingsValues>) =>
    setTemplateSettings((prev) => {
      preApplyRef.current ??= prev;
      return { ...prev, ...patch };
    });

  /** Best available recommendation: the finished sweep wins over the analytic fallback. */
  const recommendationPatch = (): Partial<TemplateSettingsValues> | null => {
    if (sweepResult) {
      return {
        precision: sweepResult.precision,
        hysteresisFactor: sweepResult.hysteresisFactor,
        consecutiveHits: sweepResult.consecutiveHits,
        pollIntervalMs: sweepResult.pollIntervalMs,
        minPollMs: sweepResult.minPollMs,
        maxPollMs: sweepResult.maxPollMs,
      };
    }
    if (stabilityStats) {
      return {
        precision: stabilityStats.recommendedPrecision,
        hysteresisFactor: stabilityStats.recommendedHysteresis,
        ...(pollingRecommendation && {
          pollIntervalMs: pollingRecommendation.basePollMs,
          minPollMs: pollingRecommendation.minPollMs,
          maxPollMs: pollingRecommendation.maxPollMs,
        }),
      };
    }
    return null;
  };

  // Run the parameter sweep whenever a fresh batch analysis appears. Combos
  // are evaluated in 200ms budget slices during idle time, mirroring the
  // chunking pattern of useTemplateTest so the editor never blocks.
  useEffect(() => {
    sweepGenRef.current += 1;
    const gen = sweepGenRef.current;
    setSweepResult(null);
    setSweepRunning(false);
    if (!stabilityStats) return;

    const runner = createSweepRunner({
      samples: [...templateTest.batchResults.values()],
      stats: stabilityStats,
      avgScoreMs: templateTest.avgScoreMs,
      cooldownSec: templateSettings.cooldownSec,
    });
    setSweepRunning(true);
    const schedule = (fn: () => void) => {
      if (typeof requestIdleCallback === "undefined") setTimeout(fn, 0);
      else requestIdleCallback(() => fn());
    };
    const pump = () => {
      if (gen !== sweepGenRef.current) return;
      if (runner.step(200)) {
        setSweepRunning(false);
        setSweepResult(runner.result());
        return;
      }
      schedule(pump);
    };
    schedule(pump);
    return () => { sweepGenRef.current += 1; };
    // Batch results, scoring cost and cooldown are captured at the moment the
    // stats appear; re-running on draft edits would discard a finished sweep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stabilityStats]);

  useEffect(() => {
    const shouldApply = stabilityStats !== null && stabilityStats.rating !== "poor";
    setApplyCalibration(shouldApply);
    // Analytic fallback, applied immediately so the draft is sensible while
    // the sweep is still running; the sweep effect below refines it once done.
    if (shouldApply && stabilityStats) {
      writeRecommendation({
        precision: stabilityStats.recommendedPrecision,
        hysteresisFactor: stabilityStats.recommendedHysteresis,
        ...(pollingRecommendation && {
          pollIntervalMs: pollingRecommendation.basePollMs,
          minPollMs: pollingRecommendation.minPollMs,
          maxPollMs: pollingRecommendation.maxPollMs,
        }),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stabilityStats]);

  useEffect(() => {
    if (!sweepResult || !stabilityStats || stabilityStats.rating === "poor") return;
    // The finished sweep supersedes the analytic values with the full swept
    // parameter set (including consecutive hits and polling bounds).
    setApplyCalibration(true);
    writeRecommendation({
      precision: sweepResult.precision,
      hysteresisFactor: sweepResult.hysteresisFactor,
      consecutiveHits: sweepResult.consecutiveHits,
      pollIntervalMs: sweepResult.pollIntervalMs,
      minPollMs: sweepResult.minPollMs,
      maxPollMs: sweepResult.maxPollMs,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sweepResult]);

  /**
   * Toggling "apply calibration" on writes the current recommendation into
   * this template's draft values; toggling it off restores the pre-apply draft.
   */
  const handleToggleApplyCalibration = (v: boolean) => {
    setApplyCalibration(v);
    if (v) {
      const patch = recommendationPatch();
      if (patch) writeRecommendation(patch);
    } else if (preApplyRef.current) {
      setTemplateSettings(preApplyRef.current);
      preApplyRef.current = null;
    }
  };

  // Browser-based replay buffer capturing from the stream at 60fps
  const replayBuffer = useReplayBuffer(stream ? videoEl : null);
  const [snapshotWidth, setSnapshotWidth] = useState(0);
  const [snapshotHeight, setSnapshotHeight] = useState(0);

  // Array of confirmed regions (absolute pixel coords in the snapshot)
  const [regions, setRegions] = useState<MatchedRegion[]>([]);

  // Bounding box drawing state (relative coords 0.0 - 1.0)
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentBox, setCurrentBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { recognize, isRecognizing, ocrError } = useOCR({ lang: ocrLang });

  // Track the actual rendered image area within the object-contain container.
  const [imageBounds, setImageBounds] = useState<{
    offsetX: number; offsetY: number; renderedW: number; renderedH: number;
  } | null>(null);

  const updateImageBounds = useCallback(
    () => computeImageBounds(containerRef.current, snapshotWidth, snapshotHeight, setImageBounds),
    [snapshotWidth, snapshotHeight],
  );

  useEffect(
    () => observeImageBounds(phase, snapshotWidth, snapshotHeight, containerRef.current, updateImageBounds, setImageBounds),
    [phase, snapshotWidth, snapshotHeight, updateImageBounds],
  );

  // In edit mode, load the existing template image into the canvas immediately.
  useEffect(
    () => loadInitialImage(initialImageUrl, canvasRef.current, initialRegions, setSnapshotWidth, setSnapshotHeight, setPhase, setRegions),
    [initialImageUrl], // only run once on mount
  );

  // Wire the stream to the video element when in "video" phase
  useEffect(
    () => wireStreamToVideo(phase, videoEl, stream),
    [stream, phase, videoEl],
  );

  // Render selected replay frame to canvas (replay and test phases)
  useEffect(() => {
    if (phase === "replay" || phase === "test") {
      renderReplayFrame(replayBuffer.getFrame(selectedFrameIndex), canvasRef.current, setSnapshotWidth, setSnapshotHeight);
    }
  }, [phase, selectedFrameIndex, replayBuffer]);

  // Keyboard navigation in replay and test phases. The replay phase is scoped
  // to the frames present at snapshot time; extension frames only become
  // navigable in the test phase.
  const navigableFrameCount = phase === "replay" ? replayBuffer.snapshotFrameCount : replayBuffer.frameCount;
  useEffect(() => {
    if (phase !== "replay" && phase !== "test") return;

    const handleKeyDown = (e: KeyboardEvent) =>
      handleReplayKeyDown(e, navigableFrameCount, setSelectedFrameIndex);

    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [phase, navigableFrameCount]);

  // Auto-focus the name input when entering the confirm phase
  useEffect(() => {
    if (phase === "confirm") {
      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
  }, [phase]);

  // --- Snapshot and replay handlers ------------------------------------------

  const resetToSnapshot = () => { setRegions([]); setCurrentBox(null); setErrorMsg(null); };

  /**
   * Enter replay phase to browse captured frames. The buffer keeps recording
   * seamlessly for up to 5 more seconds past the ring (extend), so the test
   * step gets up to 10 seconds of footage. Recording stops early if the user
   * enters the test step before the extension window is full.
   */
  const handleTakeSnapshot = () => {
    const snapshotCount = replayBuffer.extend();
    if (snapshotCount > 0) {
      setSelectedFrameIndex(snapshotCount - 1);
      setPhase("replay");
    } else {
      captureVideoFrame(videoEl, canvasRef.current, setSnapshotWidth, setSnapshotHeight, setPhase, resetToSnapshot);
    }
  };

  /** Use the currently selected replay frame as the snapshot to draw regions on. */
  const handleUseFrame = () => {
    const frame = replayBuffer.getFrame(selectedFrameIndex);
    if (frame) matchFrameDataRef.current = frame;
    drawFrameToCanvas(frame, canvasRef.current, setSnapshotWidth, setSnapshotHeight, setPhase, resetToSnapshot);
  };

  /** Clear all state and return to live video, restarting the replay buffer. */
  const returnToLive = () => {
    setPhase("video");
    setSelectedFrameIndex(0);
    setCurrentBox(null);
    setRegions([]);
    setErrorMsg(null);
    matchFrameDataRef.current = null;
    replayBuffer.restart();
  };

  /** Go back to live video from replay — restarts the replay buffer. */
  const handleBackToLive = returnToLive;

  /** Reset the snapshot and go back to live video — restarts the replay buffer. */
  const resetSnapshot = returnToLive;

  // --- Region drawing --------------------------------------------------------

  const getRelativeMousePos = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) =>
    computeRelativePos(e, containerRef.current, imageBounds);

  const onPointerDown = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (phase !== "snapshot") return;
    setIsDrawing(true);
    const pos = getRelativeMousePos(e);
    setStartPos(pos);
    setCurrentBox({ x: pos.x, y: pos.y, w: 0, h: 0 });
  };

  const onPointerMove = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (!isDrawing || phase !== "snapshot") return;
    const pos = getRelativeMousePos(e);
    setCurrentBox({
      x: Math.min(startPos.x, pos.x),
      y: Math.min(startPos.y, pos.y),
      w: Math.abs(pos.x - startPos.x),
      h: Math.abs(pos.y - startPos.y),
    });
  };

  const onPointerUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    commitDrawnRegion(currentBox, canvasRef.current, setRegions);
    setCurrentBox(null);
  };

  /**
   * Keyboard-driven parallel path to draw a region box, mirroring the mouse/touch
   * drag flow: Enter starts a box, arrow keys move it, Shift+arrow resizes it,
   * Enter again commits it, Escape cancels the pending box.
   */
  const onRegionKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (phase !== "snapshot") return;
    if (!currentBox) {
      if (e.key === "Enter") {
        e.preventDefault();
        setCurrentBox(REGION_DEFAULT_BOX);
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      commitDrawnRegion(currentBox, canvasRef.current, setRegions);
      setCurrentBox(null);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setCurrentBox(null);
    } else if (ARROW_KEYS.has(e.key)) {
      e.preventDefault();
      setCurrentBox(e.shiftKey ? resizeBoxByKey(currentBox, e.key) : moveBoxByKey(currentBox, e.key));
    }
  };

  const updateRegion = (index: number, updates: Partial<MatchedRegion>) =>
    setRegions((prev) => applyRegionUpdate(prev, index, updates, pokemonName));

  const deleteRegion = (index: number) => {
    setRegions(regions.filter((_, i) => i !== index));
  };

  const handleRunOCR = async (regionIndex: number) => {
    const recognized = await runRegionOCR(regions[regionIndex], canvasRef.current, recognize, ocrLang);
    if (recognized) updateRegion(regionIndex, { expected_text: recognized });
  };

  // --- Flow transition handlers (test/confirm) --------------------------------

  const handleGoToTest = () => {
    replayBuffer.stop();
    setPhase("test");
    // Snapshot the canvas as the match frame if not already stored (covers edit mode and direct capture)
    if (!matchFrameDataRef.current && canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        matchFrameDataRef.current = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }
    if (canvasRef.current && replayBuffer.frameCount > 0) {
      restoreMatchFrame(matchFrameDataRef.current, canvasRef.current);
      templateTest.runBatch(canvasRef.current, regions, replayBuffer.getFrame, replayBuffer.frameCount);
      const frame = replayBuffer.getFrame(selectedFrameIndex);
      if (frame) {
        templateTest.scoreFrame(canvasRef.current, regions, frame);
      }
    }
  };

  /** In edit mode without replay frames, skip test and go straight to confirm. */
  const handleGoToTestOrConfirm = () => {
    if (replayBuffer.frameCount > 0) {
      handleGoToTest();
    } else {
      setPhase("confirm");
    }
  };

  const handlePickFrame = () => {
    templateTest.cancel();
    // The replay phase only exposes the pre-snapshot frames; clamp in case
    // the user scrubbed into the extension frames during the test phase
    setSelectedFrameIndex((i) => Math.min(i, Math.max(0, replayBuffer.snapshotFrameCount - 1)));
    setPhase("replay");
  };

  const handleAdjustRegions = () => {
    templateTest.cancel();
    setPhase("snapshot");
  };

  const handleLooksGood = () => {
    // Restore the original match frame so the confirm/save step uses the correct image
    restoreMatchFrame(matchFrameDataRef.current, canvasRef.current);
    setPhase("confirm");
  };

  const handleBackToTest = () => {
    setPhase("test");
    if (canvasRef.current && replayBuffer.frameCount > 0) {
      // Restore the original match frame before batch scoring so the template is correct
      restoreMatchFrame(matchFrameDataRef.current, canvasRef.current);
      templateTest.runBatch(canvasRef.current, regions, replayBuffer.getFrame, replayBuffer.frameCount);
      // Score the currently selected frame immediately so the panel isn't empty
      const frame = replayBuffer.getFrame(selectedFrameIndex);
      if (frame) {
        renderReplayFrame(frame, canvasRef.current, setSnapshotWidth, setSnapshotHeight);
        templateTest.scoreFrame(canvasRef.current, regions, frame);
      }
    }
  };

  const handleConfirmSave = () => {
    saveTemplate({
      canvas: canvasRef.current,
      regions,
      templateName: templateName.trim() || "",
      calibration: applyCalibration && stabilityStats ? toCalibration(stabilityStats, sweepResult ?? undefined) : undefined,
      settings: templateSettings,
      onUpdateRegions,
      onSaveTemplate,
      setIsSaving,
      setErrorMsg,
    });
  };

  const hasTextRegion = regions.some((r) => r.type === "text");
  // Distinct non-empty category names in first-seen order, for autocomplete and
  // consistent chip colors across all region cards.
  const categoryNames = [...new Set(
    regions.map((r) => (r.category ?? "").trim()).filter((c) => c !== ""),
  )];
  const isEditMode = !!initialImageUrl || !!onUpdateRegions;

  const { heading, hint } = getHeadingAndHint(isEditMode, phase, t);

  const isSnapshotPhase = phase === "snapshot";
  const cursorClass = isSnapshotPhase ? "cursor-crosshair" : "cursor-default";
  const pointerDown = isSnapshotPhase ? onPointerDown : undefined;
  const pointerMove = isSnapshotPhase ? onPointerMove : undefined;
  const pointerUp = isSnapshotPhase ? onPointerUp : undefined;
  const regionKeyDown = isSnapshotPhase ? onRegionKeyDown : undefined;

  // --- Render ----------------------------------------------------------------

  const modalContent = (
    <div className="fixed inset-0 z-100 bg-black/95 flex flex-col items-center justify-center p-4 md:p-6 backdrop-blur-sm overflow-y-auto">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 md:top-8 md:right-8 p-3 rounded-none text-white hover:bg-white/10 transition-colors z-110"
      >
        <X className="w-6 h-6 2xl:w-7 2xl:h-7" />
      </button>

      <div className="text-white text-center mb-2 mt-4 shrink-0">
        {!isEditMode && (
          <div className="flex justify-center mb-3">
            <StepIndicator phase={phase} t={t} />
          </div>
        )}
        <h2 className="text-xl 2xl:text-2xl font-bold mb-1">{heading}</h2>
        <p className="text-sm 2xl:text-base text-gray-400 mb-2">{hint}</p>
      </div>

      {/* Region drawing surface — pointer events only active in snapshot phase */}
      {/* NOSONAR: non-native interactive element is intentional for freeform region drawing */}
      <div // NOSONAR
        ref={containerRef}
        tabIndex={isSnapshotPhase ? 0 : undefined}
        role={isSnapshotPhase ? "application" : undefined}
        aria-label={isSnapshotPhase ? t("aria.regionDrawSurface") : undefined}
        className={`relative w-full ${phase === "confirm" ? "max-w-[40vw] max-h-[30vh]" : "max-w-[80vw] 2xl:max-w-[85vw] max-h-[55vh] 2xl:max-h-[60vh]"} aspect-video bg-black rounded-none overflow-hidden shadow-2xl mb-3 flex items-center justify-center select-none touch-none ${cursorClass}`}
        onMouseDown={pointerDown}
        onMouseMove={pointerMove}
        onMouseUp={pointerUp}
        onMouseLeave={pointerUp}
        onTouchStart={pointerDown}
        onTouchMove={pointerMove}
        onTouchEnd={pointerUp}
        onKeyDown={regionKeyDown}
      >
        {/* Video feed layer -- hidden in edit mode */}
        {!isEditMode && (
          <>
            <video
              ref={videoRef}
              className={`w-full h-full object-contain pointer-events-none ${phase === "video" ? "" : "hidden"}`}
              autoPlay
              playsInline
              muted
            />
            {phase === "video" && replayBuffer.isBuffering && (
              <div
                className="absolute top-3 right-3 flex items-center gap-2 bg-black/70 backdrop-blur-sm px-3 py-1.5 rounded-none text-xs font-mono text-white"
                title={t("templateEditor.bufferLoopHint")}
              >
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                {Math.floor(replayBuffer.bufferedSeconds)}s / {replayBuffer.maxSeconds}s
                {replayBuffer.bufferedSeconds >= replayBuffer.maxSeconds && (
                  <RefreshCw className="w-3 h-3 text-white/60 animate-spin" style={{ animationDuration: "3s" }} aria-label={t("templateEditor.bufferLoopHint")} />
                )}
              </div>
            )}
          </>
        )}

        {/* Snapshot canvas layer */}
        <canvas
          ref={canvasRef}
          className={`w-full h-full object-contain pointer-events-none ${phase === "snapshot" || phase === "replay" || phase === "test" || phase === "confirm" ? "" : "hidden"}`}
        />

        {/* Overlay wrapper for regions and drawing box */}
        {(phase === "snapshot" || phase === "replay" || phase === "test" || phase === "confirm") && imageBounds && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: imageBounds.offsetX,
              top: imageBounds.offsetY,
              width: imageBounds.renderedW,
              height: imageBounds.renderedH,
            }}
          >
            {/* Existing regions */}
            {snapshotWidth > 0 && regions.map((r, i) => {
              const regionScore = phase === "test" && templateTest.currentResult
                ? templateTest.currentResult.regionScores.find((rs) => rs.index === i)?.score
                : undefined;
              return (
                <RegionOverlayMarker
                  key={`region-${r.type}-${r.rect.x}-${r.rect.y}-${i}`}
                  region={r}
                  index={i}
                  snapshotWidth={snapshotWidth}
                  snapshotHeight={snapshotHeight}
                  scoreBadge={regionScore}
                  chipColor={categoryColor(r.category, categoryNames)}
                />
              );
            })}

            {/* Current drawing box */}
            {currentBox && currentBox.w > 0 && currentBox.h > 0 && (
              <div
                className="absolute border-2 border-yellow-400 border-dashed bg-yellow-400/15 pointer-events-none"
                style={{
                  left: `${currentBox.x * 100}%`,
                  top: `${currentBox.y * 100}%`,
                  width: `${currentBox.w * 100}%`,
                  height: `${currentBox.h * 100}%`,
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Replay Timeline (replay phase), scoped to the frames present at
          snapshot time; extension frames stay hidden until the test phase */}
      {phase === "replay" && replayBuffer.snapshotFrameCount > 0 && (
        <div className="w-full max-w-[80vw] 2xl:max-w-[85vw] mb-4 px-8">
          <div className="flex items-center gap-4">
            <span className="text-white text-sm 2xl:text-base font-mono shrink-0">
              {(() => {
                const totalSec = replayBuffer.snapshotSeconds;
                const secPerFrame = totalSec / replayBuffer.snapshotFrameCount;
                const currentSec = selectedFrameIndex * secPerFrame;
                const relative = currentSec - totalSec;
                return Math.abs(relative) < 0.1 ? "now" : `${Math.round(relative)}s`;
              })()}
            </span>
            <input
              type="range"
              min={0}
              max={replayBuffer.snapshotFrameCount - 1}
              value={selectedFrameIndex}
              onChange={(e) => setSelectedFrameIndex(Number(e.target.value))}
              className="flex-1 h-2 bg-bg-hover border border-border-subtle rounded-none appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-none [&::-webkit-slider-thumb]:bg-accent-blue [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_var(--accent-blue)]
                [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-none [&::-moz-range-thumb]:bg-accent-blue [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:shadow-[0_0_0_1px_var(--accent-blue)]"
            />
            <span className="text-white/60 text-xs 2xl:text-sm shrink-0">
              {selectedFrameIndex + 1} / {replayBuffer.snapshotFrameCount}
            </span>
          </div>
          <p className="text-xs 2xl:text-sm text-text-muted text-center mt-2">
            {t("templateEditor.replayKeys")}
          </p>
        </div>
      )}

      {/* Test Phase UI */}
      {phase === "test" && (
        <>
          {/* Flow legend: state colors, match count, precision */}
          <div className="w-full max-w-[80vw] 2xl:max-w-[85vw] mb-1 px-8">
            <FlowLegend
              batchResults={templateTest.batchResults}
              settings={{
                precision: templateSettings.precision,
                hysteresisFactor: templateSettings.hysteresisFactor,
                consecutiveHits: templateSettings.consecutiveHits,
                cooldownSec: templateSettings.cooldownSec,
              }}
              t={t}
            />
          </div>

          {/* Timeline: a single scrubber whose track paints the contiguous
              detection-flow segments (searching/match/hysteresis/cooldown)
              instead of a separate per-frame bar chart above a plain slider.
              Near-transparent bg-primary tint instead of a bg-secondary/
              bg-hover tile, which read as a floating grey box against the
              editor's near-black backdrop. */}
          {replayBuffer.frameCount > 0 && (() => {
            // Only paint the flow gradient once scoring has settled — while
            // templateTest.isRunning, results trickle in frame by frame and
            // an early, still-incomplete state can register a spurious
            // one-frame "match" that flashes at the timeline's start before
            // the batch finishes. The flat track is a better placeholder
            // than a misleading flicker.
            const flow = templateTest.isRunning ? null : buildFlowGradient(
              Array.from(templateTest.batchResults.entries())
                .sort(([a], [b]) => a - b) as [number, { overallScore: number }][],
              {
                precision: templateSettings.precision,
                hysteresisFactor: templateSettings.hysteresisFactor,
                consecutiveHits: templateSettings.consecutiveHits,
                cooldownSec: templateSettings.cooldownSec,
              },
              Math.max(replayBuffer.frameCount - 1, 1),
            );
            return (
              <div className="w-full max-w-[80vw] 2xl:max-w-[85vw] mb-3 px-8">
                <div className="flex items-center gap-4">
                  <span className="text-white text-sm 2xl:text-base font-mono shrink-0">
                    {selectedFrameIndex + 1} / {replayBuffer.frameCount}
                  </span>
                  <div className="relative flex-1 h-3">
                    {/* Hysteresis hatch: the opaque hysteresis color plus a
                        diagonal stripe layer — same two-part recipe as the
                        legend swatch, so the two render identically instead
                        of the gradient's own (transparent, mixed-with-page-
                        background) version of the color drifting from it.
                        One static div per range, painted first (below,
                        plain DOM order, no z-index needed) so it never has
                        to move or split around the thumb; the corresponding
                        gradient stop is fully transparent there (see
                        buildFlowGradient) so this is the only color drawn.
                        The thumb itself is part of the input's own top
                        layer and is never at risk of being covered. */}
                    {flow?.hysteresisRanges.map(({ x1, x2 }) => (
                      <div
                        key={`${x1}-${x2}`}
                        aria-hidden="true"
                        className="absolute inset-0 pointer-events-none"
                        style={{
                          left: `${x1}%`,
                          width: `${x2 - x1}%`,
                          backgroundColor: flowStateColor("hysteresis"),
                          backgroundImage: "repeating-linear-gradient(135deg, transparent 0 3px, color-mix(in srgb, var(--bg-primary) 55%, transparent) 3px 4px)",
                        }}
                      />
                    ))}
                    <input
                      type="range" min={0} max={replayBuffer.frameCount - 1}
                      value={selectedFrameIndex}
                      onChange={(e) => {
                        const idx = Number(e.target.value);
                        setSelectedFrameIndex(idx);
                        const frame = replayBuffer.getFrame(idx);
                        if (frame && canvasRef.current) {
                          renderReplayFrame(frame, canvasRef.current, setSnapshotWidth, setSnapshotHeight);
                          templateTest.scoreFrame(canvasRef.current, regions, frame);
                        }
                      }}
                      style={{
                        background: flow?.gradient ?? "color-mix(in srgb, var(--bg-primary) 55%, transparent)",
                        borderColor: "color-mix(in srgb, var(--border-subtle) 70%, transparent)",
                      }}
                      className="block relative w-full h-3 border rounded-none appearance-none cursor-pointer
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-none [&::-webkit-slider-thumb]:bg-text-primary [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_var(--bg-primary)]
                        [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-none [&::-moz-range-thumb]:bg-text-primary [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:shadow-[0_0_0_1px_var(--bg-primary)]"
                    />
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Score Panel */}
          <div className="w-full max-w-lg 2xl:max-w-xl px-4 mb-3 space-y-2">
            {templateTest.isRunning && (
              <div className="flex items-center gap-3 text-sm text-text-muted mb-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t("templateEditor.testRunning")}</span>
                <div className="flex-1 h-1.5 bg-white/10 rounded-none overflow-hidden">
                  <div className="h-full bg-accent-blue rounded-none transition-all" style={{ width: `${templateTest.progress * 100}%` }} />
                </div>
              </div>
            )}
            {templateTest.currentResult && (
              <>
                <ScoreBar label={t("templateEditor.testOverall")} score={templateTest.currentResult.overallScore} precision={templateSettings.precision} precisionLabel={t("detector.precision")} />
                {templateTest.currentResult.regionScores.map((rs) => (
                  <ScoreBar
                    key={rs.index}
                    label={`${t("templateEditor.regionN")} ${rs.index + 1}`}
                    score={rs.score}
                    precision={templateSettings.precision}
                    precisionLabel={t("detector.precision")}
                  />
                ))}
              </>
            )}
            {!templateTest.isRunning && templateTest.bestScore < templateSettings.precision && templateTest.batchResults.size > 0 && (
              <p className="text-xs 2xl:text-sm text-amber-400 text-center mt-2">
                {t("templateEditor.testLowScoreHint")}
              </p>
            )}
          </div>

        </>
      )}

      {/* Confirm Phase UI */}
      {phase === "confirm" && (
        <div className="w-full max-w-md 2xl:max-w-lg px-4 mb-4 space-y-4">
          {/* Name input */}
          <input
            ref={nameInputRef}
            type="text"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleConfirmSave(); }}
            placeholder={t("templateEditor.templateName")}
            className="w-full px-4 py-3 text-sm bg-bg-secondary border border-border-subtle rounded-none text-text-primary placeholder-text-muted outline-none focus:border-accent-blue/50 transition-colors"
            aria-label={t("templateEditor.templateName")}
          />

          {/* Summary */}
          <div className="flex items-center justify-center gap-4 text-sm text-text-muted">
            <span>{t("templateEditor.regionSummary").replace("{count}", String(regions.length))}</span>
            {templateTest.bestScore > 0 && (
              <>
                <span className="text-border-subtle">&middot;</span>
                <span>{t("templateEditor.bestScore")}: {(templateTest.bestScore * 100).toFixed(0)}%</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Region List Editor */}
      {phase === "snapshot" && regions.length > 0 && (
        <div className="w-full max-w-4xl 2xl:max-w-5xl flex flex-wrap justify-center gap-2 mb-2 max-h-28 2xl:max-h-36 overflow-y-auto px-4 scrollbar-thin scrollbar-thumb-border-subtle hover:scrollbar-thumb-border-strong text-white z-50 rounded-none">
          {regions.map((r, i) => (
            <RegionEditCard
              key={`region-edit-${r.type}-${r.rect.x}-${r.rect.y}-${i}`}
              region={r}
              index={i}
              onUpdate={updateRegion}
              onDelete={deleteRegion}
              onRunOCR={handleRunOCR}
              isRecognizing={isRecognizing}
              categoryNames={categoryNames}
              t={t}
            />
          ))}
        </div>
      )}

      {/* Hints below region list */}
      {phase === "snapshot" && (
        <div className="w-full max-w-4xl px-4 mb-2 flex flex-col items-center gap-1">
          {regions.length === 0 && (
            <p className="text-xs 2xl:text-sm text-amber-400 text-center">
              {t("templateEditor.regionsRequired")}
            </p>
          )}
          {hasTextRegion && (
            <p className="text-xs 2xl:text-sm text-amber-400 text-center">
              {t("templateEditor.ocrHint")}
            </p>
          )}
          {ocrError && (
            <p className="text-xs 2xl:text-sm text-red-400 text-center">
              {t("templateEditor.ocrError", { error: ocrError })}
            </p>
          )}
        </div>
      )}

      {/* Flow Controls */}
      <div className="flex flex-col items-center gap-3 w-full max-w-md 2xl:max-w-lg shrink-0">
        {isEditMode && phase === "snapshot" ? (
          <div className="flex w-full gap-3">
            <button
              onClick={onClose}
              disabled={isSaving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-4 2xl:py-5 rounded-none border border-border-subtle bg-bg-card text-text-primary hover:bg-bg-hover text-sm 2xl:text-base font-bold whitespace-nowrap transition-colors disabled:opacity-50"
            >
              {t("templateEditor.cancel")}
            </button>
            <button
              onClick={handleGoToTestOrConfirm}
              disabled={regions.length === 0}
              className="t-cut flex-2 flex items-center justify-center gap-2 px-6 py-4 2xl:py-5 rounded-none text-sm 2xl:text-base font-bold whitespace-nowrap bg-accent-blue text-bg-primary hover:bg-accent-blue/90 transition-colors disabled:opacity-50"
            >
              <BarChart3 className="w-5 h-5 2xl:w-6 2xl:h-6 shrink-0" />
              {t("templateEditor.next")}
              <ArrowRight className="w-4 h-4 shrink-0" />
            </button>
          </div>
        ) : (
          <NewTemplateControls
            phase={phase}
            isSaving={isSaving}
            hasRegions={regions.length > 0}
            onTakeSnapshot={handleTakeSnapshot}
            onResetSnapshot={resetSnapshot}
            onSave={handleConfirmSave}
            onUseFrame={handleUseFrame}
            onBackToLive={handleBackToLive}
            onGoToTest={handleGoToTestOrConfirm}
            onPickFrame={handlePickFrame}
            onAdjustRegions={handleAdjustRegions}
            onLooksGood={handleLooksGood}
            onBackToTest={handleBackToTest}
            stabilityStatus={
              <StabilityStatus
                stats={stabilityStats}
                polling={pollingRecommendation}
                sweep={sweepResult}
                sweepRunning={sweepRunning}
                batchRunning={templateTest.isRunning}
                applyCalibration={applyCalibration}
                onToggleApply={handleToggleApplyCalibration}
                t={t}
              />
            }
            t={t}
          />
        )}

        {errorMsg && (
          <div className="w-full px-4 py-3 bg-red-500/10 text-red-500 text-sm 2xl:text-base text-center rounded-none font-medium border border-red-500/20">
            {errorMsg}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
