/**
 * NCC detection quality tests — runs the CPUDetector matching algorithm against
 * real game captures to verify detection accuracy.
 *
 * For each video, templates are loaded from the fixtures directory and matched
 * against frames extracted from the corresponding test video. The test verifies
 * that matching frames score significantly higher than non-matching frames.
 *
 * Run with: npx vitest run src/engine/__tests__/ncc-detection.node-test.ts
 */
import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  fitDimensions,
  adaptiveBlockSizeForRegion,
  scoreRegionHybrid,
  andLogicAcrossRegions,
} from "../math";
import {
  applyNoiseFloor,
} from "../matchStateMachine";
import { DEFAULT_COOLDOWN_SEC, DEFAULT_HYSTERESIS_FACTOR, MIN_POLL_MS, MAX_POLL_MS } from "../detectorDefaults";
import { simulateAdaptiveScan, type ScanSample } from "../scanSimulator";
import { analyzeStability, recommendPolling, type StabilitySample } from "../templateStability";
import { runParameterSweep, simulateCombo, buildTimeline } from "../parameterSweep";
import { regionSetDelta, type RegionGray } from "../regionDelta";

// --- Paths -------------------------------------------------------------------

const FIXTURES = path.resolve(__dirname, "fixtures");
const CLIPS = path.resolve(__dirname, "fixtures");
const CONFIG: TestEntry[] = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, "test-config.json"), "utf8"),
);

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

// --- Ground-truth encounter data (all videos 60fps) -------------------------

const FPS = 60;

/**
 * Ground-truth data for each template: the exact match frame and the detection
 * window (frame range where the encounter is visible). Derived from manual
 * review of the test videos.
 */
interface EncounterGT {
  /** Best/peak match frame number. */
  matchFrame: number;
  /** First frame where the encounter is detectable. */
  windowStart: number;
  /** Last frame where the encounter is detectable. */
  windowEnd: number;
}

interface TemplateGT {
  videoName: string;
  templateId: number;
  pokemonName: string;
  encounters: EncounterGT[];
  /** Frames that are clearly NOT encounters, used as negative samples. */
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
    videoName: "Dual_SoftReset", templateId: 30, pokemonName: "Giratina", loopTestable: false,
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
    videoName: "FRLG_Runaway", templateId: 26, pokemonName: "Bluzuk", loopTestable: false,
    encounters: [
      { matchFrame: 359, windowStart: 359, windowEnd: 359 },
    ],
    negativeFrames: [1, 180, 800, 1400],
  },
  {
    videoName: "FRLG_Runaway", templateId: 27, pokemonName: "Chaneira",
    encounters: [
      { matchFrame: 1187, windowStart: 1187, windowEnd: 1187 },
    ],
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
    videoName: "FRLG_SoftReset", templateId: 24, pokemonName: "Mewtu", loopTestable: false,
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
    encounters: [
      { matchFrame: 3521, windowStart: 3508, windowEnd: 3643 },
    ],
    negativeFrames: [1, 1000, 2000, 4000, 5000],
  },
  {
    videoName: "FRLG_Starter", templateId: 22, pokemonName: "Glumanda", loopTestable: false,
    encounters: [
      { matchFrame: 5474, windowStart: 5468, windowEnd: 5576 },
    ],
    negativeFrames: [1, 1000, 2000, 3000, 4000],
  },
  {
    videoName: "FRLG_Starter", templateId: 20, pokemonName: "Schiggy", loopTestable: false,
    encounters: [
      { matchFrame: 1240, windowStart: 1199, windowEnd: 1319 },
    ],
    negativeFrames: [1, 500, 2000, 3000, 5000],
  },
  // Dartiri template 31 uses OCR text region ("Oh?") — tested separately below.

  {
    videoName: "SwSh_Breeding", templateId: 16, pokemonName: "Relicanth",
    encounters: [
      { matchFrame: 1149, windowStart: 1149, windowEnd: 1149 },
    ],
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

// --- Tests -------------------------------------------------------------------


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
  gt: TemplateGT,
  tmplGray: Float32Array,
  tmplW: number,
  tmplH: number,
  regions: Array<{ x: number; y: number; w: number; h: number }>,
): { precision: number; hysteresisFactor: number; minPollMs: number; maxPollMs: number } | null {
  const enc = gt.encounters[0];
  const start = Math.max(0, enc.windowStart - 300);
  const end = enc.windowEnd + 300;
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

const videoTests = buildVideoTests();

describe("NCC Detection Quality", () => {
  for (const gt of GROUND_TRUTH) {
    const vt = videoTests.find((v) => v.videoName === gt.videoName);
    const tmpl = vt?.templates.find((t) => t.templateId === gt.templateId);

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
      expect(tmplImg).not.toBeNull();
      const tmplGray = toGrayscale(tmplImg!.pixels, tmplImg!.width, tmplImg!.height);

      // Score positive frames — try the match frame and ±5 frames around it,
      // take the best score. This accounts for ffmpeg seek imprecision.
      const matchScores: Array<{ encounter: number; frame: number; time: number; score: number }> = [];
      for (let ei = 0; ei < gt.encounters.length; ei++) {
        const enc = gt.encounters[ei];
        let bestScore = 0;
        let bestFrame = enc.matchFrame;
        let bestTime = enc.matchFrame / FPS;

        for (const offset of [-5, -2, 0, 2, 5]) {
          const f = enc.matchFrame + offset;
          const t = f / FPS;
          const frame = extractFrame(videoPath, t);
          if (!frame) continue;
          const frameGray = toGrayscale(frame.pixels, frame.width, frame.height);
          const score = scoreFrame(frameGray, frame.width, frame.height, tmplGray, tmplImg!.width, tmplImg!.height, tmpl.regions);
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
        const score = scoreFrame(frameGray, frame.width, frame.height, tmplGray, tmplImg!.width, tmplImg!.height, tmpl.regions);
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

      // All match frames must score above threshold
      for (const ms of matchScores) {
        expect(ms.score, `encounter ${ms.encounter} at frame ${ms.frame}`).toBeGreaterThan(0.30);
      }

      // All negative frames should score LOW
      for (const ns of negScores) {
        expect(ns.score, `negative frame ${ns.frame}`).toBeLessThan(0.5);
      }

      // There must be a clear gap between the best negative and worst match
      if (matchScores.length > 0 && negScores.length > 0) {
        expect(matchMin - negMax, "match/non-match gap").toBeGreaterThan(0);
      }
    });
  }
});

// --- Full video scan: simulate live detection --------------------------------

// --- Adaptive cooldown tests: wide detection windows -------------------------

interface CooldownTestCase {
  videoName: string;
  templateId: number;
  pokemonName: string;
  /** Detection window (first/last frame where encounter is detectable). */
  windows: Array<{ start: number; end: number }>;
  /** Core sample range as fraction (default 0.25 = sample 25%-75%). Narrow for OCR regions. */
  coreMargin?: number;
}

const COOLDOWN_TESTS: CooldownTestCase[] = [
  {
    videoName: "FRLG_SoftReset", templateId: 23, pokemonName: "Mewtu (OCR Wow!)",
    windows: [
      { start: 111, end: 308 },   // ~3.3s window
      { start: 1511, end: 2158 }, // ~10.8s window
    ],
    coreMargin: 0.4, // OCR-based template: narrow to 40%-60% to avoid edge inconsistency
  },
  {
    videoName: "FRLG_SoftReset", templateId: 24, pokemonName: "Mewtu (name region)",
    windows: [
      { start: 400, end: 550 },
      { start: 2250, end: 2300 },
    ],
    coreMargin: 0.4, // Name region is weaker; narrow to 40%-60% to avoid edge drop-off
  },
  {
    videoName: "FRLG_SoftReset", templateId: 25, pokemonName: "Mewtu (battle)",
    windows: [
      { start: 613, end: 767 },   // ~2.6s window
      { start: 2313, end: 2469 }, // ~2.6s window
    ],
  },
];

describe("Adaptive Cooldown", () => {
  for (const ct of COOLDOWN_TESTS) {
    const vt = videoTests.find((v) => v.videoName === ct.videoName);
    const tmpl = vt?.templates.find((t) => t.templateId === ct.templateId);

    it(`${ct.pokemonName} (${ct.templateId}): detection window counts as single encounter`, { timeout: 120_000 }, () => {
      if (!vt || !tmpl) return;
      const videoPath = vt.videoPath;
      if (!fs.existsSync(videoPath)) return;

      const tmplImg = loadPng(tmpl.templatePath);
      expect(tmplImg).not.toBeNull();
      const tmplGray = toGrayscale(tmplImg!.pixels, tmplImg!.width, tmplImg!.height);

      for (let wi = 0; wi < ct.windows.length; wi++) {
        const win = ct.windows[wi];
        const windowDurationSec = (win.end - win.start) / FPS;

        // Sample frames within the window core (25%-75%), avoiding edge frames
        // which may be transitional and not fully detectable
        const margin = Math.floor((win.end - win.start) * (ct.coreMargin ?? 0.25));
        const coreStart = win.start + margin;
        const coreEnd = win.end - margin;
        const coreMid = Math.floor((win.start + win.end) / 2);
        const sampleFrames = [coreStart, coreMid, coreEnd].filter((f) => f >= win.start && f <= win.end);
        const windowScores: number[] = [];

        for (const f of sampleFrames) {
          const frame = extractFrame(videoPath, f / FPS);
          if (!frame) continue;
          const frameGray = toGrayscale(frame.pixels, frame.width, frame.height);
          const score = scoreFrame(frameGray, frame.width, frame.height, tmplGray, tmplImg!.width, tmplImg!.height, tmpl.regions);
          windowScores.push(score);
        }

        const minInWindow = Math.min(...windowScores);
        console.log(
          `  Window ${wi + 1}: frames ${win.start}-${win.end} (${windowDurationSec.toFixed(1)}s) ` +
          `core=[${sampleFrames.join(",")}] ` +
          `scores=[${windowScores.map((s) => s.toFixed(3)).join(", ")}] min=${minInWindow.toFixed(3)}`,
        );

        // Core window frames should score above a baseline (encounter is detectable)
        expect(minInWindow, `window ${wi + 1} core min score`).toBeGreaterThan(0.15);
      }
    });
  }
});

// --- Full video scan: simulate live detection --------------------------------

/** Expected encounter counts for the full-video scan. */
const EXPECTED_ENCOUNTER_COUNTS: Record<string, Record<number, number>> = {
  Dual_SoftReset: { 29: 3, 30: 3 },
  FRLG_Fishing: { 28: 2 },
  FRLG_Runaway: { 26: 1, 27: 1 },
  FRLG_SoftReset: { 23: 2, 24: 2, 25: 2 },
  FRLG_Starter: { 20: 1, 21: 1, 22: 1 },
  SwSh_Breeding: { 16: 1 },
  SwSh_Runaway: { 15: 2 },
};

const SCAN_THRESHOLD = 0.55;

describe("Full Video Scan", () => {
  for (const vt of videoTests) {
    const videoExpected = EXPECTED_ENCOUNTER_COUNTS[vt.videoName];
    if (!videoExpected) continue;

    for (const tmpl of vt.templates) {
      if (tmpl.regions.length === 0) continue;
      const expected = videoExpected[tmpl.templateId];
      if (expected === undefined) continue;

      it(`${vt.videoName}/${tmpl.pokemonName} (${tmpl.templateId}): finds ${expected} encounter(s)`, { timeout: 300_000 }, () => {
        const videoPath = vt.videoPath;
        if (!fs.existsSync(videoPath)) {
          console.log(`  SKIP: video not found: ${videoPath}`);
          return;
        }

        const tmplImg = loadPng(tmpl.templatePath);
        expect(tmplImg).not.toBeNull();
        const tmplGray = toGrayscale(tmplImg!.pixels, tmplImg!.width, tmplImg!.height);
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
            tmplGray, tmplImg!.width, tmplImg!.height,
            tmpl.regions,
          );
          scores.push({
            time: t,
            score,
            frameGray: downsampleGray(frameGray, frame.width, frame.height),
          });
        }

        // Count encounters: consecutive match frames = 1 encounter,
        // separated by a gap of ≥3 non-match frames (~1.5s at 2fps).
        let encounters = 0;
        let inMatch = false;
        let gap = 0;

        for (const s of scores) {
          if (s.score >= SCAN_THRESHOLD) {
            if (!inMatch) {
              encounters++;
              inMatch = true;
            }
            gap = 0;
          } else {
            gap++;
            if (gap >= 3) inMatch = false;
          }
        }

        const matchFrames = scores.filter((s) => s.score >= SCAN_THRESHOLD);
        const maxScore = scores.length > 0 ? Math.max(...scores.map((s) => s.score)) : 0;

        // Loop-faithful cross-check: replay the dense grid through the
        // runtime state machine using the app's real adaptive polling
        // (simulateAdaptiveScan): static scenes slow polling to maxPollMs,
        // cooldown ticks without scoring. Precision on the adjusted scale
        // equivalent to SCAN_THRESHOLD on the raw scale, so both counters
        // measure at the same effective threshold.
        // Settings come from the user calibration flow ("Apply Recommended"):
        // recommended precision, hysteresis and polling bounds as a package.
        // With engine defaults the loop can miss the ultra-short encounter
        // windows of these fixtures entirely.
        const gtEntry = GROUND_TRUTH.find(
          (g) => g.videoName === vt.videoName && g.templateId === tmpl.templateId,
        );
        const calibrated = gtEntry
          ? calibratedSettings(videoPath, gtEntry, tmplGray, tmplImg!.width, tmplImg!.height, tmpl.regions)
          : null;

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
          `  ${tmpl.pokemonName} (${tmpl.templateId}): ` +
          `encounters=${encounters}/${expected} ` +
          `simulated=${sim.encounters}/${expected} ` +
          `polled=${sim.polledSamples} ` +
          `precision=${simSettings.precision.toFixed(3)} ` +
          `poll=${simSettings.minPollMs}-${simSettings.maxPollMs}ms ` +
          `matchFrames=${matchFrames.length}/${scores.length} ` +
          `max=${maxScore.toFixed(3)}`,
        );

        if (gtEntry?.loopTestable === false) {
          // One-frame score peak (see TemplateGT.loopTestable): a realistic
          // poll interval cannot hit it reliably, so only guard against
          // phantom double counts here; the Detection Quality tests cover
          // the template frame-exactly.
          expect(sim.encounters, "no phantom encounters").toBeLessThanOrEqual(expected);
        } else {
          // The simulated loop is the authoritative counter and must match
          // the ground truth exactly: with loop-faithful sampling there is
          // no over-sampling excuse left for off-by-one counts.
          expect(sim.encounters, "simulated encounter count").toBe(expected);
        }
      });
    }
  }
});

// --- Parameter sweep on real captures ----------------------------------------

/**
 * Sweep test cases: a bounded frame range around a single encounter, mirroring
 * what a replay-buffer batch test sees at runtime (one encounter per buffer).
 */
interface SweepCase {
  videoName: string;
  templateId: number;
  pokemonName: string;
  /** Scanned frame range (inclusive), sampled every 5th frame like runBatch. */
  scanStart: number;
  scanEnd: number;
  /** Ground-truth encounter frame inside the scan range. */
  matchFrame: number;
}

const SWEEP_CASES: SweepCase[] = [
  // 3D game: whole frame moves constantly, only the text box region is stable
  { videoName: "SwSh_Runaway", templateId: 15, pokemonName: "Picochilla (3D)", scanStart: 0, scanEnd: 600, matchFrame: 229 },
  // 2D game: wide, stable battle window
  { videoName: "FRLG_SoftReset", templateId: 25, pokemonName: "Mewtu (battle)", scanStart: 400, scanEnd: 900, matchFrame: 626 },
];

describe("Parameter Sweep on Real Captures", () => {
  for (const sc of SWEEP_CASES) {
    const vt = videoTests.find((v) => v.videoName === sc.videoName);
    const tmpl = vt?.templates.find((t) => t.templateId === sc.templateId);

    it(`${sc.pokemonName} (${sc.templateId}): sweep finds clean settings`, { timeout: 300_000 }, () => {
      if (!vt || !tmpl) return;
      if (!fs.existsSync(vt.videoPath)) return;

      const tmplImg = loadPng(tmpl.templatePath);
      expect(tmplImg).not.toBeNull();
      const tmplGray = toGrayscale(tmplImg!.pixels, tmplImg!.width, tmplImg!.height);

      // Sample every 5th frame like useTemplateTest.runBatch does, measuring
      // the real per-frame scoring cost that drives the polling bounds.
      const samples: StabilitySample[] = [];
      let scoreCostMs = 0;
      for (let f = sc.scanStart; f <= sc.scanEnd; f += 5) {
        const frame = extractFrame(vt.videoPath, f / FPS);
        if (!frame) continue;
        const frameGray = toGrayscale(frame.pixels, frame.width, frame.height);
        const t0 = performance.now();
        const score = scoreFrame(frameGray, frame.width, frame.height, tmplGray, tmplImg!.width, tmplImg!.height, tmpl.regions);
        scoreCostMs += performance.now() - t0;
        samples.push({ frameIndex: f, overallScore: score });
      }
      const avgScoreMs = scoreCostMs / Math.max(1, samples.length);

      const stats = analyzeStability(samples);
      expect(stats).not.toBeNull();

      const sweep = runParameterSweep({ samples, stats: stats!, avgScoreMs, cooldownSec: DEFAULT_COOLDOWN_SEC });
      expect(sweep).not.toBeNull();

      console.log(
        `  ${sc.pokemonName} (${sc.templateId}): rating=${stats!.rating} ` +
        `precision=${sweep!.precision.toFixed(3)} hysteresis=${sweep!.hysteresisFactor.toFixed(2)} ` +
        `hits=${sweep!.consecutiveHits} poll=${sweep!.pollIntervalMs}ms ` +
        `clean=${sweep!.cleanPhases}/${sweep!.totalPhases} margin=${sweep!.robustnessMargin.toFixed(3)}`,
      );

      // The swept settings must confirm the encounter exactly once in every
      // simulated polling phase (no misses, no double counts).
      expect(sweep!.perfect, "all polling phases clean").toBe(true);

      // Precision must sit between the adjusted noise level and match level
      expect(sweep!.precision).toBeGreaterThan(applyNoiseFloor(stats!.noiseP90));
      expect(sweep!.precision).toBeLessThan(applyNoiseFloor(stats!.matchMedian));

      // Ground truth: the analytic match window must contain the encounter
      expect(sc.matchFrame).toBeGreaterThanOrEqual(stats!.matchStartFrame);
      expect(sc.matchFrame).toBeLessThanOrEqual(stats!.matchEndFrame);

      // Independent re-simulation of the winning combo must reproduce the
      // clean outcome (guards against objective/simulation divergence).
      const timeline = buildTimeline(samples);
      const outcome = simulateCombo(
        timeline,
        { precision: sweep!.precision, hysteresisFactor: sweep!.hysteresisFactor, consecutiveHits: sweep!.consecutiveHits, pollMs: sweep!.pollIntervalMs },
        stats!.matchStartFrame,
        stats!.matchEndFrame,
        5,
      );
      expect(outcome.cleanPhases).toBe(outcome.totalPhases);
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
  const CASE = { videoName: "SwSh_Runaway", templateId: 15, pokemonName: "Picochilla", matchFrame: 229, changedFrame: 600 };
  const vt = videoTests.find((v) => v.videoName === CASE.videoName);
  const tmpl = vt?.templates.find((t) => t.templateId === CASE.templateId);

  it(`${CASE.pokemonName} (${CASE.templateId}): region delta separates stable match from scene change`, { timeout: 120_000 }, () => {
    if (!vt || !tmpl) return;
    if (!fs.existsSync(vt.videoPath)) return;

    const tmplImg = loadPng(tmpl.templatePath);
    expect(tmplImg).not.toBeNull();

    const grabRegions = (frameNo: number): RegionGray[] | null => {
      const frame = extractFrame(vt.videoPath, frameNo / FPS);
      if (!frame) return null;
      const frameGray = toGrayscale(frame.pixels, frame.width, frame.height);
      return tmpl.regions.map((r) =>
        cropRegionGray(frameGray, frame.width, frame.height, tmplImg!.width, tmplImg!.height, r),
      );
    };

    const atMatch = grabRegions(CASE.matchFrame);
    const shortlyAfter = grabRegions(CASE.matchFrame + 3);
    const sceneChanged = grabRegions(CASE.changedFrame);
    expect(atMatch).not.toBeNull();
    expect(shortlyAfter).not.toBeNull();
    expect(sceneChanged).not.toBeNull();

    const stableDelta = regionSetDelta(atMatch!, shortlyAfter!);
    const changedDelta = regionSetDelta(atMatch!, sceneChanged!);

    console.log(
      `  ${CASE.pokemonName}: stableDelta=${stableDelta.toFixed(4)} ` +
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
