/**
 * templateStability.ts: Stability analysis for template batch test results.
 *
 * The template test step scores sampled replay-buffer frames. The best score
 * alone is misleading: at runtime the detection loop polls at an arbitrary
 * phase, so it sees random frames from the match window, not the single best
 * one. This module derives the score distribution over the detected match
 * window (the contiguous run of high-scoring frames around the best frame),
 * separates it from the noise floor of the remaining frames, and recommends
 * a precision threshold that a randomly sampled match frame will clear while
 * staying safely above noise.
 *
 * All functions are pure; the analysis never alters the confidence reported
 * for an actual detection at runtime.
 */

import type { TemplateCalibration } from "../types";

// --- Types -------------------------------------------------------------------

/** Minimal shape of a batch test result consumed by the analysis. */
export interface StabilitySample {
  frameIndex: number;
  overallScore: number;
}

/** Detectability rating derived from the score distribution. */
export type StabilityRating = "good" | "ok" | "poor";

/** Result of analyzing a batch test run. */
export interface StabilityStats {
  /** 10th percentile of scores inside the match window. */
  matchP10: number;
  /** Median score inside the match window. */
  matchMedian: number;
  /** 90th percentile of scores outside the match window (0 if none). */
  noiseP90: number;
  /** Number of sampled frames inside the match window. */
  sampleCount: number;
  /** Recommended precision threshold for the detection loop. */
  recommendedPrecision: number;
  /** Fraction of match-window frames at or above the recommended threshold. */
  matchFraction: number;
  /** Recommended hysteresis factor for the detection loop (0.5..0.95). */
  recommendedHysteresis: number;
  /** Overall detectability rating. */
  rating: StabilityRating;
}

/** Recommended adaptive-polling intervals derived from a stability analysis. */
export interface PollingRecommendation {
  minPollMs: number;
  basePollMs: number;
  maxPollMs: number;
}

export type { TemplateCalibration };

// --- Constants ----------------------------------------------------------------

/** Minimum number of sampled frames required for a meaningful analysis. */
const MIN_SAMPLES = 8;

/** Safety margin subtracted from the match p10 for the recommendation. */
const MATCH_MARGIN = 0.03;

/** Safety margin added above the noise p90 for the recommendation. */
const NOISE_MARGIN = 0.05;

/** Bounds for the recommended precision. */
const MIN_PRECISION = 0.2;
const MAX_PRECISION = 0.95;

/** Bounds and step of the hysteresis-factor slider in the detector settings. */
const MIN_HYSTERESIS = 0.5;
const MAX_HYSTERESIS = 0.95;
const HYSTERESIS_STEP = 0.05;

/** Worst-case scenario for the polling recommendation: parallel hunts. */
const PARALLEL_HUNTS = 10;

/**
 * Conservative floor for the fastest recommended interval: polling below
 * 25 ms is the dominant load driver and never necessary for a 60fps feed.
 */
const FLOOR_MIN_POLL_MS = 25;

/**
 * Ceiling for the idle (max) interval, the proven low-load value. The match
 * window can lower it further: short matches on a 60fps feed must still be
 * hit by at least two polls.
 */
const CEIL_MAX_POLL_MS = 2000;

/**
 * Milliseconds between two sampled batch-test frames: the replay buffer
 * captures at ~60fps and the batch test scores every 5th frame.
 */
const SAMPLE_SPACING_MS = (1000 / 60) * 5;

// --- Helpers -------------------------------------------------------------------

/** Return the p-quantile (0..1) of a non-empty sorted ascending array. */
function quantileSorted(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx];
}

/** Sort a copy ascending. */
function sortedAsc(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/**
 * Find the contiguous match window around the best-scoring frame.
 *
 * The cut is the midpoint between the best score and the global median: match
 * segments are a minority of the buffer, so the median approximates the noise
 * level. Returns the index range [start, end] into the samples array.
 */
function findMatchWindow(samples: StabilitySample[]): { start: number; end: number } {
  const scores = samples.map((s) => s.overallScore);
  let bestIdx = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > scores[bestIdx]) bestIdx = i;
  }
  const median = quantileSorted(sortedAsc(scores), 0.5);
  const cut = (scores[bestIdx] + median) / 2;

  let start = bestIdx;
  while (start > 0 && scores[start - 1] >= cut) start--;
  let end = bestIdx;
  while (end < scores.length - 1 && scores[end + 1] >= cut) end++;
  return { start, end };
}

/** Derive the rating from separation and in-window hit fraction. */
function rate(matchFraction: number, separation: number): StabilityRating {
  if (matchFraction >= 0.8 && separation >= 0.15) return "good";
  if (matchFraction >= 0.5 && separation >= 0.08) return "ok";
  return "poor";
}

// --- Public API ----------------------------------------------------------------

/**
 * Analyze batch test results and derive stability statistics plus a
 * recommended precision threshold.
 *
 * Returns null when there are too few samples or no signal at all.
 */
export function analyzeStability(samples: StabilitySample[]): StabilityStats | null {
  if (samples.length < MIN_SAMPLES) return null;

  const ordered = [...samples].sort((a, b) => a.frameIndex - b.frameIndex);
  const best = Math.max(...ordered.map((s) => s.overallScore));
  if (best <= 0) return null;

  const { start, end } = findMatchWindow(ordered);
  const matchScores = sortedAsc(ordered.slice(start, end + 1).map((s) => s.overallScore));
  const noiseScores = sortedAsc(
    [...ordered.slice(0, start), ...ordered.slice(end + 1)].map((s) => s.overallScore),
  );

  const matchP10 = quantileSorted(matchScores, 0.1);
  const matchMedian = quantileSorted(matchScores, 0.5);
  const noiseP90 = noiseScores.length > 0 ? quantileSorted(noiseScores, 0.9) : 0;

  // Recommend a threshold a random match-window frame clears (p10 minus a
  // margin) while staying above the noise ceiling. When the two constraints
  // conflict the distributions overlap: fall back to the midpoint.
  const upper = matchP10 - MATCH_MARGIN;
  const lower = noiseP90 + NOISE_MARGIN;
  let recommended = upper >= lower ? upper : (matchP10 + noiseP90) / 2;
  recommended = Math.min(MAX_PRECISION, Math.max(MIN_PRECISION, recommended));

  const hits = matchScores.filter((s) => s >= recommended).length;
  const matchFraction = hits / matchScores.length;
  const separation = matchP10 - noiseP90;

  return {
    matchP10,
    matchMedian,
    noiseP90,
    sampleCount: matchScores.length,
    recommendedPrecision: recommended,
    matchFraction,
    recommendedHysteresis: recommendHysteresis(recommended, noiseP90),
    rating: upper >= lower ? rate(matchFraction, separation) : "poor",
  };
}

/**
 * Recommend a hysteresis factor from the precision and the noise ceiling.
 *
 * The loop exits hysteresis when the score drops below precision * factor.
 * Targeting the midpoint between noise p90 and the precision keeps the exit
 * above lingering noise while still triggering once the match disappears.
 */
function recommendHysteresis(precision: number, noiseP90: number): number {
  const exitTarget = (noiseP90 + precision) / 2;
  const factor = exitTarget / precision;
  const snapped = Math.round(factor / HYSTERESIS_STEP) * HYSTERESIS_STEP;
  return Math.min(MAX_HYSTERESIS, Math.max(MIN_HYSTERESIS, snapped));
}

/** Clamp v into [min, max] after rounding to the given step. */
function clampStep(v: number, step: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v / step) * step));
}

/**
 * Recommend adaptive-polling intervals from the measured per-frame scoring
 * cost on this machine and the measured match-window length.
 *
 * Worst case by design: PARALLEL_HUNTS hunts run at once and only half of the
 * CPU cores are available to them, the other half is reserved for the game,
 * streaming and other software. The minimum interval keeps the worst-case
 * detection duty cycle at or below 25% (never below FLOOR_MIN_POLL_MS), the
 * maximum interval stays at the proven low-load ceiling unless the match
 * window is so short that two polls would no longer land inside it, and the
 * base interval sits at four times the minimum, mirroring the proven
 * 50/200/2000 ms ratio.
 *
 * Returns null when no timing was measured.
 */
export function recommendPolling(
  stats: StabilityStats,
  avgScoreMs: number,
  hardwareConcurrency: number = globalThis.navigator?.hardwareConcurrency ?? 4,
): PollingRecommendation | null {
  if (avgScoreMs <= 0) return null;

  const usableCores = Math.max(1, Math.floor(hardwareConcurrency / 2));
  const wallMs = avgScoreMs * Math.ceil(PARALLEL_HUNTS / usableCores);
  const windowMs = stats.sampleCount * SAMPLE_SPACING_MS;
  // Slider bounds below mirror the detector settings inputs.
  const minPollMs = clampStep(Math.max(4 * wallMs, FLOOR_MIN_POLL_MS), 5, 10, 1000);
  const maxPollMs = clampStep(
    Math.min(CEIL_MAX_POLL_MS, windowMs / 2),
    50,
    Math.max(100, minPollMs),
    5000,
  );
  const basePollMs = clampStep(4 * minPollMs, 10, minPollMs, Math.min(2000, maxPollMs));
  return { minPollMs, basePollMs, maxPollMs };
}

/** Convert stability stats into the persisted calibration payload. */
export function toCalibration(stats: StabilityStats): TemplateCalibration {
  return {
    recommended_precision: round3(stats.recommendedPrecision),
    match_p10: round3(stats.matchP10),
    match_median: round3(stats.matchMedian),
    noise_p90: round3(stats.noiseP90),
    sample_count: stats.sampleCount,
  };
}

/** Round to 3 decimal places for compact persistence. */
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
