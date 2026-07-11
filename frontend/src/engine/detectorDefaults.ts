/**
 * detectorDefaults.ts — Hardcoded fallback values for per-template detection
 * settings (precision, hysteresis, cooldown, consecutive hits, adaptive
 * polling). These apply whenever a template carries no explicit value of its
 * own (e.g. a brand-new template before the user or the stability check sets
 * one). Shared by the detection engine and the settings UI so the two never
 * drift apart.
 */

/** Default NCC match threshold (0.0-1.0). */
export const DEFAULT_PRECISION = 0.55;
/** Default hysteresis exit-threshold multiplier (0.0-1.0). */
export const DEFAULT_HYSTERESIS_FACTOR = 0.7;
/** Default number of consecutive matching frames required before counting. */
export const DEFAULT_CONSECUTIVE_HITS = 1;
/** Default minimum seconds between counts. */
export const DEFAULT_COOLDOWN_SEC = 5;
/** Default base adaptive-polling interval in ms. */
export const DEFAULT_POLL_MS = 200;
/** Default fastest adaptive-polling interval in ms. */
export const MIN_POLL_MS = 50;
/** Default slowest adaptive-polling interval in ms. */
export const MAX_POLL_MS = 2000;
/** Default hysteresis exit mode: legacy score-based exit ("region" is opt-in for 3D games). */
export const DEFAULT_HYSTERESIS_MODE = "score" as const;
