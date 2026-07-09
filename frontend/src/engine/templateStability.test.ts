/**
 * templateStability.test.ts: Tests for match-window stability analysis and
 * calibration helpers.
 */
import { describe, it, expect } from "vitest";
import {
  analyzeStability,
  recommendPolling,
  toCalibration,
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

  it("recommends a hysteresis factor within slider bounds", () => {
    const clean = analyzeStability(
      samples([0.1, 0.12, 0.08, 0.85, 0.9, 0.92, 0.88, 0.86, 0.11, 0.09, 0.1, 0.12]),
    )!;
    expect(clean.recommendedHysteresis).toBeGreaterThanOrEqual(0.5);
    expect(clean.recommendedHysteresis).toBeLessThanOrEqual(0.95);
    // Exit threshold (precision * factor) must sit above the noise ceiling
    expect(clean.recommendedPrecision * clean.recommendedHysteresis).toBeGreaterThan(clean.noiseP90);

    const noisy = analyzeStability(
      samples([0.6, 0.65, 0.7, 0.72, 0.74, 0.75, 0.7, 0.68, 0.66, 0.64, 0.62, 0.6]),
    )!;
    expect(noisy.recommendedHysteresis).toBeLessThanOrEqual(0.95);
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

describe("recommendPolling", () => {
  // 5 match-window samples -> window ~417ms on a 60fps feed
  const shortWindow = analyzeStability(
    samples([0.1, 0.12, 0.08, 0.85, 0.9, 0.92, 0.88, 0.86, 0.11, 0.09, 0.1, 0.12]),
  )!;
  // 48 match-window samples -> window ~4s, longer than the low-load ceiling
  const longWindow = analyzeStability(
    samples([...new Array(26).fill(0.1), ...new Array(48).fill(0.9), ...new Array(26).fill(0.1)]),
  )!;

  it("returns null without a measured scoring cost", () => {
    expect(recommendPolling(shortWindow, 0, 8)).toBeNull();
  });

  it("lands on the proven 50/200/2000 profile for typical hardware", () => {
    // 8 cores -> 4 usable -> ceil(10/4)=3 rounds -> wall 12ms -> 4*12=48 -> 50
    const rec = recommendPolling(longWindow, 4, 8)!;
    expect(rec.minPollMs).toBe(50);
    expect(rec.basePollMs).toBe(200);
    // Long window: idle interval capped by the low-load ceiling, not the window
    expect(rec.maxPollMs).toBe(2000);
  });

  it("caps the idle interval so two polls land in a short match window", () => {
    const rec = recommendPolling(shortWindow, 4, 8)!;
    expect(rec.maxPollMs).toBe(200);
    expect(rec.basePollMs).toBeLessThanOrEqual(rec.maxPollMs);
  });

  it("keeps a conservative floor on strong hardware", () => {
    const fast = recommendPolling(shortWindow, 0.1, 32)!;
    expect(fast.minPollMs).toBe(25);
    expect(fast.basePollMs).toBe(100);
  });

  it("scales up on weak hardware within slider bounds", () => {
    // 2 cores -> 1 usable -> wall 200ms -> min 800
    const slow = recommendPolling(shortWindow, 20, 2)!;
    expect(slow.minPollMs).toBe(800);
    expect(slow.maxPollMs).toBeGreaterThanOrEqual(slow.minPollMs);
    expect(slow.basePollMs).toBeGreaterThanOrEqual(slow.minPollMs);

    const extreme = recommendPolling(shortWindow, 500, 2)!;
    expect(extreme.minPollMs).toBe(1000);
  });
});
