/**
 * scanSimulator.ts: Loop-faithful encounter counting over a pre-scored sample
 * timeline.
 *
 * The full-video scans (node quality suite and the dev equivalence modal)
 * used to feed every fixed-rate sample into the match state machine, which
 * over-samples compared to the real DetectionLoop: the loop polls adaptively
 * (up to maxPollMs on static scenes, cooldown as pure 100ms timer ticks
 * without scoring) and therefore never even sees many short score dips. This
 * simulator replays a densely sampled timeline through the exact runtime
 * policies (pollingPolicy + matchStateMachine) so scan results mirror what
 * the app would actually count.
 */

import { applyNoiseFloor, newCategoryState, updateMatchState } from "./matchStateMachine";
import { pixelDelta } from "./math";
import { MIN_POLL_MS, MAX_POLL_MS } from "./detectorDefaults";
import { COOLDOWN_TICK_MS, computeNextInterval, DEFAULT_CHANGE_THRESHOLD } from "./pollingPolicy";

/** One densely sampled, pre-scored video position. */
export interface ScanSample {
  /** Sample position in seconds. */
  time: number;
  /** Raw hybrid score at this position (not noise-floored). */
  score: number;
  /** Optional downsampled grayscale of the frame, used for frame deltas. */
  frameGray?: Float32Array;
}

/** Settings mirroring the state machine inputs of the runtime loop. */
export interface SimulatorSettings {
  precision: number;
  hysteresisFactor: number;
  consecutiveHits: number;
  cooldownSec: number;
  minPollMs?: number;
  maxPollMs?: number;
  changeThreshold?: number;
}

/** Result of one simulated scan. */
export interface SimulationResult {
  /** Confirmed encounters (hysteresis entries). */
  encounters: number;
  /** Number of samples the simulated loop actually scored. */
  polledSamples: number;
  /** Number of pure cooldown timer ticks. */
  cooldownTicks: number;
}

/**
 * Replays a sorted sample timeline through the runtime state machine using
 * the real adaptive polling policy: the virtual clock advances by the
 * computed poll interval, each poll scores the nearest sample, and cooldown
 * phases tick the timer without scoring, exactly like DetectionLoop.runLoop.
 *
 * `settings.precision` is expected on the noise-floor adjusted scale (the
 * scale updateMatchState compares against), like the runtime.
 */
export function simulateAdaptiveScan(
  samples: ScanSample[],
  settings: SimulatorSettings,
): SimulationResult {
  if (samples.length === 0) return { encounters: 0, polledSamples: 0, cooldownTicks: 0 };

  const minPoll = settings.minPollMs ?? MIN_POLL_MS;
  const maxPoll = settings.maxPollMs ?? MAX_POLL_MS;
  const changeThreshold = settings.changeThreshold ?? DEFAULT_CHANGE_THRESHOLD;
  const machineSettings = {
    precision: settings.precision,
    hysteresisFactor: settings.hysteresisFactor,
    consecutiveHits: settings.consecutiveHits,
    cooldownSec: settings.cooldownSec,
  };
  const zeroSettings = { precision: 0, hysteresisFactor: 0, consecutiveHits: 0, cooldownSec: 0 };

  const endMs = samples[samples.length - 1].time * 1000;
  const state = newCategoryState();
  let encounters = 0;
  let polledSamples = 0;
  let cooldownTicks = 0;
  let lastUsedGray: Float32Array | null = null;
  let cursor = 0;
  let nowMs = samples[0].time * 1000;

  while (nowMs <= endMs) {
    // Cooldown phase: the loop skips detection entirely and only advances
    // the timer at a fast tick (DetectionLoop.tickCooldownPhase).
    if (state.inCooldown) {
      updateMatchState(state, 0, zeroSettings, nowMs);
      cooldownTicks++;
      if (state.inCooldown) {
        nowMs += COOLDOWN_TICK_MS;
        continue;
      }
      // Timer elapsed on this tick; fall through and score the next poll.
    }

    // Score the sample nearest to the virtual clock (monotonic cursor).
    while (cursor + 1 < samples.length && samples[cursor + 1].time * 1000 <= nowMs) cursor++;
    const next = samples[Math.min(cursor + 1, samples.length - 1)];
    const cur = samples[cursor];
    const sample =
      Math.abs(next.time * 1000 - nowMs) < Math.abs(cur.time * 1000 - nowMs) ? next : cur;

    // Frame delta against the previously *scored* frame, like the runtime
    // detector's global frame delta. The first poll counts as full change.
    const delta = lastUsedGray && sample.frameGray
      ? pixelDelta(lastUsedGray, sample.frameGray)
      : 1;
    if (sample.frameGray) lastUsedGray = sample.frameGray;

    const adjusted = applyNoiseFloor(sample.score);
    const wasInHysteresis = state.inHysteresis;
    updateMatchState(state, adjusted, machineSettings, nowMs);
    if (state.inHysteresis && !wasInHysteresis) encounters++;
    polledSamples++;

    // Same interval decision as DetectionLoop.runDetection's tail.
    nowMs += state.inCooldown
      ? COOLDOWN_TICK_MS
      : computeNextInterval(adjusted, delta, settings.precision, minPoll, maxPoll, changeThreshold);
  }

  return { encounters, polledSamples, cooldownTicks };
}
