/**
 * captureResolution.ts — Persistence + constraint helpers for the preferred
 * capture resolution.
 *
 * Kept in localStorage (not the synced backend DB) because the resolution is a
 * property of the physical capture device on this machine (e.g. an Elgato HD60X
 * negotiates 4:3 by default without an explicit constraint). A preference like
 * "prefer 1080p" must not roam across machines, mirroring captureSourceMemory.
 */

/** Supported capture resolution presets. "auto" applies no constraint. */
export type CaptureResolution = "auto" | "720" | "1080" | "1440";

const KEY = "encounty.captureResolution";
const DEFAULT: CaptureResolution = "1080";

const VALID: readonly CaptureResolution[] = ["auto", "720", "1080", "1440"];

/** Read the preferred capture resolution, falling back to the default. */
export function getCaptureResolution(): CaptureResolution {
  try {
    const raw = localStorage.getItem(KEY);
    return VALID.includes(raw as CaptureResolution) ? (raw as CaptureResolution) : DEFAULT;
  } catch {
    // localStorage disabled (private mode) — use the default.
    return DEFAULT;
  }
}

/** Persist the preferred capture resolution. Errors are swallowed silently. */
export function setCaptureResolution(r: CaptureResolution): void {
  try {
    localStorage.setItem(KEY, r);
  } catch {
    // Losing the preference is non-critical — the default applies next time.
  }
}

/**
 * Build width/height `ideal` constraints for the preferred resolution. Uses
 * `ideal` (not `exact`) so devices that cannot deliver it fall back gracefully
 * instead of throwing OverconstrainedError. Returns an empty object for "auto".
 */
export function resolutionConstraints(r: CaptureResolution = getCaptureResolution()): MediaTrackConstraints {
  switch (r) {
    case "720":
      return { width: { ideal: 1280 }, height: { ideal: 720 } };
    case "1080":
      return { width: { ideal: 1920 }, height: { ideal: 1080 } };
    case "1440":
      return { width: { ideal: 2560 }, height: { ideal: 1440 } };
    default:
      return {};
  }
}
