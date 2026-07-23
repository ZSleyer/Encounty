/**
 * matchStateMachine.test.ts: Unit tests for the pure per-category match
 * state machine, driven entirely with virtual time via the `now` parameter.
 */
import { describe, expect, it } from "vitest";
import {
  applyNoiseFloor,
  type MatchStateSettings,
  newCategoryState,
  NOISE_FLOOR,
  updateMatchState,
} from "./matchStateMachine";

const SETTINGS: MatchStateSettings = {
  precision: 0.6,
  hysteresisFactor: 0.7,
  consecutiveHits: 3,
  cooldownSec: 5,
};

describe("applyNoiseFloor", () => {
  it("maps scores at or below the floor to zero", () => {
    expect(applyNoiseFloor(0)).toBe(0);
    expect(applyNoiseFloor(NOISE_FLOOR)).toBe(0);
  });

  it("remaps scores above the floor linearly up to 1", () => {
    const mid = NOISE_FLOOR + (1 - NOISE_FLOOR) / 2;
    expect(applyNoiseFloor(mid)).toBeCloseTo(0.5);
    expect(applyNoiseFloor(1)).toBeCloseTo(1);
  });
});

describe("updateMatchState phase 3 (normal detection)", () => {
  it("confirms a match after the required consecutive hits", () => {
    const state = newCategoryState();
    updateMatchState(state, 0.7, SETTINGS, 0);
    updateMatchState(state, 0.7, SETTINGS, 10);
    expect(state.inHysteresis).toBe(false);
    updateMatchState(state, 0.7, SETTINGS, 20);
    expect(state.inHysteresis).toBe(true);
    // Counters reset on confirmation
    expect(state.consecutiveCount).toBe(0);
    expect(state.missCount).toBe(0);
  });

  it("tolerates a single below-threshold frame between hits", () => {
    const state = newCategoryState();
    updateMatchState(state, 0.7, SETTINGS, 0);
    updateMatchState(state, 0.7, SETTINGS, 10);
    updateMatchState(state, 0.1, SETTINGS, 20); // single miss, tolerated
    updateMatchState(state, 0.7, SETTINGS, 30);
    expect(state.inHysteresis).toBe(true);
  });

  it("resets the streak on a second miss", () => {
    const state = newCategoryState();
    updateMatchState(state, 0.7, SETTINGS, 0);
    updateMatchState(state, 0.1, SETTINGS, 10); // first miss, tolerated
    updateMatchState(state, 0.1, SETTINGS, 20); // second miss, reset
    updateMatchState(state, 0.7, SETTINGS, 30);
    updateMatchState(state, 0.7, SETTINGS, 40);
    expect(state.inHysteresis).toBe(false);
    updateMatchState(state, 0.7, SETTINGS, 50);
    expect(state.inHysteresis).toBe(true);
  });
});

describe("updateMatchState phase 1 (hysteresis)", () => {
  /** Advance a fresh state into the hysteresis phase. */
  function confirmedState() {
    const state = newCategoryState();
    for (let i = 0; i < SETTINGS.consecutiveHits; i++) {
      updateMatchState(state, 0.9, SETTINGS, i * 10);
    }
    expect(state.inHysteresis).toBe(true);
    return state;
  }

  it("stays in hysteresis while the score is above the exit threshold", () => {
    const state = confirmedState();
    // Exit threshold is 0.6 * 0.7 = 0.42
    updateMatchState(state, 0.5, SETTINGS, 100);
    expect(state.inHysteresis).toBe(true);
    expect(state.inCooldown).toBe(false);
  });

  it("exits to cooldown when the score drops, capturing now and cooldownSec", () => {
    const state = confirmedState();
    updateMatchState(state, 0.3, SETTINGS, 1234);
    expect(state.inHysteresis).toBe(false);
    expect(state.inCooldown).toBe(true);
    expect(state.cooldownStartedAt).toBe(1234);
    expect(state.cooldownSec).toBe(SETTINGS.cooldownSec);
  });

  it("honors hysteresisExitOverride true despite a high score", () => {
    const state = confirmedState();
    updateMatchState(state, 0.9, SETTINGS, 100, true);
    expect(state.inHysteresis).toBe(false);
    expect(state.inCooldown).toBe(true);
  });

  it("honors hysteresisExitOverride false despite a low score", () => {
    const state = confirmedState();
    updateMatchState(state, 0.0, SETTINGS, 100, false);
    expect(state.inHysteresis).toBe(true);
    expect(state.inCooldown).toBe(false);
  });
});

describe("updateMatchState phase 2 (cooldown)", () => {
  /** Advance a fresh state into the cooldown phase starting at t=1000. */
  function coolingState() {
    const state = newCategoryState();
    for (let i = 0; i < SETTINGS.consecutiveHits; i++) {
      updateMatchState(state, 0.9, SETTINGS, i * 10);
    }
    updateMatchState(state, 0.0, SETTINGS, 1000);
    expect(state.inCooldown).toBe(true);
    return state;
  }

  it("stays in cooldown until the timer elapses, ignoring high scores", () => {
    const state = coolingState();
    updateMatchState(state, 0.9, SETTINGS, 1000 + SETTINGS.cooldownSec * 1000 - 1);
    expect(state.inCooldown).toBe(true);
    expect(state.consecutiveCount).toBe(0);
  });

  it("returns to normal detection once the timer elapses", () => {
    const state = coolingState();
    updateMatchState(state, 0.0, SETTINGS, 1000 + SETTINGS.cooldownSec * 1000);
    expect(state.inCooldown).toBe(false);
    // Next frames count toward a new confirmation again
    const base = 1000 + SETTINGS.cooldownSec * 1000;
    updateMatchState(state, 0.9, SETTINGS, base + 10);
    updateMatchState(state, 0.9, SETTINGS, base + 20);
    updateMatchState(state, 0.9, SETTINGS, base + 30);
    expect(state.inHysteresis).toBe(true);
  });
});

describe("long visible encounter with a score dip (Chaneira pattern)", () => {
  /**
   * Feeds a score timeline through the state machine and counts hysteresis
   * entries, i.e. confirmed encounters, exactly like the full-video scan.
   */
  function countEncounters(
    timeline: Array<{ t: number; score: number; regionStable?: boolean }>,
    settings: MatchStateSettings,
  ): number {
    const state = newCategoryState();
    let encounters = 0;
    for (const s of timeline) {
      const wasInHysteresis = state.inHysteresis;
      const override = s.regionStable === undefined ? undefined : !s.regionStable;
      updateMatchState(state, s.score, settings, s.t, override);
      if (state.inHysteresis && !wasInHysteresis) encounters++;
    }
    return timeline.length ? encounters : 0;
  }

  const FAST = { ...SETTINGS, consecutiveHits: 1 };

  /**
   * One encounter that stays on screen far longer than the cooldown, with a
   * multi-frame score dip in the middle (compression noise, camera pan).
   * Sampled at 200ms like the full-video scan.
   */
  function dipTimeline(): Array<{ t: number; score: number }> {
    const timeline: Array<{ t: number; score: number }> = [];
    for (let t = 0; t <= 16_000; t += 200) {
      // Dip below the hysteresis exit threshold from 6.0s to 6.6s, well
      // after the 5s cooldown can elapse; high score everywhere else.
      const inDip = t >= 6000 && t <= 6600;
      timeline.push({ t, score: inDip ? 0.1 : 0.9 });
    }
    return timeline;
  }

  it("documents the known limit: score-based exit double counts across a deep dip", () => {
    // Known limitation, pinned on purpose: with a purely score-based
    // hysteresis exit, the dip ends the hysteresis, the cooldown elapses
    // while the encounter is still on screen, and the still-high score
    // confirms a second time. Region-based hysteresis (below) is the
    // designed answer for sources that behave like this.
    expect(countEncounters(dipTimeline(), FAST)).toBe(2);
  });

  it("region-based hysteresis exit bridges the dip and counts once", () => {
    // Same timeline, but the matched region stays visually stable for the
    // whole time the encounter is on screen (including the score dip), so
    // the region-delta override keeps the state machine in hysteresis and
    // no second confirmation happens.
    const timeline = dipTimeline().map((s) => ({ ...s, regionStable: true }));
    expect(countEncounters(timeline, FAST)).toBe(1);
  });
});
