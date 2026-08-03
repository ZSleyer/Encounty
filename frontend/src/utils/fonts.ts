/**
 * fonts.ts: the font sources the overlay editor offers and the overlay renders.
 *
 * Three sources feed the font picker: the engine aliases that the overlay maps
 * to concrete CSS stacks, a curated list of Google Fonts that the overlay page
 * may load over the network, and the families installed on the user's own
 * machine (Local Font Access API). Both the picker and the overlay page read
 * the curated list from here so they cannot drift apart about which family is
 * actually available on fonts.googleapis.com.
 */

/**
 * ENGINE_FONT_ALIASES are the abstract families the overlay resolves to its own
 * CSS stacks. They are never fetched from the network.
 */
export const ENGINE_FONT_ALIASES = ["sans", "serif", "monospace", "pokemon"] as const;

/** EngineFontAlias is one of the abstract families the overlay resolves itself. */
export type EngineFontAlias = (typeof ENGINE_FONT_ALIASES)[number];

/**
 * GOOGLE_FONTS is the curated list of families served by fonts.googleapis.com.
 * Only these may be requested from Google: any other family has to come from
 * the machine the overlay renders on.
 */
export const GOOGLE_FONTS = [
  "Bebas Neue",
  "Cinzel",
  "Exo 2",
  "Lato",
  "Merriweather",
  "Montserrat",
  "Nunito",
  "Open Sans",
  "Orbitron",
  "Oswald",
  "Playfair Display",
  "Poppins",
  "Press Start 2P",
  "Raleway",
  "Roboto",
  "Ubuntu",
] as const;

const ENGINE_FONT_ALIAS_SET: ReadonlySet<string> = new Set(ENGINE_FONT_ALIASES);
const GOOGLE_FONT_SET: ReadonlySet<string> = new Set(GOOGLE_FONTS);

/** isEngineFontAlias reports whether the overlay resolves the family itself. */
export function isEngineFontAlias(family: string): boolean {
  return ENGINE_FONT_ALIAS_SET.has(family);
}

/**
 * isGoogleFont reports whether a family exists in the curated Google Fonts
 * list, which is the only case where a stylesheet request to Google makes
 * sense. Locally installed families such as "Comic Sans MS" return false.
 */
export function isGoogleFont(family: string): boolean {
  return GOOGLE_FONT_SET.has(family);
}

/**
 * LocalFontEntry is the subset of the platform's FontData that the picker uses.
 * `queryLocalFonts()` returns one entry per style (Regular, Bold, Italic, …),
 * all sharing the same `family`.
 */
export interface LocalFontEntry {
  readonly family: string;
}

/**
 * LocalFontQueryResult is the outcome of asking for the installed families.
 * "unsupported" means the API is absent (Firefox, the OBS browser source,
 * jsdom), "denied" covers a refused permission or a missing user gesture.
 */
export type LocalFontQueryResult =
  | { readonly status: "ok"; readonly families: readonly string[] }
  | { readonly status: "unsupported" }
  | { readonly status: "denied" };

/** Window shape once the Local Font Access API is present. */
interface LocalFontAccessWindow {
  queryLocalFonts?: () => Promise<readonly LocalFontEntry[]>;
}

function localFontAccess(): LocalFontAccessWindow | undefined {
  if (typeof globalThis === "undefined") return undefined;
  return globalThis as unknown as LocalFontAccessWindow;
}

/**
 * dedupeFontFamilies collapses the per-style entries of `queryLocalFonts()`
 * into a sorted list of unique family names. Empty and blank families are
 * dropped so they cannot produce an unselectable option.
 */
export function dedupeFontFamilies(fonts: readonly LocalFontEntry[]): string[] {
  const families = new Set<string>();
  for (const font of fonts) {
    const family = font?.family?.trim();
    if (family) families.add(family);
  }
  return [...families].sort((a, b) => a.localeCompare(b));
}

/**
 * supportsLocalFonts feature-detects the Local Font Access API. It is missing
 * in Firefox, in the OBS browser source and in jsdom, so every caller must be
 * able to carry on without it.
 */
export function supportsLocalFonts(): boolean {
  return typeof localFontAccess()?.queryLocalFonts === "function";
}

/**
 * queryLocalFontFamilies asks the platform for the installed families and
 * returns them deduplicated. It never throws: a missing API reports
 * "unsupported", a refused permission or a call without user activation
 * reports "denied".
 */
export async function queryLocalFontFamilies(): Promise<LocalFontQueryResult> {
  const query = localFontAccess()?.queryLocalFonts;
  if (typeof query !== "function") return { status: "unsupported" };
  try {
    const fonts = await query.call(localFontAccess());
    return { status: "ok", families: dedupeFontFamilies(fonts ?? []) };
  } catch {
    return { status: "denied" };
  }
}
