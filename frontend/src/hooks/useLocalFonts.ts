/**
 * useLocalFonts.ts: shared access to the fonts installed on the user's machine.
 *
 * The Local Font Access API needs a permission grant, so the result is kept in
 * a module-level cache and shared by every font picker on screen: one grant
 * fills all of them. Nothing is written to disk or to localStorage, the cache
 * dies with the page and the permission stays the browser's business.
 */
import { useCallback, useEffect, useState } from "react";
import { queryLocalFontFamilies, supportsLocalFonts } from "../utils/fonts";

/**
 * LocalFontStatus describes what the UI may say about the local families:
 * "idle" before a grant, "granted" with families, "empty" when the platform
 * reported none, "denied" when the user or the browser refused.
 */
export type LocalFontStatus = "idle" | "granted" | "empty" | "denied";

/** LocalFontsState is what a font picker needs to render the local group. */
export interface LocalFontsState {
  readonly families: readonly string[];
  /** False when the API is absent, in which case the UI must not offer it. */
  readonly supported: boolean;
  readonly status: LocalFontStatus;
  /** Must be called from a user gesture, the API requires activation. */
  readonly request: () => void;
}

let cachedFamilies: readonly string[] = [];
let cachedStatus: LocalFontStatus = "idle";
let pending = false;
const subscribers = new Set<() => void>();

function publish(families: readonly string[], status: LocalFontStatus) {
  cachedFamilies = families;
  cachedStatus = status;
  for (const notify of subscribers) notify();
}

/**
 * load queries the platform once and shares the outcome. A silent load runs on
 * mount without user activation: the API rejects in that case unless the
 * permission is already granted, and that rejection must stay invisible.
 */
async function load(silent: boolean): Promise<void> {
  if (pending) return;
  pending = true;
  try {
    const result = await queryLocalFontFamilies();
    if (result.status === "ok") {
      publish(result.families, result.families.length > 0 ? "granted" : "empty");
      return;
    }
    if (!silent) publish([], "denied");
  } finally {
    pending = false;
  }
}

/** resetLocalFontCache drops the shared result so the next mount re-queries. */
export function resetLocalFontCache(): void {
  cachedFamilies = [];
  cachedStatus = "idle";
  pending = false;
}

/**
 * useLocalFonts exposes the locally installed font families and a request
 * callback that asks for the permission. On an unsupported platform it returns
 * `supported: false` with an empty list and never calls the API.
 */
export function useLocalFonts(): LocalFontsState {
  const [snapshot, setSnapshot] = useState(() => ({
    families: cachedFamilies,
    status: cachedStatus,
  }));

  useEffect(() => {
    const sync = () => setSnapshot({ families: cachedFamilies, status: cachedStatus });
    subscribers.add(sync);
    sync();
    // Re-query on mount so an already granted permission fills the list without
    // another click. Without activation the call simply fails and stays quiet.
    if (cachedStatus === "idle") void load(true);
    return () => {
      subscribers.delete(sync);
    };
  }, []);

  const request = useCallback(() => {
    void load(false);
  }, []);

  return { ...snapshot, supported: supportsLocalFonts(), request };
}
