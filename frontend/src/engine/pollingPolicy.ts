/**
 * pollingPolicy.ts: The detection loop's adaptive polling policy as pure
 * functions, shared by DetectionLoop (runtime) and the scan simulator
 * (tests/dev tooling) so both always agree on when the next frame would be
 * scored.
 */

/** Fast tick interval during cooldown (no scoring, just timer updates). */
export const COOLDOWN_TICK_MS = 100;

/** Frame-delta below which a scene counts as static for polling purposes. */
export const DEFAULT_CHANGE_THRESHOLD = 0.01;

/**
 * Computes the next poll interval from the current score, the frame delta
 * and the template's precision: slow on static scenes, fast when the score
 * approaches the threshold, exponentially interpolated in between.
 */
export function computeNextInterval(
  score: number,
  delta: number,
  precision: number,
  min: number,
  max: number,
  changeThreshold: number = DEFAULT_CHANGE_THRESHOLD,
): number {
  // Static scene, slow down to max interval
  if (delta < changeThreshold) {
    return max;
  }

  // How close the score is to the threshold (0 = far, 1 = at/above threshold)
  const proximity = Math.min(score / Math.max(precision, 0.01), 1);

  // Exponential interpolation: fast when close to match, slow when far
  const t = proximity * proximity;
  const interval = max - t * (max - min);

  return Math.round(Math.max(min, Math.min(max, interval)));
}
