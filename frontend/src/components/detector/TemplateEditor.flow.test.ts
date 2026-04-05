/**
 * Tests for the detection flow simulation used in the template test step.
 *
 * The simulateDetectionFlow function is defined in TemplateEditor.tsx but is
 * not exported. This file mirrors the pure function implementation for direct
 * unit testing of the state machine logic.
 */
import { describe, it, expect } from "vitest";

// --- Mirrored types and constants from TemplateEditor.tsx ---

/** Hysteresis factor: after a match, score must drop to precision x this value. */
const HYSTERESIS_FACTOR = 0.7;

/** Detection flow state for each frame. */
type FlowState = "searching" | "match" | "hysteresis" | "cooldown";

/** Zone span in the sparkline. */
interface FlowZone { startIdx: number; endIdx: number; type: "hysteresis" | "cooldown" }

/** Mutable context passed through the detection state machine. */
interface FlowContext {
  phase: "searching" | "hysteresis" | "cooldown";
  zoneStart: number;
  cooldownRemaining: number;
  states: Map<number, FlowState>;
  zones: FlowZone[];
  threshold: number;
  hysteresisExit: number;
  cooldownFrames: number;
}

function processHysteresisFrame(ctx: FlowContext, idx: number, score: number): void {
  if (score < ctx.hysteresisExit) {
    ctx.zones.push({ startIdx: ctx.zoneStart, endIdx: idx, type: "hysteresis" });
    ctx.phase = "cooldown";
    ctx.cooldownRemaining = ctx.cooldownFrames;
    ctx.zoneStart = idx;
    ctx.states.set(idx, "cooldown");
  } else {
    ctx.states.set(idx, "hysteresis");
  }
}

function processCooldownFrame(ctx: FlowContext, idx: number, score: number): void {
  ctx.cooldownRemaining -= 5;
  if (ctx.cooldownRemaining > 0) {
    ctx.states.set(idx, "cooldown");
    return;
  }
  ctx.zones.push({ startIdx: ctx.zoneStart, endIdx: idx, type: "cooldown" });
  ctx.phase = "searching";
  ctx.zoneStart = -1;
  processSearchingFrame(ctx, idx, score);
}

function processSearchingFrame(ctx: FlowContext, idx: number, score: number): void {
  if (score >= ctx.threshold) {
    ctx.states.set(idx, "match");
    ctx.phase = "hysteresis";
    ctx.zoneStart = idx;
  } else {
    ctx.states.set(idx, "searching");
  }
}

/**
 * Mirror of simulateDetectionFlow from TemplateEditor.tsx.
 * Simulate the full detection state machine:
 * Searching -> Match -> Hysteresis -> Cooldown -> Searching.
 */
function simulateDetectionFlow(
  entries: [number, { overallScore: number }][],
  threshold: number,
  cooldownFrames: number,
): { states: Map<number, FlowState>; zones: FlowZone[] } {
  const ctx: FlowContext = {
    phase: "searching",
    zoneStart: -1,
    cooldownRemaining: 0,
    states: new Map(),
    zones: [],
    threshold,
    hysteresisExit: threshold * HYSTERESIS_FACTOR,
    cooldownFrames,
  };

  for (const [idx, r] of entries) {
    if (ctx.phase === "hysteresis") processHysteresisFrame(ctx, idx, r.overallScore);
    else if (ctx.phase === "cooldown") processCooldownFrame(ctx, idx, r.overallScore);
    else processSearchingFrame(ctx, idx, r.overallScore);
  }

  if (ctx.phase !== "searching" && ctx.zoneStart >= 0 && entries.length > 0) {
    const lastIdx = entries[entries.length - 1][0];
    ctx.zones.push({ startIdx: ctx.zoneStart, endIdx: lastIdx, type: ctx.phase === "hysteresis" ? "hysteresis" : "cooldown" });
  }

  return { states: ctx.states, zones: ctx.zones };
}

// --- Test helpers ---

/** Build entries from [frameIndex, score] tuples. */
function makeEntries(scores: [number, number][]): [number, { overallScore: number }][] {
  return scores.map(([idx, score]) => [idx, { overallScore: score }]);
}

// --- Tests ---

describe("simulateDetectionFlow", () => {
  const threshold = 0.8;
  const cooldownFrames = 15; // 3 entries at 5-per-step

  it("marks all entries as searching when all scores are below threshold", () => {
    const entries = makeEntries([
      [0, 0.1], [5, 0.3], [10, 0.5], [15, 0.7],
    ]);
    const { states, zones } = simulateDetectionFlow(entries, threshold, cooldownFrames);

    expect(zones).toHaveLength(0);
    for (const [, state] of states) {
      expect(state).toBe("searching");
    }
  });

  it("transitions through match -> hysteresis -> cooldown -> searching on a single spike", () => {
    // threshold = 0.8, hysteresisExit = 0.56
    // cooldownFrames = 15 → needs 3 entries (3 * 5 = 15) to expire
    const entries = makeEntries([
      [0, 0.2],  // searching
      [5, 0.9],  // match (>= 0.8)
      [10, 0.7], // hysteresis (>= 0.56)
      [15, 0.6], // hysteresis (>= 0.56)
      [20, 0.4], // hysteresis exits (< 0.56) -> cooldown starts
      [25, 0.1], // cooldown (remaining: 15-5=10)
      [30, 0.1], // cooldown (remaining: 10-5=5)
      [35, 0.1], // cooldown (remaining: 5-5=0) -> cooldown expires -> searching
      [40, 0.1], // searching
    ]);
    const { states, zones } = simulateDetectionFlow(entries, threshold, cooldownFrames);

    expect(states.get(0)).toBe("searching");
    expect(states.get(5)).toBe("match");
    expect(states.get(10)).toBe("hysteresis");
    expect(states.get(15)).toBe("hysteresis");
    expect(states.get(20)).toBe("cooldown");
    expect(states.get(25)).toBe("cooldown");
    expect(states.get(30)).toBe("cooldown");
    expect(states.get(35)).toBe("searching");
    expect(states.get(40)).toBe("searching");

    // Two zones: hysteresis [5, 20] and cooldown [20, 35]
    expect(zones).toHaveLength(2);
    expect(zones[0]).toEqual({ startIdx: 5, endIdx: 20, type: "hysteresis" });
    expect(zones[1]).toEqual({ startIdx: 20, endIdx: 35, type: "cooldown" });
  });

  it("keeps hysteresis open as a trailing zone when score stays high", () => {
    const entries = makeEntries([
      [0, 0.2],  // searching
      [5, 0.9],  // match
      [10, 0.85], // hysteresis
      [15, 0.9],  // hysteresis
    ]);
    const { states, zones } = simulateDetectionFlow(entries, threshold, cooldownFrames);

    expect(states.get(0)).toBe("searching");
    expect(states.get(5)).toBe("match");
    expect(states.get(10)).toBe("hysteresis");
    expect(states.get(15)).toBe("hysteresis");

    // Trailing hysteresis zone
    expect(zones).toHaveLength(1);
    expect(zones[0]).toEqual({ startIdx: 5, endIdx: 15, type: "hysteresis" });
  });

  it("handles two separate matches with cooldown between them", () => {
    // First match, drop, cooldown, then second match
    const entries = makeEntries([
      [0, 0.9],  // match
      [5, 0.3],  // hysteresis exits -> cooldown
      [10, 0.1], // cooldown (15-5=10)
      [15, 0.1], // cooldown (10-5=5)
      [20, 0.1], // cooldown expires (5-5=0) -> searching
      [25, 0.9], // match (second match)
      [30, 0.3], // hysteresis exits -> cooldown
      [35, 0.1], // cooldown
      [40, 0.1], // cooldown
      [45, 0.1], // cooldown expires -> searching
    ]);
    const { states, zones } = simulateDetectionFlow(entries, threshold, cooldownFrames);

    expect(states.get(0)).toBe("match");
    expect(states.get(5)).toBe("cooldown");
    expect(states.get(20)).toBe("searching");
    expect(states.get(25)).toBe("match");
    expect(states.get(30)).toBe("cooldown");
    expect(states.get(45)).toBe("searching");

    // 4 zones: hyst1, cool1, hyst2, cool2
    expect(zones).toHaveLength(4);
    expect(zones[0].type).toBe("hysteresis");
    expect(zones[1].type).toBe("cooldown");
    expect(zones[2].type).toBe("hysteresis");
    expect(zones[3].type).toBe("cooldown");
  });

  it("transitions from expired cooldown into immediate match when score is above threshold", () => {
    const entries = makeEntries([
      [0, 0.9],  // match
      [5, 0.3],  // hysteresis exits -> cooldown
      [10, 0.1], // cooldown (15-5=10)
      [15, 0.1], // cooldown (10-5=5)
      [20, 0.9], // cooldown expires (5-5=0) -> score >= threshold -> match
      [25, 0.3], // hysteresis exits -> cooldown
    ]);
    const { states, zones } = simulateDetectionFlow(entries, threshold, cooldownFrames);

    expect(states.get(20)).toBe("match");
    expect(states.get(25)).toBe("cooldown");

    // Zones: hyst [0,5], cool [5,20], hyst [20,25], trailing cool
    expect(zones).toHaveLength(4);
    expect(zones[0]).toEqual({ startIdx: 0, endIdx: 5, type: "hysteresis" });
    expect(zones[1]).toEqual({ startIdx: 5, endIdx: 20, type: "cooldown" });
    expect(zones[2]).toEqual({ startIdx: 20, endIdx: 25, type: "hysteresis" });
    expect(zones[3]).toEqual({ startIdx: 25, endIdx: 25, type: "cooldown" });
  });

  it("returns empty states and no zones for empty entries", () => {
    const { states, zones } = simulateDetectionFlow([], threshold, cooldownFrames);
    expect(states.size).toBe(0);
    expect(zones).toHaveLength(0);
  });

  it("stays in hysteresis when score equals the exit threshold exactly", () => {
    // hysteresisExit = 0.8 * 0.7 = 0.56
    const exitThreshold = threshold * HYSTERESIS_FACTOR; // 0.56
    const entries = makeEntries([
      [0, 0.9],           // match
      [5, exitThreshold], // exactly at exit threshold -> stays in hysteresis
      [10, exitThreshold], // still at exit threshold -> stays in hysteresis
      [15, exitThreshold - 0.01], // just below -> exits hysteresis
    ]);
    const { states } = simulateDetectionFlow(entries, threshold, cooldownFrames);

    expect(states.get(0)).toBe("match");
    expect(states.get(5)).toBe("hysteresis");
    expect(states.get(10)).toBe("hysteresis");
    expect(states.get(15)).toBe("cooldown");
  });

  it("exits hysteresis when score drops below the exit threshold", () => {
    // hysteresisExit = 0.8 * 0.7 = 0.56
    const justBelow = threshold * HYSTERESIS_FACTOR - 0.001;
    const entries = makeEntries([
      [0, 0.9],      // match
      [5, justBelow], // below exit threshold -> cooldown
    ]);
    const { states, zones } = simulateDetectionFlow(entries, threshold, cooldownFrames);

    expect(states.get(0)).toBe("match");
    expect(states.get(5)).toBe("cooldown");
    expect(zones[0]).toEqual({ startIdx: 0, endIdx: 5, type: "hysteresis" });
  });

  it("handles a single entry above threshold with trailing hysteresis zone", () => {
    const entries = makeEntries([[0, 0.9]]);
    const { states, zones } = simulateDetectionFlow(entries, threshold, cooldownFrames);

    expect(states.get(0)).toBe("match");
    expect(zones).toHaveLength(1);
    expect(zones[0]).toEqual({ startIdx: 0, endIdx: 0, type: "hysteresis" });
  });

  it("produces a trailing cooldown zone when cooldown has not expired", () => {
    const entries = makeEntries([
      [0, 0.9], // match
      [5, 0.3], // hysteresis exits -> cooldown
      [10, 0.1], // still in cooldown
    ]);
    const { states, zones } = simulateDetectionFlow(entries, threshold, cooldownFrames);

    expect(states.get(5)).toBe("cooldown");
    expect(states.get(10)).toBe("cooldown");

    // Trailing cooldown zone
    const lastZone = zones[zones.length - 1];
    expect(lastZone).toEqual({ startIdx: 5, endIdx: 10, type: "cooldown" });
  });
});
