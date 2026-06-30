/**
 * captureResolution.ts — Capture resolution presets, constraint builder, and
 * per-device lookup.
 *
 * The preferred resolution is stored PER camera deviceId in the backend DB
 * (broadcast via AppState.settings.capture_resolutions) because it depends on
 * the physical capture card: an Elgato HD60X negotiates 4:3 by default unless
 * an explicit width/height constraint is requested.
 */

/** Supported capture resolution presets. "auto" applies no constraint. */
export type CaptureResolution = "auto" | "720" | "1080" | "1440";

/** Selectable presets in display order, for the picker UI. */
export const RESOLUTION_OPTIONS: readonly CaptureResolution[] = ["auto", "720", "1080", "1440"];

/** Fallback when a device has no stored preference. Forces 16:9 on capture cards. */
export const DEFAULT_RESOLUTION: CaptureResolution = "1080";

/**
 * Resolve the effective resolution for a camera deviceId from the per-device
 * map (typically `appState.settings.capture_resolutions`), defaulting when the
 * device has no stored entry.
 */
export function effectiveResolution(
  map: Record<string, CaptureResolution> | undefined,
  deviceId: string | undefined,
): CaptureResolution {
  if (!deviceId) return DEFAULT_RESOLUTION;
  return map?.[deviceId] ?? DEFAULT_RESOLUTION;
}

/**
 * Build width/height `ideal` constraints for a resolution preset. Uses `ideal`
 * (not `exact`) so devices that cannot deliver it fall back gracefully instead
 * of throwing OverconstrainedError. Returns an empty object for "auto".
 */
export function resolutionConstraints(r: CaptureResolution = "auto"): MediaTrackConstraints {
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
