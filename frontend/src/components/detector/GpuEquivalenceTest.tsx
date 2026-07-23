/**
 * GpuEquivalenceTest -- dev-only modal that runs detection tests using both
 * CPU (math.ts) and GPU (WebGPUDetector) backends in the browser, comparing
 * their scores on identical video frames from the test fixture suite.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
} from "react";
import {
  X,
  Play,
  Check,
  AlertTriangle,
  XCircle,
  Loader2,
  Download,
} from "lucide-react";
import { WebGPUDetector } from "../../engine/WebGPUDetector";
import {
  fitDimensions,
  adaptiveBlockSizeForRegion,
  scoreRegionHybrid,
  andLogicAcrossRegions,
} from "../../engine/math";
import { applyNoiseFloor } from "../../engine/matchStateMachine";
import {
  simulateAdaptiveScan,
  type ScanSample,
} from "../../engine/scanSimulator";
import {
  analyzeStability,
  recommendPolling,
  type StabilityRating,
  type StabilitySample,
} from "../../engine/templateStability";
import { runParameterSweep } from "../../engine/parameterSweep";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GpuEquivalenceTestProps {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Ground-truth data (loaded from the generated fixture ground-truth.json)
// ---------------------------------------------------------------------------

const FPS = 60;

/** One expected encounter window in a fixture video (60 fps frame indices). */
interface EncounterWindow {
  start: number;
  end: number;
  /** Extended window end for entries whose match lingers past `end`. */
  maxEnd?: number;
}

/** Scan range and reference frame for entries that join the parameter sweep. */
interface SweepCase {
  scanStart: number;
  scanEnd: number;
  matchFrame: number;
}

/** One entry of the generated ground-truth fixture (ground-truth.json). */
interface GroundTruthEntry {
  videoName: string;
  templateId: number;
  pokemonName: string;
  label: string;
  difficulty: string;
  loopTestable: boolean;
  expectedEncounters: number;
  encounters: EncounterWindow[];
  negativeFrames: number[];
  sweepCase?: SweepCase;
}

/** Center of an encounter window, used as the canonical match frame. */
function encounterMatchFrame(enc: EncounterWindow): number {
  return Math.round((enc.start + enc.end) / 2);
}

// ---------------------------------------------------------------------------
// Full-scan constants (mirror the node suite's "Full Video Scan" describe)
// ---------------------------------------------------------------------------

/** Raw-score match threshold used by the node suite's full scan. */
const SCAN_THRESHOLD = 0.55;

/** Sampling interval in seconds (10 fps grid the adaptive simulator polls from). */
const SCAN_INTERVAL = 0.1;

/** Edge length of the downsampled grayscale used for frame deltas. */
const DELTA_GRAY_SIZE = 64;

// ---------------------------------------------------------------------------
// Test config entry (from test-config.json)
// ---------------------------------------------------------------------------

interface TestConfigEntry {
  video_name: string;
  pokemon_name: string;
  template_id: number;
  region_type: string;
  expected_text: string;
  rect_x: number;
  rect_y: number;
  rect_w: number;
  rect_h: number;
}

// ---------------------------------------------------------------------------
// Result row
// ---------------------------------------------------------------------------

interface TestResult {
  pokemonName: string;
  templateId: number;
  frame: number;
  type: "match" | "negative";
  cpuScore: number;
  gpuScore: number;
  delta: number;
}

/** Scoring backend used by the full scan and the stability sweep. */
type ScanBackend = "gpu" | "cpu";

/** State-machine settings variant used by the full scan. */
type SettingsVariant = "recommended" | "auto";

/** State-machine settings fed into the adaptive scan simulator. */
interface MatchSettings {
  precision: number;
  hysteresisFactor: number;
  consecutiveHits: number;
  cooldownSec: number;
}

/** The node suite's default full-scan settings (noise-floor adjusted scale). */
function defaultScanSettings(): MatchSettings {
  return {
    precision: applyNoiseFloor(SCAN_THRESHOLD),
    hysteresisFactor: 0.7,
    consecutiveHits: 1,
    cooldownSec: 5,
  };
}

/** One row of the full-video scan results (one template scanned end to end). */
interface FullScanResult {
  pokemonName: string;
  templateId: number;
  videoName: string;
  backend: ScanBackend;
  settingsVariant: SettingsVariant;
  difficulty: string;
  /** False marks a deliberate hard case that gets no pass/fail verdict. */
  loopTestable: boolean;
  encountersFound: number;
  encountersExpected: number;
  matchFrames: number;
  sampledFrames: number;
  /** Samples the simulated adaptive loop actually scored. */
  polledSamples: number;
  /** Frame spans of each simulated encounter, for triaging miscounts. */
  encounterSpans: Array<{ startFrame: number; endFrame: number; peakScore: number }>;
  maxScore: number;
  scanSeconds: number;
}

/**
 * Whether a full-scan row is a deliberate hard case (loopTestable === false).
 * Hard cases are excluded from the passed/failed verdict but still count
 * toward the GPU==CPU parity comparison.
 */
function isHardCase(r: FullScanResult): boolean {
  return !r.loopTestable;
}

/** Whether a full-scan row's found count matches the expected count exactly. */
function scanRowPasses(r: FullScanResult): boolean {
  return r.encountersFound === r.encountersExpected;
}

/** GPU vs CPU parity for one settings variant of the full scan. */
interface ParitySummary {
  settingsVariant: SettingsVariant;
  /** Templates where both backends found exactly the same encounter count. */
  identical: number;
  /** Templates with results from both backends. */
  total: number;
}

/**
 * Computes GPU vs CPU parity per settings variant: for every template with
 * full-scan results from both backends, the encounter counts must be exactly
 * equal. Tolerance ranges never soften parity, it is a strict comparison.
 */
function computeParitySummaries(rows: FullScanResult[]): ParitySummary[] {
  const summaries: ParitySummary[] = [];
  for (const variant of ["recommended", "auto"] as const) {
    const byBackend = (backend: ScanBackend) =>
      new Map(
        rows
          .filter((r) => r.backend === backend && r.settingsVariant === variant)
          .map((r) => [r.templateId, r.encountersFound]),
      );
    const gpu = byBackend("gpu");
    const cpu = byBackend("cpu");
    let identical = 0;
    let total = 0;
    for (const [templateId, found] of gpu) {
      const other = cpu.get(templateId);
      if (other === undefined) continue;
      total++;
      if (other === found) identical++;
    }
    if (total > 0) summaries.push({ settingsVariant: variant, identical, total });
  }
  return summaries;
}

/** One row of the stability/sweep results. */
interface SweepUiResult {
  pokemonName: string;
  templateId: number;
  backend: ScanBackend;
  rating: StabilityRating;
  precision: number;
  hysteresisFactor: number;
  consecutiveHits: number;
  pollIntervalMs: number;
  cleanPhases: number;
  totalPhases: number;
  robustnessMargin: number;
  perfect: boolean;
  sweepSeconds: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** BT.601 grayscale conversion (0-255 range) from RGBA pixel data. */
function toGrayscale(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
): Float32Array {
  const n = w * h;
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    gray[i] =
      0.299 * pixels[i * 4] +
      0.587 * pixels[i * 4 + 1] +
      0.114 * pixels[i * 4 + 2];
  }
  return gray;
}

/**
 * Downsamples a grayscale buffer to a small square via nearest-neighbor.
 * Deliberately cheap: the result only feeds the polling policy's frame delta
 * (pixelDelta), which needs coarse scene-change information, not fidelity.
 */
function downsampleGray(
  src: Float32Array,
  srcW: number,
  srcH: number,
  size: number = DELTA_GRAY_SIZE,
): Float32Array {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / size));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / size));
      out[y * size + x] = src[sy * srcW + sx];
    }
  }
  return out;
}

/** Crop and resample a rectangular region from a grayscale buffer. */
function cropAndResample(
  src: Float32Array,
  srcW: number,
  srcH: number,
  region: { x: number; y: number; w: number; h: number },
  dw: number,
  dh: number,
): Float32Array {
  const out = new Float32Array(dw * dh);
  const sx = region.w / dw;
  const sy = region.h / dh;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const idx =
        Math.min(Math.floor(y * sy) + region.y, srcH - 1) * srcW +
        Math.min(Math.floor(x * sx) + region.x, srcW - 1);
      out[y * dw + x] = src[idx];
    }
  }
  return out;
}

/** CPU region scoring matching the vitest approach. */
function cpuScoreRegion(
  frameGray: Float32Array,
  frameW: number,
  frameH: number,
  tmplGray: Float32Array,
  tmplW: number,
  tmplH: number,
  region: { x: number; y: number; w: number; h: number },
): number {
  const scaleX = frameW / tmplW;
  const scaleY = frameH / tmplH;
  const baseX = Math.round(region.x * scaleX);
  const baseY = Math.round(region.y * scaleY);
  const frw = Math.max(4, Math.round(region.w * scaleX));
  const frh = Math.max(4, Math.round(region.h * scaleY));

  const [dw, dh] = fitDimensions(region.w, region.h, 512);
  const bs = adaptiveBlockSizeForRegion(dw, dh);

  const tmplCrop = cropAndResample(
    tmplGray, tmplW, tmplH,
    region,
    dw, dh,
  );

  // Sliding window: try small offsets around region center, keep best
  let bestScore = 0;
  const step = 4;
  const maxOffset = 4;

  for (let dy = -maxOffset; dy <= maxOffset; dy += step) {
    for (let dx = -maxOffset; dx <= maxOffset; dx += step) {
      const frx = Math.max(0, Math.min(baseX + dx, frameW - frw));
      const fry = Math.max(0, Math.min(baseY + dy, frameH - frh));

      const frameCrop = cropAndResample(
        frameGray, frameW, frameH,
        { x: frx, y: fry, w: frw, h: frh },
        dw, dh,
      );

      const hybrid = scoreRegionHybrid(frameCrop, tmplCrop, dw, dh, bs);
      if (hybrid > bestScore) bestScore = hybrid;
    }
  }

  return bestScore;
}

/** CPU score across all regions (AND-logic: minimum). */
function cpuScoreFrame(
  frameGray: Float32Array,
  frameW: number,
  frameH: number,
  tmplGray: Float32Array,
  tmplW: number,
  tmplH: number,
  regions: Array<{ x: number; y: number; w: number; h: number }>,
): number {
  const scores = regions.map((region) =>
    cpuScoreRegion(
      frameGray, frameW, frameH,
      tmplGray, tmplW, tmplH,
      region,
    ),
  );
  return andLogicAcrossRegions(scores);
}

/** Seek a video element to a specific time, with timeout. */
function seekVideo(
  video: HTMLVideoElement,
  timeSec: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Seek timeout at ${timeSec.toFixed(3)}s`));
    }, 5000);

    // "seeked" alone is not enough: it can fire before the new frame is
    // actually presented, so canvas/WebGPU capture would still read the old
    // frame (in practice: every sample scores the very first frame). Wait for
    // both the seeked event and a presented video frame; a short fallback
    // covers seeks that land on the already-presented frame.
    let seeked = false;
    let framed = false;
    let frameFallback: ReturnType<typeof setTimeout> | null = null;

    const tryFinish = () => {
      if (!seeked) return;
      if (framed) {
        cleanup();
        resolve();
      } else if (frameFallback === null) {
        frameFallback = setTimeout(() => {
          cleanup();
          resolve();
        }, 150);
      }
    };

    const onSeeked = () => {
      seeked = true;
      tryFinish();
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      if (frameFallback !== null) clearTimeout(frameFallback);
      video.removeEventListener("seeked", onSeeked);
      signal.removeEventListener("abort", onAbort);
    };

    video.addEventListener("seeked", onSeeked, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(() => {
        framed = true;
        tryFinish();
      });
    } else {
      framed = true;
    }
    video.currentTime = timeSec;
  });
}

/** Wait for a video element to have loaded metadata and data. */
function waitForVideoReady(
  video: HTMLVideoElement,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Video load timeout"));
    }, 30000);

    const onReady = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error(`Video load error: ${video.error?.message ?? "unknown"}`));
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };

    video.addEventListener("loadeddata", onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Capture a frame from a video element as RGBA pixel data. */
function captureFrame(video: HTMLVideoElement): {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const w = video.videoWidth;
  const h = video.videoHeight;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(video, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  return { pixels: imageData.data, width: w, height: h };
}

/** Return a Tailwind text color class based on the delta magnitude. */
function deltaColor(delta: number): string {
  if (delta < 0.05) return "text-accent-green";
  if (delta < 0.1) return "text-accent-yellow";
  return "text-accent-red";
}

/** Count total frames across all ground-truth entries. */
function countTotalFrames(groundTruth: GroundTruthEntry[]): number {
  let total = 0;
  for (const gt of groundTruth) {
    total += gt.encounters.length + gt.negativeFrames.length;
  }
  return total;
}

/** Group ground-truth entries by video name. */
function groupByVideo(groundTruth: GroundTruthEntry[]): Map<string, GroundTruthEntry[]> {
  const byVideo = new Map<string, GroundTruthEntry[]>();
  for (const gt of groundTruth) {
    const list = byVideo.get(gt.videoName) ?? [];
    list.push(gt);
    byVideo.set(gt.videoName, list);
  }
  return byVideo;
}

/** Create and wait for a video element to be ready. */
async function loadVideoElement(
  videoName: string,
  signal: AbortSignal,
): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.crossOrigin = "anonymous";
  video.src = `/test-fixtures/${videoName}.mp4`;
  // A detached (or display:none) video is never composited, so seeks do not
  // present new frames: captures keep reading the first frame and
  // requestVideoFrameCallback never fires. Keep it in the DOM, invisible but
  // composited.
  video.style.position = "fixed";
  video.style.left = "0";
  video.style.bottom = "0";
  video.style.width = "4px";
  video.style.height = "4px";
  video.style.opacity = "0.01";
  video.style.pointerEvents = "none";
  document.body.appendChild(video);
  try {
    await waitForVideoReady(video, signal);
  } catch (e) {
    video.remove();
    throw e;
  }
  return video;
}

/** Clean up a video element after use. */
function cleanupVideo(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute("src");
  video.load();
  video.remove();
}

/** Load a template PNG and return its bitmap and grayscale data. */
async function loadTemplatePng(
  gt: GroundTruthEntry,
): Promise<{ bitmap: ImageBitmap; gray: Float32Array } | null> {
  const tmplUrl = `/test-fixtures/${gt.videoName}_${gt.pokemonName}_${gt.templateId}.png`;
  const tmplResp = await fetch(tmplUrl);
  if (!tmplResp.ok) return null;

  const tmplBlob = await tmplResp.blob();
  const tmplBitmap = await createImageBitmap(tmplBlob);

  const tmplCanvas = new OffscreenCanvas(tmplBitmap.width, tmplBitmap.height);
  const tmplCtx = tmplCanvas.getContext("2d")!;
  tmplCtx.drawImage(tmplBitmap, 0, 0);
  const tmplImageData = tmplCtx.getImageData(
    0, 0, tmplBitmap.width, tmplBitmap.height,
  );
  const tmplGray = toGrayscale(
    tmplImageData.data, tmplBitmap.width, tmplBitmap.height,
  );

  return { bitmap: tmplBitmap, gray: tmplGray };
}

/** Shared context for single-frame scoring, avoiding long param lists. */
interface ScoreContext {
  video: HTMLVideoElement;
  tmplGray: Float32Array;
  tmplW: number;
  tmplH: number;
  regions: Array<{ x: number; y: number; w: number; h: number }>;
  gpuDetector: WebGPUDetector;
  gpuTemplate: NonNullable<Awaited<ReturnType<WebGPUDetector["loadTemplate"]>>>;
}

/** Score a single video frame using both CPU and GPU backends. */
async function scoreSingleFrame(
  ctx: ScoreContext,
): Promise<{ cpuScore: number; gpuScore: number }> {
  const captured = captureFrame(ctx.video);
  const frameGray = toGrayscale(
    captured.pixels, captured.width, captured.height,
  );
  const cpuScore = cpuScoreFrame(
    frameGray, captured.width, captured.height,
    ctx.tmplGray, ctx.tmplW, ctx.tmplH,
    ctx.regions,
  );
  const gpuResult = await ctx.gpuDetector.detect(
    ctx.video, [ctx.gpuTemplate], { precision: 0 },
  );
  return { cpuScore, gpuScore: gpuResult.bestScore };
}

/** Find the best CPU and GPU scores across frame offsets for one encounter. */
async function scoreBestMatchFromOffsets(
  matchFrame: number,
  ctx: ScoreContext,
  signal: AbortSignal,
): Promise<{ bestCpu: number; bestGpu: number }> {
  let bestCpu = 0;
  let bestGpu = 0;

  for (const offset of [-5, -2, 0, 2, 5]) {
    if (signal.aborted) break;

    const timeSec = (matchFrame + offset) / FPS;
    try {
      await seekVideo(ctx.video, timeSec, signal);
    } catch {
      continue;
    }

    const { cpuScore, gpuScore } = await scoreSingleFrame(ctx);
    if (cpuScore > bestCpu) bestCpu = cpuScore;
    if (gpuScore > bestGpu) bestGpu = gpuScore;
  }

  return { bestCpu, bestGpu };
}

/** Load ground truth and test config and, when needed, create the GPU detector. */
async function initTestEnvironment(
  setProgress: (msg: string) => void,
  needGpu = true,
): Promise<{
  groundTruth: GroundTruthEntry[];
  regionMap: Map<number, Array<{ x: number; y: number; w: number; h: number }>>;
  detector: WebGPUDetector | null;
}> {
  setProgress("Loading ground-truth.json...");
  const gtResp = await fetch("/test-fixtures/ground-truth.json");
  if (!gtResp.ok) {
    throw new Error(
      "Could not load /test-fixtures/ground-truth.json. " +
      "Make sure the generated fixture files are served (e.g. via Vite public dir or dev server).",
    );
  }
  const groundTruth: GroundTruthEntry[] = await gtResp.json();

  setProgress("Loading test-config.json...");
  const configResp = await fetch("/test-fixtures/test-config.json");
  if (!configResp.ok) {
    throw new Error(
      "Could not load /test-fixtures/test-config.json. " +
      "Make sure test fixture files are served (e.g. via Vite public dir or dev server).",
    );
  }
  const testConfig: TestConfigEntry[] = await configResp.json();
  const regionMap = buildRegionMap(testConfig);

  if (!needGpu) return { groundTruth, regionMap, detector: null };
  setProgress("Creating WebGPU detector...");
  const detector = await WebGPUDetector.create();
  return { groundTruth, regionMap, detector };
}

/** Shared context for frame-processing helpers, avoiding long param lists. */
interface ProcessFramesContext {
  video: HTMLVideoElement;
  tmplData: { bitmap: ImageBitmap; gray: Float32Array };
  regions: Array<{ x: number; y: number; w: number; h: number }>;
  gpuDetector: WebGPUDetector;
  gpuTemplate: NonNullable<Awaited<ReturnType<WebGPUDetector["loadTemplate"]>>>;
  signal: AbortSignal;
  allResults: TestResult[];
  setProgress: (msg: string) => void;
  updateProgress: (frames: number) => void;
  publishResults: () => void;
}

/** Process all match-frame encounters for a single template. */
async function processMatchFrames(
  gt: GroundTruthEntry,
  ctx: ProcessFramesContext,
): Promise<void> {
  for (const enc of gt.encounters) {
    if (ctx.signal.aborted) break;

    // The fixture stores encounter windows; test the window center frame.
    const matchFrame = encounterMatchFrame(enc);
    ctx.setProgress(
      `${gt.pokemonName} (${gt.templateId}) -- Frame ${matchFrame}`,
    );

    const scoreCtx: ScoreContext = {
      video: ctx.video, tmplGray: ctx.tmplData.gray,
      tmplW: ctx.tmplData.bitmap.width, tmplH: ctx.tmplData.bitmap.height,
      regions: ctx.regions, gpuDetector: ctx.gpuDetector,
      gpuTemplate: ctx.gpuTemplate,
    };
    const { bestCpu, bestGpu } = await scoreBestMatchFromOffsets(
      matchFrame, scoreCtx, ctx.signal,
    );

    ctx.allResults.push(buildResult(gt, matchFrame, "match", bestCpu, bestGpu));
    ctx.updateProgress(1);
    ctx.publishResults();
  }
}

/** Process all negative frames for a single template. */
async function processNegativeFrames(
  gt: GroundTruthEntry,
  ctx: ProcessFramesContext,
): Promise<void> {
  for (const negFrame of gt.negativeFrames) {
    if (ctx.signal.aborted) break;

    ctx.setProgress(
      `${gt.pokemonName} (${gt.templateId}) -- Neg frame ${negFrame}`,
    );

    const timeSec = negFrame / FPS;
    try {
      await seekVideo(ctx.video, timeSec, ctx.signal);
    } catch {
      ctx.updateProgress(1);
      continue;
    }

    const scoreCtx: ScoreContext = {
      video: ctx.video, tmplGray: ctx.tmplData.gray,
      tmplW: ctx.tmplData.bitmap.width, tmplH: ctx.tmplData.bitmap.height,
      regions: ctx.regions, gpuDetector: ctx.gpuDetector,
      gpuTemplate: ctx.gpuTemplate,
    };
    const { cpuScore, gpuScore } = await scoreSingleFrame(scoreCtx);

    ctx.allResults.push(buildResult(gt, negFrame, "negative", cpuScore, gpuScore));
    ctx.updateProgress(1);
    ctx.publishResults();
  }
}

/** Build a TestResult from scoring data. */
function buildResult(
  gt: GroundTruthEntry,
  frame: number,
  type: "match" | "negative",
  cpuScore: number,
  gpuScore: number,
): TestResult {
  return {
    pokemonName: gt.pokemonName,
    templateId: gt.templateId,
    frame,
    type,
    cpuScore,
    gpuScore,
    delta: Math.abs(cpuScore - gpuScore),
  };
}

/** Group test-config entries by template, returning region rects. */
function buildRegionMap(
  config: TestConfigEntry[],
): Map<number, Array<{ x: number; y: number; w: number; h: number }>> {
  const map = new Map<
    number,
    Array<{ x: number; y: number; w: number; h: number }>
  >();
  for (const entry of config) {
    if (entry.region_type !== "image") continue;
    const existing = map.get(entry.template_id) ?? [];
    existing.push({
      x: entry.rect_x,
      y: entry.rect_y,
      w: entry.rect_w,
      h: entry.rect_h,
    });
    map.set(entry.template_id, existing);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Status icon component
// ---------------------------------------------------------------------------

function StatusIcon({ delta }: Readonly<{ delta: number }>): JSX.Element {
  if (delta < 0.05) {
    return <Check className="w-4 h-4 text-accent-green" aria-label="Pass" />;
  }
  if (delta < 0.1) {
    return (
      <AlertTriangle
        className="w-4 h-4 text-accent-yellow"
        aria-label="Warning"
      />
    );
  }
  return <XCircle className="w-4 h-4 text-accent-red" aria-label="Fail" />;
}

/** Text color for the encounters cell of a full-scan row. */
function encounterCellColor(hardCase: boolean, pass: boolean): string {
  if (hardCase) return "text-accent-yellow";
  return pass ? "text-accent-green" : "text-accent-red";
}

/**
 * Status cell of a full-scan row: hard cases get a badge instead of a
 * pass/fail verdict (they only count toward the GPU==CPU parity check).
 */
function ScanRowStatus({
  hardCase,
  pass,
}: Readonly<{ hardCase: boolean; pass: boolean }>): JSX.Element {
  if (hardCase) {
    return (
      <span
        className="inline-block px-1.5 py-0.5 rounded-none text-[10px] font-semibold bg-accent-yellow/20 text-accent-yellow"
        title="Deliberate hard case: excluded from pass/fail, still compared for GPU==CPU parity"
      >
        hard case
      </span>
    );
  }
  if (pass) {
    return (
      <Check className="w-4 h-4 text-accent-green inline-block" aria-label="Pass" />
    );
  }
  return (
    <XCircle className="w-4 h-4 text-accent-red inline-block" aria-label="Fail" />
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Try to load a video, skipping its entries on failure. Returns null if skipped. */
async function tryLoadVideo(
  videoName: string,
  gtEntries: GroundTruthEntry[],
  signal: AbortSignal,
  setProgress: (msg: string) => void,
  updateProgress: (frames: number) => void,
): Promise<HTMLVideoElement | null> {
  setProgress(`Loading video: ${videoName}.mp4...`);
  try {
    return await loadVideoElement(videoName, signal);
  } catch (e) {
    if (signal.aborted) return null;
    const msg = e instanceof Error ? e.message : String(e);
    setProgress(`Skipping ${videoName}: ${msg}`);
    for (const gt of gtEntries) {
      updateProgress(gt.encounters.length + gt.negativeFrames.length);
    }
    return null;
  }
}

/** Process a single template entry: load template, run match + negative frames, cleanup. */
async function processTemplate(
  gt: GroundTruthEntry,
  regions: Array<{ x: number; y: number; w: number; h: number }>,
  gpuDetector: WebGPUDetector,
  ctx: Omit<ProcessFramesContext, "tmplData" | "regions" | "gpuDetector" | "gpuTemplate">,
): Promise<void> {
  const tmplData = await loadTemplatePng(gt);
  const skipFrameCount = gt.encounters.length + gt.negativeFrames.length;
  if (!tmplData) {
    ctx.updateProgress(skipFrameCount);
    return;
  }

  const gpuRegions = regions.map((r) => ({
    type: "image" as const,
    rect: r,
  }));
  const gpuTemplate = await gpuDetector.loadTemplate(
    tmplData.bitmap, gpuRegions,
  );
  if (!gpuTemplate) {
    ctx.updateProgress(skipFrameCount);
    tmplData.bitmap.close();
    return;
  }

  const fullCtx: ProcessFramesContext = {
    ...ctx,
    tmplData,
    regions,
    gpuDetector,
    gpuTemplate,
  };

  await processMatchFrames(gt, fullCtx);
  await processNegativeFrames(gt, fullCtx);
  tmplData.bitmap.close();
}

/** Run all templates for a single video group. */
async function processVideoGroup(
  videoName: string,
  gtEntries: GroundTruthEntry[],
  regionMap: Map<number, Array<{ x: number; y: number; w: number; h: number }>>,
  gpuDetector: WebGPUDetector,
  ctx: Omit<ProcessFramesContext, "video" | "tmplData" | "regions" | "gpuDetector" | "gpuTemplate">,
): Promise<void> {
  const video = await tryLoadVideo(
    videoName, gtEntries, ctx.signal, ctx.setProgress, ctx.updateProgress,
  );
  if (!video) return;

  for (const gt of gtEntries) {
    if (ctx.signal.aborted) break;

    const regions = regionMap.get(gt.templateId);
    if (!regions || regions.length === 0) {
      ctx.updateProgress(gt.encounters.length + gt.negativeFrames.length);
      continue;
    }

    await processTemplate(gt, regions, gpuDetector, { ...ctx, video });
  }

  cleanupVideo(video);
}

// ---------------------------------------------------------------------------
// Full-video scan (GPU) helpers
// ---------------------------------------------------------------------------

/** Per-run bookkeeping shared by the full-scan helpers. */
interface FullScanRunContext {
  signal: AbortSignal;
  setProgress: (msg: string) => void;
  /** Report scan progress within the current template as a 0..1 fraction. */
  reportFraction: (fraction: number) => void;
  /** Mark the current template as finished (advances the overall progress). */
  advanceTemplate: () => void;
  /** Publish a finished full-scan row to the UI. */
  publish: (result: FullScanResult) => void;
}

/**
 * Seeks to a timestamp and scores the frame on one backend. Returns the
 * score, the pure scoring cost in ms (seek and capture time excluded) and a
 * small grayscale of the frame for the polling policy's frame delta, or null
 * when the seek fails (including on abort; callers check the signal
 * afterwards).
 */
type FrameScorer = (timeSec: number) => Promise<{
  score: number;
  scoreMs: number;
  frameGray: Float32Array;
} | null>;

/** Captures the current video frame as a small grayscale for frame deltas. */
function captureDeltaGray(video: HTMLVideoElement): Float32Array {
  const captured = captureFrame(video);
  const gray = toGrayscale(captured.pixels, captured.width, captured.height);
  return downsampleGray(gray, captured.width, captured.height);
}

/** Builds a FrameScorer for the WebGPU pipeline. */
function makeGpuScorer(
  video: HTMLVideoElement,
  gpuDetector: WebGPUDetector,
  gpuTemplate: NonNullable<Awaited<ReturnType<WebGPUDetector["loadTemplate"]>>>,
  signal: AbortSignal,
): FrameScorer {
  return async (timeSec) => {
    try {
      await seekVideo(video, timeSec, signal);
    } catch {
      return null;
    }
    const t0 = performance.now();
    const result = await gpuDetector.detect(video, [gpuTemplate], { precision: 0 });
    const scoreMs = performance.now() - t0;
    // The GPU path never exposes pixels, so grab a cheap CPU-side grayscale
    // for the frame delta; it is excluded from the measured scoring cost.
    return { score: result.bestScore, scoreMs, frameGray: captureDeltaGray(video) };
  };
}

/** Builds a FrameScorer for the CPU pipeline (math.ts scoring path). */
function makeCpuScorer(
  video: HTMLVideoElement,
  tmplGray: Float32Array,
  tmplW: number,
  tmplH: number,
  regions: Array<{ x: number; y: number; w: number; h: number }>,
  signal: AbortSignal,
): FrameScorer {
  return async (timeSec) => {
    try {
      await seekVideo(video, timeSec, signal);
    } catch {
      return null;
    }
    const captured = captureFrame(video);
    const frameGray = toGrayscale(captured.pixels, captured.width, captured.height);
    const t0 = performance.now();
    const score = cpuScoreFrame(
      frameGray, captured.width, captured.height, tmplGray, tmplW, tmplH, regions,
    );
    const scoreMs = performance.now() - t0;
    return {
      score,
      scoreMs,
      frameGray: downsampleGray(frameGray, captured.width, captured.height),
    };
  };
}

/**
 * Loads the template for one ground-truth entry and returns a FrameScorer for
 * the requested backend plus a dispose callback for the template resources.
 */
async function buildScorer(
  backend: ScanBackend,
  gt: GroundTruthEntry,
  regions: Array<{ x: number; y: number; w: number; h: number }>,
  video: HTMLVideoElement,
  gpuDetector: WebGPUDetector | null,
  signal: AbortSignal,
): Promise<{ scorer: FrameScorer; dispose: () => void } | null> {
  const tmplData = await loadTemplatePng(gt);
  if (!tmplData) return null;
  const tmplW = tmplData.bitmap.width;
  const tmplH = tmplData.bitmap.height;

  if (backend === "gpu") {
    if (!gpuDetector) {
      tmplData.bitmap.close();
      return null;
    }
    const gpuRegions = regions.map((r) => ({ type: "image" as const, rect: r }));
    const gpuTemplate = await gpuDetector.loadTemplate(tmplData.bitmap, gpuRegions);
    if (!gpuTemplate) {
      tmplData.bitmap.close();
      return null;
    }
    return {
      scorer: makeGpuScorer(video, gpuDetector, gpuTemplate, signal),
      dispose: () => tmplData.bitmap.close(),
    };
  }

  return {
    scorer: makeCpuScorer(video, tmplData.gray, tmplW, tmplH, regions, signal),
    dispose: () => tmplData.bitmap.close(),
  };
}

/**
 * Samples every 5th frame in the given range (like useTemplateTest.runBatch)
 * and returns the stability samples plus the measured average scoring cost.
 */
async function sweepSamplesForRange(
  scorer: FrameScorer,
  startFrame: number,
  endFrame: number,
  signal: AbortSignal,
  onFraction?: (fraction: number) => void,
): Promise<{ samples: StabilitySample[]; avgScoreMs: number }> {
  const samples: StabilitySample[] = [];
  let cost = 0;
  for (let f = startFrame; f <= endFrame; f += 5) {
    if (signal.aborted) break;
    onFraction?.((f - startFrame) / Math.max(1, endFrame - startFrame));
    const r = await scorer(f / FPS);
    if (!r) continue;
    samples.push({ frameIndex: f, overallScore: r.score });
    cost += r.scoreMs;
  }
  return { samples, avgScoreMs: samples.length ? cost / samples.length : 1 };
}

/**
 * Derives auto-calibrated state-machine settings for one template. The sweep
 * machinery expects a single match window (it optimizes for "confirms
 * exactly once"), so every ground-truth encounter window is swept on its
 * own (plus a 5 second margin) and the recommendation of the weakest window
 * (lowest recommended precision) wins: a threshold tuned on one strong
 * encounter would miss the weaker ones entirely. Returns null when no
 * window produces a recommendation.
 */
async function autoSettingsForTemplate(
  gt: GroundTruthEntry,
  scorer: FrameScorer,
  signal: AbortSignal,
  setProgress: (msg: string) => void,
): Promise<MatchSettings | null> {
  let best: MatchSettings | null = null;
  for (const [i, enc] of gt.encounters.entries()) {
    if (signal.aborted) return null;
    const start = Math.max(0, enc.start - 300);
    const end = (enc.maxEnd ?? enc.end) + 300;
    setProgress(
      `${gt.pokemonName} (${gt.templateId}) -- Calibrating window ${i + 1}/${gt.encounters.length} (frames ${start}-${end})...`,
    );
    const { samples, avgScoreMs } = await sweepSamplesForRange(scorer, start, end, signal);
    const stats = analyzeStability(samples);
    if (!stats) continue;
    const sweep = runParameterSweep({ samples, stats, avgScoreMs, cooldownSec: 5 });
    if (!sweep) continue;
    if (!best || sweep.precision < best.precision) {
      best = {
        precision: sweep.precision,
        hysteresisFactor: sweep.hysteresisFactor,
        consecutiveHits: sweep.consecutiveHits,
        cooldownSec: 5,
      };
    }
  }
  return best;
}

/** Options shared by the full scan and sweep runs. */
interface ScanOptions {
  backend: ScanBackend;
  settingsVariant: SettingsVariant;
}

/**
 * Scan one template across the whole video: sample a dense 10 fps grid
 * (score plus a small grayscale for frame deltas), then replay it through
 * simulateAdaptiveScan so encounters are counted exactly like the runtime
 * DetectionLoop would (adaptive polling, cooldown ticks), with either the
 * default or the auto-calibrated settings. Returns null when the template
 * could not be loaded.
 */
async function fullScanTemplate(
  gt: GroundTruthEntry,
  regions: Array<{ x: number; y: number; w: number; h: number }>,
  video: HTMLVideoElement,
  gpuDetector: WebGPUDetector | null,
  opts: ScanOptions,
  ctx: FullScanRunContext,
): Promise<FullScanResult | null> {
  const built = await buildScorer(opts.backend, gt, regions, video, gpuDetector, ctx.signal);
  if (!built) return null;
  const { scorer, dispose } = built;

  try {
    const started = performance.now();

    // Calibration mirrors the app's apply-recommended flow: stability
    // analysis over the first encounter window with the real measured
    // scoring cost. The recommendation is a package (precision, hysteresis,
    // polling bounds); with engine default poll bounds the loop can miss
    // the ultra-short encounter windows of these fixtures entirely.
    const calEnc = gt.encounters[0];
    ctx.setProgress(`${gt.pokemonName} (${gt.templateId}) -- Calibrating...`);
    const cal = await sweepSamplesForRange(
      scorer,
      Math.max(0, calEnc.start - 300),
      (calEnc.maxEnd ?? calEnc.end) + 300,
      ctx.signal,
    );
    const calStats = analyzeStability(cal.samples);
    const pollingRec = calStats ? recommendPolling(calStats, cal.avgScoreMs) : null;

    let settings = defaultScanSettings();
    if (opts.settingsVariant === "auto") {
      // Auto variant: sweep-optimized state machine settings.
      const auto = await autoSettingsForTemplate(gt, scorer, ctx.signal, ctx.setProgress);
      if (auto) settings = auto;
    } else if (calStats) {
      // Recommended variant: the stability recommendation as the user
      // would apply it after a batch test.
      settings = {
        precision: calStats.recommendedPrecision,
        hysteresisFactor: calStats.recommendedHysteresis,
        consecutiveHits: 1,
        cooldownSec: 5,
      };
    }
    const simSettings = {
      ...settings,
      minPollMs: pollingRec?.minPollMs,
      maxPollMs: pollingRec?.maxPollMs,
    };

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const samples: ScanSample[] = [];

    // Dense pass: score a fixed 10 fps grid the simulator can poll from.
    for (let t = 0; t < duration; t += SCAN_INTERVAL) {
      if (ctx.signal.aborted) break;
      ctx.setProgress(
        `${gt.pokemonName} (${gt.templateId}) -- Scanning ${t.toFixed(1)}s / ${duration.toFixed(1)}s`,
      );
      ctx.reportFraction(Math.min(0.95, t / duration));
      const r = await scorer(t);
      if (r === null) continue;
      samples.push({ time: t, score: r.score, frameGray: r.frameGray });
    }

    // Replay through the runtime's adaptive polling loop with the
    // calibrated poll bounds; change threshold stays at the runtime default.
    const sim = simulateAdaptiveScan(samples, simSettings);
    const matchFrames = samples.filter((s) => s.score >= SCAN_THRESHOLD).length;
    const maxScore = samples.length > 0 ? Math.max(...samples.map((s) => s.score)) : 0;

    return {
      pokemonName: gt.pokemonName,
      templateId: gt.templateId,
      videoName: gt.videoName,
      backend: opts.backend,
      settingsVariant: opts.settingsVariant,
      difficulty: gt.difficulty,
      loopTestable: gt.loopTestable,
      encountersFound: sim.encounters,
      encountersExpected: gt.expectedEncounters,
      matchFrames,
      sampledFrames: samples.length,
      polledSamples: sim.polledSamples,
      encounterSpans: sim.encounterSpans.map((span) => ({
        startFrame: Math.round((span.startMs / 1000) * FPS),
        endFrame: Math.round((span.endMs / 1000) * FPS),
        peakScore: span.peakScore,
      })),
      maxScore,
      scanSeconds: (performance.now() - started) / 1000,
    };
  } finally {
    dispose();
  }
}

/** Run the full-video scan for all templates of a single video group. */
async function fullScanVideoGroup(
  videoName: string,
  gtEntries: GroundTruthEntry[],
  regionMap: Map<number, Array<{ x: number; y: number; w: number; h: number }>>,
  gpuDetector: WebGPUDetector | null,
  opts: ScanOptions,
  ctx: FullScanRunContext,
): Promise<void> {
  if (gtEntries.length === 0) return;

  ctx.setProgress(`Loading video: ${videoName}.mp4...`);
  let video: HTMLVideoElement;
  try {
    video = await loadVideoElement(videoName, ctx.signal);
  } catch (e) {
    if (ctx.signal.aborted) return;
    const msg = e instanceof Error ? e.message : String(e);
    ctx.setProgress(`Skipping ${videoName}: ${msg}`);
    for (let i = 0; i < gtEntries.length; i++) ctx.advanceTemplate();
    return;
  }

  try {
    for (const gt of gtEntries) {
      if (ctx.signal.aborted) break;

      const regions = regionMap.get(gt.templateId);
      if (!regions || regions.length === 0) {
        ctx.advanceTemplate();
        continue;
      }

      const result = await fullScanTemplate(
        gt, regions, video, gpuDetector, opts, ctx,
      );
      if (result && !ctx.signal.aborted) ctx.publish(result);
      ctx.advanceTemplate();
    }
  } finally {
    cleanupVideo(video);
  }
}

/**
 * Runs the stability analysis and parameter sweep for every ground-truth
 * entry that declares a sweepCase, publishing one row per case.
 */
async function runSweepCases(
  groundTruth: GroundTruthEntry[],
  regionMap: Map<number, Array<{ x: number; y: number; w: number; h: number }>>,
  gpuDetector: WebGPUDetector | null,
  backend: ScanBackend,
  signal: AbortSignal,
  setProgress: (msg: string) => void,
  reportFraction: (fraction: number) => void,
  publish: (row: SweepUiResult) => void,
): Promise<void> {
  const cases = groundTruth.filter(
    (g): g is GroundTruthEntry & { sweepCase: SweepCase } =>
      g.sweepCase !== undefined,
  );
  for (let i = 0; i < cases.length; i++) {
    if (signal.aborted) break;
    const gt = cases[i];
    const sc = gt.sweepCase;
    const regions = regionMap.get(gt.templateId);
    if (!regions || regions.length === 0) continue;

    setProgress(`Sweep: loading ${gt.videoName}.mp4...`);
    let video: HTMLVideoElement;
    try {
      video = await loadVideoElement(gt.videoName, signal);
    } catch {
      continue;
    }

    try {
      const built = await buildScorer(backend, gt, regions, video, gpuDetector, signal);
      if (!built) continue;
      try {
        const started = performance.now();
        const { samples, avgScoreMs } = await sweepSamplesForRange(
          built.scorer, sc.scanStart, sc.scanEnd, signal,
          (f) => {
            setProgress(
              `Sweep: ${gt.pokemonName} (${gt.templateId}) -- frames ${sc.scanStart}-${sc.scanEnd}`,
            );
            reportFraction((i + f) / cases.length);
          },
        );
        if (signal.aborted) break;

        const stats = analyzeStability(samples);
        const sweep = stats
          ? runParameterSweep({ samples, stats, avgScoreMs, cooldownSec: 5 })
          : null;
        publish({
          pokemonName: gt.pokemonName,
          templateId: gt.templateId,
          backend,
          rating: stats?.rating ?? "poor",
          precision: sweep?.precision ?? 0,
          hysteresisFactor: sweep?.hysteresisFactor ?? 0,
          consecutiveHits: sweep?.consecutiveHits ?? 0,
          pollIntervalMs: sweep?.pollIntervalMs ?? 0,
          cleanPhases: sweep?.cleanPhases ?? 0,
          totalPhases: sweep?.totalPhases ?? 0,
          robustnessMargin: sweep?.robustnessMargin ?? 0,
          perfect: sweep?.perfect === true,
          sweepSeconds: (performance.now() - started) / 1000,
        });
      } finally {
        built.dispose();
      }
    } finally {
      cleanupVideo(video);
    }
  }
}

/** Dev-only modal for GPU/CPU equivalence testing. */
export default function GpuEquivalenceTest({
  onClose,
}: Readonly<GpuEquivalenceTestProps>): JSX.Element {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<TestResult[]>([]);
  const [fullScanResults, setFullScanResults] = useState<FullScanResult[]>([]);
  const [sweepResults, setSweepResults] = useState<SweepUiResult[]>([]);
  const [backend, setBackend] = useState<ScanBackend>("gpu");
  const [settingsVariant, setSettingsVariant] = useState<SettingsVariant>("recommended");
  const [progress, setProgress] = useState<string>("");
  const [progressPct, setProgressPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [gpuAvailable] = useState(() => WebGPUDetector.isAvailable());

  const abortRef = useRef<AbortController | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Auto-focus close button on mount
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Open dialog on mount
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const runTests = useCallback(async () => {
    setRunning(true);
    setResults([]);
    setError(null);
    setProgress("Initializing...");
    setProgressPct(0);

    const abort = new AbortController();
    abortRef.current = abort;
    const { signal } = abort;

    let gpuDetector: WebGPUDetector | null = null;

    try {
      const { groundTruth, regionMap, detector } = await initTestEnvironment(setProgress);
      if (!detector) throw new Error("WebGPU is not available.");
      gpuDetector = detector;

      const totalFrames = countTotalFrames(groundTruth);
      let completedFrames = 0;
      const allResults: TestResult[] = [];

      const updateProgress = (frames: number) => {
        completedFrames += frames;
        setProgressPct((completedFrames / totalFrames) * 100);
      };

      const publishResults = () => {
        setResults([...allResults]);
      };

      const ctx = { signal, allResults, setProgress, updateProgress, publishResults };

      for (const [videoName, gtEntries] of groupByVideo(groundTruth)) {
        if (signal.aborted) break;
        await processVideoGroup(videoName, gtEntries, regionMap, detector, ctx);
      }

      setProgress(signal.aborted ? "Cancelled." : "Complete.");
      if (!signal.aborted) setProgressPct(100);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setProgress("Cancelled.");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setProgress("Failed.");
      }
    } finally {
      gpuDetector?.destroy();
      setRunning(false);
    }
  }, []);

  /**
   * Runs the full-video scan on the selected backend and settings variant:
   * samples a dense 0.1s grid and replays it through the loop-faithful
   * adaptive polling simulator (encounters counted as hysteresis entries).
   * Results accumulate across runs keyed by backend, settings variant and
   * template; re-running a combination replaces only its own rows, so GPU
   * and CPU runs can be compared side by side for parity.
   */
  const runFullScan = useCallback(async () => {
    setRunning(true);
    setError(null);
    setProgress("Initializing...");
    setProgressPct(0);

    const abort = new AbortController();
    abortRef.current = abort;
    const { signal } = abort;

    let gpuDetector: WebGPUDetector | null = null;

    try {
      const { groundTruth, regionMap, detector } = await initTestEnvironment(
        setProgress, backend === "gpu",
      );
      if (backend === "gpu" && !detector) throw new Error("WebGPU is not available.");
      gpuDetector = detector;

      const totalTemplates = groundTruth.length;
      let templatesDone = 0;

      const ctx: FullScanRunContext = {
        signal,
        setProgress,
        reportFraction: (fraction: number) => {
          setProgressPct(((templatesDone + fraction) / totalTemplates) * 100);
        },
        advanceTemplate: () => {
          templatesDone += 1;
          setProgressPct((templatesDone / totalTemplates) * 100);
        },
        // Upsert by (backend, settingsVariant, templateId) so results
        // accumulate across runs and only same-combination rows get replaced.
        publish: (result: FullScanResult) => {
          setFullScanResults((prev) => [
            ...prev.filter(
              (r) =>
                r.backend !== result.backend ||
                r.settingsVariant !== result.settingsVariant ||
                r.templateId !== result.templateId,
            ),
            result,
          ]);
        },
      };

      const opts: ScanOptions = { backend, settingsVariant };
      for (const [videoName, gtEntries] of groupByVideo(groundTruth)) {
        if (signal.aborted) break;
        await fullScanVideoGroup(videoName, gtEntries, regionMap, gpuDetector, opts, ctx);
      }

      setProgress(signal.aborted ? "Cancelled." : "Complete.");
      if (!signal.aborted) setProgressPct(100);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setProgress("Cancelled.");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setProgress("Failed.");
      }
    } finally {
      gpuDetector?.destroy();
      setRunning(false);
    }
  }, [backend, settingsVariant]);

  /**
   * Runs the stability analysis and parameter sweep for the fixture entries
   * that declare a sweepCase on the selected backend (mirrors the node
   * suite's "Parameter Sweep on Real Captures").
   */
  const runSweep = useCallback(async () => {
    setRunning(true);
    setSweepResults([]);
    setError(null);
    setProgress("Initializing...");
    setProgressPct(0);

    const abort = new AbortController();
    abortRef.current = abort;
    const { signal } = abort;

    let gpuDetector: WebGPUDetector | null = null;

    try {
      const { groundTruth, regionMap, detector } = await initTestEnvironment(
        setProgress, backend === "gpu",
      );
      if (backend === "gpu" && !detector) throw new Error("WebGPU is not available.");
      gpuDetector = detector;

      const rows: SweepUiResult[] = [];
      await runSweepCases(
        groundTruth, regionMap, gpuDetector, backend, signal, setProgress,
        (fraction) => setProgressPct(fraction * 100),
        (row) => {
          rows.push(row);
          setSweepResults([...rows]);
        },
      );

      setProgress(signal.aborted ? "Cancelled." : "Complete.");
      if (!signal.aborted) setProgressPct(100);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setProgress("Cancelled.");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setProgress("Failed.");
      }
    } finally {
      gpuDetector?.destroy();
      setRunning(false);
    }
  }, [backend]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /**
   * Downloads the current results as a JSON report (and copies it to the
   * clipboard) so a run can be archived or shared without manual copy-paste.
   */
  const exportResults = useCallback(() => {
    const deltas = results.map((r) => r.delta);
    const exportParity = computeParitySummaries(fullScanResults);
    const fullScanSection = fullScanResults.length > 0
      ? {
          fullScan: {
            summary: {
              videos: new Set(fullScanResults.map((r) => r.videoName)).size,
              // Hard cases carry no pass/fail verdict; report them separately.
              passed: fullScanResults.filter(
                (r) => !isHardCase(r) && scanRowPasses(r),
              ).length,
              failed: fullScanResults.filter(
                (r) => !isHardCase(r) && !scanRowPasses(r),
              ).length,
              hardCases: fullScanResults.filter(isHardCase).length,
              totalEncountersExpected: fullScanResults.reduce(
                (sum, r) => sum + r.encountersExpected, 0,
              ),
              totalEncountersFound: fullScanResults.reduce(
                (sum, r) => sum + r.encountersFound, 0,
              ),
            },
            ...(exportParity.length > 0 ? { paritySummary: exportParity } : {}),
            results: fullScanResults,
          },
        }
      : {};
    const sweepSection = sweepResults.length > 0
      ? {
          stabilitySweep: {
            summary: {
              cases: sweepResults.length,
              passed: sweepResults.filter((r) => r.perfect).length,
              failed: sweepResults.filter((r) => !r.perfect).length,
            },
            results: sweepResults,
          },
        }
      : {};
    const report = {
      exportedAt: new Date().toISOString(),
      backend: "webgpu-vs-cpu",
      simulator: "adaptive-polling",
      summary: {
        total: results.length,
        passed: results.filter((r) => r.delta < 0.05).length,
        warned: results.filter((r) => r.delta >= 0.05 && r.delta < 0.1).length,
        failed: results.filter((r) => r.delta >= 0.1).length,
        avgDelta: deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0,
        maxDelta: deltas.length ? Math.max(...deltas) : 0,
      },
      results,
      ...fullScanSection,
      ...sweepSection,
    };
    const json = JSON.stringify(report, null, 2);
    navigator.clipboard?.writeText(json).catch(() => {
      // Clipboard may be blocked; the download below still works.
    });
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // Name the file after what it contains so multiple exports do not need
    // manual renaming (e.g. gpu-equivalence-2026-07-23-fullscan-gpu-auto.json).
    const parts = [`gpu-equivalence-${new Date().toISOString().slice(0, 10)}`];
    if (fullScanResults.length > 0) {
      // Accumulated results can mix backends/variants; name accordingly.
      const backends = new Set(fullScanResults.map((r) => r.backend));
      const variants = new Set(fullScanResults.map((r) => r.settingsVariant));
      const backendPart = backends.size === 1 ? [...backends][0] : "both";
      const variantPart = variants.size === 1 ? [...variants][0] : "mixed";
      parts.push(`fullscan-${backendPart}-${variantPart}`);
    }
    if (sweepResults.length > 0) parts.push(`sweep-${sweepResults[0].backend}`);
    a.download = `${parts.join("-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [results, fullScanResults, sweepResults]);

  // Dev console access: __gpuEquivalence.run() / .runFullScan() / .runSweep()
  // / .export() while the modal is open, so runs can be scripted from
  // DevTools. Full scan and sweep honor the backend/settings toggles.
  useEffect(() => {
    const g = globalThis as unknown as { __gpuEquivalence?: unknown };
    g.__gpuEquivalence = { run: runTests, runFullScan, runSweep, export: exportResults };
    return () => {
      delete g.__gpuEquivalence;
    };
  }, [runTests, runFullScan, runSweep, exportResults]);

  /** Close the dialog natively and notify the parent. */
  const handleDialogClose = useCallback(() => {
    dialogRef.current?.close();
    onClose();
  }, [onClose]);

  // Close on backdrop click (imperative to avoid onClick on non-interactive <dialog>)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleBackdropClick = (e: MouseEvent) => {
      if (e.target === dialog) handleDialogClose();
    };
    dialog.addEventListener("click", handleBackdropClick);
    return () => dialog.removeEventListener("click", handleBackdropClick);
  }, [handleDialogClose]);

  // --- Summary stats ---
  const totalTests = results.length;
  const passed = results.filter((r) => r.delta < 0.05).length;
  const warned = results.filter(
    (r) => r.delta >= 0.05 && r.delta < 0.1,
  ).length;
  const failed = results.filter((r) => r.delta >= 0.1).length;
  const avgDelta =
    totalTests > 0
      ? results.reduce((sum, r) => sum + r.delta, 0) / totalTests
      : 0;
  const maxDelta =
    totalTests > 0 ? Math.max(...results.map((r) => r.delta)) : 0;

  // --- Full-scan summary stats ---
  // Hard cases (loopTestable === false) get no pass/fail verdict; they are
  // shown with a badge and only count toward the GPU==CPU parity check.
  const scanTotal = fullScanResults.length;
  const scanVideos = new Set(fullScanResults.map((r) => r.videoName)).size;
  const scanVerdictRows = fullScanResults.filter((r) => !isHardCase(r));
  const scanHardCases = scanTotal - scanVerdictRows.length;
  const scanPassed = scanVerdictRows.filter(scanRowPasses).length;
  const scanFailed = scanVerdictRows.length - scanPassed;
  const paritySummaries = computeParitySummaries(fullScanResults);
  // Stable ordering with GPU/CPU rows of the same template adjacent, so the
  // accumulated table stays readable across runs.
  const sortedScanResults = [...fullScanResults].sort(
    (a, b) =>
      a.videoName.localeCompare(b.videoName) ||
      a.templateId - b.templateId ||
      a.settingsVariant.localeCompare(b.settingsVariant) ||
      a.backend.localeCompare(b.backend),
  );
  const scanExpectedTotal = fullScanResults.reduce(
    (sum, r) => sum + r.encountersExpected, 0,
  );
  const scanFoundTotal = fullScanResults.reduce(
    (sum, r) => sum + r.encountersFound, 0,
  );

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleDialogClose}
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center m-0 p-0 border-none max-w-none max-h-none w-full h-full"
      aria-label="GPU Equivalence Test"
    >
      <div className="bg-bg-card rounded-none border border-border-subtle shadow-xl max-w-4xl w-full max-h-[85vh] flex flex-col">
        {/* --- Header --- */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-primary">
            GPU / CPU Equivalence Test
          </h2>
          <button
            ref={closeButtonRef}
            onClick={handleDialogClose}
            className="p-1.5 rounded-none hover:bg-bg-hover text-text-secondary focus-visible:outline-2 focus-visible:outline-accent-blue"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* --- Controls --- */}
        <div className="px-6 py-3 border-b border-border-subtle space-y-3">
          {/* Options for full scan and sweep runs */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-text-secondary">
            <span className="font-semibold uppercase tracking-wider">Backend</span>
            <div className="flex border border-border-subtle rounded-none overflow-hidden">
              {(["gpu", "cpu"] as const).map((b) => (
                <button
                  key={b}
                  onClick={() => setBackend(b)}
                  disabled={running}
                  className={`px-3 py-1 font-medium uppercase ${
                    backend === b
                      ? "bg-accent-blue/15 text-accent-blue"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  {b.toUpperCase()}
                </button>
              ))}
            </div>
            <span className="font-semibold uppercase tracking-wider">Settings</span>
            <div className="flex border border-border-subtle rounded-none overflow-hidden">
              {(["recommended", "auto"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setSettingsVariant(v)}
                  disabled={running}
                  className={`px-3 py-1 font-medium capitalize ${
                    settingsVariant === v
                      ? "bg-accent-blue/15 text-accent-blue"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  {v === "auto" ? "Auto (sweep)" : "Recommended"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {running ? (
              <button
                onClick={handleCancel}
                className="flex items-center gap-2 px-4 py-2 rounded-none bg-accent-red text-bg-primary font-medium hover:bg-accent-red/80 focus-visible:outline-2 focus-visible:outline-accent-blue"
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
            ) : (
              <>
                <button
                  onClick={runTests}
                  disabled={!gpuAvailable || running}
                  className="flex items-center gap-2 px-4 py-2 rounded-none bg-accent-blue text-bg-primary font-medium hover:bg-accent-blue/80 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent-blue"
                >
                  <Play className="w-4 h-4" />
                  Run Test
                </button>
                <button
                  onClick={runFullScan}
                  disabled={(backend === "gpu" && !gpuAvailable) || running}
                  className="flex items-center gap-2 px-4 py-2 rounded-none border border-accent-blue text-accent-blue font-medium hover:bg-accent-blue/10 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent-blue"
                >
                  <Play className="w-4 h-4" />
                  Full Scan
                </button>
                <button
                  onClick={runSweep}
                  disabled={(backend === "gpu" && !gpuAvailable) || running}
                  className="flex items-center gap-2 px-4 py-2 rounded-none border border-accent-blue text-accent-blue font-medium hover:bg-accent-blue/10 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent-blue"
                >
                  <Play className="w-4 h-4" />
                  Stability &amp; Sweep
                </button>
              </>
            )}

            {running && (
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{progress}</span>
              </div>
            )}

            {!running && !gpuAvailable && (
              <span className="text-sm text-accent-red">
                WebGPU is not available in this browser.
              </span>
            )}

            {!running && error && (
              <span className="text-sm text-accent-red">{error}</span>
            )}

            {!running && (totalTests > 0 || scanTotal > 0 || sweepResults.length > 0) && (
              <button
                onClick={exportResults}
                className="flex items-center gap-2 px-4 py-2 rounded-none border border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent-blue focus-visible:outline-2 focus-visible:outline-accent-blue"
              >
                <Download className="w-4 h-4" />
                Export JSON
              </button>
            )}

            {!running && scanTotal > 0 && (
              <button
                onClick={() => setFullScanResults([])}
                className="flex items-center gap-2 px-4 py-2 rounded-none border border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent-red focus-visible:outline-2 focus-visible:outline-accent-blue"
              >
                <X className="w-4 h-4" />
                Clear results
              </button>
            )}

            {!running && !error && (totalTests > 0 || scanTotal > 0 || sweepResults.length > 0) && (
              <span className="text-sm text-text-secondary">
                {progress}
              </span>
            )}
          </div>

          {/* Progress bar */}
          {running && (
            <div className="w-full h-2 rounded-none bg-bg-hover overflow-hidden">
              <div
                className="h-full bg-accent-blue rounded-none transition-all duration-200"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}

          {/* Summary bar */}
          {totalTests > 0 && (
            <div className="flex flex-wrap gap-4 text-xs font-mono text-text-secondary">
              <span>
                Total: <strong className="text-text-primary">{totalTests}</strong>
              </span>
              <span>
                Passed:{" "}
                <strong className="text-accent-green">{passed}</strong>
              </span>
              <span>
                Warned:{" "}
                <strong className="text-accent-yellow">{warned}</strong>
              </span>
              <span>
                Failed:{" "}
                <strong className="text-accent-red">{failed}</strong>
              </span>
              <span>
                Avg delta:{" "}
                <strong className="text-text-primary">
                  {(avgDelta * 100).toFixed(2)}%
                </strong>
              </span>
              <span>
                Max delta:{" "}
                <strong className="text-text-primary">
                  {(maxDelta * 100).toFixed(2)}%
                </strong>
              </span>
            </div>
          )}

          {/* Full-scan summary bar */}
          {scanTotal > 0 && (
            <div className="flex flex-wrap gap-4 text-xs font-mono text-text-secondary">
              <span>
                Scan videos:{" "}
                <strong className="text-text-primary">{scanVideos}</strong>
              </span>
              <span>
                Scan passed:{" "}
                <strong className="text-accent-green">{scanPassed}</strong>
              </span>
              <span>
                Scan failed:{" "}
                <strong className="text-accent-red">{scanFailed}</strong>
              </span>
              {scanHardCases > 0 && (
                <span>
                  Hard cases:{" "}
                  <strong className="text-accent-yellow">{scanHardCases}</strong>
                </span>
              )}
              <span>
                Encounters:{" "}
                <strong className="text-text-primary">
                  {scanFoundTotal}/{scanExpectedTotal}
                </strong>
              </span>
            </div>
          )}
        </div>

        {/* --- Results tables --- */}
        <div className="flex-1 overflow-auto px-6 py-3">
          {totalTests === 0 && scanTotal === 0 && sweepResults.length === 0 && !running ? (
            <div className="flex items-center justify-center h-40 text-text-faint text-sm">
              Press &quot;Run Test&quot; for the frame equivalence test, &quot;Full
              Scan&quot; for the full-video encounter scan, or &quot;Stability &amp;
              Sweep&quot; for the calibration check.
              Fixture files must be served at /test-fixtures/.
            </div>
          ) : (
            <div className="space-y-6">
              {totalTests > 0 && (
                <section aria-label="Frame equivalence results">
                  {scanTotal > 0 && (
                    <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
                      Frame Equivalence (CPU vs GPU)
                    </h3>
                  )}
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="text-left text-text-secondary border-b border-border-subtle">
                        <th className="py-2 pr-3">Pokemon (ID)</th>
                        <th className="py-2 pr-3">Frame #</th>
                        <th className="py-2 pr-3">Type</th>
                        <th className="py-2 pr-3 text-right">CPU Score</th>
                        <th className="py-2 pr-3 text-right">GPU Score</th>
                        <th className="py-2 pr-3 text-right">Delta</th>
                        <th className="py-2 pr-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r, i) => (
                        <tr
                          key={`${r.templateId}-${r.frame}-${r.type}`}
                          className={
                            i % 2 === 0 ? "bg-transparent" : "bg-bg-hover/50"
                          }
                        >
                          <td className="py-1.5 pr-3 text-text-primary">
                            {r.pokemonName} ({r.templateId})
                          </td>
                          <td className="py-1.5 pr-3 text-text-secondary">
                            {r.frame}
                          </td>
                          <td className="py-1.5 pr-3">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded-none text-[10px] font-semibold ${
                                r.type === "match"
                                  ? "bg-accent-green/20 text-accent-green"
                                  : "bg-neutral-500/20 text-neutral-400"
                              }`}
                            >
                              {r.type}
                            </span>
                          </td>
                          <td className="py-1.5 pr-3 text-right text-text-primary">
                            {(r.cpuScore * 100).toFixed(2)}%
                          </td>
                          <td className="py-1.5 pr-3 text-right text-text-primary">
                            {(r.gpuScore * 100).toFixed(2)}%
                          </td>
                          <td
                            className={`py-1.5 pr-3 text-right ${deltaColor(r.delta)}`}
                          >
                            {(r.delta * 100).toFixed(2)}%
                          </td>
                          <td className="py-1.5 pr-3 text-center">
                            <StatusIcon delta={r.delta} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {scanTotal > 0 && (
                <section aria-label="Full video scan results">
                  <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
                    Full Video Scan
                  </h3>
                  {/* Parity is the primary verdict: same encounter counts on
                      both backends. Ground-truth pass/fail stays as the
                      secondary per-row status. */}
                  {paritySummaries.length > 0 && (
                    <div className="mb-2 space-y-1">
                      {paritySummaries.map((p) => (
                        <p
                          key={`parity-${p.settingsVariant}`}
                          className={`text-sm font-mono font-semibold ${
                            p.identical === p.total
                              ? "text-accent-green"
                              : "text-accent-red"
                          }`}
                        >
                          Parity GPU==CPU ({p.settingsVariant}): {p.identical}/
                          {p.total} identical
                        </p>
                      ))}
                    </div>
                  )}
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="text-left text-text-secondary border-b border-border-subtle">
                        <th className="py-2 pr-3">Pokemon (ID)</th>
                        <th className="py-2 pr-3">Video</th>
                        <th className="py-2 pr-3">Backend</th>
                        <th className="py-2 pr-3">Settings</th>
                        <th className="py-2 pr-3 text-right">Encounters</th>
                        <th className="py-2 pr-3 text-right">Match Frames</th>
                        <th className="py-2 pr-3 text-right">Sampled</th>
                        <th className="py-2 pr-3 text-right">Polled</th>
                        <th className="py-2 pr-3 text-right">Max Score</th>
                        <th className="py-2 pr-3 text-right">Scan (s)</th>
                        <th className="py-2 pr-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedScanResults.map((r, i) => {
                        const hardCase = isHardCase(r);
                        const pass = scanRowPasses(r);
                        return (
                          <tr
                            key={`scan-${r.videoName}-${r.templateId}-${r.backend}-${r.settingsVariant}`}
                            className={
                              i % 2 === 0 ? "bg-transparent" : "bg-bg-hover/50"
                            }
                          >
                            <td className="py-1.5 pr-3 text-text-primary">
                              {r.pokemonName} ({r.templateId})
                            </td>
                            <td className="py-1.5 pr-3 text-text-secondary">
                              {r.videoName}
                            </td>
                            <td className="py-1.5 pr-3 text-text-secondary uppercase">
                              {r.backend}
                            </td>
                            <td className="py-1.5 pr-3 text-text-secondary">
                              {r.settingsVariant}
                            </td>
                            <td
                              className={`py-1.5 pr-3 text-right ${encounterCellColor(hardCase, pass)}`}
                              title={r.encounterSpans
                                .map(
                                  (span, i) =>
                                    `${i + 1}: ${span.startFrame}f-${span.endFrame}f (peak ${(span.peakScore * 100).toFixed(1)}%)`,
                                )
                                .join("\n")}
                            >
                              {r.encountersFound}/{r.encountersExpected}
                            </td>
                            <td className="py-1.5 pr-3 text-right text-text-primary">
                              {r.matchFrames}
                            </td>
                            <td className="py-1.5 pr-3 text-right text-text-secondary">
                              {r.sampledFrames}
                            </td>
                            <td className="py-1.5 pr-3 text-right text-text-secondary">
                              {r.polledSamples}
                            </td>
                            <td className="py-1.5 pr-3 text-right text-text-primary">
                              {(r.maxScore * 100).toFixed(2)}%
                            </td>
                            <td className="py-1.5 pr-3 text-right text-text-secondary">
                              {r.scanSeconds.toFixed(1)}
                            </td>
                            <td className="py-1.5 pr-3 text-center">
                              <ScanRowStatus hardCase={hardCase} pass={pass} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              )}

              {sweepResults.length > 0 && (
                <section aria-label="Stability and sweep results">
                  <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
                    Stability &amp; Parameter Sweep
                  </h3>
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="text-left text-text-secondary border-b border-border-subtle">
                        <th className="py-2 pr-3">Pokemon (ID)</th>
                        <th className="py-2 pr-3">Backend</th>
                        <th className="py-2 pr-3">Rating</th>
                        <th className="py-2 pr-3 text-right">Precision</th>
                        <th className="py-2 pr-3 text-right">Hysteresis</th>
                        <th className="py-2 pr-3 text-right">Hits</th>
                        <th className="py-2 pr-3 text-right">Poll (ms)</th>
                        <th className="py-2 pr-3 text-right">Clean</th>
                        <th className="py-2 pr-3 text-right">Margin</th>
                        <th className="py-2 pr-3 text-right">Sweep (s)</th>
                        <th className="py-2 pr-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sweepResults.map((r, i) => (
                        <tr
                          key={`sweep-${r.templateId}-${r.backend}`}
                          className={
                            i % 2 === 0 ? "bg-transparent" : "bg-bg-hover/50"
                          }
                        >
                          <td className="py-1.5 pr-3 text-text-primary">
                            {r.pokemonName} ({r.templateId})
                          </td>
                          <td className="py-1.5 pr-3 text-text-secondary uppercase">
                            {r.backend}
                          </td>
                          <td className="py-1.5 pr-3 text-text-secondary">
                            {r.rating}
                          </td>
                          <td className="py-1.5 pr-3 text-right text-text-primary">
                            {r.precision.toFixed(3)}
                          </td>
                          <td className="py-1.5 pr-3 text-right text-text-primary">
                            {r.hysteresisFactor.toFixed(2)}
                          </td>
                          <td className="py-1.5 pr-3 text-right text-text-secondary">
                            {r.consecutiveHits}
                          </td>
                          <td className="py-1.5 pr-3 text-right text-text-secondary">
                            {r.pollIntervalMs}
                          </td>
                          <td className="py-1.5 pr-3 text-right text-text-primary">
                            {r.cleanPhases}/{r.totalPhases}
                          </td>
                          <td className="py-1.5 pr-3 text-right text-text-primary">
                            {r.robustnessMargin.toFixed(3)}
                          </td>
                          <td className="py-1.5 pr-3 text-right text-text-secondary">
                            {r.sweepSeconds.toFixed(1)}
                          </td>
                          <td className="py-1.5 pr-3 text-center">
                            {r.perfect ? (
                              <Check
                                className="w-4 h-4 text-accent-green inline-block"
                                aria-label="Pass"
                              />
                            ) : (
                              <XCircle
                                className="w-4 h-4 text-accent-red inline-block"
                                aria-label="Fail"
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
