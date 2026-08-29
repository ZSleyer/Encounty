import { apiUrl } from "./api";

export type SpriteType = "normal" | "shiny";
export type SpriteStyle = "box" | "animated" | "3d" | "artwork" | "classic";

interface GenderSpritePokemon {
  canonical_name: string;
  game: string;
  sprite_type: SpriteType;
  sprite_style?: SpriteStyle;
}

interface GenderSpriteDexEntry {
  id: number;
  canonical: string;
  forms?: Array<{
    canonical: string;
    sprite_id: number;
    sprite_slug?: string;
    gender?: "male" | "female";
  }>;
}

export const POKEAPI_BASE =
  "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
export const SHOWDOWN_BASE = "https://play.pokemonshowdown.com/sprites";
export const POKESPRITE_BASE =
  "https://raw.githubusercontent.com/msikma/pokesprite/master/pokemon-gen8";

const SPRITE_FALLBACK_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
  `stroke="#7a8ea0" stroke-width="1.4" stroke-linecap="round">` +
  `<circle cx="12" cy="12" r="9.3"/>` +
  `<path d="M2.7 12h6.6M14.7 12h6.6"/>` +
  `<circle cx="12" cy="12" r="2.4"/>` +
  `</svg>`;

/** Placeholder sprite (Tempest pokéball glyph) used when a sprite fails to load or is unset. */
export const SPRITE_FALLBACK = `data:image/svg+xml,${encodeURIComponent(SPRITE_FALLBACK_SVG)}`;

/**
 * Upstream prefixes the backend sprite proxy will cache. Mirrors the allowlist
 * in backend/internal/server/handler/games/sprites.go; a URL missing here is
 * simply served from its origin, so the two lists drifting apart costs
 * performance, never correctness.
 */
const CACHEABLE_SPRITE_PREFIXES = [
  "https://raw.githubusercontent.com/PokeAPI/sprites/",
  "https://raw.githubusercontent.com/msikma/pokesprite/",
  "https://raw.githubusercontent.com/kwsch/PKHeX/",
  "https://play.pokemonshowdown.com/sprites/",
];

/**
 * Routes a sprite through the backend's on-disk cache so it is fetched from
 * its upstream host once rather than once per session, and stays available
 * offline.
 *
 * Render-time only. The result embeds the backend base URL, which in the
 * packaged app carries a port assigned at startup, so a proxied URL must never
 * be persisted as a `sprite_url` or compared against by {@link isCustomSprite}.
 * That is why the URL builders below return upstream URLs unchanged and the
 * wrapping happens at the `<img>`.
 * @param url Any sprite URL; non-cacheable ones pass through untouched.
 */
export function cachedSpriteSrc(url: string): string {
  if (!CACHEABLE_SPRITE_PREFIXES.some((prefix) => url.startsWith(prefix))) return url;
  return apiUrl(`/api/sprite?url=${encodeURIComponent(url)}`);
}

/**
 * Guards a user-supplied sprite URL before it is used as an <img src>.
 *
 * The custom-sprite field lets the user paste an arbitrary URL that is also
 * persisted and later re-rendered, so a hostile value like "javascript:..."
 * or "data:text/html,..." must never reach the DOM. Only image-safe schemes
 * (http, https, blob, data:image/*) and same-origin relative paths pass;
 * anything else collapses to SPRITE_FALLBACK.
 * @param url The candidate sprite URL, possibly user-controlled or empty.
 * @returns The url unchanged when safe, otherwise SPRITE_FALLBACK.
 */
export function safeSpriteSrc(url: string | null | undefined): string {
  if (!url) return SPRITE_FALLBACK;
  // Relative/same-origin paths (e.g. "/api/pokemon/…/sprite") carry no scheme.
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  let scheme: string;
  try {
    scheme = new URL(url, "http://localhost").protocol;
  } catch {
    return SPRITE_FALLBACK;
  }
  if (scheme === "http:" || scheme === "https:" || scheme === "blob:") return url;
  if (scheme === "data:" && /^data:image\//i.test(url)) return url;
  return SPRITE_FALLBACK;
}

/**
 * Resolves a stored sprite URL into a browser-loadable <img src>.
 *
 * Uploaded custom sprites are persisted as an app-relative backend path
 * ("/api/pokemon/<id>/sprite?v=…"). That path resolves fine behind the Vite
 * dev proxy, but in the packaged Electron app a bare "/api/…" resolves against
 * the renderer origin instead of the backend port and 404s. Prefixing the
 * backend base (via apiUrl) makes it load in both. External and data: URLs are
 * already absolute and pass through unchanged. The scheme guard from
 * safeSpriteSrc is always applied first, the sprite-cache detour last: this is
 * a render-time funnel only, no caller persists what it returns.
 * @param url The stored sprite URL, possibly relative, external, or empty.
 * @returns An absolute, scheme-safe URL, or SPRITE_FALLBACK when unusable.
 */
export function resolveSpriteSrc(url: string | null | undefined): string {
  if (!url) return SPRITE_FALLBACK;
  const safe = safeSpriteSrc(url);
  if (safe.startsWith("/") && !safe.startsWith("//")) return apiUrl(safe);
  return cachedSpriteSrc(safe);
}

/**
 * Reports whether a sprite URL is a user-custom sprite rather than an
 * auto-generated default. Custom means an uploaded backend path or a pasted
 * foreign URL; defaults always point at one of the three known sprite hosts.
 * Used to decide whether to show the sprite directly instead of the trimmed
 * box art derived from the canonical name.
 * @param url The stored sprite URL to classify.
 * @returns True when the URL is not one of the default sprite hosts.
 */
export function isCustomSprite(url: string | null | undefined): boolean {
  return !!url && ![POKEAPI_BASE, SHOWDOWN_BASE, POKESPRITE_BASE].some((base) => url.startsWith(base));
}

/**
 * Small default PokeAPI sprite, available for all generations including Gen 9.
 *
 * `gender` mirrors the female-path branch of {@link getSpriteUrl}: a
 * synthesized female pseudo-form (species carries the gender-differences flag
 * but has no dedicated pokemonform, so it reuses the species' own numeric id)
 * inserts a "female/" path segment instead of substituting a slug. Gated to
 * base-species ids (<= 10000) since a gendered form with its own dedicated
 * PokeAPI id already resolves correctly through the plain id path.
 * @param pokemonId Numeric PokeAPI id, or a slug for cosmetic-only forms.
 * @param spriteType "shiny" switches to the shiny path segment; defaults to the
 * normal sprite so existing single-argument callers keep their URL.
 * @param gender "female" inserts the female path segment for a synthesized
 * gender variant; omit for every other case.
 */
export function getDefaultSpriteUrl(
  pokemonId: number | string,
  spriteType: SpriteType = "normal",
  gender?: string,
): string {
  const shiny = spriteType === "shiny";
  if (gender === "female" && Number(pokemonId) <= 10000) {
    return shiny
      ? `${POKEAPI_BASE}/shiny/female/${pokemonId}.png`
      : `${POKEAPI_BASE}/female/${pokemonId}.png`;
  }
  const variant = shiny ? "shiny/" : "";
  return `${POKEAPI_BASE}/${variant}${pokemonId}.png`;
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
  /** i18n key of the visible name. */
  labelKey: string;
  /** i18n key of the tooltip describing the source of the sprites. */
  descKey: string;
  /** Available for games of this generation range (inclusive). null = always available. */
  minGen: number | null;
  maxGen: number | null;
}

/** All sprite style options with availability info. */
export const SPRITE_STYLES: SpriteStyleOption[] = [
  {
    key: "box",
    labelKey: "modal.spriteBox",
    descKey: "modal.spriteBoxDesc",
    minGen: null,
    maxGen: 8,
  },
  {
    key: "animated",
    labelKey: "modal.spriteAnimated",
    descKey: "modal.spriteAnimatedDesc",
    minGen: null,
    maxGen: null,
  },
  {
    key: "3d",
    labelKey: "modal.sprite3d",
    descKey: "modal.sprite3dDesc",
    minGen: null,
    maxGen: null,
  },
  {
    key: "artwork",
    labelKey: "modal.spriteArtwork",
    descKey: "modal.spriteArtworkDesc",
    minGen: null,
    maxGen: null,
  },
  {
    key: "classic",
    labelKey: "modal.spriteClassic",
    descKey: "modal.spriteClassicDesc",
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
 *
 * `spriteSlug` marks a purely cosmetic form (sprite_id 0) whose PokeAPI assets
 * live under a slug path such as "201-b" or "666-icy-snow". These forms have
 * no 3D Home render and no official artwork; the slug-based default pixel
 * sprite is the only PokeAPI asset available, so the 3d/artwork/classic styles
 * all resolve to it. Box and animated stay canonical-name based.
 *
 * `baseCanonical` is the canonical name of the base species a form belongs to.
 * Only the animated style needs it, to place Showdown's single form hyphen;
 * leaving it out costs the animated sprite of every form with a suffix.
 *
 * `gender` marks a female-appearance gender variant (see `pokedex.Form.Gender`
 * on the backend). Only *synthesized* variants (Path B: species carries the
 * gender-differences flag but has no dedicated pokemonform, so the backend
 * fabricates a "<canonical>-female" form reusing the species' own numeric id)
 * take the female-path branch below. Gendered forms with their own dedicated
 * PokeAPI pokemon id (Path A, e.g. Meowstic-female = 10025) already have a
 * working 3D Home render and official artwork at that id and must resolve
 * through the normal id-based paths instead, so the branch is gated to
 * base-species ids (<= 10000), mirroring the id > 10000 check in
 * getClassicSpriteUrl below.
 */
export function getSpriteUrl(
  pokemonId: number | string,
  gameKey: string,
  spriteType: SpriteType = "shiny",
  spriteStyle: SpriteStyle = "box",
  canonicalName?: string,
  spriteSlug?: string,
  baseCanonical?: string,
  gender?: string,
): string {
  const shiny = spriteType === "shiny";

  // Slug handling must run before any numeric ID resolution:
  // Number.parseInt("201-b") would silently truncate to 201.
  if (
    spriteSlug &&
    (spriteStyle === "3d" || spriteStyle === "artwork" || spriteStyle === "classic")
  ) {
    return shiny
      ? `${POKEAPI_BASE}/shiny/${spriteSlug}.png`
      : `${POKEAPI_BASE}/${spriteSlug}.png`;
  }

  // Synthesized female gender variants (Path B) carry the species' own
  // numeric id, not a slug, so they insert a "female/" path segment instead
  // of substituting a slug. Gendered forms with their own dedicated PokeAPI
  // pokemon id (Path A, id > 10000) already resolve correctly through the
  // normal id-based paths below and must not take this branch.
  if (
    gender === "female" &&
    Number(pokemonId) <= 10000 &&
    (spriteStyle === "3d" || spriteStyle === "artwork" || spriteStyle === "classic")
  ) {
    return shiny
      ? `${POKEAPI_BASE}/shiny/female/${pokemonId}.png`
      : `${POKEAPI_BASE}/female/${pokemonId}.png`;
  }

  const resolvedId = resolvePokeApiId(pokemonId, canonicalName);

  // ── Classic (game-specific pixel sprites) ────────────────────────────
  if (spriteStyle === "classic") {
    const effectiveGameKey = gameKey || defaultGameKeyForGeneration(resolvedId);
    return getClassicSpriteUrl(resolvedId, effectiveGameKey, shiny, canonicalName);
  }

  // ── Animated (Pokémon Showdown GIFs) ─────────────────────────────────
  if (spriteStyle === "animated") {
    return getShowdownAnimatedUrl(resolvedId, canonicalName, shiny, baseCanonical);
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

/** Resolve the automatic sprite for a species and recorded gender. */
export function getGenderSpriteUrl(
  pokemon: GenderSpritePokemon,
  pokedex: readonly GenderSpriteDexEntry[],
  gender: "male" | "female" | "genderless" | undefined,
): string | undefined {
  const species = pokedex.find(
    (entry) =>
      entry.canonical === pokemon.canonical_name ||
      entry.forms?.some((form) => form.canonical === pokemon.canonical_name),
  );
  if (!species) return undefined;
  const genderForms = species.forms?.filter((form) => form.gender) ?? [];
  const form = genderForms.find((candidate) => candidate.gender === gender);
  const selectedForm = species.forms?.find(
    (candidate) => !candidate.gender && candidate.canonical === pokemon.canonical_name,
  );
  const spriteForm = form ?? selectedForm;
  return getSpriteUrl(
    String(spriteForm?.sprite_id ?? species.id),
    pokemon.game,
    pokemon.sprite_type,
    pokemon.sprite_style || "box",
    spriteForm?.canonical ?? species.canonical,
    spriteForm?.sprite_slug,
    species.canonical,
    spriteForm?.gender,
  );
}

/** Lowercase a name and drop everything that is not a letter or a digit. */
function toShowdownId(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "");
}

/**
 * Build a Showdown sprite ID from a canonical name.
 *
 * Showdown keeps exactly one hyphen, the one between the species and its form
 * suffix, and drops every other one: "mr-mime-galar" is "mrmime-galar" and
 * "charizard-mega-x" is "charizard-megax". Nothing in the name itself marks
 * that separator (both "ho-oh" and "zigzagoon-galar" are one hyphen), so the
 * split comes from the base canonical when the caller knows it. Without it the
 * whole name collapses, which is what base species need anyway ("ho-oh" →
 * "hooh", "type-null" → "typenull").
 */
function toShowdownSlug(canonicalName: string, baseCanonical?: string): string {
  // Showdown spells the Paldean Tauros breeds without the "breed" word, and
  // dropping it first also keeps normalizeDefaultForm from swallowing
  // "-combat-breed" whole and collapsing that form onto plain "tauros".
  const name = normalizeDefaultForm(canonicalName.replace(/-breed$/, ""));
  const base = baseCanonical?.toLowerCase();
  if (!base || !name.toLowerCase().startsWith(`${base}-`)) return toShowdownId(name);
  return `${toShowdownId(base)}-${toShowdownId(name.slice(base.length + 1))}`;
}

/**
 * Animated GIF sprite from Pokémon Showdown.
 * Uses canonical name (e.g. "bulbasaur", "charizard-mega-x").
 */
function getShowdownAnimatedUrl(
  pokemonId: number,
  canonicalName?: string,
  shiny = false,
  baseCanonical?: string,
): string {
  const name = canonicalName || String(pokemonId);
  const slug = toShowdownSlug(name, baseCanonical);
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
  // Gen 4, BDSP remakes (must precede generic diamond/pearl)
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

  // Form variants (IDs > 10000) always use the default path.
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

  // Gen 6+ defaults to Showdown dex renders.
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
