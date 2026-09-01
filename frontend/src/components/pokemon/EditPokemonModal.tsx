import { PokemonFormModal } from "./PokemonFormModal";
export type { NewPokemonData } from "./PokemonFormModal";
import type { NewPokemonData, ExistingPokemonData, GroupOption } from "./PokemonFormModal";
import type { SpriteType, SpriteStyle } from "../../utils/sprites";
import type { PhaseTarget, ShinyVariant } from "../../types";

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
    shiny_charm?: boolean;
    sparkling_power?: number;
    shiny_variant?: ShinyVariant;
    step?: number;
    encounters?: number;
    timer_accumulated_ms?: number;
    group_id?: string;
    tags?: string[];
    /** Species that end a phase when they show up shiny. */
    phase_targets?: PhaseTarget[];
    /** ID of the parent hunt when this entry is a finished phase. */
    phase_of?: string;
    pokedex_ids?: string[];
  };
  onSave: (id: string, data: NewPokemonData) => void;
  onClose: () => void;
  activeLanguages?: string[];
  groups?: GroupOption[];
  availableTags?: string[];
  onManageGroups?: () => void;
  enablePokedexes?: boolean;
}>;

/** Thin wrapper around PokemonFormModal in "edit" mode. */
export function EditPokemonModal({
  pokemon,
  onSave,
  onClose,
  activeLanguages,
  groups,
  availableTags,
  onManageGroups,
  enablePokedexes,
}: Readonly<Props>) {
  return (
    <PokemonFormModal
      mode="edit"
      pokemon={pokemon as ExistingPokemonData}
      onSubmit={onSave}
      onClose={onClose}
      activeLanguages={activeLanguages}
      groups={groups}
      availableTags={availableTags}
      onManageGroups={onManageGroups}
      enablePokedexes={enablePokedexes}
    />
  );
}
