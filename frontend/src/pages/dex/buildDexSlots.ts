/**
 * buildDexSlots.ts: turns the dex index into the slots the grid renders.
 *
 * One species becomes one base slot plus, while the active Pokédex shows
 * forms, one slot per form it allows in the current game. Everything the grid
 * needs is flattened onto the slot here, including its complete aria sentence,
 * so rendering a slot never has to reach back into the index.
 */
import { isFormAvailableForGame, type PokemonData } from "../../components/pokemon/pokemonPicker";
import { formCanonicalLabel } from "../../components/dex/dexOverrideLabels";
import type { DexIndex, DexMode } from "../../utils/dex";
import { formCategory, type UserPokedex } from "../../utils/userPokedex";
import type { GameEntry } from "../../types";
import { formSlotLabel, localizedName, slotLabel } from "./dexFilters";
import type { DexSlotView } from "./types";

/** Everything {@link buildDexSlots} reads; all of it owned by the dex page. */
export interface BuildDexSlotsArgs {
  /** The resolved dex index the slots are built from. */
  readonly index: DexIndex;
  /** Full species catalog, for the localized name and the form list. */
  readonly allPokemon: PokemonData[];
  /** UI locale of the species and form names. */
  readonly locale: string;
  /** Translator for the aria sentences. */
  readonly t: (key: string, options?: Record<string, string | number>) => string;
  /** Active Pokédex, which decides whether forms get their own slots. */
  readonly pokedex: UserPokedex;
  /** National or per-game dex. */
  readonly mode: DexMode;
  /** Game key while `mode` is "game". */
  readonly game: string;
  /** Game catalog, for the per-game form availability. */
  readonly games: GameEntry[];
}

/** Flattens the dex index into one view model per rendered grid slot. */
export function buildDexSlots({
  index,
  allPokemon,
  locale,
  t,
  pokedex,
  mode,
  game,
  games,
}: BuildDexSlotsArgs): DexSlotView[] {
  const speciesById = new Map(allPokemon.map((species) => [species.id, species]));
  const result: DexSlotView[] = [];
  for (const entry of index.entries) {
    const species = speciesById.get(entry.id);
    const name = species ? localizedName(species, locale) : entry.canonical;
    const catchCount = entry.baseCatchCount;
    const formEntryCount = pokedex.show_forms
      ? 0
      : entry.forms.filter((form) => form.caught || form.seen).length;
    const seenOnly = entry.seen && !entry.caught;
    result.push({
      slotKey: String(entry.id),
      id: entry.id,
      canonical: entry.canonical,
      name,
      generation: entry.generation,
      caught: entry.caught,
      seenOnly,
      catchCount,
      formEntryCount,
      label: slotLabel(t, entry.id, name, entry.caught, seenOnly, catchCount, formEntryCount),
      spriteId: entry.id,
      shinyVariants: entry.shinyVariants,
    });

    if (!pokedex.show_forms) continue;
    const forms = (species?.forms ?? []).filter((form) =>
      pokedex.form_categories.includes(formCategory(form)),
    );
    const formStates = new Map(entry.forms.map((f) => [f.canonical.toLowerCase(), f]));
    for (const form of forms) {
      if (!isFormAvailableForGame(form, mode === "game" ? game : "", games)) continue;
      const state = formStates.get(form.canonical.toLowerCase());
      const formCaught = state?.caught ?? false;
      const formSeenOnly = (state?.seen ?? false) && !formCaught;
      const formName = formCanonicalLabel(form, locale, t);
      result.push({
        slotKey: `${entry.id}:${form.canonical}`,
        id: entry.id,
        canonical: form.canonical,
        name: formName,
        generation: entry.generation,
        caught: formCaught,
        seenOnly: formSeenOnly,
        catchCount: state?.catchCount ?? 0,
        formEntryCount: 0,
        label: formSlotLabel(
          t,
          entry.id,
          name,
          formName,
          formCaught,
          formSeenOnly,
          state?.catchCount ?? 0,
        ),
        spriteId: form.sprite_id,
        spriteSlug: form.sprite_slug,
        gender: form.gender,
        shinyVariants: entry.shinyVariants,
      });
    }
  }
  return result;
}
