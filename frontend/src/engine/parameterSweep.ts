/**
 * parameterSweep.ts: Simulation-based parameter sweep for template calibration.
 *
 * The analytic stability recommendation (templateStability.ts) derives one
 * threshold from percentiles. This module instead replays the batch-test score
 * timeline through the real runtime state machine (matchStateMachine.ts) for a
 * grid of parameter combinations and picks the combination that confirms the
 * match window exactly once, never confirms outside it, and does so with the
 * largest safety margin at the lowest CPU cost.
 *
 * Scale note: batch-test samples carry RAW hybrid scores while the runtime
 * compares NOISE-FLOORED scores against precision. The sweep therefore maps
 * both the sample scores and the stats-derived bounds through applyNoiseFloor
 * before building the grid, so the recommended precision and hysteresis live
 * on the adjusted scale that the runtime actually uses.
 *
 * All functions are pure; time enters only through virtual clocks, except for
 * createSweepRunner which reads performance.now() to honor its step budget.
 */

import { applyNoiseFloor, newCategoryState, updateMatchState, type MatchStateSettings } from "./matchStateMachine";
import { DEFAULT_COOLDOWN_SEC } from "./detectorDefaults";
import { MIN_SAMPLES, recommendPolling, type StabilitySample, type StabilityStats } from "./templateStability";

// --- Types ---------------------------------------------------------------------

/** One parameter combination evaluated by the sweep. */
export interface SweepCombo {
  precision: number;
  hysteresisFactor: number;
  consecutiveHits: number;
  pollMs: number;
}

/** Winning combination plus the quality metrics that selected it. */
export interface SweepResult {
  /** Recommended precision on the noise-floor adjusted scale. */
  precision: number;
  hysteresisFactor: number;
  consecutiveHits: number;
  /** Winning base poll interval, clamped into [minPollMs, maxPollMs]. */
  pollIntervalMs: number;
  minPollMs: number;
  maxPollMs: number;
  /** Number of simulated polling phases with exactly one in-window confirm. */
  cleanPhases: number;
  totalPhases: number;
  /** True when every simulated phase was clean. */
  perfect: boolean;
  /** min(adjusted matchP10 - precision, precision - adjusted noiseP90). */
  robustnessMargin: number;
  /** Worst confirm latency across phases (ms from match-window start). */
  worstLatencyMs: number;
}

/** Inputs for a sweep run. */
export interface SweepInput {
  samples: StabilitySample[];
  stats: StabilityStats;
  /** Measured per-frame scoring cost in ms (drives the polling bounds). */
  avgScoreMs: number;
  cooldownSec?: number;
  hardwareConcurrency?: number;
}

/** Score timeline in typed arrays, ordered by frame index. */
export interface SweepTimeline {
  /** Sample timestamps in ms, frameIndex * 1000/60 (60fps replay buffer). */
  timesMs: Float64Array;
  /** Noise-floor adjusted scores, the scale the runtime compares against. */
  adjusted: Float64Array;
  frameIndex: Int32Array;
}

/** Parameter grid plus the polling bounds it was built for. */
export interface SweepGrid {
  combos: SweepCombo[];
  minPollMs: number;
  maxPollMs: number;
}

/** Outcome of simulating one polling phase. */
export interface PhaseOutcome {
  insideConfirms: number;
  outsideConfirms: number;
  /** Latency of the first in-window confirm (Infinity when none). */
  latencyMs: number;
  /** Exactly one confirm inside the match window and none outside. */
  clean: boolean;
}

/** Outcome of simulating one combo across all polling phases. */
export interface ComboOutcome {
  phases: PhaseOutcome[];
  cleanPhases: number;
  totalPhases: number;
  worstLatencyMs: number;
}

/** Incremental sweep executor for budgeted UI-friendly runs. */
export interface SweepRunner {
  /** Process combos until budgetMs elapsed or done; true when finished. */
  step(budgetMs: number): boolean;
  /** Fraction of the grid processed so far (0..1). */
  progress(): number;
  /** Winning result, valid (non-null) only after step() returned true. */
  result(): SweepResult | null;
}

// --- Constants -----------------------------------------------------------------

/** Milliseconds per replay-buffer frame (~60fps capture). */
const FRAME_MS = 1000 / 60;

/** Precision grid step on the adjusted scale. */
const PRECISION_STEP = 0.025;

/** Bounds for precision candidates, mirroring the detector settings slider. */
const MIN_PRECISION = 0.2;
const MAX_PRECISION = 0.95;

/** Hysteresis-factor grid, mirroring the detector settings slider. */
const MIN_HYSTERESIS = 0.5;
const MAX_HYSTERESIS = 0.95;
const HYSTERESIS_STEP = 0.05;

/** Candidate base poll intervals, filtered by the hardware recommendation. */
const POLL_CANDIDATES = [50, 100, 200, 400, 800];

/** Polling bounds fallback when no scoring cost was measured. */
const FALLBACK_MIN_POLL_MS = 50;
const FALLBACK_MAX_POLL_MS = 2000;

/** Runtime cooldown ticker interval mirrored by the simulation clock. */
const COOLDOWN_TICK_MS = 100;

/** Default poll-phase offsets as fractions of the poll interval. */
const DEFAULT_PHASE_OFFSETS = [0, 0.25, 0.5, 0.75];

// --- Helpers -------------------------------------------------------------------

/** Clamp v into [min, max]. */
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Round to 3 decimal places to keep grid values tidy and deterministic. */
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

// --- Timeline and grid ----------------------------------------------------------

/**
 * Build the simulation timeline from batch-test samples.
 *
 * Samples are ordered by frame index; timestamps assume the ~60fps replay
 * buffer, and scores are mapped through the runtime noise floor.
 */
export function buildTimeline(samples: StabilitySample[]): SweepTimeline {
  const ordered = [...samples].sort((a, b) => a.frameIndex - b.frameIndex);
  const n = ordered.length;
  const timesMs = new Float64Array(n);
  const adjusted = new Float64Array(n);
  const frameIndex = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    timesMs[i] = ordered[i].frameIndex * FRAME_MS;
    adjusted[i] = applyNoiseFloor(ordered[i].overallScore);
    frameIndex[i] = ordered[i].frameIndex;
  }
  return { timesMs, adjusted, frameIndex };
}

/** Build the precision candidate list on the adjusted scale. */
function precisionCandidates(stats: StabilityStats): number[] {
  const adjNoiseP90 = applyNoiseFloor(stats.noiseP90);
  const adjMatchMedian = applyNoiseFloor(stats.matchMedian);
  const rawStart = adjNoiseP90 + 0.05;
  const rawEnd = adjMatchMedian - 0.01;
  const start = clamp(rawStart, MIN_PRECISION, MAX_PRECISION);
  const end = clamp(rawEnd, MIN_PRECISION, MAX_PRECISION);
  if (rawStart > rawEnd || start > end) {
    // Distributions overlap: a stepped range is meaningless, probe the midpoint.
    return [round3(clamp((adjNoiseP90 + adjMatchMedian) / 2, MIN_PRECISION, MAX_PRECISION))];
  }
  const candidates: number[] = [];
  for (let i = 0; ; i++) {
    const p = start + i * PRECISION_STEP;
    if (p > end + 1e-9) break;
    candidates.push(round3(p));
  }
  return candidates;
}

/**
 * Build the full parameter grid for a sweep.
 *
 * The poll candidates reuse the hardware-aware recommendPolling bounds so the
 * sweep never proposes an interval the detector settings validator rejects.
 */
export function buildSweepGrid(
  stats: StabilityStats,
  avgScoreMs: number,
  hardwareConcurrency?: number,
): SweepGrid {
  const polling = recommendPolling(stats, avgScoreMs, hardwareConcurrency);
  const minPollMs = polling?.minPollMs ?? FALLBACK_MIN_POLL_MS;
  const maxPollMs = polling?.maxPollMs ?? FALLBACK_MAX_POLL_MS;
  let polls = POLL_CANDIDATES.filter((p) => p >= minPollMs);
  if (polls.length === 0) polls = [minPollMs];

  const precisions = precisionCandidates(stats);
  const hysteresisSteps = Math.round((MAX_HYSTERESIS - MIN_HYSTERESIS) / HYSTERESIS_STEP);

  const combos: SweepCombo[] = [];
  for (const precision of precisions) {
    for (let h = 0; h <= hysteresisSteps; h++) {
      const hysteresisFactor = round3(MIN_HYSTERESIS + h * HYSTERESIS_STEP);
      for (let consecutiveHits = 1; consecutiveHits <= 3; consecutiveHits++) {
        for (const pollMs of polls) {
          combos.push({ precision, hysteresisFactor, consecutiveHits, pollMs });
        }
      }
    }
  }
  return { combos, minPollMs, maxPollMs };
}

// --- Simulation ------------------------------------------------------------------

/**
 * Replay the timeline through the runtime state machine for one combo.
 *
 * Each phase offsets the virtual polling clock by a fraction of the poll
 * interval, because at runtime the loop starts at an arbitrary phase relative
 * to the match window. Ticks map to the nearest sample by time; a tick that
 * lands on the same sample as the previous tick skips the state update,
 * mirroring the runtime video.currentTime dedupe (fast polling must not count
 * one frame as two consecutive hits). While the state is in cooldown the
 * clock advances by the runtime's 100ms cooldown ticker instead of pollMs.
 */
export function simulateCombo(
  timeline: SweepTimeline,
  combo: SweepCombo,
  windowStartFrame: number,
  windowEndFrame: number,
  cooldownSec: number,
  phaseOffsets: number[] = DEFAULT_PHASE_OFFSETS,
): ComboOutcome {
  const n = timeline.timesMs.length;
  const lastTimeMs = timeline.timesMs[n - 1];
  const windowStartTime = windowStartFrame * FRAME_MS;
  const settings: MatchStateSettings = {
    precision: combo.precision,
    hysteresisFactor: combo.hysteresisFactor,
    consecutiveHits: combo.consecutiveHits,
    cooldownSec,
  };

  const phases: PhaseOutcome[] = [];
  for (const offset of phaseOffsets) {
    const state = newCategoryState();
    let insideConfirms = 0;
    let outsideConfirms = 0;
    let latencyMs = Number.POSITIVE_INFINITY;
    let prevSampleIdx = -1;
    let sampleIdx = 0;
    let t = timeline.timesMs[0] + offset * combo.pollMs;

    while (t <= lastTimeMs) {
      // Ticks are monotonic, so the nearest sample only ever moves forward.
      while (sampleIdx + 1 < n && (timeline.timesMs[sampleIdx] + timeline.timesMs[sampleIdx + 1]) / 2 <= t) {
        sampleIdx++;
      }
      if (sampleIdx !== prevSampleIdx) {
        prevSampleIdx = sampleIdx;
        const wasInHysteresis = state.inHysteresis;
        updateMatchState(state, timeline.adjusted[sampleIdx], settings, t);
        if (!wasInHysteresis && state.inHysteresis) {
          const frame = timeline.frameIndex[sampleIdx];
          if (frame >= windowStartFrame && frame <= windowEndFrame) {
            insideConfirms++;
            if (!Number.isFinite(latencyMs)) latencyMs = t - windowStartTime;
          } else {
            outsideConfirms++;
          }
        }
      }
      t += state.inCooldown ? Math.min(combo.pollMs, COOLDOWN_TICK_MS) : combo.pollMs;
    }

    phases.push({
      insideConfirms,
      outsideConfirms,
      latencyMs,
      clean: insideConfirms === 1 && outsideConfirms === 0,
    });
  }

  let cleanPhases = 0;
  let worstLatencyMs = 0;
  for (const phase of phases) {
    if (phase.clean) cleanPhases++;
    worstLatencyMs = Math.max(worstLatencyMs, phase.latencyMs);
  }
  return { phases, cleanPhases, totalPhases: phases.length, worstLatencyMs };
}

// --- Sweep execution --------------------------------------------------------------

/** Combo plus the metrics needed by the selection objective. */
interface EvaluatedCombo {
  combo: SweepCombo;
  cleanPhases: number;
  totalPhases: number;
  robustnessMargin: number;
  worstLatencyMs: number;
}

/**
 * Strict lexicographic objective: more clean phases, then larger robustness
 * margin, then larger poll interval (less CPU), then smaller worst latency.
 * Returns true only when a is strictly better, so the first combo seen wins
 * remaining ties and the sweep stays deterministic.
 */
function isStrictlyBetter(a: EvaluatedCombo, b: EvaluatedCombo): boolean {
  if (a.cleanPhases !== b.cleanPhases) return a.cleanPhases > b.cleanPhases;
  if (a.robustnessMargin !== b.robustnessMargin) return a.robustnessMargin > b.robustnessMargin;
  if (a.combo.pollMs !== b.combo.pollMs) return a.combo.pollMs > b.combo.pollMs;
  return a.worstLatencyMs < b.worstLatencyMs;
}

/**
 * Create an incremental sweep runner.
 *
 * step(budgetMs) evaluates grid combos until the time budget elapses or the
 * grid is exhausted, letting the caller interleave the sweep with UI work.
 * runParameterSweep drains a runner in one call, so both entry points share
 * the exact same evaluation and objective logic.
 */
export function createSweepRunner(input: SweepInput): SweepRunner {
  const { samples, stats } = input;
  if (stats == null || samples.length < MIN_SAMPLES) {
    // Not enough signal for a simulation; report an immediately finished,
    // empty run so callers need no separate validity check.
    return { step: () => true, progress: () => 1, result: () => null };
  }
  const cooldownSec = input.cooldownSec ?? DEFAULT_COOLDOWN_SEC;
  const timeline = buildTimeline(samples);
  const grid = buildSweepGrid(stats, input.avgScoreMs, input.hardwareConcurrency);
  const total = grid.combos.length;
  const adjMatchP10 = applyNoiseFloor(stats.matchP10);
  const adjNoiseP90 = applyNoiseFloor(stats.noiseP90);

  let cursor = 0;
  let best: EvaluatedCombo | null = null;
  let done = total === 0;

  const evaluate = (combo: SweepCombo): EvaluatedCombo => {
    const outcome = simulateCombo(timeline, combo, stats.matchStartFrame, stats.matchEndFrame, cooldownSec);
    return {
      combo,
      cleanPhases: outcome.cleanPhases,
      totalPhases: outcome.totalPhases,
      robustnessMargin: Math.min(adjMatchP10 - combo.precision, combo.precision - adjNoiseP90),
      worstLatencyMs: outcome.worstLatencyMs,
    };
  };

  return {
    step(budgetMs: number): boolean {
      if (done) return true;
      const startedAt = performance.now();
      // Always evaluate at least one combo so progress is guaranteed even
      // with a zero budget.
      do {
        const candidate = evaluate(grid.combos[cursor]);
        if (best === null || isStrictlyBetter(candidate, best)) best = candidate;
        cursor++;
      } while (cursor < total && performance.now() - startedAt < budgetMs);
      if (cursor >= total) done = true;
      return done;
    },
    progress(): number {
      if (total === 0) return 1;
      return done ? 1 : cursor / total;
    },
    result(): SweepResult | null {
      if (!done || best === null) return null;
      return {
        precision: best.combo.precision,
        hysteresisFactor: best.combo.hysteresisFactor,
        consecutiveHits: best.combo.consecutiveHits,
        // Clamp so the settings validator can never reject the recommendation.
        pollIntervalMs: clamp(best.combo.pollMs, grid.minPollMs, grid.maxPollMs),
        minPollMs: grid.minPollMs,
        maxPollMs: grid.maxPollMs,
        cleanPhases: best.cleanPhases,
        totalPhases: best.totalPhases,
        perfect: best.cleanPhases === best.totalPhases,
        robustnessMargin: best.robustnessMargin,
        worstLatencyMs: best.worstLatencyMs,
      };
    },
  };
}

/**
 * Run the full parameter sweep synchronously.
 *
 * Returns null when stats are missing or there are fewer samples than the
 * stability analysis minimum.
 */
export function runParameterSweep(input: SweepInput): SweepResult | null {
  const runner = createSweepRunner(input);
  while (!runner.step(Number.POSITIVE_INFINITY)) {
    // Drain the runner; an unlimited budget finishes in one step.
  }
  return runner.result();
}
