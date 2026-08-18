import type { Pokemon } from "../types";

export const pokemonDisplayName = (pokemon: Pick<Pokemon, "name" | "nickname">): string =>
  pokemon.nickname?.trim() || pokemon.name;
