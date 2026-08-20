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
const PER_GROUP_PREFIX = "encounty.groupCaptureSource.";

/** Machine-local source preference for a group. Wayland display capture has no reusable source ID. */
export interface GroupCaptureSource {
  type: "browser_display" | "browser_camera";
  sourceId?: string;
  sourceLabel: string;
}

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

/** Read a group's machine-local source preference. */
export function getGroupSource(groupId: string): GroupCaptureSource | null {
  if (!groupId) return null;
  try {
    const value = JSON.parse(localStorage.getItem(PER_GROUP_PREFIX + groupId) ?? "null") as Record<string, unknown> | null;
    if (!value || (value.type !== "browser_display" && value.type !== "browser_camera")) return null;
    if (typeof value.sourceLabel !== "string") return null;
    if (value.sourceId !== undefined && typeof value.sourceId !== "string") return null;
    return value as unknown as GroupCaptureSource;
  } catch {
    return null;
  }
}

/** Persist a group's source preference on this machine only. */
export function saveGroupSource(groupId: string, source: GroupCaptureSource): void {
  try {
    localStorage.setItem(PER_GROUP_PREFIX + groupId, JSON.stringify(source));
  } catch {
    /* Losing the preference is non-critical. */
  }
}

export function clearGroupSource(groupId: string): void {
  try {
    localStorage.removeItem(PER_GROUP_PREFIX + groupId);
  } catch {
    /* ignore unavailable storage */
  }
}
