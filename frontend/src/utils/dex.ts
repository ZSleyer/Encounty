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
  /** One entry per pokedex species, in pokedex order. */
  entries: DexEntry[];
  /** Number of entries carrying at least one catch. */
  caught: number;
  /** Total species count. Never shrinks in game mode. */
  total: number;
  /** Completed catches that resolve onto no species slot. */
  unmatched: Pokemon[];
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
  return slots.get(id) ?? "unmatched";
}

/**
 * Projects the archived catches onto the pokedex species list.
 *
 * Only entries carrying `completed_at` count, which includes finished phases
 * (they are ordinary completed entries with a `phase_of` back-reference) and
 * excludes every running hunt. `total` is always the full species count so the
 * denominator does not move when the game filter changes.
 * @param pokedex Dex-ordered species as delivered by GET /api/pokedex.
 * @param catches The current snapshot's Pokémon entries, hunts included.
 * @param mode "national" counts every game, "game" only the selected one.
 * @param game Game key the "game" mode filters on; ignored in national mode.
 * @returns A fresh index; neither argument is modified.
 */
export function buildDexIndex(
  pokedex: PokemonData[],
  catches: Pokemon[],
  mode: DexMode,
  game: string,
): DexIndex {
  const entries: DexEntry[] = pokedex.map((species) => ({
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
