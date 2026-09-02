/**
 * CurrentEvolutionSprite.tsx: sprite of the stage a catch currently sits on.
 *
 * Shared by the archived catch card and the manual entry card, which record
 * their evolution chain the same way and must therefore show the same sprite.
 */
import { PokemonThumb, type PokemonData } from "../pokemon/pokemonPicker";

/** Thumbnail of the evolution stage a catch has reached, resolved by canonical name. */
export function CurrentEvolutionSprite({
  canonical,
  gender,
  allPokemon,
}: Readonly<{
  canonical: string;
  gender?: "male" | "female" | "genderless";
  allPokemon: PokemonData[];
}>) {
  const species = allPokemon.find(
    (entry) =>
      entry.canonical === canonical || entry.forms?.some((form) => form.canonical === canonical),
  );
  const form = species?.forms?.find((entry) => entry.canonical === canonical);
  return (
    <PokemonThumb
      spriteId={form?.sprite_id ?? species?.id ?? 0}
      canonical={canonical}
      spriteSlug={form?.sprite_slug}
      gender={form?.gender ?? (gender === "male" || gender === "female" ? gender : undefined)}
      alt=""
      className="h-8 w-8 shrink-0 object-contain"
    />
  );
}
