/**
 * matchStateMachine.ts, the pure per-category match state machine shared by
 * detection loops.
 *
 * Holds the three-phase confirmation logic (consecutive hits, hysteresis,
 * cooldown) plus the noise-floor score remap. Everything here is free of
 * side effects and wall-clock access: time enters exclusively through the
 * `now` parameter, which keeps the machine trivially testable with virtual
 * time and reusable outside DetectionLoop.
 */
import { DEFAULT_COOLDOWN_SEC } from "./detectorDefaults";

/**
 * Per-category match state.
 *
 * Each counting category (see MatchedRegion.category) advances its own
 * consecutive-hit, hysteresis and cooldown phases independently, so two
 * gameplays captured in one video source can each confirm a match without
 * blocking one another. The default category (empty-string key) reproduces
 * the legacy single-counter behavior.
 */
export interface CategoryState {
  consecutiveCount: number;
  missCount: number;
  inHysteresis: boolean;
  inCooldown: boolean;
  cooldownStartedAt: number;
  /** Cooldown duration (seconds) captured from the winning template when this category entered cooldown. */
  cooldownSec: number;
  /** Smoothed score (EMA) used for live confidence display. */
  smoothedScore: number;
}

/** Create a fresh, idle category state. */
export function newCategoryState(): CategoryState {
  return {
    consecutiveCount: 0,
    missCount: 0,
    inHysteresis: false,
    inCooldown: false,
    cooldownStartedAt: 0,
    cooldownSec: DEFAULT_COOLDOWN_SEC,
    smoothedScore: 0,
  };
}

/** Scores below this floor are mapped to zero to suppress metric noise. */
export const NOISE_FLOOR = 0.15;

/**
 * Suppress metric noise by remapping low scores to zero.
 *
 * The hybrid metric fusion (SSIM+Pearson+MAD+Histogram) produces
 * 0.15-0.30 even for unrelated frames due to coarse histogram bins and
 * MAD normalization. This linear remap eliminates that visual noise.
 */
export function applyNoiseFloor(raw: number): number {
  if (raw <= NOISE_FLOOR) return 0;
  return (raw - NOISE_FLOOR) / (1 - NOISE_FLOOR);
}

/** Detection thresholds consumed by updateMatchState, resolved per template. */
export interface MatchStateSettings {
  /** Score threshold a frame must reach to count as a hit. */
  precision: number;
  /** Fraction of precision the score must drop below to leave hysteresis. */
  hysteresisFactor: number;
  /** Number of consecutive hits required to confirm a match. */
  consecutiveHits: number;
  /** Cooldown duration in seconds after hysteresis ends. */
  cooldownSec: number;
}

/**
 * Update hysteresis and consecutive-hit state after scoring a frame.
 *
 * After a confirmed match, hysteresis blocks re-triggering until the
 * score drops well below the threshold (70% of precision).
 *
 * Uses a "near-consecutive" approach: a single below-threshold frame
 * between match frames is tolerated (miss counter) because short
 * encounter animations can produce intermittent low scores between
 * high-score frames at typical polling rates.
 *
 * @param state - Mutable per-category state, advanced in place.
 * @param adjusted - Noise-floor adjusted score of the current frame.
 * @param settings - Per-template thresholds resolved for this category.
 * @param now - Current timestamp in milliseconds (e.g. Date.now()), injected
 *   so tests can drive the cooldown timer with virtual time.
 * @param hysteresisExitOverride - Optional externally computed exit decision
 *   for Phase 1, replacing the score-based check when provided.
 */
export function updateMatchState(
  state: CategoryState,
  adjusted: number,
  settings: MatchStateSettings,
  now: number,
  hysteresisExitOverride?: boolean,
): void {
  // Phase 1: Hysteresis, wait for score to drop after a confirmed match
  if (state.inHysteresis) {
    // The override exists for region-based hysteresis, where a pixel-delta
    // check on the matched region replaces the score-based exit condition.
    const belowThreshold = hysteresisExitOverride ?? (adjusted < settings.precision * settings.hysteresisFactor);
    if (belowThreshold) {
      // Score dropped, transition to cooldown phase. The cooldown duration
      // is captured from the winning template at this exact moment, so a
      // category's cooldown always matches the template that confirmed it.
      state.inHysteresis = false;
      state.inCooldown = true;
      state.cooldownStartedAt = now;
      state.cooldownSec = settings.cooldownSec;
    }
    state.consecutiveCount = 0;
    state.missCount = 0;
    return;
  }

  // Phase 2: Cooldown, wait for timer to elapse after hysteresis ended
  if (state.inCooldown) {
    const cooldownElapsed = now - state.cooldownStartedAt >= state.cooldownSec * 1000;
    if (cooldownElapsed) {
      state.inCooldown = false;
    }
    state.consecutiveCount = 0;
    state.missCount = 0;
    return;
  }

  // Phase 3: Normal detection, count consecutive matches
  if (adjusted >= settings.precision) {
    state.consecutiveCount += 1;
    state.missCount = 0;
  } else if (state.consecutiveCount > 0 && state.missCount < 1) {
    // Tolerate a single below-threshold frame between match frames
    state.missCount += 1;
  } else {
    state.consecutiveCount = 0;
    state.missCount = 0;
  }

  if (state.consecutiveCount >= settings.consecutiveHits) {
    state.consecutiveCount = 0;
    state.missCount = 0;
    state.inHysteresis = true;
  }
}
