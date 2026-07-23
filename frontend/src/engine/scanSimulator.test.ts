/**
 * scanSimulator.test.ts: Unit tests for the loop-faithful scan simulator,
 * driven with synthetic score timelines and synthetic frame grays.
 */
import { describe, expect, it } from "vitest";
import { applyNoiseFloor } from "./matchStateMachine";
import { simulateAdaptiveScan, type ScanSample } from "./scanSimulator";

/** Uniform synthetic 64px grayscale frame. */
function gray(value: number): Float32Array {
  return new Float32Array(64).fill(value);
}

const SETTINGS = {
  precision: applyNoiseFloor(0.55),
  hysteresisFactor: 0.7,
  consecutiveHits: 1,
  cooldownSec: 5,
};

/**
 * Builds a 0.1s-rastered timeline: idle scene (low score, frame A), one
 * encounter visible from encStart to encEnd (high score, static frame B)
 * with an optional dip window (low score, flash frame C), idle afterwards.
 */
function timeline(
  durationSec: number,
  encStart: number,
  encEnd: number,
  dip?: { start: number; end: number },
): ScanSample[] {
  const samples: ScanSample[] = [];
  for (let t = 0; t <= durationSec; t += 0.1) {
    const inEncounter = t >= encStart && t <= encEnd;
    const inDip = dip !== undefined && t >= dip.start && t <= dip.end;
    let score = 0.1;
    let frame = gray(0);
    if (inEncounter && !inDip) {
      score = 0.9;
      frame = gray(200);
    } else if (inDip) {
      score = 0.1;
      frame = gray(100);
    }
    samples.push({ time: Number(t.toFixed(1)), score, frameGray: frame });
  }
  return samples;
}

describe("simulateAdaptiveScan", () => {
  it("counts a plain encounter exactly once", () => {
    const result = simulateAdaptiveScan(timeline(20, 1, 4), SETTINGS);
    expect(result.encounters).toBe(1);
  });

  it("counts two encounters separated by a quiet phase", () => {
    const first = timeline(30, 1, 4);
    // Second encounter from 15s to 18s on the same timeline
    for (const s of first) {
      if (s.time >= 15 && s.time <= 18) {
        s.score = 0.9;
        s.frameGray = gray(200);
      }
    }
    expect(simulateAdaptiveScan(first, SETTINGS).encounters).toBe(2);
  });

  it("skips a short dip on a static battle screen (Chaneira pattern)", () => {
    // Encounter visible 1s..14s with a 0.6s dip at 6s. In hysteresis on a
    // static scene the loop polls at maxPollMs (2s), so the dip falls
    // between polls and the encounter counts exactly once. A dense feed of
    // the same timeline double counts (pinned in matchStateMachine.test.ts).
    const result = simulateAdaptiveScan(timeline(20, 1, 14, { start: 6.0, end: 6.6 }), SETTINGS);
    expect(result.encounters).toBe(1);
  });

  it("documents the remaining limit: a dip longer than maxPollMs still splits", () => {
    // A 3s dip cannot fall between 2s polls; the hysteresis exits, the
    // cooldown elapses during the still-visible encounter and it counts
    // again. This is the case a potential re-arm hardening would address.
    const result = simulateAdaptiveScan(timeline(24, 1, 16, { start: 6.0, end: 9.0 }), SETTINGS);
    expect(result.encounters).toBe(2);
  });

  it("ticks through cooldown without scoring samples", () => {
    const result = simulateAdaptiveScan(timeline(20, 1, 4), SETTINGS);
    expect(result.cooldownTicks).toBeGreaterThan(0);
    // 5s cooldown at 100ms ticks is about 50 ticks
    expect(result.cooldownTicks).toBeGreaterThanOrEqual(45);
    expect(result.polledSamples).toBeLessThan(200);
  });
});
