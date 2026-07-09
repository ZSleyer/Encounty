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
  /** Overall detectability rating. */
  rating: StabilityRating;
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
    rating: upper >= lower ? rate(matchFraction, separation) : "poor",
  };
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

/**
 * Compute the effective calibrated precision for a set of templates.
 *
 * Returns the minimum recommended precision across templates that carry a
 * valid calibration, or undefined when none do. The minimum is used because
 * detect() takes the max score across templates: the loop must not demand
 * more than the weakest calibrated template can deliver under polling.
 */
export function calibratedPrecisionFor(
  templates: { calibration?: TemplateCalibration | null }[],
): number | undefined {
  let min: number | undefined;
  for (const t of templates) {
    const rec = t.calibration?.recommended_precision;
    if (typeof rec === "number" && rec > 0 && rec <= 1 && (min === undefined || rec < min)) {
      min = rec;
    }
  }
  return min;
}
