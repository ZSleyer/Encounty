/**
 * TemplateEditor.tsx: Template creation and region editing for auto-detection.
 *
 * In new-template mode, shows a live preview from the CaptureService stream,
 * lets the user take a replay-buffer snapshot via useReplayBuffer, scrub through
 * frames to pick the best one, then draw detection regions on it.
 * In edit mode, loads an existing template image for region editing.
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, RefreshCw, Loader2, ArrowRight, BarChart3 } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { MatchedRegion, TemplateCalibration } from "../../types";
import { useOCR } from "../../hooks/useOCR";
import { useReplayBuffer } from "../../hooks/useReplayBuffer";
import { useTemplateTest } from "../../hooks/useTemplateTest";
import { analyzeStability, recommendPolling, toCalibration } from "../../engine/templateStability";
import { createSweepRunner, type SweepResult } from "../../engine/parameterSweep";
import {
  DEFAULT_PRECISION,
  DEFAULT_HYSTERESIS_FACTOR,
  DEFAULT_CONSECUTIVE_HITS,
  DEFAULT_COOLDOWN_SEC,
  DEFAULT_POLL_MS,
  MIN_POLL_MS,
  MAX_POLL_MS,
} from "../../engine/detectorDefaults";
import { formatPercent } from "../../utils/format";
import type { Phase } from "./templateEditorTypes";
import { NewTemplateControls } from "./NewTemplateControls";
import {
  boxToRegion,
  computeImageBounds,
  computeRelativePos,
  handleReplayKeyDown,
  moveBoxByKey,
  resizeBoxByKey,
  REGION_DEFAULT_BOX,
} from "./templateEditorGeometry";
import {
  captureVideoFrame,
  drawFrameToCanvas,
  loadInitialImage,
  observeImageBounds,
  renderReplayFrame,
  restoreMatchFrame,
  runRegionOCR,
  wireStreamToVideo,
} from "./templateEditorCanvas";
import { RegionOverlayMarker } from "./RegionOverlayMarker";
import { RegionEditCard } from "./RegionEditCard";
import { categoryColor } from "./templateCategories";
import { ScoreBar } from "./ScoreBar";
import { buildFlowGradient, flowStateColor } from "./TemplateEditor.flow";
import { FlowLegend } from "./FlowLegend";
import { phaseToStep, StepIndicator } from "./StepIndicator";
import { StabilityStatus } from "./StabilityStatus";

// --- Props -------------------------------------------------------------------

export type TemplateEditorProps = Readonly<{
  /** Live video stream for new-template mode. If omitted, edit mode is assumed. */
  stream?: MediaStream;
  onClose: () => void;
  /** Called when saving a new template (new-template mode). */
  onSaveTemplate?: (payload: {
    imageBase64: string;
    regions: MatchedRegion[];
    name?: string;
    calibration?: TemplateCalibration;
    precision?: number;
    hysteresisFactor?: number;
    consecutiveHits?: number;
    cooldownSec?: number;
    pollIntervalMs?: number;
    minPollMs?: number;
    maxPollMs?: number;
  }) => Promise<void>;
  /** Called when updating regions of an existing template (edit mode). */
  onUpdateRegions?: (
    regions: MatchedRegion[],
    opts?: {
      name?: string;
      precision?: number;
      hysteresisFactor?: number;
      consecutiveHits?: number;
      cooldownSec?: number;
      pollIntervalMs?: number;
      minPollMs?: number;
      maxPollMs?: number;
    },
  ) => void | Promise<void>;
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

// --- Helpers -----------------------------------------------------------------

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

/**
 * Persists the current template (new or updated regions).
 *
 * Resolves to true only when a save callback actually ran and succeeded, so
 * callers can release resources without doing so on a no-op or an error.
 */
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
}): Promise<boolean> {
  const {
    canvas,
    regions,
    templateName,
    calibration,
    settings,
    onUpdateRegions,
    onSaveTemplate,
    setIsSaving,
    setErrorMsg,
  } = opts;
  if (!canvas) return false;

  const {
    precision,
    hysteresisFactor,
    consecutiveHits,
    cooldownSec,
    pollIntervalMs,
    minPollMs,
    maxPollMs,
  } = settings;

  setIsSaving(true);
  setErrorMsg(null);
  try {
    const trimmedName = templateName.trim() || undefined;
    if (onUpdateRegions) {
      await onUpdateRegions(regions, {
        name: trimmedName,
        precision,
        hysteresisFactor,
        consecutiveHits,
        cooldownSec,
        pollIntervalMs,
        minPollMs,
        maxPollMs,
      });
    } else if (onSaveTemplate) {
      const base64Data = canvas.toDataURL("image/png");
      await onSaveTemplate({
        imageBase64: base64Data,
        regions,
        name: trimmedName,
        calibration,
        precision,
        hysteresisFactor,
        consecutiveHits,
        cooldownSec,
        pollIntervalMs,
        minPollMs,
        maxPollMs,
      });
    } else {
      return false;
    }
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to save template";
    setErrorMsg(msg);
    return false;
  } finally {
    setIsSaving(false);
  }
}

/** Applies an update to a single region, pre-filling text fields with the pokemon name. */
function applyRegionUpdate(
  regions: MatchedRegion[],
  index: number,
  updates: Partial<MatchedRegion>,
  pokemonName?: string,
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

const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

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
  const videoRef = useCallback((el: HTMLVideoElement | null) => {
    setVideoEl(el);
  }, []);
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
    return () => {
      sweepGenRef.current += 1;
    };
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
  const [currentBox, setCurrentBox] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { recognize, isRecognizing, ocrError } = useOCR({ lang: ocrLang });

  // Track the actual rendered image area within the object-contain container.
  const [imageBounds, setImageBounds] = useState<{
    offsetX: number;
    offsetY: number;
    renderedW: number;
    renderedH: number;
  } | null>(null);

  const updateImageBounds = useCallback(
    () => computeImageBounds(containerRef.current, snapshotWidth, snapshotHeight, setImageBounds),
    [snapshotWidth, snapshotHeight],
  );

  useEffect(
    () =>
      observeImageBounds(
        phase,
        snapshotWidth,
        snapshotHeight,
        containerRef.current,
        updateImageBounds,
        setImageBounds,
      ),
    [phase, snapshotWidth, snapshotHeight, updateImageBounds],
  );

  // In edit mode, load the existing template image into the canvas immediately.
  useEffect(
    () =>
      loadInitialImage(
        initialImageUrl,
        canvasRef.current,
        initialRegions,
        setSnapshotWidth,
        setSnapshotHeight,
        setPhase,
        setRegions,
      ),
    [initialImageUrl], // only run once on mount
  );

  // Wire the stream to the video element when in "video" phase
  useEffect(() => wireStreamToVideo(phase, videoEl, stream), [stream, phase, videoEl]);

  // Render selected replay frame to canvas (replay and test phases)
  useEffect(() => {
    if (phase === "replay" || phase === "test") {
      renderReplayFrame(
        replayBuffer.getFrame(selectedFrameIndex),
        canvasRef.current,
        setSnapshotWidth,
        setSnapshotHeight,
      );
    }
  }, [phase, selectedFrameIndex, replayBuffer]);

  // Keyboard navigation in replay and test phases. The replay phase is scoped
  // to the frames present at snapshot time; extension frames only become
  // navigable in the test phase.
  const navigableFrameCount =
    phase === "replay" ? replayBuffer.snapshotFrameCount : replayBuffer.frameCount;
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

  const resetToSnapshot = () => {
    setRegions([]);
    setCurrentBox(null);
    setErrorMsg(null);
  };

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
      captureVideoFrame(
        videoEl,
        canvasRef.current,
        setSnapshotWidth,
        setSnapshotHeight,
        setPhase,
        resetToSnapshot,
      );
    }
  };

  /** Use the currently selected replay frame as the snapshot to draw regions on. */
  const handleUseFrame = () => {
    const frame = replayBuffer.getFrame(selectedFrameIndex);
    if (frame) matchFrameDataRef.current = frame;
    drawFrameToCanvas(
      frame,
      canvasRef.current,
      setSnapshotWidth,
      setSnapshotHeight,
      setPhase,
      resetToSnapshot,
    );
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

  /** Go back to live video from replay, restarts the replay buffer. */
  const handleBackToLive = returnToLive;

  /** Reset the snapshot and go back to live video, restarts the replay buffer. */
  const resetSnapshot = returnToLive;

  // --- Region drawing --------------------------------------------------------

  const getRelativeMousePos = (
    e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>,
  ) => computeRelativePos(e, containerRef.current, imageBounds);

  const onPointerDown = (
    e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>,
  ) => {
    if (phase !== "snapshot") return;
    setIsDrawing(true);
    const pos = getRelativeMousePos(e);
    setStartPos(pos);
    setCurrentBox({ x: pos.x, y: pos.y, w: 0, h: 0 });
  };

  const onPointerMove = (
    e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>,
  ) => {
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
      setCurrentBox(
        e.shiftKey ? resizeBoxByKey(currentBox, e.key) : moveBoxByKey(currentBox, e.key),
      );
    }
  };

  const updateRegion = (index: number, updates: Partial<MatchedRegion>) =>
    setRegions((prev) => applyRegionUpdate(prev, index, updates, pokemonName));

  const deleteRegion = (index: number) => {
    setRegions(regions.filter((_, i) => i !== index));
  };

  const handleRunOCR = async (regionIndex: number) => {
    const recognized = await runRegionOCR(
      regions[regionIndex],
      canvasRef.current,
      recognize,
      ocrLang,
    );
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
        matchFrameDataRef.current = ctx.getImageData(
          0,
          0,
          canvasRef.current.width,
          canvasRef.current.height,
        );
      }
    }
    if (canvasRef.current && replayBuffer.frameCount > 0) {
      restoreMatchFrame(matchFrameDataRef.current, canvasRef.current);
      templateTest.runBatch(
        canvasRef.current,
        regions,
        replayBuffer.getFrame,
        replayBuffer.frameCount,
      );
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
      templateTest.runBatch(
        canvasRef.current,
        regions,
        replayBuffer.getFrame,
        replayBuffer.frameCount,
      );
      // Score the currently selected frame immediately so the panel isn't empty
      const frame = replayBuffer.getFrame(selectedFrameIndex);
      if (frame) {
        renderReplayFrame(frame, canvasRef.current, setSnapshotWidth, setSnapshotHeight);
        templateTest.scoreFrame(canvasRef.current, regions, frame);
      }
    }
  };

  const handleConfirmSave = async () => {
    const saved = await saveTemplate({
      canvas: canvasRef.current,
      regions,
      templateName: templateName.trim() || "",
      calibration:
        applyCalibration && stabilityStats
          ? toCalibration(stabilityStats, sweepResult ?? undefined)
          : undefined,
      settings: templateSettings,
      onUpdateRegions,
      onSaveTemplate,
      setIsSaving,
      setErrorMsg,
    });
    if (!saved) return;
    // Free the buffered replay frames and the stored match frame as soon as
    // the template is persisted. The dialog usually unmounts right after, but
    // the release must not depend on the caller closing it.
    replayBuffer.clear();
    matchFrameDataRef.current = null;
  };

  const hasTextRegion = regions.some((r) => r.type === "text");
  // Distinct non-empty category names in first-seen order, for autocomplete and
  // consistent chip colors across all region cards.
  const categoryNames = [
    ...new Set(regions.map((r) => (r.category ?? "").trim()).filter((c) => c !== "")),
  ];
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
    // Safe alignment, not plain centering: with `overflow-y-auto` a centered
    // flex container pushes overflowing content past its top edge, where it
    // cannot be scrolled back into view. `safe` falls back to start alignment
    // exactly then, which is what keeps this reachable on short windows.
    <div className="fixed inset-0 z-100 bg-black/95 flex flex-col items-center-safe justify-center-safe p-4 md:p-6 backdrop-blur-sm overflow-y-auto">
      <button
        onClick={onClose}
        aria-label={t("templateEditor.closeEditor")}
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

      {/* Region drawing surface, pointer events only active in snapshot phase */}
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
                <span className="w-2 h-2 rounded-full bg-accent-red animate-pulse" />
                {Math.floor(replayBuffer.bufferedSeconds)}s / {replayBuffer.maxSeconds}s
                {replayBuffer.bufferedSeconds >= replayBuffer.maxSeconds && (
                  <RefreshCw
                    className="w-3 h-3 text-white/60 animate-spin"
                    style={{ animationDuration: "3s" }}
                    aria-label={t("templateEditor.bufferLoopHint")}
                  />
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
        {(phase === "snapshot" || phase === "replay" || phase === "test" || phase === "confirm") &&
          imageBounds && (
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
              {snapshotWidth > 0 &&
                regions.map((r, i) => {
                  const regionScore =
                    phase === "test" && templateTest.currentResult
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
                  className="absolute border-2 border-accent-yellow border-dashed bg-accent-yellow/15 pointer-events-none"
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
            <span className="text-white/60 text-xs 2xl:text-sm font-mono tabular-nums shrink-0">
              <span
                className="inline-block text-right"
                style={{ minWidth: `${String(replayBuffer.snapshotFrameCount).length}ch` }}
              >
                {selectedFrameIndex + 1}
              </span>
              {" / "}
              {replayBuffer.snapshotFrameCount}
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
          {replayBuffer.frameCount > 0 &&
            (() => {
              // Only paint the flow gradient once scoring has settled, while
              // templateTest.isRunning, results trickle in frame by frame and
              // an early, still-incomplete state can register a spurious
              // one-frame "match" that flashes at the timeline's start before
              // the batch finishes. The flat track is a better placeholder
              // than a misleading flicker.
              const flow = templateTest.isRunning
                ? null
                : buildFlowGradient(
                    Array.from(templateTest.batchResults.entries()).sort(([a], [b]) => a - b) as [
                      number,
                      { overallScore: number },
                    ][],
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
                    <span className="text-white text-sm 2xl:text-base font-mono tabular-nums shrink-0">
                      <span
                        className="inline-block text-right"
                        style={{ minWidth: `${String(replayBuffer.frameCount).length}ch` }}
                      >
                        {selectedFrameIndex + 1}
                      </span>
                      {" / "}
                      {replayBuffer.frameCount}
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
                            backgroundImage:
                              "repeating-linear-gradient(135deg, transparent 0 3px, color-mix(in srgb, var(--bg-primary) 55%, transparent) 3px 4px)",
                          }}
                        />
                      ))}
                      <input
                        type="range"
                        min={0}
                        max={replayBuffer.frameCount - 1}
                        value={selectedFrameIndex}
                        onChange={(e) => {
                          const idx = Number(e.target.value);
                          setSelectedFrameIndex(idx);
                          const frame = replayBuffer.getFrame(idx);
                          if (frame && canvasRef.current) {
                            renderReplayFrame(
                              frame,
                              canvasRef.current,
                              setSnapshotWidth,
                              setSnapshotHeight,
                            );
                            templateTest.scoreFrame(canvasRef.current, regions, frame);
                          }
                        }}
                        style={{
                          background:
                            flow?.gradient ??
                            "color-mix(in srgb, var(--bg-primary) 55%, transparent)",
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
                  <div
                    className="h-full bg-accent-blue rounded-none transition-all"
                    style={{ width: `${templateTest.progress * 100}%` }}
                  />
                </div>
              </div>
            )}
            {templateTest.currentResult && (
              <>
                <ScoreBar
                  label={t("templateEditor.testOverall")}
                  score={templateTest.currentResult.overallScore}
                  precision={templateSettings.precision}
                  precisionLabel={t("detector.precision")}
                />
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
            {!templateTest.isRunning &&
              templateTest.bestScore < templateSettings.precision &&
              templateTest.batchResults.size > 0 && (
                <p className="text-xs 2xl:text-sm text-accent-yellow text-center mt-2">
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
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleConfirmSave();
            }}
            placeholder={t("templateEditor.templateName")}
            className="w-full px-4 py-3 text-sm bg-bg-secondary border border-border-subtle rounded-none text-text-primary placeholder-text-muted outline-none focus:border-accent-blue/50 transition-colors"
            aria-label={t("templateEditor.templateName")}
          />

          {/* Summary */}
          <div className="flex items-center justify-center gap-4 text-sm text-text-muted">
            <span>
              {t("templateEditor.regionSummary").replace("{count}", String(regions.length))}
            </span>
            {templateTest.bestScore > 0 && (
              <>
                <span className="text-border-subtle">&middot;</span>
                <span>
                  {t("templateEditor.bestScore")}: {formatPercent(templateTest.bestScore, 0)}%
                </span>
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
            <p className="text-xs 2xl:text-sm text-accent-yellow text-center">
              {t("templateEditor.regionsRequired")}
            </p>
          )}
          {hasTextRegion && (
            <p className="text-xs 2xl:text-sm text-accent-yellow text-center">
              {t("templateEditor.ocrHint")}
            </p>
          )}
          {ocrError && (
            <p className="text-xs 2xl:text-sm text-accent-red text-center">
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
          <div className="w-full px-4 py-3 bg-accent-red/10 text-accent-red text-sm 2xl:text-base text-center rounded-none font-medium border border-accent-red/20">
            {errorMsg}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
