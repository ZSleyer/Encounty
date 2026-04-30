/**
 * captureSourceMemory.ts — Persistence helpers for the last-used capture source.
 *
 * We keep this in localStorage (not the backend DB) because the capture source
 * is tightly coupled to the local machine: source IDs like "screen:0" or a
 * camera deviceId are only meaningful on the device that produced them and
 * MUST NOT roam across machines via the sync'd backend state.
 *
 * Two scopes are stored:
 *   - per-pokemon: preferred when the user returns to the same hunt
 *   - global: fallback for fresh pokemon so the first pick is pre-primed
 */

/** Stored shape of a previously used capture source. */
export interface RememberedCaptureSource {
  type: "browser_display" | "browser_camera";
  /** Electron source ID ("screen:0", "window:<handle>") or camera deviceId. */
  sourceId: string;
  /** Human-readable label as shown to the user when the source was picked. */
  sourceLabel: string;
  /** Display identifier for screens only — unused for windows / cameras. */
  displayId?: string;
  /** ISO timestamp written at save time, purely informational. */
  persistedAt: string;
}

const GLOBAL_KEY = "encounty.lastCaptureSource.global";
const PER_POKEMON_PREFIX = "encounty.lastCaptureSource.";

/** Type guard that accepts only well-formed remembered-source payloads. */
function isValidRemembered(value: unknown): value is RememberedCaptureSource {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.type !== "browser_display" && v.type !== "browser_camera") return false;
  if (typeof v.sourceId !== "string" || v.sourceId.length === 0) return false;
  if (typeof v.sourceLabel !== "string") return false;
  if (typeof v.persistedAt !== "string") return false;
  if (v.displayId !== undefined && typeof v.displayId !== "string") return false;
  return true;
}

/** Safely read+parse a JSON localStorage value, returning null on any error. */
function readJson(key: string): RememberedCaptureSource | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidRemembered(parsed) ? parsed : null;
  } catch {
    // JSON parse error, localStorage disabled, quota exceeded, ...
    return null;
  }
}

/** Read the per-pokemon remembered source, or null when absent / corrupted. */
export function getLastSource(pokemonId: string): RememberedCaptureSource | null {
  if (!pokemonId) return null;
  return readJson(PER_POKEMON_PREFIX + pokemonId);
}

/** Read the global fallback remembered source, or null when absent / corrupted. */
export function getGlobalLastSource(): RememberedCaptureSource | null {
  return readJson(GLOBAL_KEY);
}

/**
 * Persist a remembered source both under the per-pokemon key and the global
 * fallback. Errors (private mode, quota exceeded) are swallowed silently so a
 * failing write never blocks capture startup.
 */
export function saveLastSource(
  pokemonId: string,
  source: Omit<RememberedCaptureSource, "persistedAt">,
): void {
  const entry: RememberedCaptureSource = {
    ...source,
    persistedAt: new Date().toISOString(),
  };
  const payload = JSON.stringify(entry);
  try {
    if (pokemonId) localStorage.setItem(PER_POKEMON_PREFIX + pokemonId, payload);
    localStorage.setItem(GLOBAL_KEY, payload);
  } catch {
    // localStorage may throw in private mode or when quota is exceeded.
    // Losing the memory is non-critical — the user simply re-picks next time.
  }
}
