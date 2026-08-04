/**
 * dex.ts: resolves archived catches onto Pokédex species slots.
 *
 * The index is a pure projection of two inputs, the synced pokedex and the
 * current state snapshot, so callers can rebuild it inside a `useMemo` without
 * caching anything themselves. Nothing here reads the clock, fetches, or
 * mutates its arguments.
 *
 * A partially synced pokedex is a legal state (the backend only guarantees a
 * threshold, not the full national dex), so every lookup goes through a map
 * keyed by dex id. Indexing an array by `id - 1` would silently shift every
 * species behind a gap onto the wrong slot.
 */
import type { Pokemon } from "../types";
import type { PokemonData } from "../components/pokemon/pokemonPicker";
import { getPokemonGeneration } from "./sprites";

/** Which catches the index counts: the whole archive or one game only. */
export type DexMode = "national" | "game";

/** One pokedex species slot with the archived catches resolved onto it. */
export interface DexEntry {
  /** National Dex number. */
  id: number;
  /** English PokéAPI slug of the base species. */
  canonical: string;
  /** Generation the species was introduced in. */
  generation: number;
  /** Completed entries on this slot, newest `completed_at` first. */
  catches: Pokemon[];
  /** Distinct non-default form canonicals among `catches`, first seen first. */
  variants: string[];
}

/** The full dex projection for one mode/game combination. */
export interface DexIndex {
  /** One entry per rendered species, in pokedex order. */
  entries: DexEntry[];
  /** Number of entries carrying at least one catch. */
  caught: number;
  /** Number of rendered species; the denominator of every progress readout. */
  total: number;
  /** Completed catches that resolve onto no species slot. */
  unmatched: Pokemon[];
}

/**
 * Highest National Dex number that existed at the end of each generation.
 *
 * A game can only ever show the National Dex of its own generation, so this is
 * the species cap of a game-mode view. The boundaries mirror
 * `getPokemonGeneration`, which splits the dex at the very same numbers.
 */
const GENERATION_DEX_CAP: Record<number, number> = {
  1: 151,
  2: 251,
  3: 386,
  4: 493,
  5: 649,
  6: 721,
  7: 809,
  8: 905,
  9: 1025,
};

/**
 * Highest dex number the current view renders, or null for "no cap".
 *
 * A generation this table does not know yet falls back to the uncapped view
 * rather than to an empty dex, so a newly synced game group stays usable
 * before its cap is filled in here.
 */
function resolveDexCap(mode: DexMode, generation: number | undefined): number | null {
  if (mode === "game" && generation !== undefined) {
    return GENERATION_DEX_CAP[generation] ?? null;
  }
  return null;
}

/**
 * Builds the lookup from every known canonical to its species dex id.
 *
 * Species names are written first and form names only fill the gaps, so a form
 * that happens to share a species canonical can never steal that slot. Form
 * canonicals resolve to their base species, which is what puts a
 * `vulpix-alola` catch on slot 37.
 */
function buildCanonicalIndex(pokedex: PokemonData[]): Map<string, number> {
  const byCanonical = new Map<string, number>();
  for (const species of pokedex) {
    byCanonical.set(species.canonical.toLowerCase(), species.id);
  }
  for (const species of pokedex) {
    for (const form of species.forms ?? []) {
      const key = form.canonical.toLowerCase();
      if (!byCanonical.has(key)) byCanonical.set(key, species.id);
    }
  }
  return byCanonical;
}

/** Sorts two completed entries newest first, treating a missing date as oldest. */
function byNewestCompletion(a: Pokemon, b: Pokemon): number {
  return (b.completed_at ?? "").localeCompare(a.completed_at ?? "");
}

/** Distinct catch canonicals that differ from the species canonical. */
function collectVariants(entry: DexEntry): string[] {
  const seen = new Set<string>();
  const variants: string[] = [];
  for (const p of entry.catches) {
    const canonical = p.canonical_name?.toLowerCase() ?? "";
    if (!canonical || canonical === entry.canonical.toLowerCase()) continue;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    variants.push(p.canonical_name);
  }
  return variants;
}

/** Catches that belong to no slot in the current view. */
type Rejected = "skip" | "unmatched";

/**
 * Decides where a single archive entry goes.
 *
 * "skip" drops the entry from this view entirely (an active hunt, or a catch
 * from a different game while a game filter is on). "unmatched" keeps it
 * visible but uncounted. The game filter runs before the species lookup on
 * purpose: in game mode the unmatched list describes the selected game, not
 * the whole archive.
 */
function placeCatch(
  p: Pokemon,
  mode: DexMode,
  game: string,
  byCanonical: Map<string, number>,
  slots: Map<number, DexEntry>,
): DexEntry | Rejected {
  if (!p.completed_at) return "skip";
  if (mode === "game") {
    if (!p.game) return "unmatched";
    if (p.game !== game) return "skip";
  }
  const id = byCanonical.get(p.canonical_name?.toLowerCase() ?? "");
  if (id === undefined) return "unmatched";
  // Species above the game's dex cap have no slot. Traded or transferred
  // catches land there, and losing them silently would be worse than listing
  // them as unmatched.
  return slots.get(id) ?? "unmatched";
}

/**
 * Projects the archived catches onto the pokedex species list.
 *
 * Only entries carrying `completed_at` count, which includes finished phases
 * (they are ordinary completed entries with a `phase_of` back-reference) and
 * excludes every running hunt. Game mode renders the National Dex of the
 * game's generation, national mode the whole species list.
 * @param pokedex Dex-ordered species as delivered by GET /api/pokedex.
 * @param catches The current snapshot's Pokémon entries, hunts included.
 * @param mode "national" counts every game, "game" only the selected one.
 * @param game Game key the "game" mode filters on; ignored in national mode.
 * @param generation Generation of that game; ignored in national mode. An
 * omitted or unknown generation renders the uncapped species list.
 * @returns A fresh index; neither argument is modified.
 */
export function buildDexIndex(
  pokedex: PokemonData[],
  catches: Pokemon[],
  mode: DexMode,
  game: string,
  generation?: number,
): DexIndex {
  const cap = resolveDexCap(mode, generation);
  const visible = cap === null ? pokedex : pokedex.filter((s) => s.id <= cap);

  const entries: DexEntry[] = visible.map((species) => ({
    id: species.id,
    canonical: species.canonical,
    generation: getPokemonGeneration(species.id),
    catches: [],
    variants: [],
  }));

  const slots = new Map<number, DexEntry>();
  for (const entry of entries) {
    if (!slots.has(entry.id)) slots.set(entry.id, entry);
  }
  const byCanonical = buildCanonicalIndex(pokedex);

  const unmatched: Pokemon[] = [];
  for (const p of catches) {
    const target = placeCatch(p, mode, game, byCanonical, slots);
    if (target === "skip") continue;
    if (target === "unmatched") {
      unmatched.push(p);
      continue;
    }
    target.catches.push(p);
  }

  let caught = 0;
  for (const entry of entries) {
    if (entry.catches.length === 0) continue;
    caught++;
    entry.catches.sort(byNewestCompletion);
    entry.variants = collectVariants(entry);
  }

  return { entries, caught, total: entries.length, unmatched };
}
