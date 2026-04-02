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
} from "lucide-react";
import { WebGPUDetector } from "../../engine/WebGPUDetector";
import {
  fitDimensions,
  adaptiveBlockSizeForRegion,
  scoreRegionHybrid,
  andLogicAcrossRegions,
} from "../../engine/math";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GpuEquivalenceTestProps {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Ground-truth data (matches ncc-detection.test.ts exactly)
// ---------------------------------------------------------------------------

const FPS = 60;

interface EncounterGT {
  matchFrame: number;
  windowStart: number;
  windowEnd: number;
}

interface TemplateGT {
  videoName: string;
  templateId: number;
  pokemonName: string;
  encounters: EncounterGT[];
  negativeFrames: number[];
}

const GROUND_TRUTH: TemplateGT[] = [
  {
    videoName: "Dual_SoftReset", templateId: 29, pokemonName: "Kyurem",
    encounters: [
      { matchFrame: 613, windowStart: 613, windowEnd: 613 },
      { matchFrame: 2800, windowStart: 2800, windowEnd: 2800 },
      { matchFrame: 4854, windowStart: 4854, windowEnd: 4854 },
    ],
    negativeFrames: [1, 300, 1500, 3500],
  },
  {
    videoName: "Dual_SoftReset", templateId: 30, pokemonName: "Giratina",
    encounters: [
      { matchFrame: 627, windowStart: 627, windowEnd: 627 },
      { matchFrame: 2436, windowStart: 2436, windowEnd: 2436 },
      { matchFrame: 4124, windowStart: 4124, windowEnd: 4124 },
    ],
    negativeFrames: [1, 300, 1500, 3500],
  },
  {
    videoName: "FRLG_Fishing", templateId: 28, pokemonName: "Goldini",
    encounters: [
      { matchFrame: 658, windowStart: 658, windowEnd: 658 },
      { matchFrame: 2376, windowStart: 2376, windowEnd: 2376 },
    ],
    negativeFrames: [1, 300, 1500],
  },
  {
    videoName: "FRLG_Runaway", templateId: 26, pokemonName: "Bluzuk",
    encounters: [{ matchFrame: 359, windowStart: 359, windowEnd: 359 }],
    negativeFrames: [1, 180, 800, 1400],
  },
  {
    videoName: "FRLG_Runaway", templateId: 27, pokemonName: "Chaneira",
    encounters: [{ matchFrame: 1187, windowStart: 1187, windowEnd: 1187 }],
    negativeFrames: [1, 60, 800, 1500],
  },
  {
    videoName: "FRLG_SoftReset", templateId: 23, pokemonName: "Mewtu",
    encounters: [
      { matchFrame: 151, windowStart: 111, windowEnd: 308 },
      { matchFrame: 1599, windowStart: 1511, windowEnd: 2158 },
    ],
    negativeFrames: [1, 60, 500, 1000],
  },
  {
    videoName: "FRLG_SoftReset", templateId: 24, pokemonName: "Mewtu",
    encounters: [
      { matchFrame: 417, windowStart: 400, windowEnd: 550 },
      { matchFrame: 2266, windowStart: 2250, windowEnd: 2300 },
    ],
    negativeFrames: [1, 60, 800, 1500],
  },
  {
    videoName: "FRLG_SoftReset", templateId: 25, pokemonName: "Mewtu",
    encounters: [
      { matchFrame: 626, windowStart: 613, windowEnd: 767 },
      { matchFrame: 2330, windowStart: 2313, windowEnd: 2469 },
    ],
    negativeFrames: [1, 60, 900, 1500],
  },
  {
    videoName: "FRLG_Starter", templateId: 21, pokemonName: "Bisasam",
    encounters: [{ matchFrame: 3521, windowStart: 3508, windowEnd: 3643 }],
    negativeFrames: [1, 1000, 2000, 4000, 5000],
  },
  {
    videoName: "FRLG_Starter", templateId: 22, pokemonName: "Glumanda",
    encounters: [{ matchFrame: 5474, windowStart: 5468, windowEnd: 5576 }],
    negativeFrames: [1, 1000, 2000, 3000, 4000],
  },
  {
    videoName: "FRLG_Starter", templateId: 20, pokemonName: "Schiggy",
    encounters: [{ matchFrame: 1240, windowStart: 1199, windowEnd: 1319 }],
    negativeFrames: [1, 500, 2000, 3000, 5000],
  },
  {
    videoName: "SwSh_Breeding", templateId: 16, pokemonName: "Relicanth",
    encounters: [{ matchFrame: 1149, windowStart: 1149, windowEnd: 1149 }],
    negativeFrames: [1, 300, 600, 1500],
  },
  {
    videoName: "SwSh_Runaway", templateId: 15, pokemonName: "Picochilla",
    encounters: [
      { matchFrame: 229, windowStart: 229, windowEnd: 229 },
      { matchFrame: 1338, windowStart: 1338, windowEnd: 1338 },
    ],
    negativeFrames: [1, 100, 600, 1800],
  },
];

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

    const onSeeked = () => {
      cleanup();
      resolve();
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener("seeked", onSeeked);
      signal.removeEventListener("abort", onAbort);
    };

    video.addEventListener("seeked", onSeeked, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
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
  if (delta < 0.05) return "text-green-400";
  if (delta < 0.1) return "text-yellow-400";
  return "text-red-400";
}

/** Count total frames across all ground-truth entries. */
function countTotalFrames(groundTruth: TemplateGT[]): number {
  let total = 0;
  for (const gt of groundTruth) {
    total += gt.encounters.length + gt.negativeFrames.length;
  }
  return total;
}

/** Group ground-truth entries by video name. */
function groupByVideo(groundTruth: TemplateGT[]): Map<string, TemplateGT[]> {
  const byVideo = new Map<string, TemplateGT[]>();
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
  await waitForVideoReady(video, signal);
  return video;
}

/** Clean up a video element after use. */
function cleanupVideo(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute("src");
  video.load();
}

/** Load a template PNG and return its bitmap and grayscale data. */
async function loadTemplatePng(
  gt: TemplateGT,
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
  enc: EncounterGT,
  ctx: ScoreContext,
  signal: AbortSignal,
): Promise<{ bestCpu: number; bestGpu: number }> {
  let bestCpu = 0;
  let bestGpu = 0;

  for (const offset of [-5, -2, 0, 2, 5]) {
    if (signal.aborted) break;

    const timeSec = (enc.matchFrame + offset) / FPS;
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

/** Load test config and create the GPU detector. */
async function initTestEnvironment(
  setProgress: (msg: string) => void,
): Promise<{
  regionMap: Map<number, Array<{ x: number; y: number; w: number; h: number }>>;
  detector: WebGPUDetector;
}> {
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

  setProgress("Creating WebGPU detector...");
  const detector = await WebGPUDetector.create();
  return { regionMap, detector };
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
  gt: TemplateGT,
  ctx: ProcessFramesContext,
): Promise<void> {
  for (const enc of gt.encounters) {
    if (ctx.signal.aborted) break;

    ctx.setProgress(
      `${gt.pokemonName} (${gt.templateId}) -- Frame ${enc.matchFrame}`,
    );

    const scoreCtx: ScoreContext = {
      video: ctx.video, tmplGray: ctx.tmplData.gray,
      tmplW: ctx.tmplData.bitmap.width, tmplH: ctx.tmplData.bitmap.height,
      regions: ctx.regions, gpuDetector: ctx.gpuDetector,
      gpuTemplate: ctx.gpuTemplate,
    };
    const { bestCpu, bestGpu } = await scoreBestMatchFromOffsets(
      enc, scoreCtx, ctx.signal,
    );

    ctx.allResults.push(buildResult(gt, enc.matchFrame, "match", bestCpu, bestGpu));
    ctx.updateProgress(1);
    ctx.publishResults();
  }
}

/** Process all negative frames for a single template. */
async function processNegativeFrames(
  gt: TemplateGT,
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
  gt: TemplateGT,
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
    return <Check className="w-4 h-4 text-green-400" aria-label="Pass" />;
  }
  if (delta < 0.1) {
    return (
      <AlertTriangle
        className="w-4 h-4 text-yellow-400"
        aria-label="Warning"
      />
    );
  }
  return <XCircle className="w-4 h-4 text-red-400" aria-label="Fail" />;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Try to load a video, skipping its entries on failure. Returns null if skipped. */
async function tryLoadVideo(
  videoName: string,
  gtEntries: TemplateGT[],
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
  gt: TemplateGT,
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
  gtEntries: TemplateGT[],
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

/** Dev-only modal for GPU/CPU equivalence testing. */
export default function GpuEquivalenceTest({
  onClose,
}: Readonly<GpuEquivalenceTestProps>): JSX.Element {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<TestResult[]>([]);
  const [progress, setProgress] = useState<string>("");
  const [progressPct, setProgressPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [gpuAvailable] = useState(() => WebGPUDetector.isAvailable());

  const abortRef = useRef<AbortController | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Auto-focus close button on mount
  useEffect(() => {
    closeButtonRef.current?.focus();
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
      const { regionMap, detector } = await initTestEnvironment(setProgress);
      gpuDetector = detector;

      const totalFrames = countTotalFrames(GROUND_TRUTH);
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

      for (const [videoName, gtEntries] of groupByVideo(GROUND_TRUTH)) {
        if (signal.aborted) break;
        await processVideoGroup(videoName, gtEntries, regionMap, gpuDetector, ctx);
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

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

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

  return (
    <dialog
      open
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center m-0 p-0 border-none max-w-none max-h-none w-full h-full"
      aria-label="GPU Equivalence Test"
    >
      <div className="bg-bg-card rounded-xl border border-border-subtle shadow-xl max-w-4xl w-full max-h-[85vh] flex flex-col">
        {/* --- Header --- */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-primary">
            GPU / CPU Equivalence Test
          </h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg-hover text-text-secondary focus-visible:outline-2 focus-visible:outline-accent"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* --- Controls --- */}
        <div className="px-6 py-3 border-b border-border-subtle space-y-3">
          <div className="flex items-center gap-3">
            {running ? (
              <button
                onClick={handleCancel}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-accent"
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
            ) : (
              <button
                onClick={runTests}
                disabled={!gpuAvailable || running}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent"
              >
                <Play className="w-4 h-4" />
                Run Test
              </button>
            )}

            {running && (
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{progress}</span>
              </div>
            )}

            {!running && !gpuAvailable && (
              <span className="text-sm text-red-400">
                WebGPU is not available in this browser.
              </span>
            )}

            {!running && error && (
              <span className="text-sm text-red-400">{error}</span>
            )}

            {!running && !error && totalTests > 0 && (
              <span className="text-sm text-text-secondary">
                {progress}
              </span>
            )}
          </div>

          {/* Progress bar */}
          {running && (
            <div className="w-full h-2 rounded-full bg-bg-hover overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-200"
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
                <strong className="text-green-400">{passed}</strong>
              </span>
              <span>
                Warned:{" "}
                <strong className="text-yellow-400">{warned}</strong>
              </span>
              <span>
                Failed:{" "}
                <strong className="text-red-400">{failed}</strong>
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
        </div>

        {/* --- Results table --- */}
        <div className="flex-1 overflow-auto px-6 py-3">
          {totalTests === 0 && !running ? (
            <div className="flex items-center justify-center h-40 text-text-faint text-sm">
              Press &quot;Run Test&quot; to start the equivalence test.
              Fixture files must be served at /test-fixtures/.
            </div>
          ) : (
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
                        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          r.type === "match"
                            ? "bg-green-500/20 text-green-400"
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
          )}
        </div>
      </div>
    </dialog>
  );
}
