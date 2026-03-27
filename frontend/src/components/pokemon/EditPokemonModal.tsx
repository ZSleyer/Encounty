import { PokemonFormModal } from "./PokemonFormModal";
export type { NewPokemonData } from "./PokemonFormModal";
import type { NewPokemonData, ExistingPokemonData } from "./PokemonFormModal";
import type { SpriteType, SpriteStyle } from "../../utils/sprites";

type Props = Readonly<{
  pokemon: {
    id: string;
    name: string;
    title?: string;
    canonical_name: string;
    sprite_url: string;
    sprite_type: SpriteType;
    sprite_style?: SpriteStyle;
    language: string;
    game: string;
    hunt_type?: string;
    step?: number;
  };
  onSave: (id: string, data: NewPokemonData) => void;
  onClose: () => void;
  activeLanguages?: string[];
}>;

/** Thin wrapper around PokemonFormModal in "edit" mode. */
export function EditPokemonModal({ pokemon, onSave, onClose, activeLanguages }: Readonly<Props>) {
  return (
    <PokemonFormModal
      mode="edit"
      pokemon={pokemon as ExistingPokemonData}
      onSubmit={onSave}
      onClose={onClose}
      activeLanguages={activeLanguages}
    />
  );
}
