import type { PokemonData, PokemonForm } from "../components/pokemon/pokemonPicker";
import type { GameEntry, Pokemon } from "../types";

export type DexFormCategory = "regional" | "mega" | "gigantamax" | "gender" | "cosmetic" | "other";
export const FORM_CATEGORIES: DexFormCategory[] = [
  "regional",
  "mega",
  "gigantamax",
  "gender",
  "cosmetic",
  "other",
];

export interface UserPokedex {
  id: string;
  name: string;
  show_forms: boolean;
  /** Only the stage an evolved catch currently is counts, not the ones it passed through. */
  living_dex: boolean;
  generations: number[];
  target_games: string[];
  catch_games: string[];
  form_categories: DexFormCategory[];
  include_species: number[];
  exclude_species: number[];
}

export const DEFAULT_POKEDEX: UserPokedex = {
  id: "default",
  name: "Living Dex",
  show_forms: true,
  living_dex: false,
  generations: [],
  target_games: [],
  catch_games: [],
  form_categories: FORM_CATEGORIES,
  include_species: [],
  exclude_species: [],
};

export function formCategory(form: PokemonForm): DexFormCategory {
  if (form.gender) return "gender";
  if (/(?:^|-)(?:alola|galar|hisui|paldea)(?:-|$)/.test(form.canonical)) return "regional";
  if (/-mega(?:-[xy])?$/.test(form.canonical)) return "mega";
  if (/-gmax$/.test(form.canonical)) return "gigantamax";
  return form.sprite_id === 0 ? "cosmetic" : "other";
}

/** Highest species id of each generation, ordered from generation 1 upwards. */
const GENERATION_MAX_SPECIES_ID = [151, 251, 386, 493, 649, 721, 809, 905];

/**
 * generationOf resolves the generation a species id belongs to. Ids past the
 * last boundary fall into generation 9, which stays open-ended until its own
 * upper bound is known.
 */
function generationOf(speciesId: number): number {
  const index = GENERATION_MAX_SPECIES_ID.findIndex((max) => speciesId <= max);
  return index === -1 ? 9 : index + 1;
}

export function speciesInPokedex(
  species: PokemonData,
  dex: UserPokedex,
  _games: GameEntry[],
): boolean {
  if (dex.exclude_species.includes(species.id)) return false;
  if (dex.include_species.includes(species.id)) return true;
  if (dex.generations.length === 0 && dex.target_games.length === 0) return true;
  const generation = generationOf(species.id);
  if (dex.generations.includes(generation)) return true;
  return dex.target_games.some((key) => species.games?.includes(key));
}

export function pokemonInPokedex(
  pokemon: Pokemon,
  dex: UserPokedex,
  pokedex: PokemonData[],
  games: GameEntry[],
): boolean {
  if (dex.catch_games.length > 0 && !dex.catch_games.includes(pokemon.game)) return false;
  const species = pokedex.find(
    (entry) =>
      entry.canonical === pokemon.canonical_name ||
      entry.forms?.some((form) => form.canonical === pokemon.canonical_name),
  );
  if (!species || !speciesInPokedex(species, dex, games)) return false;
  const form = species.forms?.find((candidate) => candidate.canonical === pokemon.canonical_name);
  return !form || (dex.show_forms && dex.form_categories.includes(formCategory(form)));
}
