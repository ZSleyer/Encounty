/**
 * dexSeen.ts: best-effort sync between a failed shiny hunt and the manual
 * Pokédex override system.
 *
 * A shiny that got away was still seen, and the dex should reflect that even
 * though nothing was ever caught. This reuses the existing manual override
 * escape hatch (see useDexOverrides.ts / DexOverrideModal.tsx) instead of a
 * dedicated seen flag on Pokemon, so the dex projection needs no new code
 * path: an override with `seen: true` already renders exactly this state.
 */
import { apiUrl } from "./api";
import type { CatchMeta } from "../types";
import type { PokemonData } from "../components/pokemon/pokemonPicker";

/** Raw payload of one row from GET/PUT /api/pokedex/overrides. */
interface OverridePayload {
  id: number;
  species_id: number;
  form_canonical?: string;
  gender?: string;
  game?: string;
  caught: boolean;
  seen: boolean;
  meta?: CatchMeta;
}

/** Resolved species/form target of a canonical name. */
interface ResolvedTarget {
  speciesId: number;
  /** The matched form's own canonical, or "" when the match was the base species. */
  formCanonical: string;
}

/**
 * Resolves a canonical name (case-insensitive) to its species id and, when it
 * names a specific form rather than the base species, that form's own
 * canonical. Species are checked before forms, mirroring the lookup
 * `buildDexIndex` uses for the same pokedex data, except this keeps the
 * matched form's own identity instead of collapsing it onto the species slot:
 * a failed `vulpix-alola` hunt should mark that form seen, not plain Vulpix.
 */
function resolveTarget(pokedex: PokemonData[], canonicalName: string): ResolvedTarget | null {
  const needle = canonicalName.toLowerCase();
  for (const species of pokedex) {
    if (species.canonical.toLowerCase() === needle) {
      return { speciesId: species.id, formCanonical: "" };
    }
  }
  for (const species of pokedex) {
    for (const form of species.forms ?? []) {
      if (form.canonical.toLowerCase() === needle) {
        return { speciesId: species.id, formCanonical: form.canonical };
      }
    }
  }
  return null;
}

/**
 * Marks a species (or form) as seen in the Pokédex after a failed hunt, using
 * the manual override system.
 *
 * Writes a global override (no gender/game scope), the same default
 * `DexOverrideModal` uses when a hunter marks a species by hand: the failed
 * hunt itself carries no gender information, and scoping to its game would
 * make the "seen" mark disappear from every other game's dex view.
 *
 * Best-effort and fire-and-forget: the fail action itself already succeeded
 * by the time this runs, so a dex-sync hiccup must never surface as a
 * failure of that action. Every error, including a missing fetch or a
 * malformed response, is swallowed.
 */
export async function markSpeciesSeen(canonicalName: string): Promise<void> {
  if (!canonicalName) return;
  try {
    const pokedexRes = await fetch(apiUrl("/api/pokedex"));
    if (!pokedexRes.ok) return;
    const pokedex: PokemonData[] = await pokedexRes.json();
    const target = resolveTarget(pokedex, canonicalName);
    if (!target) return;

    const overridesRes = await fetch(apiUrl("/api/pokedex/overrides"));
    if (!overridesRes.ok) return;
    const overrides: OverridePayload[] = await overridesRes.json();
    const existing = overrides.find(
      (o) =>
        o.species_id === target.speciesId &&
        (o.form_canonical ?? "") === target.formCanonical &&
        (o.gender ?? "") === "" &&
        (o.game ?? "") === "",
    );
    // Already seen (caught implies seen too): nothing left to record.
    if (existing?.seen) return;

    await fetch(apiUrl("/api/pokedex/overrides"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        species_id: target.speciesId,
        form_canonical: target.formCanonical,
        gender: "",
        game: "",
        // Never downgrade an existing "caught" override; this call only ever
        // adds the seen flag.
        caught: existing?.caught ?? false,
        seen: true,
        // meta is omitted on purpose: the backend leaves a stored meta
        // untouched when the key is absent from the body, so an existing
        // manual entry's details survive this sync.
      }),
    });
  } catch {
    // The fail action already succeeded; a dex-sync failure here must never
    // surface as one.
  }
}
