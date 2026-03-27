export type { NewPokemonData } from "./PokemonFormModal";
import { PokemonFormModal } from "./PokemonFormModal";
import type { NewPokemonData } from "./PokemonFormModal";

type Props = Readonly<{
  onAdd: (data: NewPokemonData) => void;
  onClose: () => void;
  activeLanguages?: string[];
}>;

/** Thin wrapper around PokemonFormModal in "add" mode. */
export function AddPokemonModal({ onAdd, onClose, activeLanguages }: Props) {
  return (
    <PokemonFormModal
      mode="add"
      onSubmit={onAdd}
      onClose={onClose}
      activeLanguages={activeLanguages}
    />
  );
}
