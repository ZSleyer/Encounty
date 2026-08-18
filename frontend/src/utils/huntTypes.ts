/**
 * huntTypes.ts — Game-based hunt method availability.
 * Uses game-group data from gameGroups.ts for per-game method availability.
 */

import { getMethodsForGame } from "./gameGroups";

/** Minimal hunt method descriptor returned by getAvailableHuntMethods. */
export interface HuntMethodInfo {
  key: string;
}

/**
 * Returns hunt methods available for the given game key.
 * If no game key is provided, returns only the universal methods.
 */
export function getAvailableHuntMethods(
  gameKey: string | null | undefined,
): HuntMethodInfo[] {
  if (!gameKey) return [{ key: "encounter" }, { key: "soft_reset" }];
  return getMethodsForGame(gameKey).map((key) => ({ key }));
}
