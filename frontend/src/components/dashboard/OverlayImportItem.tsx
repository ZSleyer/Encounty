/**
 * OverlayImportItem.tsx: One entry of the overlay import dropdown.
 */

import { Pokemon } from "../../types";
import { pokemonDisplayName } from "../../utils/pokemon";

/** Renders a single import-overlay-from-pokemon button in the import dropdown. */
export function OverlayImportItem({
  pokemon,
  onCopy,
}: Readonly<{ pokemon: Pokemon; onCopy: (id: string) => void }>) {
  const icon = pokemon.sprite_url ? (
    <img src={pokemon.sprite_url} alt="" className="w-4 h-4 object-contain" />
  ) : (
    <div className="w-4 h-4 rounded-none bg-bg-hover" />
  );
  return (
    <button
      onClick={() => onCopy(pokemon.id)}
      className="w-full text-left px-3 py-2 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors flex items-center gap-2"
    >
      {icon}
      {pokemonDisplayName(pokemon)}
    </button>
  );
}
