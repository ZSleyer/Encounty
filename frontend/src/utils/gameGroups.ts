/**
 * gameGroups.ts — Maps game keys to game groups with method availability and odds.
 * Each game group defines which hunt methods are available, their base shiny odds,
 * and optional Shiny Charm odds. This replaces the old generation-range-based filtering.
 */

/** Odds as a [numerator, denominator] tuple. */
export type OddsTuple = [number, number];

/** Base and optional Shiny Charm odds for one hunt method in a game group. */
export interface MethodOdds {
  base: OddsTuple;
  charm?: OddsTuple;
}

/** A game group bundles one or more game keys sharing the same method/odds set. */
export interface GameGroup {
  id: string;
  gameKeys: string[];
  generation: number;
  baseOdds: OddsTuple;
  charmOdds?: OddsTuple;
  methods: Record<string, MethodOdds>;
}

// --- Helper: shorthand for "Base Odds" (inherits group base) ---
const B = (g: GameGroup): MethodOdds => ({ base: g.baseOdds });
const BC = (g: GameGroup): MethodOdds => ({
  base: g.baseOdds,
  charm: g.charmOdds,
});

// --- Game Group Definitions ---

const gen1Rby: GameGroup = {
  id: "gen1_rby",
  gameKeys: ["pokemon-red", "pokemon-blue", "pokemon-yellow"],
  generation: 1,
  baseOdds: [1, 8192],
  methods: {},
};
gen1Rby.methods = {
  fishing: B(gen1Rby),
  safari_zone: B(gen1Rby),
  dv_method: B(gen1Rby),
  time_capsule_exploit: B(gen1Rby),
};

const gen2Gsc: GameGroup = {
  id: "gen2_gsc",
  gameKeys: ["pokemon-gold", "pokemon-silver", "pokemon-crystal"],
  generation: 2,
  baseOdds: [1, 8192],
  methods: {},
};
gen2Gsc.methods = {
  odd_egg: { base: [1, 7] },
  breeding: B(gen2Gsc),
  dv_breeding: { base: [1, 64] },
  fishing: B(gen2Gsc),
  fossil: B(gen2Gsc),
  headbutt: B(gen2Gsc),
  roaming_reset: B(gen2Gsc),
  swarm: B(gen2Gsc),
  coin_case_glitch: B(gen2Gsc),
};

const gen3Rs: GameGroup = {
  id: "gen3_rs",
  gameKeys: ["pokemon-ruby", "pokemon-sapphire"],
  generation: 3,
  baseOdds: [1, 8192],
  methods: {},
};
gen3Rs.methods = {
  breeding: B(gen3Rs),
  fishing: B(gen3Rs),
  fossil: B(gen3Rs),
  roaming_reset: B(gen3Rs),
  rock_smash: B(gen3Rs),
  swarm: B(gen3Rs),
};

const gen3Frlg: GameGroup = {
  id: "gen3_frlg",
  gameKeys: ["pokemon-firered", "pokemon-leafgreen"],
  generation: 3,
  baseOdds: [1, 8192],
  methods: {},
};
gen3Frlg.methods = {
  breeding: B(gen3Frlg),
  fishing: B(gen3Frlg),
  fossil: B(gen3Frlg),
  game_corner: B(gen3Frlg),
  safari_zone: B(gen3Frlg),
  roaming_reset: B(gen3Frlg),
  rock_smash: B(gen3Frlg),
  pomeg_glitch: B(gen3Frlg),
};

const gen3E: GameGroup = {
  id: "gen3_e",
  gameKeys: ["pokemon-emerald"],
  generation: 3,
  baseOdds: [1, 8192],
  methods: {},
};
gen3E.methods = {
  breeding: B(gen3E),
  fishing: B(gen3E),
  fossil: B(gen3E),
  safari_zone: B(gen3E),
  swarm: B(gen3E),
  roaming_reset: B(gen3E),
  rock_smash: B(gen3E),
  run_away: B(gen3E),
  battle_pyramid_glitch: B(gen3E),
  battle_tower_glitch: B(gen3E),
};

const gen3Gc: GameGroup = {
  id: "gen3_gc",
  gameKeys: ["pokemon-colosseum", "pokemon-xd"],
  generation: 3,
  baseOdds: [1, 8192],
  methods: {},
};

const gen4Dpp: GameGroup = {
  id: "gen4_dpp",
  gameKeys: ["pokemon-diamond", "pokemon-pearl", "pokemon-platinum"],
  generation: 4,
  baseOdds: [1, 8192],
  methods: {},
};
gen4Dpp.methods = {
  cute_charm_glitch: { base: [1, 5] },
  radar: { base: [1, 200] },
  masuda: { base: [1, 1638] },
  breeding: B(gen4Dpp),
  fishing: B(gen4Dpp),
  fossil: B(gen4Dpp),
  great_marsh: B(gen4Dpp),
  roaming_reset: B(gen4Dpp),
  honey_tree: B(gen4Dpp),
  swarm: B(gen4Dpp),
  dongle_method: B(gen4Dpp),
};

const gen4Hgss: GameGroup = {
  id: "gen4_hgss",
  gameKeys: ["pokemon-heartgold", "pokemon-soulsilver"],
  generation: 4,
  baseOdds: [1, 8192],
  methods: {},
};
gen4Hgss.methods = {
  cute_charm_glitch: { base: [1, 5] },
  masuda: { base: [1, 1638] },
  breeding: B(gen4Hgss),
  fishing: B(gen4Hgss),
  fossil: B(gen4Hgss),
  game_corner: B(gen4Hgss),
  safari_zone: B(gen4Hgss),
  roaming_reset: B(gen4Hgss),
  headbutt: B(gen4Hgss),
  rock_smash: B(gen4Hgss),
  run_away: B(gen4Hgss),
  swarm: B(gen4Hgss),
  dongle_method: B(gen4Hgss),
};

const gen5Bw: GameGroup = {
  id: "gen5_bw",
  gameKeys: ["pokemon-black", "pokemon-white"],
  generation: 5,
  baseOdds: [1, 8192],
  methods: {},
};
gen5Bw.methods = {
  masuda: { base: [1, 1365] },
  breeding: B(gen5Bw),
  fishing: B(gen5Bw),
  roaming_reset: B(gen5Bw),
  swarm: B(gen5Bw),
};

const gen5Bw2: GameGroup = {
  id: "gen5_bw2",
  gameKeys: [
    "pokemon-black-2",
    "pokemon-white-2",
    "pokemon-black2",
    "pokemon-white2",
  ],
  generation: 5,
  baseOdds: [1, 8192],
  charmOdds: [1, 2730],
  methods: {},
};
gen5Bw2.methods = {
  masuda: { base: [1, 1365], charm: [1, 1024] },
  lucky_power: { base: [1, 4096], charm: [1, 2048] },
  breeding: BC(gen5Bw2),
  fishing: BC(gen5Bw2),
  roaming_reset: BC(gen5Bw2),
  swarm: BC(gen5Bw2),
};

const gen6Xy: GameGroup = {
  id: "gen6_xy",
  gameKeys: ["pokemon-x", "pokemon-y"],
  generation: 6,
  baseOdds: [1, 4096],
  charmOdds: [1, 1365],
  methods: {},
};
gen6Xy.methods = {
  chain_fishing: { base: [1, 100], charm: [1, 96] },
  radar: { base: [1, 99], charm: [1, 99] },
  masuda: { base: [1, 682], charm: [1, 512] },
  friend_safari: { base: [1, 819], charm: [1, 585] },
  fossil: { base: gen6Xy.baseOdds },
  horde: { base: [5, 4096], charm: [5, 1365] },
  breeding: { base: gen6Xy.baseOdds, charm: [1, 1365] },
  fishing: { base: gen6Xy.baseOdds, charm: [1, 1365] },
  rock_smash: { base: gen6Xy.baseOdds, charm: [1, 1365] },
};

const gen6Oras: GameGroup = {
  id: "gen6_oras",
  gameKeys: [
    "pokemon-omega-ruby",
    "pokemon-alpha-sapphire",
    "pokemon-oras-alpha",
    "pokemon-oras-omega",
  ],
  generation: 6,
  baseOdds: [1, 4096],
  charmOdds: [1, 1365],
  methods: {},
};
gen6Oras.methods = {
  dexnav: { base: [1, 42], charm: [1, 36] },
  chain_fishing: { base: [1, 100], charm: [1, 96] },
  masuda: { base: [1, 682], charm: [1, 512] },
  horde: { base: [5, 4096], charm: [5, 1365] },
  breeding: { base: gen6Oras.baseOdds, charm: [1, 1365] },
  fishing: { base: gen6Oras.baseOdds, charm: [1, 1365] },
  soaring: { base: gen6Oras.baseOdds, charm: [1, 1365] },
  rock_smash: { base: gen6Oras.baseOdds, charm: [1, 1365] },
};

const gen7Sm: GameGroup = {
  id: "gen7_sm",
  gameKeys: ["pokemon-sun", "pokemon-moon"],
  generation: 7,
  baseOdds: [1, 4096],
  charmOdds: [1, 1365],
  methods: {},
};
gen7Sm.methods = {
  sos: { base: [1, 315], charm: [1, 273] },
  poke_pelago: { base: gen7Sm.baseOdds },
  masuda: { base: [1, 682], charm: [1, 512] },
  breeding: { base: gen7Sm.baseOdds, charm: [1, 1365] },
  fishing: { base: gen7Sm.baseOdds, charm: [1, 1365] },
  island_scan: { base: gen7Sm.baseOdds, charm: [1, 1365] },
};

const gen7Usum: GameGroup = {
  id: "gen7_usum",
  gameKeys: [
    "pokemon-ultra-sun",
    "pokemon-ultra-moon",
    "pokemon-ultrasun",
    "pokemon-ultramoon",
  ],
  generation: 7,
  baseOdds: [1, 4096],
  charmOdds: [1, 1365],
  methods: {},
};
gen7Usum.methods = {
  ultra_wormhole: { base: [1, 3], charm: [1, 3] },
  sos: { base: [1, 315], charm: [1, 273] },
  poke_pelago: { base: gen7Usum.baseOdds },
  masuda: { base: [1, 682], charm: [1, 512] },
  breeding: { base: gen7Usum.baseOdds, charm: [1, 1365] },
  fishing: { base: gen7Usum.baseOdds, charm: [1, 1365] },
  island_scan: { base: gen7Usum.baseOdds, charm: [1, 1365] },
};

const gen7Lgpe: GameGroup = {
  id: "gen7_lgpe",
  gameKeys: [
    "pokemon-lets-go-pikachu",
    "pokemon-lets-go-eevee",
    "pokemon-letsgopikachu",
    "pokemon-letsgoeevee",
  ],
  generation: 7,
  baseOdds: [1, 4096],
  charmOdds: [1, 1365],
  methods: {},
};
gen7Lgpe.methods = {
  catch_combo: { base: [1, 315], charm: [1, 273] },
  fishing: { base: gen7Lgpe.baseOdds, charm: [1, 1365] },
};

const gen8Swsh: GameGroup = {
  id: "gen8_swsh",
  gameKeys: ["pokemon-sword", "pokemon-shield"],
  generation: 8,
  baseOdds: [1, 4096],
  charmOdds: [1, 1365],
  methods: {},
};
gen8Swsh.methods = {
  dynamax_adventure: { base: [1, 300], charm: [1, 100] },
  battle_method: { base: gen8Swsh.baseOdds, charm: [1, 1365] },
  masuda: { base: [1, 682], charm: [1, 512] },
  chain_fishing: { base: [1, 1529], charm: [1, 876] },
  breeding: { base: gen8Swsh.baseOdds, charm: [1, 1365] },
  fishing: { base: gen8Swsh.baseOdds, charm: [1, 1365] },
  max_raid: { base: gen8Swsh.baseOdds },
  curry_hunting: { base: gen8Swsh.baseOdds },
};

const gen8Bdsp: GameGroup = {
  id: "gen8_bdsp",
  gameKeys: [
    "pokemon-bd",
    "pokemon-sp",
    "pokemon-brilliant-diamond",
    "pokemon-shining-pearl",
  ],
  generation: 8,
  baseOdds: [1, 4096],
  charmOdds: [1, 2048],
  methods: {},
};
gen8Bdsp.methods = {
  radar: { base: [1, 99], charm: [1, 99] },
  masuda: { base: [1, 682], charm: [1, 512] },
  grand_underground: { base: [1, 2048], charm: [1, 2048] },
  breeding: { base: gen8Bdsp.baseOdds, charm: [1, 2048] },
  fishing: { base: gen8Bdsp.baseOdds },
  fossil: { base: gen8Bdsp.baseOdds },
  great_marsh: { base: gen8Bdsp.baseOdds },
  honey_tree: { base: gen8Bdsp.baseOdds },
  swarm: { base: gen8Bdsp.baseOdds },
};

const gen8Pla: GameGroup = {
  id: "gen8_pla",
  gameKeys: ["pokemon-legends", "pokemon-legends-arceus"],
  generation: 8,
  baseOdds: [1, 4096],
  charmOdds: [1, 1024],
  methods: {},
};
gen8Pla.methods = {
  outbreak: { base: [1, 158], charm: [1, 142] },
  outbreak_lv10: { base: [1, 152], charm: [1, 137] },
  outbreak_perfect: { base: [1, 141], charm: [1, 128] },
  massive_outbreak: { base: [1, 315], charm: [1, 256] },
  massive_outbreak_lv10: { base: [1, 293], charm: [1, 241] },
  massive_outbreak_perfect: { base: [1, 256], charm: [1, 216] },
  encounter_lv10: { base: [1, 2048], charm: [1, 819] },
  encounter_perfect: { base: [1, 1024], charm: [1, 585] },
};

const gen9Sv: GameGroup = {
  id: "gen9_sv",
  gameKeys: ["pokemon-scarlet", "pokemon-violet"],
  generation: 9,
  baseOdds: [1, 4096],
  charmOdds: [1, 1365],
  methods: {},
};
gen9Sv.methods = {
  outbreak: { base: [1, 1365], charm: [1, 819] },
  masuda: { base: [1, 682], charm: [1, 512] },
  sandwich_sp1: { base: [1, 2048], charm: [1, 1024] },
  sandwich_sp2: { base: [1, 1365], charm: [1, 819] },
  sandwich_sp3: { base: [1, 1024], charm: [1, 683] },
  picnic_breeding: { base: [1, 4096], charm: [1, 2048] },
  tera_raid: { base: [1, 4103], charm: [1, 4103] },
};

const gen9Za: GameGroup = {
  id: "gen9_za",
  gameKeys: ["pokemon-legends-za"],
  generation: 9,
  baseOdds: [1, 4096],
  charmOdds: [1, 1024],
  methods: {},
};
gen9Za.methods = {
  fossil: { base: gen9Za.baseOdds },
  sparkling_power_lv1: { base: [1, 2048], charm: [1, 819] },
  sparkling_power_lv2: { base: [1, 1365], charm: [1, 683] },
  sparkling_power_lv3: { base: [1, 1024], charm: [1, 585] },
};

const gen10Ww: GameGroup = {
  id: "gen10_ww",
  gameKeys: ["pokemon-winds", "pokemon-waves"],
  generation: 10,
  baseOdds: [1, 4096],
  methods: {},
};

// --- All game groups ---

export const GAME_GROUPS: GameGroup[] = [
  gen1Rby,
  gen2Gsc,
  gen3Rs,
  gen3Frlg,
  gen3E,
  gen3Gc,
  gen4Dpp,
  gen4Hgss,
  gen5Bw,
  gen5Bw2,
  gen6Xy,
  gen6Oras,
  gen7Sm,
  gen7Usum,
  gen7Lgpe,
  gen8Swsh,
  gen8Bdsp,
  gen8Pla,
  gen9Sv,
  gen9Za,
  gen10Ww,
];

// --- Lookup map: game key → GameGroup ---

const GAME_KEY_TO_GROUP: Record<string, GameGroup> = {};
for (const group of GAME_GROUPS) {
  for (const key of group.gameKeys) {
    GAME_KEY_TO_GROUP[key] = group;
  }
}

// --- Legacy method aliases for backward compatibility ---

const LEGACY_METHOD_ALIASES: Record<string, string> = {
  sandwich: "sandwich_sp3",
};

// --- Exported helpers ---

/** Returns the game group for a given game key, or null if unknown. */
export function getGameGroup(gameKey: string): GameGroup | null {
  return GAME_KEY_TO_GROUP[gameKey] ?? null;
}

/**
 * Returns the hunt method keys available for a given game key.
 * Always includes "encounter" and "soft_reset" as universal methods.
 */
export function getMethodsForGame(gameKey: string): string[] {
  const group = GAME_KEY_TO_GROUP[gameKey];
  const universal = ["encounter", "soft_reset"];
  if (!group) return universal;
  return [...universal, ...Object.keys(group.methods)];
}

/**
 * Returns the shiny odds for a specific method in a specific game.
 * Falls back to the game group's base odds for unknown methods.
 */
export function getMethodOdds(
  gameKey: string,
  methodKey: string,
  hasCharm: boolean,
): OddsTuple {
  const group = GAME_KEY_TO_GROUP[gameKey];
  if (!group) return [1, 4096];

  const resolvedKey = LEGACY_METHOD_ALIASES[methodKey] ?? methodKey;

  // Universal base-odds methods
  if (
    resolvedKey === "encounter" ||
    resolvedKey === "soft_reset" ||
    resolvedKey === "gift"
  ) {
    if (hasCharm && group.charmOdds) return group.charmOdds;
    return group.baseOdds;
  }

  const methodOdds = group.methods[resolvedKey];
  if (!methodOdds) {
    // Unknown method — fall back to base odds
    if (hasCharm && group.charmOdds) return group.charmOdds;
    return group.baseOdds;
  }

  if (hasCharm && methodOdds.charm) return methodOdds.charm;
  return methodOdds.base;
}

/** Returns whether the given game supports a Shiny Charm. */
export function gameSupportsCharm(gameKey: string): boolean {
  const group = GAME_KEY_TO_GROUP[gameKey];
  return group?.charmOdds != null;
}

/** Formats an odds tuple as a display string like "1/4096" or "5/4096". */
export function formatOdds(odds: OddsTuple): string {
  return `${odds[0]}/${odds[1]}`;
}
