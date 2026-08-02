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

/**
 * Hunt methods whose encounter pool holds exactly one species, so no foreign
 * shiny can ever end a phase. Kept as a deny list: every method that is not
 * listed here is phaseable, which keeps future methods correct by default.
 */
export const NON_PHASING_METHODS: ReadonlySet<string> = new Set([
  "soft_reset",
  "masuda",
  "breeding",
  "dv_breeding",
  "picnic_breeding",
  "fossil",
  "colosseum_bonus_disc",
  "max_raid",
  "tera_raid",
]);

/**
 * Reports whether phases are possible with the given hunt method.
 * A missing method falls back to "encounter", the backend default.
 */
export function isPhasingMethod(huntType: string | null | undefined): boolean {
  return !NON_PHASING_METHODS.has(huntType || "encounter");
}
