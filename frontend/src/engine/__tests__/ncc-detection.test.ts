/**
 * NCC detection quality tests: runs the CPUDetector matching algorithm against
 * real game captures to verify detection accuracy.
 *
 * Fully data-driven: template regions come from fixtures/test-config.json and
 * the expected encounters, negative frames and sweep cases come from
 * fixtures/ground-truth.json (generated alongside the fixture clips). The
 * tests verify that matching frames score significantly higher than
 * non-matching frames and that the loop-faithful scan simulator reproduces
 * the ground-truth encounter counts.
 *
 * Run with: npx vitest run --config vitest.ncc.config.ts
 */
import { afterAll, describe, it, expect } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  fitDimensions,
  adaptiveBlockSizeForRegion,
  scoreRegionHybrid,
  andLogicAcrossRegions,
} from "../math";
import { applyNoiseFloor } from "../matchStateMachine";
import { DEFAULT_COOLDOWN_SEC, DEFAULT_HYSTERESIS_FACTOR, MIN_POLL_MS, MAX_POLL_MS } from "../detectorDefaults";
import { simulateAdaptiveScan, type ScanSample } from "../scanSimulator";
import { analyzeStability, recommendPolling, type StabilitySample } from "../templateStability";
import { runParameterSweep } from "../parameterSweep";
import { regionSetDelta, type RegionGray } from "../regionDelta";

// --- Fixture data --------------------------------------------------------------

const FIXTURES = path.resolve(__dirname, "fixtures");
const CLIPS = path.resolve(__dirname, "fixtures");

/** One template region row from test-config.json. */
interface TestEntry {
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

/** One ground-truth encounter window (inclusive frame range, 60fps). */
interface EncounterGT {
  /** First frame where the encounter is detectable. */
  start: number;
  /** Last frame where the encounter is reliably detectable. */
  end: number;
  /** Optional true end of visibility when it extends beyond `end`. */
  maxEnd?: number;
}

/** Bounded scan range around a single encounter for the parameter sweep. */
interface SweepCaseGT {
  scanStart: number;
  scanEnd: number;
  /** Ground-truth encounter frame inside the scan range. */
  matchFrame: number;
}

/** Ground-truth record for one template, generated from manual video review. */
interface GroundTruthEntry {
  videoName: string;
  templateId: number;
  pokemonName: string;
  label: string;
  difficulty: string;
  /** False for deliberate hard cases a realistic poll interval cannot hit. */
  loopTestable: boolean;
  expectedEncounters: number;
  encounters: EncounterGT[];
  /** Frames that are clearly NOT encounters, used as negative samples. */
  negativeFrames: number[];
  sweepCase?: SweepCaseGT;
}

const CONFIG: TestEntry[] = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, "test-config.json"), "utf8"),
);
const GROUND_TRUTH: GroundTruthEntry[] = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, "ground-truth.json"), "utf8"),
);

/** All fixture videos are 60fps. */
const FPS = 60;

// --- Image loading via ffmpeg ------------------------------------------------

function loadPng(filePath: string): { pixels: Uint8ClampedArray; width: number; height: number } | null {
  if (!fs.existsSync(filePath)) return null;
  const info = execSync(
    `ffprobe -v quiet -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${filePath}"`,
    { encoding: "utf8" },
  ).trim();
  const [w, h] = info.split(",").map(Number);
  if (!w || !h) return null;
  const raw = execSync(
    `ffmpeg -y -i "${filePath}" -f rawvideo -pix_fmt rgba - 2>/dev/null`,
    { maxBuffer: 50 * 1024 * 1024 },
  );
  return { pixels: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength), width: w, height: h };
}

function extractFrame(videoPath: string, timeSec: number): { pixels: Uint8ClampedArray; width: number; height: number } | null {
  if (!fs.existsSync(videoPath)) return null;
  const info = execSync(
    `ffprobe -v quiet -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${videoPath}"`,
    { encoding: "utf8" },
  ).trim();
  const [w, h] = info.split(",").map(Number);
  if (!w || !h) return null;
  const raw = execSync(
    `ffmpeg -y -ss ${timeSec} -i "${videoPath}" -frames:v 1 -f rawvideo -pix_fmt rgba - 2>/dev/null`,
    { maxBuffer: 50 * 1024 * 1024 },
  );
  if (raw.byteLength !== w * h * 4) return null;
  return { pixels: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength), width: w, height: h };
}

function getVideoDuration(videoPath: string): number {
  const dur = execSync(
    `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${videoPath}"`,
    { encoding: "utf8" },
  ).trim();
  return parseFloat(dur) || 0;
}

// --- Grayscale helpers (matching CPUDetector logic) --------------------------

function toGrayscale(pixels: Uint8ClampedArray, w: number, h: number): Float32Array {
  const n = w * h;
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    gray[i] = 0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2];
  }
  return gray;
}

/**
 * Downsamples a grayscale frame to 64x64 (nearest neighbor) for the
 * simulator's frame-delta computation, mirroring the runtime detector's
 * cheap global frame delta.
 */
function downsampleGray(gray: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(64 * 64);
  for (let y = 0; y < 64; y++) {
    const sy = Math.min(h - 1, Math.floor((y * h) / 64));
    for (let x = 0; x < 64; x++) {
      const sx = Math.min(w - 1, Math.floor((x * w) / 64));
      out[y * 64 + x] = gray[sy * w + sx];
    }
  }
  return out;
}

function matchRegion(
  frameGray: Float32Array, frameW: number, frameH: number,
  tmplGray: Float32Array, tmplW: number, tmplH: number,
  region: { x: number; y: number; w: number; h: number },
): number {
  const scaleX = frameW / tmplW;
  const scaleY = frameH / tmplH;
  const baseX = Math.round(region.x * scaleX);
  const baseY = Math.round(region.y * scaleY);
  const frw = Math.max(4, Math.round(region.w * scaleX));
  const frh = Math.max(4, Math.round(region.h * scaleY));

  // Target size: use template region dimensions (high res)
  const [dw, dh] = fitDimensions(region.w, region.h, 512);
  const bs = adaptiveBlockSizeForRegion(dw, dh);

  // Pre-crop template once (shared across all offsets)
  const tmplCrop = new Float32Array(dw * dh);
  const tsx = region.w / dw, tsy = region.h / dh;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const ti = Math.min(Math.floor(y * tsy) + region.y, tmplH - 1) * tmplW + Math.min(Math.floor(x * tsx) + region.x, tmplW - 1);
      tmplCrop[y * dw + x] = tmplGray[ti];
    }
  }

  // Sliding window: try small offsets around the region center, keep best score
  let bestScore = 0;
  const step = 4;
  const maxOffset = 4;

  for (let dy = -maxOffset; dy <= maxOffset; dy += step) {
    for (let dx = -maxOffset; dx <= maxOffset; dx += step) {
      const frx = Math.max(0, Math.min(baseX + dx, frameW - frw));
      const fry = Math.max(0, Math.min(baseY + dy, frameH - frh));

      const frameCrop = new Float32Array(dw * dh);
      const fsx = frw / dw, fsy = frh / dh;
      for (let y = 0; y < dh; y++) {
        for (let x = 0; x < dw; x++) {
          const fi = Math.min(Math.floor(y * fsy) + fry, frameH - 1) * frameW + Math.min(Math.floor(x * fsx) + frx, frameW - 1);
          frameCrop[y * dw + x] = frameGray[fi];
        }
      }

      const hybrid = scoreRegionHybrid(frameCrop, tmplCrop, dw, dh, bs);
      if (hybrid > bestScore) bestScore = hybrid;
    }
  }

  return bestScore;
}

/** Score a frame against all regions of a template (AND-logic: minimum). */
function scoreFrame(
  frameGray: Float32Array, frameW: number, frameH: number,
  tmplGray: Float32Array, tmplW: number, tmplH: number,
  regions: Array<{ x: number; y: number; w: number; h: number }>,
): number {
  const scores = regions.map((region) =>
    matchRegion(frameGray, frameW, frameH, tmplGray, tmplW, tmplH, region),
  );
  return andLogicAcrossRegions(scores);
}

// --- Group config entries by video -------------------------------------------

interface VideoTest {
  videoName: string;
  videoPath: string;
  templates: Array<{
    pokemonName: string;
    templateId: number;
    templatePath: string;
    regions: Array<{ x: number; y: number; w: number; h: number }>;
  }>;
}

function buildVideoTests(): VideoTest[] {
  const grouped = new Map<string, VideoTest>();

  for (const entry of CONFIG) {
    if (entry.region_type !== "image") continue;

    const videoPath = path.join(CLIPS, `${entry.video_name}.mp4`);
    const templatePath = path.join(FIXTURES, `${entry.video_name}_${entry.pokemon_name}_${entry.template_id}.png`);

    const vt: VideoTest = grouped.get(entry.video_name) ?? {
      videoName: entry.video_name,
      videoPath,
      templates: [],
    };

    const existing = vt.templates.find((t) => t.templateId === entry.template_id);
    if (existing) {
      existing.regions.push({ x: entry.rect_x, y: entry.rect_y, w: entry.rect_w, h: entry.rect_h });
    } else {
      vt.templates.push({
        pokemonName: entry.pokemon_name,
        templateId: entry.template_id,
        templatePath,
        regions: [{ x: entry.rect_x, y: entry.rect_y, w: entry.rect_w, h: entry.rect_h }],
      });
    }

    grouped.set(entry.video_name, vt);
  }

  return Array.from(grouped.values());
}

// --- Optional results export (consumed by the website testing page) ----------
//
// When NCC_RESULTS_PATH is set (the CI workflow points it at
// site/public/testing-results.json), the suite writes its per-scenario
// results after the run so the public testing page renders real, current
// numbers. Values are recorded before the assertions, so failed scenarios
// export with pass=false instead of vanishing.

/** Video display metadata for the website. */
const VIDEO_META: Record<string, { game: string; style: "2D" | "3D" }> = {
  FRLG_SoftReset: { game: "Fire Red/Leaf Green", style: "2D" },
  FRLG_Fishing: { game: "Fire Red/Leaf Green", style: "2D" },
  FRLG_Runaway: { game: "Fire Red/Leaf Green", style: "2D" },
  FRLG_Starter: { game: "Fire Red/Leaf Green", style: "2D" },
  Dual_SoftReset: { game: "Gen 4/5 (DS)", style: "2D" },
  SwSh_Breeding: { game: "Sword/Shield", style: "3D" },
  SwSh_Runaway: { game: "Sword/Shield", style: "3D" },
  SV_Breeding: { game: "Scarlet/Violet", style: "3D" },
};

interface ScenarioResult {
  templateId: number;
  pokemonName: string;
  label: string;
  videoName: string;
  game: string;
  style: string;
  difficulty: string;
  loopTestable: boolean;
  expectedEncounters: number;
  quality?: { matchMin: number; negMax: number; gap: number };
  scan?: {
    simulated: number;
    polled: number;
    precision: number;
    minPollMs: number;
    maxPollMs: number;
    matchFrames: number;
    sampledFrames: number;
    maxScore: number;
    spans: Array<{ startFrame: number; endFrame: number; peakScore: number }>;
    pass: boolean;
  };
}

const RESULTS = new Map<number, ScenarioResult>();

/** Returns (and lazily creates) the export record for a ground-truth entry. */
function resultFor(gt: GroundTruthEntry): ScenarioResult {
  let r = RESULTS.get(gt.templateId);
  if (!r) {
    const meta = VIDEO_META[gt.videoName] ?? { game: gt.videoName, style: "2D" };
    r = {
      templateId: gt.templateId,
      pokemonName: gt.pokemonName,
      label: gt.label,
      videoName: gt.videoName,
      game: meta.game,
      style: meta.style,
      difficulty: gt.difficulty,
      loopTestable: gt.loopTestable,
      expectedEncounters: gt.expectedEncounters,
    };
    RESULTS.set(gt.templateId, r);
  }
  return r;
}

afterAll(() => {
  const out = process.env.NCC_RESULTS_PATH;
  if (!out) return;
  const report = {
    generatedAt: new Date().toISOString(),
    version: process.env.NCC_APP_VERSION ?? "dev",
    commit: process.env.GITHUB_SHA ?? null,
    scenarios: [...RESULTS.values()].sort((a, b) => a.templateId - b.templateId),
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.log(`  results written to ${out}`);
});

const videoTests = buildVideoTests();

/** Look up the config-side video/template pair for a ground-truth entry. */
function findConfig(gt: GroundTruthEntry): { vt?: VideoTest; tmpl?: VideoTest["templates"][number] } {
  const vt = videoTests.find((v) => v.videoName === gt.videoName);
  const tmpl = vt?.templates.find((t) => t.templateId === gt.templateId);
  return { vt, tmpl };
}

/** Center frame of an encounter window. */
function windowCenter(enc: EncounterGT): number {
  return Math.round((enc.start + enc.end) / 2);
}

// --- Detection quality: window centers vs negative frames --------------------

describe("NCC Detection Quality", () => {
  for (const gt of GROUND_TRUTH) {
    const { vt, tmpl } = findConfig(gt);

    it(`${gt.pokemonName} (template ${gt.templateId}): ${gt.encounters.length} encounter(s) in ${gt.videoName}`, { timeout: 120_000 }, () => {
      if (!vt || !tmpl) {
        console.log(`  SKIP: config not found for ${gt.videoName} template ${gt.templateId}`);
        return;
      }
      const videoPath = vt.videoPath;
      if (!fs.existsSync(videoPath)) {
        console.log(`  SKIP: video not found: ${videoPath}`);
        return;
      }

      const tmplImg = loadPng(tmpl.templatePath);
      if (!tmplImg) {
        console.log(`  SKIP: template not found: ${tmpl.templatePath}`);
        return;
      }
      const tmplGray = toGrayscale(tmplImg.pixels, tmplImg.width, tmplImg.height);

      // Score positive frames: try the window center and small offsets around
      // it, take the best score. This accounts for ffmpeg seek imprecision.
      const matchScores: Array<{ encounter: number; frame: number; time: number; score: number }> = [];
      for (let ei = 0; ei < gt.encounters.length; ei++) {
        const center = windowCenter(gt.encounters[ei]);
        let bestScore = 0;
        let bestFrame = center;
        let bestTime = center / FPS;

        for (const offset of [-5, -2, 0, 2, 5]) {
          const f = center + offset;
          const t = f / FPS;
          const frame = extractFrame(videoPath, t);
          if (!frame) continue;
          const frameGray = toGrayscale(frame.pixels, frame.width, frame.height);
          const score = scoreFrame(frameGray, frame.width, frame.height, tmplGray, tmplImg.width, tmplImg.height, tmpl.regions);
          if (score > bestScore) {
            bestScore = score;
            bestFrame = f;
            bestTime = t;
          }
        }

        matchScores.push({ encounter: ei + 1, frame: bestFrame, time: bestTime, score: bestScore });
      }

      // Score negative frames (known non-encounter frames)
      const negScores: Array<{ frame: number; time: number; score: number }> = [];
      for (const negFrame of gt.negativeFrames) {
        const timeSec = negFrame / FPS;
        const frame = extractFrame(videoPath, timeSec);
        if (!frame) continue;
        const frameGray = toGrayscale(frame.pixels, frame.width, frame.height);
        const score = scoreFrame(frameGray, frame.width, frame.height, tmplGray, tmplImg.width, tmplImg.height, tmpl.regions);
        negScores.push({ frame: negFrame, time: timeSec, score });
      }

      // Log results
      const matchMin = matchScores.length > 0 ? Math.min(...matchScores.map((s) => s.score)) : 0;
      const negMax = negScores.length > 0 ? Math.max(...negScores.map((s) => s.score)) : 0;

      console.log(
        `  ${gt.pokemonName} (${gt.templateId}): ` +
        `match=[${matchScores.map((s) => s.score.toFixed(3)).join(", ")}] ` +
        `neg=[${negScores.map((s) => s.score.toFixed(3)).join(", ")}] ` +
        `gap=${(matchMin - negMax).toFixed(3)}`,
      );
      resultFor(gt).quality = { matchMin, negMax, gap: matchMin - negMax };

      // Score distribution analysis
      if (matchScores.length > 0) {
        const scores = matchScores.map((s) => s.score);
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
        const stddev = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length);
        const negScoreVals = negScores.map((s) => s.score);
        const negMean = negScoreVals.length > 0 ? negScoreVals.reduce((a, b) => a + b, 0) / negScoreVals.length : 0;
        const gap = matchMin - negMax;
        const quality = gap > 0.3 ? "EXCELLENT" : gap > 0.15 ? "GOOD" : gap > 0 ? "MARGINAL" : "OVERLAP";
        console.log(
          `  Distribution: match(mean=${mean.toFixed(3)} std=${stddev.toFixed(3)}) ` +
          `neg(mean=${negMean.toFixed(3)} max=${negMax.toFixed(3)}) ` +
          `gap=${gap.toFixed(3)} [${quality}]`,
        );
      }

      // Every encounter best-score must beat every negative-frame score
      for (const ms of matchScores) {
        expect(ms.score, `encounter ${ms.encounter} at frame ${ms.frame}`).toBeGreaterThan(negMax);
      }

      // There must be a clear gap between the best negative and worst match
      if (matchScores.length > 0 && negScores.length > 0) {
        expect(matchMin - negMax, "match/non-match gap").toBeGreaterThan(0);
      }
    });
  }
});

// --- Adaptive cooldown: wide detection windows --------------------------------

/** A window longer than 2 seconds counts as wide (frames at 60fps). */
const WIDE_WINDOW_MIN_FRAMES = 120;

describe("Adaptive Cooldown", () => {
  for (const gt of GROUND_TRUTH) {
    const wideWindows = gt.encounters.filter((e) => e.end - e.start > WIDE_WINDOW_MIN_FRAMES);
    if (wideWindows.length === 0) continue;
    const { vt, tmpl } = findConfig(gt);

    it(`${gt.pokemonName} (${gt.templateId}): detection window counts as single encounter`, { timeout: 120_000 }, () => {
      if (!vt || !tmpl) return;
      const videoPath = vt.videoPath;
      if (!fs.existsSync(videoPath)) return;

      const tmplImg = loadPng(tmpl.templatePath);
      if (!tmplImg) {
        console.log(`  SKIP: template not found: ${tmpl.templatePath}`);
        return;
      }
      const tmplGray = toGrayscale(tmplImg.pixels, tmplImg.width, tmplImg.height);

      for (let wi = 0; wi < wideWindows.length; wi++) {
        const win = wideWindows[wi];
        const windowDurationSec = (win.end - win.start) / FPS;

        // Sample the window core at 25%/50%/75%, avoiding edge frames which
        // may be transitional and not fully detectable
        const span = win.end - win.start;
        const sampleFrames = [0.25, 0.5, 0.75].map((f) => Math.round(win.start + f * span));
        const windowScores: number[] = [];

        for (const f of sampleFrames) {
          const frame = extractFrame(videoPath, f / FPS);
          if (!frame) continue;
          const frameGray = toGrayscale(frame.pixels, frame.width, frame.height);
          const score = scoreFrame(frameGray, frame.width, frame.height, tmplGray, tmplImg.width, tmplImg.height, tmpl.regions);
          windowScores.push(score);
        }

        const minInWindow = Math.min(...windowScores);
        console.log(
          `  Window ${wi + 1}: frames ${win.start}-${win.end} (${windowDurationSec.toFixed(1)}s) ` +
          `core=[${sampleFrames.join(",")}] ` +
          `scores=[${windowScores.map((s) => s.toFixed(3)).join(", ")}] min=${minInWindow.toFixed(3)}`,
        );

        // Most core window frames must score above a baseline. One outlier
        // is tolerated: some games fade the screen mid-encounter (e.g. the
        // FRLG "Wow!" window), which legitimately drops the score while the
        // text stays visible; the detection loop bridges such fades via
        // hysteresis and cooldown.
        const aboveBaseline = windowScores.filter((s) => s > 0.3).length;
        expect(
          aboveBaseline,
          `window ${wi + 1}: core frames above baseline (scores ${windowScores.map((s) => s.toFixed(3)).join(", ")})`,
        ).toBeGreaterThanOrEqual(windowScores.length - 1);
        expect(aboveBaseline, `window ${wi + 1} has detectable core frames`).toBeGreaterThan(0);
      }
    });
  }
});

// --- Full video scan: simulate live detection --------------------------------

/** Raw-score threshold for the logged matchFrames statistic (no assertion). */
const SCAN_THRESHOLD = 0.55;

/**
 * Mirrors the user calibration flow for one template ("Apply Recommended"
 * after a batch test): sample every 5th frame around its first ground-truth
 * encounter window, run the stability analysis and return the complete
 * recommended settings: precision, hysteresis and polling bounds. The
 * recommendation is a package; simulating recommended poll bounds against a
 * different threshold mixes calibrations and misses narrow peaks. Scoring
 * cost and core count are fixed to representative app values (GPU scoring,
 * mid-range CPU) so the result is deterministic across test runners.
 * Returns null when the analysis yields no recommendation.
 */
function calibratedSettings(
  videoPath: string,
  gt: GroundTruthEntry,
  tmplGray: Float32Array,
  tmplW: number,
  tmplH: number,
  regions: Array<{ x: number; y: number; w: number; h: number }>,
): { precision: number; hysteresisFactor: number; minPollMs: number; maxPollMs: number } | null {
  const enc = gt.encounters[0];
  const start = Math.max(0, enc.start - 300);
  const end = (enc.maxEnd ?? enc.end) + 300;
  const samples: StabilitySample[] = [];
  for (let f = start; f <= end; f += 5) {
    const frame = extractFrame(videoPath, f / FPS);
    if (!frame) continue;
    const frameGray = toGrayscale(frame.pixels, frame.width, frame.height);
    const score = scoreFrame(frameGray, frame.width, frame.height, tmplGray, tmplW, tmplH, regions);
    samples.push({ frameIndex: f, overallScore: score });
  }
  const stats = analyzeStability(samples);
  if (!stats) return null;
  const rec = recommendPolling(stats, 5, 8);
  return {
    precision: stats.recommendedPrecision,
    hysteresisFactor: stats.recommendedHysteresis,
    minPollMs: rec?.minPollMs ?? MIN_POLL_MS,
    maxPollMs: rec?.maxPollMs ?? MAX_POLL_MS,
  };
}

describe("Full Video Scan", () => {
  for (const gt of GROUND_TRUTH) {
    const { vt, tmpl } = findConfig(gt);

    it(`${gt.videoName}/${gt.pokemonName} (${gt.templateId}): finds ${gt.expectedEncounters} encounter(s)`, { timeout: 300_000 }, () => {
      if (!vt || !tmpl) {
        console.log(`  SKIP: config not found for ${gt.videoName} template ${gt.templateId}`);
        return;
      }
      const videoPath = vt.videoPath;
      if (!fs.existsSync(videoPath)) {
        console.log(`  SKIP: video not found: ${videoPath}`);
        return;
      }

      const tmplImg = loadPng(tmpl.templatePath);
      if (!tmplImg) {
        console.log(`  SKIP: template not found: ${tmpl.templatePath}`);
        return;
      }
      const tmplGray = toGrayscale(tmplImg.pixels, tmplImg.width, tmplImg.height);
      const duration = getVideoDuration(videoPath);

      // Dense 0.1s sampling grid: the raw data basis. Which of these
      // samples the "app" would actually score is decided afterwards by
      // the loop-faithful simulator, not by the grid itself.
      const scanInterval = 0.1;
      const scores: ScanSample[] = [];

      for (let t = 0; t < duration; t += scanInterval) {
        const frame = extractFrame(videoPath, t);
        if (!frame) continue;
        const frameGray = toGrayscale(frame.pixels, frame.width, frame.height);
        const score = scoreFrame(
          frameGray, frame.width, frame.height,
          tmplGray, tmplImg.width, tmplImg.height,
          tmpl.regions,
        );
        scores.push({
          time: t,
          score,
          frameGray: downsampleGray(frameGray, frame.width, frame.height),
        });
      }

      const matchFrames = scores.filter((s) => s.score >= SCAN_THRESHOLD);
      const maxScore = scores.length > 0 ? Math.max(...scores.map((s) => s.score)) : 0;

      // Loop-faithful counting: replay the dense grid through the runtime
      // state machine using the app's real adaptive polling
      // (simulateAdaptiveScan): static scenes slow polling to maxPollMs,
      // cooldown ticks without scoring.
      // Settings come from the user calibration flow ("Apply Recommended"):
      // recommended precision, hysteresis and polling bounds as a package.
      // With engine defaults the loop can miss the ultra-short encounter
      // windows of these fixtures entirely.
      const calibrated = calibratedSettings(videoPath, gt, tmplGray, tmplImg.width, tmplImg.height, tmpl.regions);

      const simSettings = calibrated
        ? { ...calibrated, consecutiveHits: 1, cooldownSec: DEFAULT_COOLDOWN_SEC }
        : {
            precision: applyNoiseFloor(SCAN_THRESHOLD),
            hysteresisFactor: DEFAULT_HYSTERESIS_FACTOR,
            consecutiveHits: 1,
            cooldownSec: DEFAULT_COOLDOWN_SEC,
            minPollMs: MIN_POLL_MS,
            maxPollMs: MAX_POLL_MS,
          };
      const sim = simulateAdaptiveScan(scores, simSettings);

      console.log(
        `  ${gt.pokemonName} (${gt.templateId}): ` +
        `simulated=${sim.encounters}/${gt.expectedEncounters} ` +
        `polled=${sim.polledSamples} ` +
        `precision=${simSettings.precision.toFixed(3)} ` +
        `poll=${simSettings.minPollMs}-${simSettings.maxPollMs}ms ` +
        `matchFrames=${matchFrames.length}/${scores.length} ` +
        `max=${maxScore.toFixed(3)}`,
      );

      // Per-encounter triage log: which frames each simulated encounter
      // covered and which ground-truth window (if any) it belongs to, so a
      // miscount points directly at the window or template to fix.
      for (const [i, span] of sim.encounterSpans.entries()) {
        const startF = Math.round((span.startMs / 1000) * FPS);
        const endF = Math.round((span.endMs / 1000) * FPS);
        const windowIdx = gt.encounters.findIndex(
          (w) => startF <= (w.maxEnd ?? w.end) + 30 && endF >= w.start - 30,
        );
        const verdict = windowIdx >= 0 ? `window ${windowIdx + 1}` : "PHANTOM";
        console.log(
          `    sim encounter ${i + 1}: ${startF}f-${endF}f peak=${span.peakScore.toFixed(3)} -> ${verdict}`,
        );
      }

      resultFor(gt).scan = {
        simulated: sim.encounters,
        polled: sim.polledSamples,
        precision: simSettings.precision,
        minPollMs: simSettings.minPollMs ?? MIN_POLL_MS,
        maxPollMs: simSettings.maxPollMs ?? MAX_POLL_MS,
        matchFrames: matchFrames.length,
        sampledFrames: scores.length,
        maxScore,
        spans: sim.encounterSpans.map((span) => ({
          startFrame: Math.round((span.startMs / 1000) * FPS),
          endFrame: Math.round((span.endMs / 1000) * FPS),
          peakScore: span.peakScore,
        })),
        pass: gt.loopTestable
          ? sim.encounters === gt.expectedEncounters
          : sim.encounters <= gt.expectedEncounters,
      };

      if (gt.loopTestable) {
        // The simulated loop is the authoritative counter and must match
        // the ground truth exactly: with loop-faithful sampling there is
        // no over-sampling excuse left for off-by-one counts.
        expect(sim.encounters, "simulated encounter count").toBe(gt.expectedEncounters);
      } else {
        // "unrealistic" templates are deliberate hard cases: a realistic
        // poll interval cannot hit their one-peak score windows reliably,
        // so only guard against phantom double counts here; frame-exact
        // coverage lives in the Detection Quality tests.
        expect(sim.encounters, "no phantom encounters").toBeLessThanOrEqual(gt.expectedEncounters);
      }
    });
  }
});

// --- Parameter sweep on real captures ----------------------------------------

describe("Parameter Sweep on Real Captures", () => {
  for (const gt of GROUND_TRUTH) {
    const sc = gt.sweepCase;
    if (!sc) continue;
    const { vt, tmpl } = findConfig(gt);

    it(`${gt.pokemonName} (${gt.templateId}): sweep finds clean settings`, { timeout: 120_000 }, () => {
      if (!vt || !tmpl) return;
      if (!fs.existsSync(vt.videoPath)) return;

      const tmplImg = loadPng(tmpl.templatePath);
      if (!tmplImg) {
        console.log(`  SKIP: template not found: ${tmpl.templatePath}`);
        return;
      }
      const tmplGray = toGrayscale(tmplImg.pixels, tmplImg.width, tmplImg.height);

      // Sample every 5th frame like useTemplateTest.runBatch does, measuring
      // the real per-frame scoring cost that drives the polling bounds.
      const samples: StabilitySample[] = [];
      let scoreCostMs = 0;
      for (let f = sc.scanStart; f <= sc.scanEnd; f += 5) {
        const frame = extractFrame(vt.videoPath, f / FPS);
        if (!frame) continue;
        const frameGray = toGrayscale(frame.pixels, frame.width, frame.height);
        const t0 = performance.now();
        const score = scoreFrame(frameGray, frame.width, frame.height, tmplGray, tmplImg.width, tmplImg.height, tmpl.regions);
        scoreCostMs += performance.now() - t0;
        samples.push({ frameIndex: f, overallScore: score });
      }
      const avgScoreMs = scoreCostMs / Math.max(1, samples.length);

      const stats = analyzeStability(samples);
      expect(stats).not.toBeNull();

      const sweep = runParameterSweep({ samples, stats: stats!, avgScoreMs, cooldownSec: DEFAULT_COOLDOWN_SEC });
      expect(sweep).not.toBeNull();

      console.log(
        `  ${gt.pokemonName} (${gt.templateId}): rating=${stats!.rating} ` +
        `precision=${sweep!.precision.toFixed(3)} hysteresis=${sweep!.hysteresisFactor.toFixed(2)} ` +
        `hits=${sweep!.consecutiveHits} poll=${sweep!.pollIntervalMs}ms ` +
        `clean=${sweep!.cleanPhases}/${sweep!.totalPhases} margin=${sweep!.robustnessMargin.toFixed(3)}`,
      );

      // The swept settings must confirm the encounter exactly once in every
      // simulated polling phase (no misses, no double counts).
      expect(sweep!.perfect, "all polling phases clean").toBe(true);

      // Ground truth: the analytic match window must contain the encounter
      expect(sc.matchFrame).toBeGreaterThanOrEqual(stats!.matchStartFrame);
      expect(sc.matchFrame).toBeLessThanOrEqual(stats!.matchEndFrame);
    });
  }
});

// --- Region hysteresis delta on real 3D captures ------------------------------

/**
 * Mirrors DetectionLoop.REGION_EXIT_DELTA: normalized mean-abs-diff above
 * which region content counts as changed for the region-based hysteresis exit.
 */
const REGION_EXIT_DELTA = 0.12;

/** Crop a template-space region from a frame into a [0, 1] grayscale RegionGray. */
function cropRegionGray(
  frameGray: Float32Array, frameW: number, frameH: number,
  tmplW: number, tmplH: number,
  region: { x: number; y: number; w: number; h: number },
): RegionGray {
  const scaleX = frameW / tmplW;
  const scaleY = frameH / tmplH;
  const x = Math.round(region.x * scaleX);
  const y = Math.round(region.y * scaleY);
  const w = Math.max(1, Math.round(region.w * scaleX));
  const h = Math.max(1, Math.round(region.h * scaleY));
  const data = new Float32Array(w * h);
  for (let ry = 0; ry < h; ry++) {
    for (let rx = 0; rx < w; rx++) {
      const fi = Math.min(y + ry, frameH - 1) * frameW + Math.min(x + rx, frameW - 1);
      // toGrayscale keeps 0-255 luma; region grays are normalized to [0, 1]
      data[ry * w + rx] = frameGray[fi] / 255;
    }
  }
  return { data, width: w, height: h };
}

describe("Region Hysteresis Delta (3D)", () => {
  // 3D capture: the whole frame moves constantly, only the encounter text box
  // region is stable. Derived from the SwSh_Runaway ground-truth entry.
  const gt = GROUND_TRUTH.find((g) => g.videoName === "SwSh_Runaway");
  const { vt, tmpl } = gt ? findConfig(gt) : { vt: undefined, tmpl: undefined };

  it("region delta separates stable match from scene change", { timeout: 120_000 }, () => {
    if (!gt || !vt || !tmpl) return;
    if (!fs.existsSync(vt.videoPath)) return;

    const tmplImg = loadPng(tmpl.templatePath);
    if (!tmplImg) {
      console.log(`  SKIP: template not found: ${tmpl.templatePath}`);
      return;
    }

    // In-encounter frame: center of the first ground-truth window.
    // Scene-change frame: the first negative frame after that window.
    const enc = gt.encounters[0];
    const matchFrame = windowCenter(enc);
    const changedFrame = gt.negativeFrames.find((f) => f > (enc.maxEnd ?? enc.end));
    expect(changedFrame, "negative frame after first encounter").toBeDefined();

    const grabRegions = (frameNo: number): RegionGray[] | null => {
      const frame = extractFrame(vt.videoPath, frameNo / FPS);
      if (!frame) return null;
      const frameGray = toGrayscale(frame.pixels, frame.width, frame.height);
      return tmpl.regions.map((r) =>
        cropRegionGray(frameGray, frame.width, frame.height, tmplImg.width, tmplImg.height, r),
      );
    };

    const atMatch = grabRegions(matchFrame);
    const shortlyAfter = grabRegions(matchFrame + 3);
    const sceneChanged = grabRegions(changedFrame!);
    expect(atMatch).not.toBeNull();
    expect(shortlyAfter).not.toBeNull();
    expect(sceneChanged).not.toBeNull();

    const stableDelta = regionSetDelta(atMatch!, shortlyAfter!);
    const changedDelta = regionSetDelta(atMatch!, sceneChanged!);

    console.log(
      `  ${gt.pokemonName}: stableDelta=${stableDelta.toFixed(4)} ` +
      `changedDelta=${changedDelta.toFixed(4)} threshold=${REGION_EXIT_DELTA}`,
    );

    // While the encounter text box is on screen, the region content barely
    // changes even though the 3D scene around it keeps moving: the region
    // hysteresis must NOT re-arm.
    expect(stableDelta, "in-encounter region delta").toBeLessThan(REGION_EXIT_DELTA);

    // Once the encounter is gone, the region shows the moving 3D scene and
    // the delta must clearly exceed the exit threshold so hysteresis re-arms.
    expect(changedDelta, "post-encounter region delta").toBeGreaterThan(REGION_EXIT_DELTA);
  });
});
