/**
 * huntTypes.ts — Hunt method registry and game-based availability filtering.
 * Uses game-group data from gameGroups.ts for per-game method availability.
 */

import { getMethodsForGame } from "./gameGroups";

/** Minimal hunt method descriptor returned by getAvailableHuntMethods. */
export interface HuntMethodInfo {
  key: string;
}

/** All known hunt method keys (used as a registry for localization and validation). */
export const ALL_HUNT_METHOD_KEYS: string[] = [
  // Universal
  "encounter",
  "soft_reset",
  // Breeding
  "breeding",
  "masuda",
  "dv_breeding",
  "odd_egg",
  "picnic_breeding",
  // Encounter variants
  "fishing",
  "safari_zone",
  "headbutt",
  "rock_smash",
  "roaming_reset",
  "swarm",
  "run_away",
  "soaring",
  "honey_tree",
  "great_marsh",
  "grand_underground",
  // Fossils & gifts
  "fossil",
  "gift",
  "game_corner",
  // Chaining methods
  "radar",
  "chain_fishing",
  "dexnav",
  "friend_safari",
  "horde",
  "sos",
  "catch_combo",
  "battle_method",
  // Special encounter methods
  "dynamax_adventure",
  "max_raid",
  "tera_raid",
  "ultra_wormhole",
  "poke_pelago",
  "island_scan",
  "dongle_method",
  "curry_hunting",
  "lucky_power",
  // Mass outbreaks
  "outbreak",
  "outbreak_lv10",
  "outbreak_perfect",
  "massive_outbreak",
  "massive_outbreak_lv10",
  "massive_outbreak_perfect",
  // PLA research variants
  "encounter_lv10",
  "encounter_perfect",
  // Sandwich / Sparkling Power
  "sandwich",
  "sandwich_sp1",
  "sandwich_sp2",
  "sandwich_sp3",
  "sparkling_power_lv1",
  "sparkling_power_lv2",
  "sparkling_power_lv3",
  // Gen 1-2 glitches
  "dv_method",
  "time_capsule_exploit",
  "coin_case_glitch",
  // Gen 3 glitches
  "pomeg_glitch",
  "battle_pyramid_glitch",
  "battle_tower_glitch",
  // Gen 4 glitches
  "cute_charm_glitch",
];

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
