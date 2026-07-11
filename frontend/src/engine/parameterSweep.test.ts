/**
 * parameterSweep.test.ts: Tests for the simulation-based calibration sweep.
 */
import { describe, it, expect } from "vitest";
import { applyNoiseFloor } from "./matchStateMachine";
import {
  buildSweepGrid,
  buildTimeline,
  createSweepRunner,
  runParameterSweep,
  simulateCombo,
  type SweepInput,
  type SweepResult,
} from "./parameterSweep";
import { analyzeStability, toCalibration, type StabilitySample, type StabilityStats } from "./templateStability";

// --- Fixtures ---

/**
 * Build samples spaced 5 frames apart (mirrors the batch-test sampling of a
 * ~60fps buffer): a noise baseline with one rectangular high-score pulse and
 * optional per-index score overrides.
 */
function pulseSamples(
  total: number,
  pulseStart: number,
  pulseLen: number,
  overrides: Record<number, number> = {},
  noise = 0.2,
  match = 0.9,
): StabilitySample[] {
  return Array.from({ length: total }, (_, i) => {
    let overallScore = i >= pulseStart && i < pulseStart + pulseLen ? match : noise;
    if (overrides[i] !== undefined) overallScore = overrides[i];
    return { frameIndex: i * 5, overallScore };
  });
}

/** Build a SweepInput from samples with typical hardware parameters. */
function inputFor(samples: StabilitySample[]): SweepInput {
  const stats = analyzeStability(samples);
  expect(stats).not.toBeNull();
  return { samples, stats: stats!, avgScoreMs: 4, hardwareConcurrency: 8 };
}

// 120 samples (~10s), clean 12-sample pulse (~1s match window)
const cleanSamples = pulseSamples(120, 50, 12);
// Same pulse plus a short 2-sample noise spike (raw 0.6) far outside the window
const spikySamples = pulseSamples(120, 50, 12, { 100: 0.6, 101: 0.6 });

// --- Tests ---

describe("runParameterSweep", () => {
  it("returns null for too few samples", () => {
    const samples = pulseSamples(4, 1, 2);
    const stats = analyzeStability(cleanSamples)!;
    expect(runParameterSweep({ samples, stats, avgScoreMs: 4 })).toBeNull();
  });

  it("returns null for missing stats", () => {
    const input: SweepInput = {
      samples: cleanSamples,
      stats: null as unknown as StabilityStats,
      avgScoreMs: 4,
    };
    expect(runParameterSweep(input)).toBeNull();
  });

  it("finds a perfect combination for a clean single pulse", () => {
    const result = runParameterSweep(inputFor(cleanSamples));
    expect(result).not.toBeNull();
    expect(result!.perfect).toBe(true);
    expect(result!.cleanPhases).toBe(result!.totalPhases);
    expect(result!.totalPhases).toBe(4);
    // Precision must sit between the adjusted noise ceiling and match level
    expect(result!.precision).toBeGreaterThan(applyNoiseFloor(0.2));
    expect(result!.precision).toBeLessThan(applyNoiseFloor(0.9));
    expect(result!.robustnessMargin).toBeGreaterThan(0);
    // Winning interval respects the hardware polling bounds
    expect(result!.pollIntervalMs).toBeGreaterThanOrEqual(result!.minPollMs);
    expect(result!.pollIntervalMs).toBeLessThanOrEqual(result!.maxPollMs);
    expect(Number.isFinite(result!.worstLatencyMs)).toBe(true);
  });

  it("avoids a false trigger from a short noise spike", () => {
    const input = inputFor(spikySamples);
    const result = runParameterSweep(input);
    expect(result).not.toBeNull();
    expect(result!.perfect).toBe(true);

    // Re-simulate the winning settings: no phase may confirm outside the window
    const timeline = buildTimeline(input.samples);
    const outcome = simulateCombo(
      timeline,
      {
        precision: result!.precision,
        hysteresisFactor: result!.hysteresisFactor,
        consecutiveHits: result!.consecutiveHits,
        pollMs: result!.pollIntervalMs,
      },
      input.stats.matchStartFrame,
      input.stats.matchEndFrame,
      5,
    );
    for (const phase of outcome.phases) {
      expect(phase.outsideConfirms).toBe(0);
      expect(phase.insideConfirms).toBe(1);
    }
  });

  it("prefers the larger poll interval among equally clean combos", () => {
    // 60-sample pulse (~5s window): every poll candidate lands enough ticks
    // inside, so the CPU tie-break decides
    const result = runParameterSweep(inputFor(pulseSamples(200, 70, 60)));
    expect(result).not.toBeNull();
    expect(result!.perfect).toBe(true);
    expect(result!.maxPollMs).toBe(2000);
    expect(result!.pollIntervalMs).toBe(800);
  });

  it("is deterministic across runs", () => {
    const a = runParameterSweep(inputFor(spikySamples));
    const b = runParameterSweep(inputFor(spikySamples));
    expect(a).toEqual(b);
  });
});

describe("simulateCombo", () => {
  it("does not double-count one sample as two consecutive hits (dedupe)", () => {
    // Single high sample at index 60 (frame 300), samples ~83ms apart:
    // 50ms polling maps two ticks onto the same sample in some phases
    const samples = pulseSamples(120, 60, 1, {}, 0.2, 0.95);
    const timeline = buildTimeline(samples);
    const combo = { precision: 0.5, hysteresisFactor: 0.7, consecutiveHits: 2, pollMs: 50 };

    const twoHits = simulateCombo(timeline, combo, 300, 300, 5);
    for (const phase of twoHits.phases) {
      expect(phase.insideConfirms).toBe(0);
      expect(phase.outsideConfirms).toBe(0);
    }

    // Sanity check: a single required hit does confirm on that sample
    const oneHit = simulateCombo(timeline, { ...combo, consecutiveHits: 1 }, 300, 300, 5);
    for (const phase of oneHit.phases) {
      expect(phase.insideConfirms).toBe(1);
      expect(phase.outsideConfirms).toBe(0);
    }
  });
});

describe("buildSweepGrid", () => {
  it("falls back to a single midpoint precision for overlapping distributions", () => {
    // Noise up to 0.7, "match" only slightly above (see templateStability tests)
    const stats = analyzeStability(
      [0.6, 0.65, 0.7, 0.72, 0.74, 0.75, 0.7, 0.68, 0.66, 0.64, 0.62, 0.6].map(
        (overallScore, i) => ({ frameIndex: i * 5, overallScore }),
      ),
    )!;
    const grid = buildSweepGrid(stats, 4, 8);
    const precisions = new Set(grid.combos.map((c) => c.precision));
    expect(precisions.size).toBe(1);
    const [p] = [...precisions];
    expect(p).toBeGreaterThanOrEqual(0.2);
    expect(p).toBeLessThanOrEqual(0.95);
  });

  it("keeps poll candidates at or above the hardware minimum", () => {
    const stats = analyzeStability(cleanSamples)!;
    // Weak hardware: 20ms scoring on 2 cores pushes the minimum to 800ms
    const grid = buildSweepGrid(stats, 20, 2);
    expect(grid.minPollMs).toBe(800);
    for (const combo of grid.combos) {
      expect(combo.pollMs).toBeGreaterThanOrEqual(grid.minPollMs);
    }
  });
});

describe("createSweepRunner", () => {
  it("reaches completion via repeated steps and matches runParameterSweep", () => {
    const input = inputFor(spikySamples);
    const expected = runParameterSweep(input);

    const runner = createSweepRunner(input);
    expect(runner.result()).toBeNull();
    let finished = false;
    let guard = 0;
    while (!finished && guard < 100000) {
      finished = runner.step(1);
      guard++;
    }
    expect(finished).toBe(true);
    expect(runner.progress()).toBe(1);
    expect(runner.result()).toEqual(expected);
  });

  it("finishes immediately with a null result for invalid input", () => {
    const stats = analyzeStability(cleanSamples)!;
    const runner = createSweepRunner({ samples: pulseSamples(4, 1, 2), stats, avgScoreMs: 4 });
    expect(runner.step(1)).toBe(true);
    expect(runner.progress()).toBe(1);
    expect(runner.result()).toBeNull();
  });
});

describe("toCalibration with sweep", () => {
  const stats = analyzeStability(cleanSamples)!;
  const sweep: SweepResult = {
    precision: 0.4567,
    hysteresisFactor: 0.65,
    consecutiveHits: 2,
    pollIntervalMs: 200,
    minPollMs: 50,
    maxPollMs: 2000,
    cleanPhases: 4,
    totalPhases: 4,
    perfect: true,
    robustnessMargin: 0.1234,
    worstLatencyMs: 312.4,
  };

  it("embeds the sweep block and uses the swept precision", () => {
    const cal = toCalibration(stats, sweep);
    expect(cal.recommended_precision).toBe(0.457);
    expect(cal.sweep).toEqual({
      hysteresis_factor: 0.65,
      consecutive_hits: 2,
      poll_interval_ms: 200,
      min_poll_ms: 50,
      max_poll_ms: 2000,
      robustness_margin: 0.123,
      latency_ms: 312,
    });
    // Analytic fields are unchanged by the sweep
    expect(cal.match_p10).toBeCloseTo(stats.matchP10, 3);
    expect(cal.sample_count).toBe(stats.sampleCount);
  });

  it("omits the sweep block without a sweep result", () => {
    const cal = toCalibration(stats);
    expect(cal.sweep).toBeUndefined();
    expect(cal.recommended_precision).toBeCloseTo(stats.recommendedPrecision, 3);
  });
});
