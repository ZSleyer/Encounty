/**
 * Tests for the detection flow simulation used in the template test step.
 *
 * simulateDetectionFlow delegates all state transitions to the shared
 * matchStateMachine, so these tests exercise the exported function directly
 * instead of mirroring a private implementation. Scores are specified on the
 * noise-floor adjusted scale (the scale the runtime compares against) and
 * converted back to raw batch scores, because the simulation applies the same
 * noise floor as the detection loop.
 */
import { describe, it, expect } from "vitest";
import { simulateDetectionFlow } from "./TemplateEditor";
import { NOISE_FLOOR, type MatchStateSettings } from "../../engine/matchStateMachine";

// --- Test helpers ---

/** Convert an intended noise-floor adjusted score into the raw batch score. */
function raw(adjusted: number): number {
  return adjusted <= 0 ? 0 : adjusted * (1 - NOISE_FLOOR) + NOISE_FLOOR;
}

/** Build entries from [frameIndex, adjustedScore] tuples. */
function makeEntries(scores: [number, number][]): [number, { overallScore: number }][] {
  return scores.map(([idx, adjusted]) => [idx, { overallScore: raw(adjusted) }]);
}

/** Base settings: one hit confirms, cooldown spans three sampled entries. */
function makeSettings(overrides?: Partial<MatchStateSettings>): MatchStateSettings {
  // Entries are sampled every 5th frame of a 60fps buffer (83.33ms apart), so
  // the cooldown elapses three entries after the hysteresis exit. 0.24s sits
  // safely below the exact three-entry spacing (250ms) so float rounding of
  // the virtual clock cannot flip the boundary tick either way.
  return { precision: 0.8, hysteresisFactor: 0.7, consecutiveHits: 1, cooldownSec: 0.24, ...overrides };
}

// --- Tests ---

describe("simulateDetectionFlow", () => {
  it("marks all entries as searching when all scores are below threshold", () => {
    const entries = makeEntries([
      [0, 0.1], [5, 0.3], [10, 0.5], [15, 0.7],
    ]);
    const { states, zones } = simulateDetectionFlow(entries, makeSettings());

    expect(zones).toHaveLength(0);
    for (const [, state] of states) {
      expect(state).toBe("searching");
    }
  });

  it("transitions through match -> hysteresis -> cooldown -> searching on a single spike", () => {
    // precision 0.8, hysteresis exit at 0.8 * 0.7 = 0.56 (adjusted scale)
    const entries = makeEntries([
      [0, 0.2],  // searching
      [5, 0.9],  // hit confirms (consecutiveHits = 1) -> match
      [10, 0.7], // hysteresis (>= 0.56)
      [15, 0.6], // hysteresis (>= 0.56)
      [20, 0.4], // hysteresis exits (< 0.56) -> cooldown starts
      [25, 0.1], // cooldown (~83ms elapsed)
      [30, 0.1], // cooldown (~167ms elapsed)
      [35, 0.1], // cooldown elapsed (250ms) -> searching
      [40, 0.1], // searching
    ]);
    const { states, zones } = simulateDetectionFlow(entries, makeSettings());

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
      [0, 0.2],   // searching
      [5, 0.9],   // match
      [10, 0.85], // hysteresis
      [15, 0.9],  // hysteresis
    ]);
    const { states, zones } = simulateDetectionFlow(entries, makeSettings());

    expect(states.get(0)).toBe("searching");
    expect(states.get(5)).toBe("match");
    expect(states.get(10)).toBe("hysteresis");
    expect(states.get(15)).toBe("hysteresis");

    // Trailing hysteresis zone
    expect(zones).toHaveLength(1);
    expect(zones[0]).toEqual({ startIdx: 5, endIdx: 15, type: "hysteresis" });
  });

  it("handles two separate matches with cooldown between them", () => {
    const entries = makeEntries([
      [0, 0.9],  // match
      [5, 0.3],  // hysteresis exits -> cooldown
      [10, 0.1], // cooldown
      [15, 0.1], // cooldown
      [20, 0.1], // cooldown expires -> searching
      [25, 0.9], // match (second match)
      [30, 0.3], // hysteresis exits -> cooldown
      [35, 0.1], // cooldown
      [40, 0.1], // cooldown
      [45, 0.1], // cooldown expires -> searching
    ]);
    const { states, zones } = simulateDetectionFlow(entries, makeSettings());

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

  it("skips hit counting on the cooldown expiry frame like the runtime machine", () => {
    const entries = makeEntries([
      [0, 0.9],  // match
      [5, 0.3],  // hysteresis exits -> cooldown
      [10, 0.1], // cooldown
      [15, 0.1], // cooldown
      [20, 0.9], // cooldown expires: the machine returns without counting hits
      [25, 0.9], // first counted hit after cooldown -> match
    ]);
    const { states, zones } = simulateDetectionFlow(entries, makeSettings());

    expect(states.get(20)).toBe("searching");
    expect(states.get(25)).toBe("match");

    // Zones: hyst [0,5], cool [5,20], trailing hyst [25,25]
    expect(zones).toHaveLength(3);
    expect(zones[0]).toEqual({ startIdx: 0, endIdx: 5, type: "hysteresis" });
    expect(zones[1]).toEqual({ startIdx: 5, endIdx: 20, type: "cooldown" });
    expect(zones[2]).toEqual({ startIdx: 25, endIdx: 25, type: "hysteresis" });
  });

  it("requires the configured number of consecutive hits before confirming", () => {
    const entries = makeEntries([
      [0, 0.2],  // searching
      [5, 0.9],  // first hit, not confirmed yet
      [10, 0.9], // second hit -> confirmed -> match
      [15, 0.4], // hysteresis exits -> cooldown
    ]);
    const { states, zones } = simulateDetectionFlow(entries, makeSettings({ consecutiveHits: 2 }));

    expect(states.get(5)).toBe("searching");
    expect(states.get(10)).toBe("match");
    expect(states.get(15)).toBe("cooldown");

    expect(zones).toHaveLength(2);
    expect(zones[0]).toEqual({ startIdx: 10, endIdx: 15, type: "hysteresis" });
    expect(zones[1]).toEqual({ startIdx: 15, endIdx: 15, type: "cooldown" });
  });

  it("tolerates a single dip between hits (near-consecutive counting)", () => {
    const entries = makeEntries([
      [0, 0.9], // first hit
      [5, 0.5], // single below-threshold frame is tolerated
      [10, 0.9], // second hit -> confirmed -> match
    ]);
    const { states } = simulateDetectionFlow(entries, makeSettings({ consecutiveHits: 2 }));

    expect(states.get(0)).toBe("searching");
    expect(states.get(5)).toBe("searching");
    expect(states.get(10)).toBe("match");
  });

  it("returns empty states and no zones for empty entries", () => {
    const { states, zones } = simulateDetectionFlow([], makeSettings());
    expect(states.size).toBe(0);
    expect(zones).toHaveLength(0);
  });

  it("stays in hysteresis just above the exit threshold and exits just below it", () => {
    // hysteresisExit = 0.8 * 0.7 = 0.56 on the adjusted scale
    const entries = makeEntries([
      [0, 0.9],   // match
      [5, 0.57],  // just above exit threshold -> stays in hysteresis
      [10, 0.55], // just below -> exits hysteresis
    ]);
    const { states, zones } = simulateDetectionFlow(entries, makeSettings());

    expect(states.get(0)).toBe("match");
    expect(states.get(5)).toBe("hysteresis");
    expect(states.get(10)).toBe("cooldown");
    expect(zones[0]).toEqual({ startIdx: 0, endIdx: 10, type: "hysteresis" });
  });

  it("handles a single entry above threshold with trailing hysteresis zone", () => {
    const entries = makeEntries([[0, 0.9]]);
    const { states, zones } = simulateDetectionFlow(entries, makeSettings());

    expect(states.get(0)).toBe("match");
    expect(zones).toHaveLength(1);
    expect(zones[0]).toEqual({ startIdx: 0, endIdx: 0, type: "hysteresis" });
  });

  it("produces a trailing cooldown zone when cooldown has not expired", () => {
    const entries = makeEntries([
      [0, 0.9],  // match
      [5, 0.3],  // hysteresis exits -> cooldown
      [10, 0.1], // still in cooldown
    ]);
    const { states, zones } = simulateDetectionFlow(entries, makeSettings());

    expect(states.get(5)).toBe("cooldown");
    expect(states.get(10)).toBe("cooldown");

    // Trailing cooldown zone
    const lastZone = zones[zones.length - 1];
    expect(lastZone).toEqual({ startIdx: 5, endIdx: 10, type: "cooldown" });
  });
});
