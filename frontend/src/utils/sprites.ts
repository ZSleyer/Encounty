export type SpriteType = "normal" | "shiny";
export type SpriteStyle = "box" | "animated" | "3d" | "artwork" | "classic";

const POKEAPI_BASE =
  "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
const SHOWDOWN_BASE = "https://play.pokemonshowdown.com/sprites";
const POKESPRITE_BASE =
  "https://raw.githubusercontent.com/msikma/pokesprite/master/pokemon-gen8";

/** Placeholder sprite (PokeAPI's "unknown Pokémon" silhouette) used when a sprite fails to load. */
export const SPRITE_FALLBACK = `${POKEAPI_BASE}/0.png`;

/** Small default PokeAPI sprite — available for all generations including Gen 9. */
export function getDefaultSpriteUrl(pokemonId: number | string): string {
  return `${POKEAPI_BASE}/${pokemonId}.png`;
}

/**
 * Default-form suffixes that Pokesprite omits from filenames.
 * E.g. Pokesprite uses "deoxys.png" not "deoxys-normal.png".
 */
const DEFAULT_FORM_SUFFIXES = [
  "-normal", "-altered", "-land", "-aria", "-incarnate",
  "-plant", "-standard", "-red-striped", "-shield",
  "-ordinary", "-average", "-baile", "-midday",
  "-solo", "-50", "-male", "-amped",
  "-single-strike", "-full-belly", "-chest",
  "-family-of-three", "-two-segment", "-curly",
  "-combat-breed", "-green-plumage", "-zero",
];

/** Normalize a canonical name by stripping default-form suffixes. */
function normalizeDefaultForm(name: string): string {
  for (const suffix of DEFAULT_FORM_SUFFIXES) {
    if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
  }
  return name;
}

/** Returns a small box sprite URL from pokesprite for use in compact UI elements. */
export function getBoxSpriteUrl(canonicalName: string, spriteType: SpriteType = "shiny"): string {
  const variant = spriteType === "shiny" ? "shiny" : "regular";
  const normalized = normalizeDefaultForm(canonicalName);
  return `${POKESPRITE_BASE}/${variant}/${normalized}.png`;
}

/**
 * Canonical name to correct PokeAPI numeric ID for regional forms.
 * Used as a safety net so sprite URLs resolve correctly even when
 * the pokedex data has stale or wrong sprite_id values.
 */
const REGIONAL_FORM_IDS: Record<string, number> = {
  "rattata-alola": 10091, "raticate-alola": 10092,
  "raichu-alola": 10100, "sandshrew-alola": 10101,
  "sandslash-alola": 10102, "vulpix-alola": 10103,
  "ninetales-alola": 10104, "diglett-alola": 10105,
  "dugtrio-alola": 10106, "meowth-alola": 10107,
  "persian-alola": 10108, "geodude-alola": 10109,
  "graveler-alola": 10110, "golem-alola": 10111,
  "grimer-alola": 10112, "muk-alola": 10113,
  "exeggutor-alola": 10114, "marowak-alola": 10115,
  "meowth-galar": 10161, "ponyta-galar": 10162,
  "rapidash-galar": 10163, "slowpoke-galar": 10164,
  "slowbro-galar": 10165, "farfetchd-galar": 10166,
  "weezing-galar": 10167, "mr-mime-galar": 10168,
  "articuno-galar": 10169, "zapdos-galar": 10170,
  "moltres-galar": 10171, "slowking-galar": 10172,
  "corsola-galar": 10173, "zigzagoon-galar": 10174,
  "linoone-galar": 10175, "darumaka-galar": 10176,
  "darmanitan-galar-standard": 10177, "darmanitan-galar-zen": 10178,
  "yamask-galar": 10179, "stunfisk-galar": 10180,
  "growlithe-hisui": 10229, "arcanine-hisui": 10230,
  "voltorb-hisui": 10231, "electrode-hisui": 10232,
  "typhlosion-hisui": 10233, "qwilfish-hisui": 10234,
  "sneasel-hisui": 10235, "samurott-hisui": 10236,
  "lilligant-hisui": 10237, "zorua-hisui": 10238,
  "zoroark-hisui": 10239, "braviary-hisui": 10240,
  "sliggoo-hisui": 10241, "goodra-hisui": 10242,
  "avalugg-hisui": 10243, "decidueye-hisui": 10244,
  "wooper-paldea": 10253,
  "tauros-paldea-combat-breed": 10250,
  "tauros-paldea-blaze-breed": 10251,
  "tauros-paldea-aqua-breed": 10252,
};

/**
 * Resolves the correct PokeAPI numeric ID for a pokemon.
 * For regional forms, uses the canonical name lookup table to ensure
 * the correct ID is returned even if the pokedex data is stale.
 */
function resolvePokeApiId(
  pokemonId: number | string,
  canonicalName?: string,
): number {
  if (canonicalName) {
    const mapped = REGIONAL_FORM_IDS[canonicalName.toLowerCase()];
    if (mapped) return mapped;
  }
  return typeof pokemonId === "number"
    ? pokemonId
    : Number.parseInt(String(pokemonId), 10);
}

/** Sprite style metadata for UI display and per-generation availability. */
export interface SpriteStyleOption {
  key: SpriteStyle;
  label: string;
  desc: string;
  /** Available for games of this generation range (inclusive). null = always available. */
  minGen: number | null;
  maxGen: number | null;
}

/** All sprite style options with availability info. */
export const SPRITE_STYLES: SpriteStyleOption[] = [
  {
    key: "box",
    label: "Box",
    desc: "Pokésprite Box-Sprites",
    minGen: null,
    maxGen: 8,
  },
  {
    key: "animated",
    label: "Animiert",
    desc: "Showdown GIFs",
    minGen: null,
    maxGen: null,
  },
  {
    key: "3d",
    label: "3D Home",
    desc: "HD-Render",
    minGen: null,
    maxGen: null,
  },
  {
    key: "artwork",
    label: "Artwork",
    desc: "Offizielle Illustrationen",
    minGen: null,
    maxGen: null,
  },
  {
    key: "classic",
    label: "Classic",
    desc: "Spielspezifische Pixel-Sprites",
    minGen: null,
    maxGen: 5,
  },
];

/**
 * Check if a sprite style is available for a given game generation.
 * Returns true if available, false if not.
 */
export function isSpriteStyleAvailable(
  style: SpriteStyle,
  generation: number | null | undefined,
): boolean {
  const opt = SPRITE_STYLES.find((s) => s.key === style);
  if (!opt) return false;
  // No generation selected = all styles available
  if (generation == null) return true;
  if (opt.minGen != null && generation < opt.minGen) return false;
  if (opt.maxGen != null && generation > opt.maxGen) return false;
  return true;
}

/**
 * Returns the best available sprite style for a game generation,
 * falling back from the preferred style if it's not available.
 */
export function bestAvailableStyle(
  preferred: SpriteStyle,
  generation: number | null | undefined,
): SpriteStyle {
  if (isSpriteStyleAvailable(preferred, generation)) return preferred;
  // Fallback order: animated > 3d > artwork > classic > box
  for (const fallback of [
    "animated",
    "3d",
    "artwork",
    "classic",
    "box",
  ] as SpriteStyle[]) {
    if (isSpriteStyleAvailable(fallback, generation)) return fallback;
  }
  return "3d";
}

/**
 * Returns the sprite URL for a Pokémon based on the sprite style, type, game, and ID/name.
 *
 * - box:      Pokésprite box sprites (trimmed pixel art, all Pokémon)
 * - animated: Pokémon Showdown animated GIFs (all Pokémon)
 * - 3d:       Pokémon Home 3D renders (high-quality PNG)
 * - artwork:  Official Ken Sugimori / official artwork from PokeAPI
 */
export function getSpriteUrl(
  pokemonId: number | string,
  gameKey: string,
  spriteType: SpriteType = "shiny",
  spriteStyle: SpriteStyle = "box",
  canonicalName?: string,
): string {
  const shiny = spriteType === "shiny";
  const resolvedId = resolvePokeApiId(pokemonId, canonicalName);

  // ── Classic (game-specific pixel sprites) ────────────────────────────
  if (spriteStyle === "classic") {
    const effectiveGameKey = gameKey || defaultGameKeyForGeneration(resolvedId);
    return getClassicSpriteUrl(resolvedId, effectiveGameKey, shiny, canonicalName);
  }

  // ── Animated (Pokémon Showdown GIFs) ─────────────────────────────────
  if (spriteStyle === "animated") {
    return getShowdownAnimatedUrl(resolvedId, canonicalName, shiny);
  }

  // ── 3D Home renders ──────────────────────────────────────────────────
  if (spriteStyle === "3d") {
    return getHome3dUrl(resolvedId, shiny);
  }

  // ── Official Artwork ─────────────────────────────────────────────────
  if (spriteStyle === "artwork") {
    return getOfficialArtworkUrl(resolvedId, shiny);
  }

  // ── Box: pokesprite box sprites ──────────────────────────────────────
  if (canonicalName) {
    return getBoxSpriteUrl(canonicalName, spriteType);
  }

  // Legacy fallback for "classic" or missing canonical name
  return getClassicSpriteUrl(resolvedId, gameKey, shiny, canonicalName);
}

/** Convert a name to a Showdown sprite ID (lowercase, non-alphanumeric removed). */
function toShowdownId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Animated GIF sprite from Pokémon Showdown.
 * Uses canonical name (e.g. "bulbasaur", "charizard-mega-x").
 */
function getShowdownAnimatedUrl(
  pokemonId: number,
  canonicalName?: string,
  shiny = false,
): string {
  const name = canonicalName || String(pokemonId);
  const slug = toShowdownId(normalizeDefaultForm(name));
  const dir = shiny ? "ani-shiny" : "ani";
  return `${SHOWDOWN_BASE}/${dir}/${slug}.gif`;
}

/**
 * High-quality 3D render from Pokémon Home via PokeAPI.
 * The ID must be the correct PokeAPI numeric ID (use resolvePokeApiId first).
 */
function getHome3dUrl(pokemonId: number, shiny = false): string {
  return shiny
    ? `${POKEAPI_BASE}/other/home/shiny/${pokemonId}.png`
    : `${POKEAPI_BASE}/other/home/${pokemonId}.png`;
}

/**
 * Official artwork (Ken Sugimori illustrations) from PokeAPI.
 * The ID must be the correct PokeAPI numeric ID (use resolvePokeApiId first).
 */
function getOfficialArtworkUrl(pokemonId: number, shiny = false): string {
  return shiny
    ? `${POKEAPI_BASE}/other/official-artwork/shiny/${pokemonId}.png`
    : `${POKEAPI_BASE}/other/official-artwork/${pokemonId}.png`;
}

/** Predicate + path builder pair used by the classic sprite lookup table. */
interface ClassicSpriteRule {
  match: (key: string) => boolean;
  /** Return the URL, or null to skip to the next rule. */
  url: (id: number, shinyPart: string, canonicalName?: string) => string | null;
}

/**
 * Ordered lookup table for classic (version-specific) sprite resolution.
 * Each rule matches a game key pattern and returns the corresponding PokeAPI path.
 * Order matters: BDSP must be checked before generic diamond/pearl, etc.
 */
const CLASSIC_SPRITE_RULES: ClassicSpriteRule[] = [
  // Gen 1
  {
    match: (k) => (k.includes("red") && !k.includes("firered")) || k === "pokemon-blue",
    url: (id) => `${POKEAPI_BASE}/versions/generation-i/red-blue/transparent/${id}.png`,
  },
  {
    match: (k) => k.includes("yellow"),
    url: (id) => `${POKEAPI_BASE}/versions/generation-i/yellow/transparent/${id}.png`,
  },
  // Gen 2
  {
    match: (k) => k.includes("crystal"),
    url: (id, sp) => `${POKEAPI_BASE}/versions/generation-ii/crystal/transparent/${sp}${id}.png`,
  },
  {
    match: (k) => k.includes("gold") && !k.includes("heartgold"),
    url: (id, sp) => `${POKEAPI_BASE}/versions/generation-ii/gold/transparent/${sp}${id}.png`,
  },
  {
    match: (k) => k.includes("silver") && !k.includes("soulsilver"),
    url: (id, sp) => `${POKEAPI_BASE}/versions/generation-ii/silver/transparent/${sp}${id}.png`,
  },
  // Gen 3
  {
    match: (k) => k.includes("emerald"),
    url: (id, sp) => `${POKEAPI_BASE}/versions/generation-iii/emerald/${sp}${id}.png`,
  },
  {
    match: (k) => k.includes("firered") || k.includes("leafgreen"),
    url: (id, sp) => `${POKEAPI_BASE}/versions/generation-iii/firered-leafgreen/${sp}${id}.png`,
  },
  {
    match: (k) => (k.includes("ruby") && !k.includes("omegaruby") && !k.includes("omega-ruby"))
      || (k.includes("sapphire") && !k.includes("alphasapphire") && !k.includes("alpha-sapphire")),
    url: (id, sp) => `${POKEAPI_BASE}/versions/generation-iii/ruby-sapphire/${sp}${id}.png`,
  },
  // Gen 4 — BDSP remakes (must precede generic diamond/pearl)
  {
    match: (k) => k.includes("brilliant") || k.includes("shining") || k === "pokemon-bd" || k === "pokemon-sp",
    url: (id, sp, cn) => {
      if (sp) {
        const slug = toShowdownId(normalizeDefaultForm((cn || String(id)).toLowerCase()));
        return `${SHOWDOWN_BASE}/dex-shiny/${slug}.png`;
      }
      return `${POKEAPI_BASE}/versions/generation-viii/brilliant-diamond-shining-pearl/${id}.png`;
    },
  },
  {
    match: (k) => k.includes("diamond") || k.includes("pearl"),
    url: (id, sp) => `${POKEAPI_BASE}/versions/generation-iv/diamond-pearl/${sp}${id}.png`,
  },
  {
    match: (k) => k.includes("platinum"),
    url: (id, sp) => `${POKEAPI_BASE}/versions/generation-iv/platinum/${sp}${id}.png`,
  },
  {
    match: (k) => k.includes("heartgold") || k.includes("soulsilver"),
    url: (id, sp) => `${POKEAPI_BASE}/versions/generation-iv/heartgold-soulsilver/${sp}${id}.png`,
  },
  // Gen 5
  {
    match: (k) => k.includes("black") || k.includes("white"),
    url: (id, sp) => `${POKEAPI_BASE}/versions/generation-v/black-white/animated/${sp}${id}.gif`,
  },
];

/**
 * Returns the default game key for a Pokemon based on its generation.
 * Used when "classic" style is selected but no specific game is chosen,
 * so the sprite defaults to the first game the Pokemon appeared in.
 */
function defaultGameKeyForGeneration(pokemonId: number): string {
  const gen = getPokemonGeneration(pokemonId);
  switch (gen) {
    case 1: return "pokemon-red";
    case 2: return "pokemon-gold";
    case 3: return "pokemon-ruby";
    case 4: return "pokemon-diamond";
    case 5: return "pokemon-black";
    default: return "";
  }
}

/**
 * Classic version-specific sprite from PokeAPI GitHub (Gen 1-5 only).
 * Gen 6+ falls through to Showdown dex renders.
 */
function getClassicSpriteUrl(
  pokemonId: number,
  gameKey: string,
  shiny: boolean,
  canonicalName?: string,
): string {
  const shinyPart = shiny ? "shiny/" : "";
  const key = gameKey || "";

  // Form variants (IDs > 10000) — always use default path
  if (pokemonId > 10000) {
    return shiny
      ? `${POKEAPI_BASE}/shiny/${pokemonId}.png`
      : `${POKEAPI_BASE}/${pokemonId}.png`;
  }

  // Walk the ordered rule table; first match wins
  for (const rule of CLASSIC_SPRITE_RULES) {
    if (rule.match(key)) {
      const result = rule.url(pokemonId, shinyPart, canonicalName);
      if (result) return result;
    }
  }

  // Gen 6+ / default — fallback to Showdown dex renders
  const slug = toShowdownId(normalizeDefaultForm((canonicalName || String(pokemonId)).toLowerCase()));
  return shiny
    ? `${SHOWDOWN_BASE}/dex-shiny/${slug}.png`
    : `${SHOWDOWN_BASE}/dex/${slug}.png`;
}

/**
 * Returns the generation a Pokemon was introduced in, based on its national dex number.
 * Regional forms (id > 10000) inherit the generation of their base species,
 * but since we can't resolve that here, they return 1 (always available).
 */
export function getPokemonGeneration(dexNumber: number): number {
  if (dexNumber > 10000) return 1;
  if (dexNumber <= 151) return 1;
  if (dexNumber <= 251) return 2;
  if (dexNumber <= 386) return 3;
  if (dexNumber <= 493) return 4;
  if (dexNumber <= 649) return 5;
  if (dexNumber <= 721) return 6;
  if (dexNumber <= 809) return 7;
  if (dexNumber <= 905) return 8;
  return 9;
}
