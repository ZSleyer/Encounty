export type { NewPokemonData } from "./PokemonFormModal";
import { PokemonFormModal } from "./PokemonFormModal";
import type { NewPokemonData, GroupOption } from "./PokemonFormModal";

type Props = Readonly<{
  onAdd: (data: NewPokemonData) => void;
  onClose: () => void;
  activeLanguages?: string[];
  groups?: GroupOption[];
  availableTags?: string[];
  onManageGroups?: () => void;
}>;

/** Thin wrapper around PokemonFormModal in "add" mode. */
export function AddPokemonModal({ onAdd, onClose, activeLanguages, groups, availableTags, onManageGroups }: Props) {
  return (
    <PokemonFormModal
      mode="add"
      onSubmit={onAdd}
      onClose={onClose}
      activeLanguages={activeLanguages}
      groups={groups}
      availableTags={availableTags}
      onManageGroups={onManageGroups}
    />
  );
}
