/**
 * TemplateEditor.tsx — Template creation and region editing for auto-detection.
 *
 * In new-template mode, shows a live preview from the CaptureService stream,
 * lets the user take a replay-buffer snapshot via useReplayBuffer, scrub through
 * frames to pick the best one, then draw detection regions on it.
 * In edit mode, loads an existing template image for region editing.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  X, Camera, Save, RefreshCw, Trash2, Image as ImageIcon,
  Type, Loader2, ScanText, Play, ArrowRight, BarChart3, ArrowLeft,
} from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { MatchedRegion } from "../../types";
import { useOCR } from "../../hooks/useOCR";
import { useReplayBuffer } from "../../hooks/useReplayBuffer";
import { useTemplateTest } from "../../hooks/useTemplateTest";

// --- Props -------------------------------------------------------------------

export type TemplateEditorProps = Readonly<{
  /** Live video stream for new-template mode. If omitted, edit mode is assumed. */
  stream?: MediaStream;
  onClose: () => void;
  /** Called when saving a new template (new-template mode). */
  onSaveTemplate?: (payload: { imageBase64: string; regions: MatchedRegion[]; name?: string }) => Promise<void>;
  /** Called when updating regions of an existing template (edit mode). */
  onUpdateRegions?: (regions: MatchedRegion[], name?: string) => void | Promise<void>;
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
  /** Detection precision threshold (0.0–1.0) for test step visualization. */
  precision?: number;
  /** Cooldown in seconds after a confirmed match. */
  cooldownSec?: number;
}>;

type Phase = "video" | "replay" | "snapshot" | "test" | "confirm";

// --- Flow Controls -----------------------------------------------------------

/** Flow controls for creating a new template (all 5 phases). */
function NewTemplateControls({
  phase, isSaving, hasRegions,
  onTakeSnapshot, onResetSnapshot, onSave,
  onUseFrame, onBackToLive,
  onGoToTest, onPickFrame, onAdjustRegions, onLooksGood, onBackToTest,
  t,
}: Readonly<{
  phase: Phase;
  isSaving: boolean;
  hasRegions: boolean;
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
        className="flex items-center justify-center gap-2 w-full px-6 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold whitespace-nowrap bg-accent-blue text-white shadow-lg shadow-accent-blue/20 hover:bg-accent-blue/90 hover:scale-[1.02] transition-all"
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
          className="flex-1 flex items-center justify-center gap-2 px-4 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold whitespace-nowrap bg-white/10 text-white hover:bg-white/20 transition-all"
        >
          <Play className="w-4 h-4 2xl:w-5 2xl:h-5 shrink-0" />
          {t("templateEditor.backToLive")}
        </button>
        <button
          onClick={onUseFrame}
          className="flex-2 flex items-center justify-center gap-2 px-6 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold whitespace-nowrap bg-accent-blue text-white shadow-lg shadow-accent-blue/20 hover:bg-accent-blue/90 hover:scale-[1.02] transition-all"
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
          className="flex-1 flex items-center justify-center gap-2 px-4 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold whitespace-nowrap bg-white/10 text-white hover:bg-white/20 transition-all"
        >
          <RefreshCw className="w-4 h-4 2xl:w-5 2xl:h-5 shrink-0" />
          {t("templateEditor.retake")}
        </button>
        <button
          onClick={onGoToTest}
          disabled={!hasRegions}
          className="flex-2 flex items-center justify-center gap-2 px-6 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold whitespace-nowrap bg-accent-blue text-white shadow-lg shadow-accent-blue/20 hover:bg-accent-blue/90 hover:scale-[1.02] transition-all disabled:opacity-50"
        >
          <BarChart3 className="w-5 h-5 2xl:w-6 2xl:h-6 shrink-0" />
          {t("templateEditor.next")}
          <ArrowRight className="w-4 h-4 shrink-0" />
        </button>
      </div>
    );
  }

  if (phase === "test") {
    return (
      <div className="flex w-full gap-3">
        <button
          onClick={onPickFrame}
          className="flex items-center justify-center gap-2 px-4 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold whitespace-nowrap bg-white/10 text-white hover:bg-white/20 transition-all"
        >
          <Camera className="w-4 h-4 2xl:w-5 2xl:h-5 shrink-0" />
          {t("templateEditor.pickFrame")}
        </button>
        <button
          onClick={onAdjustRegions}
          className="flex items-center justify-center gap-2 px-4 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold whitespace-nowrap bg-white/10 text-white hover:bg-white/20 transition-all"
        >
          <RefreshCw className="w-4 h-4 2xl:w-5 2xl:h-5 shrink-0" />
          {t("templateEditor.adjustRegions")}
        </button>
        <button
          onClick={onLooksGood}
          className="flex-1 flex items-center justify-center gap-2 px-6 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold whitespace-nowrap bg-accent-blue text-white shadow-lg shadow-accent-blue/20 hover:bg-accent-blue/90 hover:scale-[1.02] transition-all"
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
        className="flex-1 flex items-center justify-center gap-2 px-4 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold whitespace-nowrap bg-white/10 text-white hover:bg-white/20 transition-all"
      >
        <ArrowLeft className="w-4 h-4 2xl:w-5 2xl:h-5 shrink-0" />
        {t("templateEditor.back")}
      </button>
      <button
        onClick={onSave}
        disabled={isSaving}
        className="flex-2 flex items-center justify-center gap-2 px-6 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold whitespace-nowrap bg-accent-blue text-white shadow-lg shadow-accent-blue/20 hover:bg-accent-blue/90 hover:scale-[1.02] transition-all disabled:opacity-50"
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
function RegionOverlayMarker({ region, index, snapshotWidth, snapshotHeight, scoreBadge }: Readonly<{
  region: MatchedRegion; index: number; snapshotWidth: number; snapshotHeight: number;
  scoreBadge?: number;
}>) {
  const isText = region.type === "text";
  const borderStyle = isText ? "border-purple-500 bg-purple-500/30" : "border-accent-blue bg-accent-blue/30";
  const labelColor = isText ? "text-purple-400" : "text-accent-blue";
  const regionIcon = isText
    ? <Type className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />
    : <ImageIcon className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />;

  return (
    <div
      className={`absolute border-[3px] pointer-events-none transition-colors ${borderStyle}`}
      style={{
        left: `${(region.rect.x / snapshotWidth) * 100}%`,
        top: `${(region.rect.y / snapshotHeight) * 100}%`,
        width: `${(region.rect.w / snapshotWidth) * 100}%`,
        height: `${(region.rect.h / snapshotHeight) * 100}%`,
      }}
    >
      <div className="absolute -top-6 left-0 flex items-center gap-1 bg-black/80 px-1.5 py-0.5 2xl:px-2 2xl:py-1 rounded text-white font-mono text-xs 2xl:text-sm whitespace-nowrap shadow-lg ring-1 ring-black/30">
        <strong className={labelColor}>#{index + 1}</strong>
        {regionIcon}
        {isText && region.expected_text ? (
          <span className="opacity-80 ml-1 truncate max-w-15">"{region.expected_text}"</span>
        ) : null}
        {scoreBadge !== undefined && (() => {
          let scoreColor: string;
          if (scoreBadge >= 0.8) scoreColor = "text-green-400";
          else if (scoreBadge >= 0.5) scoreColor = "text-amber-400";
          else scoreColor = "text-red-400";
          return (
            <span className={`ml-1 font-bold ${scoreColor}`}>
              {(scoreBadge * 100).toFixed(0)}%
            </span>
          );
        })()}
      </div>
    </div>
  );
}

// --- Score Display Components ------------------------------------------------

/** Score bar with precision threshold marker. */
function ScoreBar({ label, score, precision, precisionLabel }: Readonly<{
  label: string; score: number; precision?: number; precisionLabel?: string;
}>) {
  const threshold = precision ?? 0.55;
  const isMatch = score >= threshold;
  const pct = (score * 100).toFixed(0);
  const thresholdPct = (threshold * 100).toFixed(0);
  return (
    <div className="flex items-center gap-3 text-sm text-white">
      <meter
        className="sr-only"
        value={score * 100}
        min={0}
        max={100}
        aria-label={`${label}: ${pct}%`}
      />
      <span className="w-28 truncate text-text-muted text-xs 2xl:text-sm">{label}</span>
      <div className="relative flex-1 h-2.5 bg-white/6 rounded-full">
        <div
          className={`h-full rounded-full transition-all ${isMatch ? "bg-green-500" : "bg-white/20"}`}
          style={{ width: `${score * 100}%` }}
        />
        {/* Precision threshold marker */}
        <div
          className="absolute -top-1 -bottom-1 w-0.5 bg-green-400/70 rounded-full"
          style={{ left: `${threshold * 100}%` }}
          aria-label={`${precisionLabel ?? "Precision"}: ${thresholdPct}%`}
        >
          <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[8px] 2xl:text-[9px] text-green-400/70 font-mono whitespace-nowrap pointer-events-none">
            {thresholdPct}%
          </div>
        </div>
      </div>
      <span className={`w-12 text-right font-mono text-xs font-bold ${isMatch ? "text-green-400" : "text-text-muted"}`}>
        {pct}%
      </span>
    </div>
  );
}

/** Hysteresis factor: after a match, score must drop to precision × this value. */
const HYSTERESIS_FACTOR = 0.7;

/** Detection flow state for each frame. */
type FlowState = "searching" | "match" | "hysteresis" | "cooldown";

/** Zone span in the sparkline. */
interface FlowZone { startIdx: number; endIdx: number; type: "hysteresis" | "cooldown" }

/** Mutable context passed through the detection state machine. */
interface FlowContext {
  phase: "searching" | "hysteresis" | "cooldown";
  zoneStart: number;
  cooldownRemaining: number;
  states: Map<number, FlowState>;
  zones: FlowZone[];
  threshold: number;
  hysteresisExit: number;
  cooldownFrames: number;
}

/** Process a single frame during the hysteresis phase. */
function processHysteresisFrame(ctx: FlowContext, idx: number, score: number): void {
  if (score < ctx.hysteresisExit) {
    ctx.zones.push({ startIdx: ctx.zoneStart, endIdx: idx, type: "hysteresis" });
    ctx.phase = "cooldown";
    ctx.cooldownRemaining = ctx.cooldownFrames;
    ctx.zoneStart = idx;
    ctx.states.set(idx, "cooldown");
  } else {
    ctx.states.set(idx, "hysteresis");
  }
}

/** Process a single frame during the cooldown phase. */
function processCooldownFrame(ctx: FlowContext, idx: number, score: number): void {
  ctx.cooldownRemaining -= 5; // sampled every 5th frame
  if (ctx.cooldownRemaining > 0) {
    ctx.states.set(idx, "cooldown");
    return;
  }
  ctx.zones.push({ startIdx: ctx.zoneStart, endIdx: idx, type: "cooldown" });
  ctx.phase = "searching";
  ctx.zoneStart = -1;
  processSearchingFrame(ctx, idx, score);
}

/** Process a single frame during the searching phase. */
function processSearchingFrame(ctx: FlowContext, idx: number, score: number): void {
  if (score >= ctx.threshold) {
    ctx.states.set(idx, "match");
    ctx.phase = "hysteresis";
    ctx.zoneStart = idx;
  } else {
    ctx.states.set(idx, "searching");
  }
}

/**
 * Simulate the full detection state machine: Searching → Match → Hysteresis → Cooldown → Searching.
 * Cooldown is estimated from cooldownSec and the replay buffer's fps (~60fps, sampled every 5th).
 */
function simulateDetectionFlow(
  entries: [number, { overallScore: number }][],
  threshold: number,
  cooldownFrames: number,
): { states: Map<number, FlowState>; zones: FlowZone[] } {
  const ctx: FlowContext = {
    phase: "searching",
    zoneStart: -1,
    cooldownRemaining: 0,
    states: new Map(),
    zones: [],
    threshold,
    hysteresisExit: threshold * HYSTERESIS_FACTOR,
    cooldownFrames,
  };

  for (const [idx, r] of entries) {
    if (ctx.phase === "hysteresis") processHysteresisFrame(ctx, idx, r.overallScore);
    else if (ctx.phase === "cooldown") processCooldownFrame(ctx, idx, r.overallScore);
    else processSearchingFrame(ctx, idx, r.overallScore);
  }

  // Close trailing zone
  if (ctx.phase !== "searching" && ctx.zoneStart >= 0 && entries.length > 0) {
    const lastIdx = entries[entries.length - 1][0];
    ctx.zones.push({ startIdx: ctx.zoneStart, endIdx: lastIdx, type: ctx.phase === "hysteresis" ? "hysteresis" : "cooldown" });
  }

  return { states: ctx.states, zones: ctx.zones };
}

/** Score timeline visualizing the detection flow: Searching → Match → Hysteresis → Cooldown → Searching. */
function ScoreSparkline({ batchResults, frameCount, selectedIndex, precision, cooldownSec, t }: Readonly<{
  batchResults: Map<number, { overallScore: number }>;
  frameCount: number;
  selectedIndex: number;
  precision?: number;
  cooldownSec?: number;
  t: (k: string) => string;
}>) {
  if (batchResults.size === 0) return null;
  const threshold = precision ?? 0.55;
  const cooldownFrames = (cooldownSec ?? 5) * 60; // 60 fps
  const entries = Array.from(batchResults.entries()).sort(([a], [b]) => a - b) as [number, { overallScore: number }][];
  const barWidth = 100 / Math.max(entries.length, 1);
  const { states, zones } = simulateDetectionFlow(entries, threshold, cooldownFrames);

  const matchCount = Array.from(states.values()).filter((s) => s === "match").length;
  const maxFrame = Math.max(frameCount - 1, 1);
  const hasHysteresis = zones.some((z) => z.type === "hysteresis");
  const hasCooldown = zones.some((z) => z.type === "cooldown");

  return (
    <div className="bg-white/3 rounded-xl px-4 py-3 space-y-2">
      {/* Legend — uses the same palette as DetectorPanel runtime dots so the
          sparkline and the live detector stay visually in sync. */}
      <div className="flex items-center justify-between text-[10px] 2xl:text-xs">
        <div className="flex items-center gap-3 text-text-muted">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-blue-400 inline-block" />
            {t("detector.stateIdle")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block" />
            {t("detector.stateMatch")}
          </span>
          {hasHysteresis && (
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-lime-400 inline-block" />
              {t("detector.stateHysteresis")}
            </span>
          )}
          {hasCooldown && (
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-purple-500 inline-block" />
              {t("detector.stateCooldown")}
            </span>
          )}
        </div>
        <span className="text-text-muted font-mono">
          {matchCount}× {t("detector.stateMatch")} · {t("detector.precision")} {(threshold * 100).toFixed(0)}%
        </span>
      </div>

      {/* Chart */}
      <svg viewBox="0 0 100 40" className="w-full h-12 2xl:h-14" preserveAspectRatio="none" aria-label="Score timeline">
        {/* Flow zones — background bands. The "sustained match" zone is drawn
            noticeably more visible than cooldown so the after-match decay
            window stands out as part of the match itself. */}
        {zones.map((z) => {
          const x1 = (z.startIdx / maxFrame) * 100;
          const x2 = Math.min((z.endIdx / maxFrame) * 100 + barWidth, 100);
          const isHysteresis = z.type === "hysteresis";
          const fill = isHysteresis ? "#a3e635" : "#a855f7";
          return (
            <rect key={`z-${z.type}-${z.startIdx}-${z.endIdx}`} x={x1} y={0} width={x2 - x1} height={40}
              fill={fill} opacity={isHysteresis ? 0.22 : 0.12} rx={0.3} />
          );
        })}

        {/* Score bars */}
        {entries.map(([idx, r]) => {
          const x = (idx / maxFrame) * 100;
          const h = r.overallScore * 36;
          const state = states.get(idx) ?? "searching";
          let fill: string;
          if (state === "match") fill = "#22c55e";
          else if (state === "hysteresis") fill = "#a3e635";
          else if (state === "cooldown") fill = "#a855f7";
          else fill = "#60a5fa";
          return (
            <rect key={idx} x={x} y={40 - h} width={Math.max(barWidth * 0.8, 0.5)} height={h}
              fill={fill} opacity={state === "searching" ? 0.55 : 0.85} rx={0.3} />
          );
        })}

        {/* Selected frame cursor */}
        <line
          x1={(selectedIndex / maxFrame) * 100}
          x2={(selectedIndex / maxFrame) * 100}
          y1={0} y2={40}
          stroke="white" strokeWidth={0.6} opacity={0.8}
        />
      </svg>
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

/** Returns the container class for an inactive step (done vs upcoming). */
function getStepInactiveStyle(isDone: boolean): string {
  return isDone ? "bg-white/10 text-white/70" : "bg-white/5 text-white/30";
}

/** Returns the badge class for an inactive step (done vs upcoming). */
function getBadgeInactiveStyle(isDone: boolean): string {
  return isDone ? "bg-white/20 text-white/70" : "bg-white/10 text-white/30";
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

        const containerStyle = isActive
          ? "bg-accent-blue/20 text-accent-blue ring-1 ring-accent-blue/40"
          : getStepInactiveStyle(isDone);

        const badgeStyle = isActive
          ? "bg-accent-blue text-white"
          : getBadgeInactiveStyle(isDone);

        return (
          <React.Fragment key={step}>
            {step > 1 && (
              <div className={`hidden sm:block w-6 h-px ${isDone ? "bg-accent-blue" : "bg-white/20"}`} />
            )}
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors ${containerStyle}`}>
              <span className={`w-5 h-5 flex items-center justify-center rounded-full font-bold leading-none ${badgeStyle}`}>
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

/** Persists the current template (new or updated regions). */
async function saveTemplate(opts: {
  canvas: HTMLCanvasElement | null;
  regions: MatchedRegion[];
  templateName: string;
  onUpdateRegions: TemplateEditorProps["onUpdateRegions"];
  onSaveTemplate: TemplateEditorProps["onSaveTemplate"];
  setIsSaving: (v: boolean) => void;
  setErrorMsg: (v: string | null) => void;
}) {
  const { canvas, regions, templateName, onUpdateRegions, onSaveTemplate, setIsSaving, setErrorMsg } = opts;
  if (!canvas) return;

  setIsSaving(true);
  setErrorMsg(null);
  try {
    const trimmedName = templateName.trim() || undefined;
    if (onUpdateRegions) {
      await onUpdateRegions(regions, trimmedName);
    } else if (onSaveTemplate) {
      const base64Data = canvas.toDataURL("image/png");
      await onSaveTemplate({ imageBase64: base64Data, regions, name: trimmedName });
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
  return recognize(crop, lang);
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

/** Single region editor card shown below the snapshot preview. */
function RegionEditCard({ region: r, index: i, onUpdate, onDelete, onRunOCR, isRecognizing, t }: Readonly<{
  region: MatchedRegion; index: number;
  onUpdate: (i: number, u: Partial<MatchedRegion>) => void;
  onDelete: (i: number) => void;
  onRunOCR: (i: number) => void;
  isRecognizing: boolean;
  t: (key: string) => string;
}>) {
  const labelColor = r.type === "text" ? "text-purple-400" : "text-accent-blue";
  return (
    <div className="flex items-center gap-2 bg-bg-card border border-border-subtle rounded-lg px-3 py-2 shadow-lg transition-colors hover:border-accent-blue/50">
      <span className={`font-mono font-bold w-5 shrink-0 ${labelColor}`}>
        #{i + 1}
      </span>
      <select
        className="bg-bg-primary text-xs 2xl:text-sm p-1 2xl:p-1.5 rounded border border-border-subtle outline-none min-w-25 2xl:min-w-30"
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
            className="bg-bg-primary text-xs 2xl:text-sm p-1 2xl:p-1.5 rounded border border-border-subtle outline-none min-w-30 2xl:min-w-35 focus:border-purple-400"
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
  precision: precisionProp,
  cooldownSec: cooldownSecProp,
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

  // Keyboard navigation in replay and test phases
  useEffect(() => {
    if (phase !== "replay" && phase !== "test") return;

    const handleKeyDown = (e: KeyboardEvent) =>
      handleReplayKeyDown(e, replayBuffer.frameCount, setSelectedFrameIndex);

    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [phase, replayBuffer.frameCount]);

  // Auto-focus the name input when entering the confirm phase
  useEffect(() => {
    if (phase === "confirm") {
      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
  }, [phase]);

  // --- Snapshot and replay handlers ------------------------------------------

  const resetToSnapshot = () => { setRegions([]); setCurrentBox(null); setErrorMsg(null); };

  /** Stop the replay buffer and enter replay phase to browse captured frames. */
  const handleTakeSnapshot = () => {
    replayBuffer.stop();
    if (replayBuffer.frameCount > 0) {
      setSelectedFrameIndex(replayBuffer.frameCount - 1);
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
      onUpdateRegions,
      onSaveTemplate,
      setIsSaving,
      setErrorMsg,
    });
  };

  const hasTextRegion = regions.some((r) => r.type === "text");
  const isEditMode = !!initialImageUrl || !!onUpdateRegions;

  const { heading, hint } = getHeadingAndHint(isEditMode, phase, t);

  const isSnapshotPhase = phase === "snapshot";
  const cursorClass = isSnapshotPhase ? "cursor-crosshair" : "cursor-default";
  const pointerDown = isSnapshotPhase ? onPointerDown : undefined;
  const pointerMove = isSnapshotPhase ? onPointerMove : undefined;
  const pointerUp = isSnapshotPhase ? onPointerUp : undefined;

  // --- Render ----------------------------------------------------------------

  const modalContent = (
    <div className="fixed inset-0 z-100 bg-black/95 flex flex-col items-center justify-center p-4 md:p-6 backdrop-blur-sm overflow-y-auto">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 md:top-8 md:right-8 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-110"
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
        className={`relative w-full ${phase === "confirm" ? "max-w-[40vw] max-h-[30vh]" : "max-w-[80vw] 2xl:max-w-[85vw] max-h-[55vh] 2xl:max-h-[60vh]"} aspect-video bg-black rounded-lg overflow-hidden shadow-2xl mb-3 flex items-center justify-center select-none touch-none ${cursorClass}`}
        onMouseDown={pointerDown}
        onMouseMove={pointerMove}
        onMouseUp={pointerUp}
        onMouseLeave={pointerUp}
        onTouchStart={pointerDown}
        onTouchMove={pointerMove}
        onTouchEnd={pointerUp}
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
                className="absolute top-3 right-3 flex items-center gap-2 bg-black/70 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs font-mono text-white"
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

      {/* Replay Timeline (replay phase) */}
      {phase === "replay" && replayBuffer.frameCount > 0 && (
        <div className="w-full max-w-[80vw] 2xl:max-w-[85vw] mb-4 px-8">
          <div className="flex items-center gap-4">
            <span className="text-white text-sm 2xl:text-base font-mono shrink-0">
              {(() => {
                const totalSec = replayBuffer.bufferedSeconds;
                const secPerFrame = totalSec / replayBuffer.frameCount;
                const currentSec = selectedFrameIndex * secPerFrame;
                const relative = currentSec - totalSec;
                return Math.abs(relative) < 0.1 ? "now" : `${Math.round(relative)}s`;
              })()}
            </span>
            <input
              type="range"
              min={0}
              max={replayBuffer.frameCount - 1}
              value={selectedFrameIndex}
              onChange={(e) => setSelectedFrameIndex(Number(e.target.value))}
              className="flex-1 h-2 bg-white/20 rounded-lg appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent-blue [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-lg
                [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent-blue [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:shadow-lg"
            />
            <span className="text-white/60 text-xs 2xl:text-sm shrink-0">
              {selectedFrameIndex + 1} / {replayBuffer.frameCount}
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
          {/* Score Sparkline */}
          <div className="w-full max-w-[80vw] 2xl:max-w-[85vw] mb-2 px-8">
            <ScoreSparkline
              batchResults={templateTest.batchResults}
              frameCount={replayBuffer.frameCount}
              selectedIndex={selectedFrameIndex}
              precision={precisionProp}
              cooldownSec={cooldownSecProp}
              t={t}
            />
          </div>

          {/* Timeline Scrubber */}
          {replayBuffer.frameCount > 0 && (
            <div className="w-full max-w-[80vw] 2xl:max-w-[85vw] mb-3 px-8">
              <div className="flex items-center gap-4">
                <span className="text-white text-sm 2xl:text-base font-mono shrink-0">
                  {selectedFrameIndex + 1} / {replayBuffer.frameCount}
                </span>
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
                  className="flex-1 h-2 bg-white/20 rounded-lg appearance-none cursor-pointer
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent-blue [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-lg
                    [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent-blue [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:shadow-lg"
                />
              </div>
            </div>
          )}

          {/* Score Panel */}
          <div className="w-full max-w-lg 2xl:max-w-xl px-4 mb-3 space-y-2">
            {templateTest.isRunning && (
              <div className="flex items-center gap-3 text-sm text-text-muted mb-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t("templateEditor.testRunning")}</span>
                <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-accent-blue rounded-full transition-all" style={{ width: `${templateTest.progress * 100}%` }} />
                </div>
              </div>
            )}
            {templateTest.currentResult && (
              <>
                <ScoreBar label={t("templateEditor.testOverall")} score={templateTest.currentResult.overallScore} precision={precisionProp} precisionLabel={t("detector.precision")} />
                {templateTest.currentResult.regionScores.map((rs) => (
                  <ScoreBar
                    key={rs.index}
                    label={`${t("templateEditor.regionN")} ${rs.index + 1}`}
                    score={rs.score}
                    precision={precisionProp}
                    precisionLabel={t("detector.precision")}
                  />
                ))}
              </>
            )}
            {!templateTest.isRunning && templateTest.bestScore < (precisionProp ?? 0.55) && templateTest.batchResults.size > 0 && (
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
            className="w-full px-4 py-3 text-sm bg-white/10 border border-border-subtle rounded-xl text-text-primary placeholder-text-muted outline-none focus:border-accent-blue/50 transition-colors"
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
        <div className="w-full max-w-4xl 2xl:max-w-5xl flex flex-wrap justify-center gap-2 mb-2 max-h-28 2xl:max-h-36 overflow-y-auto px-4 scrollbar-thin scrollbar-thumb-border-subtle hover:scrollbar-thumb-border-strong text-white z-50 rounded-lg">
          {regions.map((r, i) => (
            <RegionEditCard
              key={`region-edit-${r.type}-${r.rect.x}-${r.rect.y}-${i}`}
              region={r}
              index={i}
              onUpdate={updateRegion}
              onDelete={deleteRegion}
              onRunOCR={handleRunOCR}
              isRecognizing={isRecognizing}
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
              className="flex-1 flex items-center justify-center gap-2 px-4 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold whitespace-nowrap bg-white/10 text-white hover:bg-white/20 transition-all disabled:opacity-50"
            >
              {t("templateEditor.cancel")}
            </button>
            <button
              onClick={handleGoToTestOrConfirm}
              disabled={regions.length === 0}
              className="flex-2 flex items-center justify-center gap-2 px-6 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold whitespace-nowrap bg-accent-blue text-white shadow-lg shadow-accent-blue/20 hover:bg-accent-blue/90 hover:scale-[1.02] transition-all disabled:opacity-50"
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
            t={t}
          />
        )}

        {errorMsg && (
          <div className="w-full px-4 py-3 bg-red-500/10 text-red-500 text-sm 2xl:text-base text-center rounded-lg font-medium border border-red-500/20">
            {errorMsg}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
