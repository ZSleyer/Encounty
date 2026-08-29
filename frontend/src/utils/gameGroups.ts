/**
 * gameGroups.ts — Maps game keys to game groups with method availability and odds.
 * Each game group defines which hunt methods are available, their base shiny odds,
 * and optional Shiny Charm odds. This replaces the old generation-range-based filtering.
 */
import type { ShinyVariant } from "../types";

/** Odds as a [numerator, denominator] tuple. */
export type OddsTuple = [number, number];

/** Base and optional Shiny Charm odds for one hunt method in a game group. */
export interface MethodOdds {
  base: OddsTuple;
  charm?: OddsTuple;
  /** Shiny rolls the method itself grants, in roll-modelled groups (Gen 9). */
  rolls?: number;
  /** Shiny rolls the Shiny Charm adds on top of `rolls`. */
  charmRolls?: number;
  /** Flat shiny chance rolled before the shiny rolls (event distributions). */
  flatChance?: number;
  /** Whether Sparkling Power stacks on this method. Wild spawns only. */
  sparkling?: boolean;
}

/** A game group bundles one or more game keys sharing the same method/odds set. */
export interface GameGroup {
  id: string;
  gameKeys: string[];
  generation: number;
  baseOdds: OddsTuple;
  charmOdds?: OddsTuple;
  methods: Record<string, MethodOdds>;
  /** Universal methods offered for this group. Defaults to DEFAULT_UNIVERSAL_METHODS. */
  universalMethods?: string[];
}

/** Methods every game group offers unless it declares its own universalMethods. */
const DEFAULT_UNIVERSAL_METHODS = ["encounter", "soft_reset"];

// --- Helper: shorthand for "Base Odds" (inherits group base) ---
const B = (g: GameGroup): MethodOdds => ({ base: g.baseOdds });
const BC = (g: GameGroup): MethodOdds => ({
  base: g.baseOdds,
  charm: g.charmOdds,
});

// --- Helper: Gen 9 shiny rolls ---

/** Chance of a single Gen 9 shiny roll coming up short. */
const ROLL_MISS = 4095 / 4096;

/** Highest Sparkling Power level a sandwich can reach. */
const MAX_SPARKLING_POWER = 3;

/**
 * Converts a Gen 9 shiny roll count into a display odds tuple.
 * `flatChance` is the flat shiny chance an event distribution rolls before the
 * ordinary rolls. The result is floored, which is how every Gen 9 fraction in
 * this file has always been written (3 rolls read 1/1365, not 1/1366).
 */
function oddsFromRolls(rolls: number, flatChance = 0): OddsTuple {
  const p = flatChance + (1 - flatChance) * (1 - ROLL_MISS ** rolls);
  return [1, Math.floor(1 / p)];
}

/**
 * Builds a roll-modelled method declaration for a group whose Shiny Charm is
 * worth `charmRolls` extra rolls. Methods declared this way accept the
 * Sparkling Power modifier when they opt in through `sparkling`.
 */
const rollMethod =
  (charmRolls: number) =>
  (
    rolls: number,
    opts: { flat?: number; sparkling?: boolean } = {},
  ): MethodOdds => ({
    base: oddsFromRolls(rolls, opts.flat),
    charm: oddsFromRolls(rolls + charmRolls, opts.flat),
    rolls,
    charmRolls,
    flatChance: opts.flat,
    sparkling: opts.sparkling,
  });

// --- Game Group Definitions ---

const gen1Rby: GameGroup = {
  id: "gen1_rby",
  gameKeys: ["pokemon-red", "pokemon-blue", "pokemon-yellow"],
  generation: 1,
  baseOdds: [1, 8192],
  methods: {},
  // Grass, cave and Surf encounters in RBY run through the same routine, whose
  // encounter rate check correlates with the rolls the DVs come from, so they
  // can never produce a DV set that is Shiny in Gen 2. Safari Zone grass is no
  // exception. Fishing is, because the routine returns early on the fish flag,
  // and so are static encounters, which is what soft_reset covers.
  universalMethods: ["soft_reset"],
};
gen1Rby.methods = {
  fishing: B(gen1Rby),
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
  colosseum_bonus_disc: { base: [1, 7282] },
  pokemon_channel: B(gen3Rs),
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

const gen3Colosseum: GameGroup = {
  id: "gen3_colosseum",
  gameKeys: ["pokemon-colosseum"],
  generation: 3,
  baseOdds: [1, 8192],
  methods: {},
  // Colosseum has no wild Pokemon, and every non-Shadow Pokemon in it (the
  // starter Espeon/Umbreon, Duking's Plusle, the Mt. Battle Ho-Oh) is shiny
  // locked, so snagging Shadow Pokemon is the only shiny hunt there is.
  universalMethods: [],
};
gen3Colosseum.methods = {
  shadow_snag_colosseum: B(gen3Colosseum),
};

const gen3Xd: GameGroup = {
  id: "gen3_xd",
  gameKeys: ["pokemon-xd"],
  generation: 3,
  baseOdds: [1, 8192],
  methods: {},
  // XD has no wild Pokemon outside the Poke Spots, and every Shadow Pokemon in
  // it is shiny locked. The non-Shadow ones are not, but gift_xd covers both of
  // them (the starter Eevee and the Mt. Battle Johto starter), so the keys
  // below already span every shiny target and soft_reset would only duplicate.
  universalMethods: [],
};
gen3Xd.methods = {
  poke_spot_xd: B(gen3Xd),
  gift_xd: B(gen3Xd),
  trade_xd: B(gen3Xd),
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
  // Each generation caps the sparkling patch at a different rate on a chain of
  // 40: Gen IV at 1/200, Gen VI at 1/100, BDSP at 1/99. In Gen VI the chance
  // starts at 1/8100 and the denominator drops by 200 per successful encounter.
  // The Shiny Charm does not apply to the patch roll.
  radar: { base: [1, 100] },
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
  // Combo 31+ without a Lure. The Lure column would be 1/316 and 1/274, but
  // the app has no Lure toggle and every other method uses the itemless base.
  catch_combo: { base: [1, 342], charm: [1, 293] },
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
  // Only Brilliant Pokemon get extra rolls, and only the Pokedex catch/defeat
  // counter feeds them: 7x the normal rate at 500+, 9x with the Shiny Charm.
  // Fishing chains raise how often a Brilliant appears, not its shiny rate, so
  // fishing for Brilliants is this method rather than a chain_fishing hunt.
  battle_method: { base: [1, 585], charm: [1, 455] },
  masuda: { base: [1, 682], charm: [1, 512] },
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
  // BDSP disables the Shiny Charm for everything except eggs, so the universal
  // methods are declared here to override the group's charm odds. The charm
  // does not apply to the Poke Radar or the Grand Underground either.
  encounter: { base: gen8Bdsp.baseOdds },
  soft_reset: { base: gen8Bdsp.baseOdds },
  radar: { base: [1, 99] },
  masuda: { base: [1, 682], charm: [1, 512] },
  grand_underground: { base: [1, 2048] },
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
// Scarlet/Violet resolve every shiny check from a roll count: one base roll,
// two more from the Shiny Charm, one to three from a Sparkling Power sandwich
// and one or two for clearing a Mass Outbreak. Sparkling Power boosts wild
// spawns only, so eggs and Tera Raids opt out.
const sv = rollMethod(2);
gen9Sv.methods = {
  // Declared here, unlike in most groups, so a plain wild spawn can carry the
  // Sparkling Power modifier. The odds still match the group's own.
  encounter: sv(1, { sparkling: true }),
  // Clearing a Mass Outbreak is worth one extra roll from 30 knockouts on and
  // two from 60, so each tier is its own method. Scarlet/Violet do not reuse
  // the plain "outbreak" key, whose tiers mean something else in Legends Arceus.
  outbreak_ko0: sv(1, { sparkling: true }),
  outbreak_ko30: sv(2, { sparkling: true }),
  outbreak_ko60: sv(3, { sparkling: true }),
  // Distribution outbreaks roll a flat 0.5% before the ordinary rolls.
  outbreak_event_ko0: sv(1, { sparkling: true, flat: 0.005 }),
  outbreak_event_ko30: sv(2, { sparkling: true, flat: 0.005 }),
  outbreak_event_ko60: sv(3, { sparkling: true, flat: 0.005 }),
  masuda: sv(6),
  picnic_breeding: sv(1),
  // Raids roll against their own table, outside the 4096 roll model.
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
// Same roll model as Scarlet/Violet, except the Shiny Charm is worth three
// rolls here instead of two.
const za = rollMethod(3);
gen9Za.methods = {
  encounter: za(1, { sparkling: true }),
  fossil: { base: gen9Za.baseOdds },
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
  gen3Colosseum,
  gen3Xd,
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

/**
 * Retired method keys that still sit in saved hunts, and what they mean today.
 * The Gen 9 sandwich keys encoded a Sparkling Power level, which is a modifier
 * on its own now, so they resolve to a wild encounter plus that level.
 */
const LEGACY_METHODS: Record<string, { key: string; sparkling?: number }> = {
  sandwich: { key: "encounter", sparkling: 3 },
  sandwich_sp1: { key: "encounter", sparkling: 1 },
  sandwich_sp2: { key: "encounter", sparkling: 2 },
  sandwich_sp3: { key: "encounter", sparkling: 3 },
  sparkling_power_lv1: { key: "encounter", sparkling: 1 },
  sparkling_power_lv2: { key: "encounter", sparkling: 2 },
  sparkling_power_lv3: { key: "encounter", sparkling: 3 },
};

// --- Shiny variant (star vs. square sparkles, Sword/Shield only) ---

/** The only group whose shinies roll a visible sparkle variant. */
const SHINY_VARIANT_GROUP_ID = "gen8_swsh";

/**
 * SwSh methods that spawn a Pokemon in the overworld. Every other method of the
 * group (breeding, masuda, max_raid, dynamax_adventure, soft_reset) keeps the
 * natural PID and therefore the plain 15:1 star-to-square split.
 */
const SWSH_WILD_METHODS = new Set([
  "encounter",
  "battle_method",
  "fishing",
  "curry_hunting",
]);

/** Greatest common divisor, used to keep variant-adjusted tuples small. */
function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x;
}

/** Reduces a numerator/denominator pair to its lowest terms. */
function reduceOdds(num: number, denom: number): OddsTuple {
  const divisor = gcd(num, denom) || 1;
  return [num / divisor, denom / divisor];
}

// --- Exported helpers ---

/** Returns the game group for a given game key, or null if unknown. */
export function getGameGroup(gameKey: string): GameGroup | null {
  return GAME_KEY_TO_GROUP[gameKey] ?? null;
}

/**
 * Returns the hunt method keys available for a given game key.
 * Most groups offer DEFAULT_UNIVERSAL_METHODS on top of their own methods;
 * a group can narrow that set through its universalMethods field.
 */
export function getMethodsForGame(gameKey: string): string[] {
  const group = GAME_KEY_TO_GROUP[gameKey];
  if (!group) return [...DEFAULT_UNIVERSAL_METHODS];
  const universal = group.universalMethods ?? DEFAULT_UNIVERSAL_METHODS;
  return [
    ...universal,
    ...Object.keys(group.methods).filter((k) => !universal.includes(k)),
  ];
}

/**
 * Returns the shiny odds for a specific method in a specific game.
 * A group's own `methods` entry always wins over the universal defaults, so a
 * group can override the odds of a universal method. Everything else falls
 * back to the group's base odds.
 *
 * `sparklingLevel` is the Gen 9 Sparkling Power level (0..3). It only moves the
 * odds of methods that declare themselves roll-modelled and sandwich-boosted.
 */
export function getMethodOdds(
  gameKey: string,
  methodKey: string,
  hasCharm: boolean,
  sparklingLevel = 0,
): OddsTuple {
  const group = GAME_KEY_TO_GROUP[gameKey];
  if (!group) return [1, 4096];

  const legacy = LEGACY_METHODS[methodKey];
  const resolvedKey = legacy?.key ?? methodKey;

  const methodOdds = group.methods[resolvedKey];
  if (!methodOdds) {
    // Universal or unknown method, fall back to the group's base odds
    if (hasCharm && group.charmOdds) return group.charmOdds;
    return group.baseOdds;
  }

  // A stored level and a legacy key never disagree, but clamping keeps a
  // corrupted import from producing a nonsense fraction.
  const sparkling = Math.min(
    MAX_SPARKLING_POWER,
    Math.max(0, sparklingLevel, legacy?.sparkling ?? 0),
  );
  if (sparkling > 0 && methodOdds.sparkling && methodOdds.rolls !== undefined) {
    const charmRolls = hasCharm ? (methodOdds.charmRolls ?? 0) : 0;
    return oddsFromRolls(
      methodOdds.rolls + charmRolls + sparkling,
      methodOdds.flatChance,
    );
  }

  if (hasCharm && methodOdds.charm) return methodOdds.charm;
  return methodOdds.base;
}

/**
 * Returns whether a Sparkling Power sandwich boosts the given method.
 * Sparkling Power is Gen 9 only and reaches wild spawns, not eggs, static
 * encounters or Tera Raids.
 */
export function methodSupportsSparklingPower(
  gameKey: string,
  methodKey: string,
): boolean {
  const group = GAME_KEY_TO_GROUP[gameKey];
  if (!group) return false;
  const resolvedKey = LEGACY_METHODS[methodKey]?.key ?? methodKey;
  return group.methods[resolvedKey]?.sparkling === true;
}

/** Returns whether the given game supports a Shiny Charm. */
export function gameSupportsCharm(gameKey: string): boolean {
  const group = GAME_KEY_TO_GROUP[gameKey];
  return group?.charmOdds != null;
}

/**
 * Returns whether the given game distinguishes star from square shinies.
 * Only Sword/Shield roll a visible sparkle variant, later games dropped it.
 */
export function gameSupportsShinyVariant(gameKey: string): boolean {
  return GAME_KEY_TO_GROUP[gameKey]?.id === SHINY_VARIANT_GROUP_ID;
}

/**
 * Applies the star/square split to a Sword/Shield odds tuple.
 * Returns `odds` untouched when no variant is targeted or the game has no
 * variants, so every other game keeps its exact display fraction.
 */
export function applyShinyVariantOdds(
  gameKey: string,
  methodKey: string,
  odds: OddsTuple,
  variant?: ShinyVariant,
): OddsTuple {
  if (!variant || !gameSupportsShinyVariant(gameKey)) return odds;

  const resolvedKey = LEGACY_METHODS[methodKey]?.key ?? methodKey;
  const [num, denom] = odds;

  if (SWSH_WILD_METHODS.has(resolvedKey)) {
    // Overworld spawns get their PID overwritten, which forces the XOR to 0.
    // A star then only survives when the trainer's own XOR is already 1..15.
    return variant === "square"
      ? reduceOdds(num * 65521, denom * 65536)
      : reduceOdds(num * 15, denom * 65536);
  }

  // Eggs, static encounters and raids keep their natural PID, so all 16 XOR
  // buckets are equally likely and only 1 of them is square.
  return variant === "star"
    ? reduceOdds(num * 15, denom * 16)
    : reduceOdds(num, denom * 16);
}

/** Formats an odds tuple as a display string like "1/4096" or "5/4096". */
export function formatOdds(odds: OddsTuple): string {
  return `${odds[0]}/${odds[1]}`;
}

/**
 * Formats an odds tuple as a rounded "1 in N" string, e.g. "1/17895697".
 * Variant-adjusted tuples never reduce to a readable fraction, so the display
 * shows the nearest unit fraction instead of the exact ratio.
 */
export function formatOddsApprox(odds: OddsTuple): string {
  const [num, denom] = odds;
  if (num <= 0 || denom <= 0) return formatOdds(odds);
  return `1/${Math.round(denom / num)}`;
}
