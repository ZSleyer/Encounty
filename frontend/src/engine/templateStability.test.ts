/**
 * templateStability.test.ts: Tests for match-window stability analysis and
 * calibration helpers.
 */
import { describe, it, expect } from "vitest";
import {
  analyzeStability,
  toCalibration,
  calibratedPrecisionFor,
  type StabilitySample,
} from "./templateStability";

/** Build samples from a score array, frame indices 0,5,10,... */
function samples(scores: number[]): StabilitySample[] {
  return scores.map((overallScore, i) => ({ frameIndex: i * 5, overallScore }));
}

describe("analyzeStability", () => {
  it("returns null for too few samples", () => {
    expect(analyzeStability(samples([0.1, 0.9, 0.1]))).toBeNull();
  });

  it("returns null when all scores are zero", () => {
    expect(analyzeStability(samples(new Array(12).fill(0)))).toBeNull();
  });

  it("detects a clean match window and rates it good", () => {
    // Noise ~0.1, match window 0.85-0.92 (5 frames)
    const s = samples([0.1, 0.12, 0.08, 0.85, 0.9, 0.92, 0.88, 0.86, 0.11, 0.09, 0.1, 0.12]);
    const stats = analyzeStability(s);
    expect(stats).not.toBeNull();
    expect(stats!.sampleCount).toBe(5);
    expect(stats!.matchP10).toBeCloseTo(0.85, 5);
    expect(stats!.matchMedian).toBeCloseTo(0.88, 5);
    expect(stats!.noiseP90).toBeLessThanOrEqual(0.12);
    expect(stats!.rating).toBe("good");
    // Recommendation sits below the weakest match frame and above noise
    expect(stats!.recommendedPrecision).toBeLessThan(0.85);
    expect(stats!.recommendedPrecision).toBeGreaterThan(0.17);
  });

  it("rates overlapping distributions poor", () => {
    // Noise up to 0.7, "match" only slightly above
    const s = samples([0.6, 0.65, 0.7, 0.72, 0.74, 0.75, 0.7, 0.68, 0.66, 0.64, 0.62, 0.6]);
    const stats = analyzeStability(s);
    expect(stats).not.toBeNull();
    expect(stats!.rating).toBe("poor");
  });

  it("handles a match window at the end of the buffer", () => {
    const s = samples([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.88, 0.9, 0.91]);
    const stats = analyzeStability(s);
    expect(stats).not.toBeNull();
    expect(stats!.sampleCount).toBe(3);
    expect(stats!.rating).toBe("good");
  });

  it("clamps the recommendation into [0.2, 0.95]", () => {
    const high = analyzeStability(
      samples([0.1, 0.1, 0.1, 0.1, 0.99, 0.999, 0.999, 0.999, 0.1, 0.1, 0.1, 0.1]),
    );
    expect(high!.recommendedPrecision).toBeLessThanOrEqual(0.95);

    const low = analyzeStability(
      samples([0.01, 0.01, 0.01, 0.01, 0.2, 0.22, 0.21, 0.2, 0.01, 0.01, 0.01, 0.01]),
    );
    expect(low!.recommendedPrecision).toBeGreaterThanOrEqual(0.2);
  });

  it("is independent of sample order", () => {
    const base = [0.1, 0.12, 0.08, 0.85, 0.9, 0.92, 0.88, 0.86, 0.11, 0.09, 0.1, 0.12];
    const shuffled = samples(base).reverse();
    const a = analyzeStability(samples(base));
    const b = analyzeStability(shuffled);
    expect(a).toEqual(b);
  });
});

describe("toCalibration", () => {
  it("rounds values to 3 decimals with snake_case keys", () => {
    const stats = analyzeStability(
      samples([0.1, 0.12, 0.08, 0.85, 0.9, 0.92, 0.88, 0.86, 0.11, 0.09, 0.1, 0.12]),
    )!;
    const cal = toCalibration(stats);
    expect(cal.sample_count).toBe(stats.sampleCount);
    for (const v of [cal.recommended_precision, cal.match_p10, cal.match_median, cal.noise_p90]) {
      expect(v).toBeCloseTo(Math.round(v * 1000) / 1000, 10);
    }
  });
});

describe("calibratedPrecisionFor", () => {
  it("returns the minimum valid recommendation", () => {
    const min = calibratedPrecisionFor([
      { calibration: { recommended_precision: 0.8, match_p10: 0, match_median: 0, noise_p90: 0, sample_count: 5 } },
      { calibration: { recommended_precision: 0.6, match_p10: 0, match_median: 0, noise_p90: 0, sample_count: 5 } },
      {},
    ]);
    expect(min).toBe(0.6);
  });

  it("ignores invalid values and returns undefined without calibrations", () => {
    expect(calibratedPrecisionFor([{}, { calibration: null }])).toBeUndefined();
    expect(
      calibratedPrecisionFor([
        { calibration: { recommended_precision: 0, match_p10: 0, match_median: 0, noise_p90: 0, sample_count: 1 } },
        { calibration: { recommended_precision: 1.5, match_p10: 0, match_median: 0, noise_p90: 0, sample_count: 1 } },
      ]),
    ).toBeUndefined();
  });
});
