/** Hunt method metadata with generation availability for filtering by selected game. */
export interface HuntMethodInfo {
  key: string;
  /** Minimum game generation where this method is available (inclusive). */
  minGen: number;
  /** Maximum game generation where this method is available (inclusive, null = no upper limit). */
  maxGen: number | null;
}

/**
 * All supported shiny hunting methods with their generation availability.
 * Order determines display order in the UI.
 */
export const HUNT_METHODS: HuntMethodInfo[] = [
  { key: "encounter",          minGen: 1, maxGen: null },
  { key: "soft_reset",         minGen: 1, maxGen: null },
  { key: "masuda",             minGen: 4, maxGen: null },
  { key: "fossil",             minGen: 1, maxGen: null },
  { key: "gift",               minGen: 1, maxGen: null },
  { key: "radar",              minGen: 4, maxGen: 6 },   // DPPt, XY, BDSP
  { key: "horde",              minGen: 6, maxGen: 6 },   // XY, ORAS
  { key: "sos",                minGen: 7, maxGen: 7 },   // Sun/Moon, USUM
  { key: "chain_fishing",      minGen: 6, maxGen: 6 },   // XY, ORAS
  { key: "friend_safari",      minGen: 6, maxGen: 6 },   // XY
  { key: "dexnav",             minGen: 6, maxGen: 6 },   // ORAS
  { key: "ultra_wormhole",     minGen: 7, maxGen: 7 },   // USUM
  { key: "catch_combo",        minGen: 7, maxGen: 7 },   // Let's Go
  { key: "dynamax_adventure",  minGen: 8, maxGen: 8 },   // SwSh Crown Tundra
  { key: "max_raid",           minGen: 8, maxGen: 8 },   // SwSh
  { key: "outbreak",           minGen: 8, maxGen: 9 },   // PLA, SV
  { key: "sandwich",           minGen: 9, maxGen: 9 },   // SV
  { key: "tera_raid",          minGen: 9, maxGen: 9 },   // SV
];

/** Returns hunt methods available for the given game generation, or all if no generation specified. */
export function getAvailableHuntMethods(generation: number | null | undefined): HuntMethodInfo[] {
  if (generation == null) return HUNT_METHODS;
  return HUNT_METHODS.filter(
    (m) => generation >= m.minGen && (m.maxGen === null || generation <= m.maxGen),
  );
}
