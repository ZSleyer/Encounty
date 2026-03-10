export type SpriteType = "normal" | "shiny";
export type SpriteStyle = "classic" | "animated" | "3d" | "artwork";

const POKEAPI_BASE =
  "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
const SHOWDOWN_BASE = "https://play.pokemonshowdown.com/sprites";

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
    : parseInt(String(pokemonId), 10);
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
    key: "classic",
    label: "🎮 Klassisch",
    desc: "Pixel-Sprites je Spiel",
    minGen: 1,
    maxGen: 5, // Gen 6+ have no pixel sprites
  },
  {
    key: "animated",
    label: "✨ Animiert",
    desc: "Showdown GIFs",
    minGen: null, // works for all
    maxGen: null,
  },
  {
    key: "3d",
    label: "🏠 3D Home",
    desc: "HD-Render",
    minGen: null,
    maxGen: null,
  },
  {
    key: "artwork",
    label: "🎨 Artwork",
    desc: "Offizielle Illustrationen",
    minGen: null,
    maxGen: null,
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
  // Fallback order: animated > 3d > artwork > classic
  for (const fallback of [
    "animated",
    "3d",
    "artwork",
    "classic",
  ] as SpriteStyle[]) {
    if (isSpriteStyleAvailable(fallback, generation)) return fallback;
  }
  return "3d";
}

/**
 * Returns the sprite URL for a Pokémon based on the sprite style, type, game, and ID/name.
 *
 * - classic:  version-specific PokeAPI sprites (pixelated, Gen 1-5 only)
 * - animated: Pokémon Showdown animated GIFs (all Pokémon)
 * - 3d:       Pokémon Home 3D renders (high-quality PNG)
 * - artwork:  Official Ken Sugimori / official artwork from PokeAPI
 */
export function getSpriteUrl(
  pokemonId: number | string,
  gameKey: string,
  spriteType: SpriteType = "shiny",
  spriteStyle: SpriteStyle = "classic",
  canonicalName?: string,
): string {
  const shiny = spriteType === "shiny";
  const resolvedId = resolvePokeApiId(pokemonId, canonicalName);

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

  // ── Classic: version-specific PokeAPI sprites ────────────────────────
  return getClassicSpriteUrl(resolvedId, gameKey, shiny, canonicalName);
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
  const slug = name.toLowerCase();
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
  gameKey = gameKey || "";

  // Form variants (IDs > 10000) — always use default path
  if (pokemonId > 10000) {
    return shiny
      ? `${POKEAPI_BASE}/shiny/${pokemonId}.png`
      : `${POKEAPI_BASE}/${pokemonId}.png`;
  }

  // ── Gen 1 ────────────────────────────────────────────────────────────
  if (
    (gameKey.includes("red") && !gameKey.includes("firered")) ||
    gameKey === "pokemon-blue"
  ) {
    return `${POKEAPI_BASE}/versions/generation-i/red-blue/transparent/${pokemonId}.png`;
  }
  if (gameKey.includes("yellow")) {
    return `${POKEAPI_BASE}/versions/generation-i/yellow/transparent/${pokemonId}.png`;
  }

  // ── Gen 2 ────────────────────────────────────────────────────────────
  if (gameKey.includes("crystal")) {
    return `${POKEAPI_BASE}/versions/generation-ii/crystal/transparent/${shinyPart}${pokemonId}.png`;
  }
  if (gameKey.includes("gold") && !gameKey.includes("heartgold")) {
    return `${POKEAPI_BASE}/versions/generation-ii/gold/transparent/${shinyPart}${pokemonId}.png`;
  }
  if (gameKey.includes("silver") && !gameKey.includes("soulsilver")) {
    return `${POKEAPI_BASE}/versions/generation-ii/silver/transparent/${shinyPart}${pokemonId}.png`;
  }

  // ── Gen 3 ────────────────────────────────────────────────────────────
  if (gameKey.includes("emerald")) {
    return `${POKEAPI_BASE}/versions/generation-iii/emerald/${shinyPart}${pokemonId}.png`;
  }
  if (gameKey.includes("firered") || gameKey.includes("leafgreen")) {
    return `${POKEAPI_BASE}/versions/generation-iii/firered-leafgreen/${shinyPart}${pokemonId}.png`;
  }
  if (
    gameKey.includes("ruby") &&
    !gameKey.includes("omegaruby") &&
    !gameKey.includes("omega-ruby")
  ) {
    return `${POKEAPI_BASE}/versions/generation-iii/ruby-sapphire/${shinyPart}${pokemonId}.png`;
  }
  if (
    gameKey.includes("sapphire") &&
    !gameKey.includes("alphasapphire") &&
    !gameKey.includes("alpha-sapphire")
  ) {
    return `${POKEAPI_BASE}/versions/generation-iii/ruby-sapphire/${shinyPart}${pokemonId}.png`;
  }

  // ── Gen 4 ────────────────────────────────────────────────────────────
  // BDSP (Gen 8 remakes) — must check BEFORE generic diamond/pearl
  if (
    gameKey.includes("brilliant") ||
    gameKey.includes("shining") ||
    gameKey === "pokemon-bd" ||
    gameKey === "pokemon-sp"
  ) {
    if (shiny) {
      const slug = (canonicalName || String(pokemonId)).toLowerCase();
      return `${SHOWDOWN_BASE}/dex-shiny/${slug}.png`;
    }
    return `${POKEAPI_BASE}/versions/generation-viii/brilliant-diamond-shining-pearl/${pokemonId}.png`;
  }
  if (gameKey.includes("diamond") || gameKey.includes("pearl")) {
    return `${POKEAPI_BASE}/versions/generation-iv/diamond-pearl/${shinyPart}${pokemonId}.png`;
  }
  if (gameKey.includes("platinum")) {
    return `${POKEAPI_BASE}/versions/generation-iv/platinum/${shinyPart}${pokemonId}.png`;
  }
  if (gameKey.includes("heartgold") || gameKey.includes("soulsilver")) {
    return `${POKEAPI_BASE}/versions/generation-iv/heartgold-soulsilver/${shinyPart}${pokemonId}.png`;
  }

  // ── Gen 5 ────────────────────────────────────────────────────────────
  if (gameKey.includes("black") || gameKey.includes("white")) {
    return `${POKEAPI_BASE}/versions/generation-v/black-white/animated/${shinyPart}${pokemonId}.gif`;
  }

  // ── Gen 6+ / default ─────────────────────────────────────────────────
  // Classic should not be selected for Gen 6+, but as fallback use Showdown dex
  const slug = (canonicalName || String(pokemonId)).toLowerCase();
  return shiny
    ? `${SHOWDOWN_BASE}/dex-shiny/${slug}.png`
    : `${SHOWDOWN_BASE}/dex/${slug}.png`;
}
