/**
 * scan.ts -- Scoring runs of the GPU/CPU equivalence test.
 *
 * Drives the three run modes: the per-frame CPU/GPU comparison, the full
 * video scan replayed through the adaptive polling simulator, and the
 * stability plus parameter sweep cases.
 */
import { WebGPUDetector } from "../../../engine/WebGPUDetector";
import { simulateAdaptiveScan, type ScanSample } from "../../../engine/scanSimulator";
import {
  analyzeStability,
  recommendPolling,
  type StabilitySample,
} from "../../../engine/templateStability";
import { runParameterSweep } from "../../../engine/parameterSweep";
import { cpuScoreFrame, downsampleGray, toGrayscale } from "./cpuScoring";
import {
  buildRegionMap,
  defaultScanSettings,
  encounterMatchFrame,
  FPS,
  SCAN_INTERVAL,
  SCAN_THRESHOLD,
  type FullScanResult,
  type GroundTruthEntry,
  type MatchSettings,
  type ScanBackend,
  type SettingsVariant,
  type SweepCase,
  type SweepUiResult,
  type TestConfigEntry,
  type TestResult,
} from "./fixtures";
import {
  captureDeltaGray,
  captureFrame,
  cleanupVideo,
  loadTemplatePng,
  loadVideoElement,
  seekVideo,
  tryLoadVideo,
} from "./video";

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
  const frameGray = toGrayscale(captured.pixels, captured.width, captured.height);
  const cpuScore = cpuScoreFrame(
    frameGray,
    captured.width,
    captured.height,
    ctx.tmplGray,
    ctx.tmplW,
    ctx.tmplH,
    ctx.regions,
  );
  const gpuResult = await ctx.gpuDetector.detect(ctx.video, [ctx.gpuTemplate], { precision: 0 });
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
export async function initTestEnvironment(
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
async function processMatchFrames(gt: GroundTruthEntry, ctx: ProcessFramesContext): Promise<void> {
  for (const enc of gt.encounters) {
    if (ctx.signal.aborted) break;

    // The fixture stores encounter windows; test the window center frame.
    const matchFrame = encounterMatchFrame(enc);
    ctx.setProgress(`${gt.pokemonName} (${gt.templateId}) -- Frame ${matchFrame}`);

    const scoreCtx: ScoreContext = {
      video: ctx.video,
      tmplGray: ctx.tmplData.gray,
      tmplW: ctx.tmplData.bitmap.width,
      tmplH: ctx.tmplData.bitmap.height,
      regions: ctx.regions,
      gpuDetector: ctx.gpuDetector,
      gpuTemplate: ctx.gpuTemplate,
    };
    const { bestCpu, bestGpu } = await scoreBestMatchFromOffsets(matchFrame, scoreCtx, ctx.signal);

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

    ctx.setProgress(`${gt.pokemonName} (${gt.templateId}) -- Neg frame ${negFrame}`);

    const timeSec = negFrame / FPS;
    try {
      await seekVideo(ctx.video, timeSec, ctx.signal);
    } catch {
      ctx.updateProgress(1);
      continue;
    }

    const scoreCtx: ScoreContext = {
      video: ctx.video,
      tmplGray: ctx.tmplData.gray,
      tmplW: ctx.tmplData.bitmap.width,
      tmplH: ctx.tmplData.bitmap.height,
      regions: ctx.regions,
      gpuDetector: ctx.gpuDetector,
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
  const gpuTemplate = await gpuDetector.loadTemplate(tmplData.bitmap, gpuRegions);
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
export async function processVideoGroup(
  videoName: string,
  gtEntries: GroundTruthEntry[],
  regionMap: Map<number, Array<{ x: number; y: number; w: number; h: number }>>,
  gpuDetector: WebGPUDetector,
  ctx: Omit<ProcessFramesContext, "video" | "tmplData" | "regions" | "gpuDetector" | "gpuTemplate">,
): Promise<void> {
  const video = await tryLoadVideo(
    videoName,
    gtEntries,
    ctx.signal,
    ctx.setProgress,
    ctx.updateProgress,
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

/** Per-run bookkeeping shared by the full-scan helpers. */
export interface FullScanRunContext {
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
      frameGray,
      captured.width,
      captured.height,
      tmplGray,
      tmplW,
      tmplH,
      regions,
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
export interface ScanOptions {
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
export async function fullScanVideoGroup(
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

      const result = await fullScanTemplate(gt, regions, video, gpuDetector, opts, ctx);
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
export async function runSweepCases(
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
    (g): g is GroundTruthEntry & { sweepCase: SweepCase } => g.sweepCase !== undefined,
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
          built.scorer,
          sc.scanStart,
          sc.scanEnd,
          signal,
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
