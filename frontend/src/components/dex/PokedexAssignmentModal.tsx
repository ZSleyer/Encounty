import { useMemo, useState } from "react";
import type { Pokemon } from "../../types";
import { usePokedex } from "../pokemon/pokemonPicker";
import { useUserPokedexes } from "../../hooks/useUserPokedexes";
import { pokemonInPokedex } from "../../utils/userPokedex";
import { useI18n } from "../../contexts/I18nContext";
import { ModalActions, ModalShell } from "../shared/ModalShell";

export function PokedexAssignmentModal({
  pokemon,
  onSave,
  onClose,
}: Readonly<{ pokemon: Pokemon; onSave: (ids: string[]) => Promise<void>; onClose: () => void }>) {
  const { t } = useI18n();
  const { allPokemon, games } = usePokedex();
  const { pokedexes } = useUserPokedexes();
  const eligible = useMemo(
    () => pokedexes.filter((dex) => pokemonInPokedex(pokemon, dex, allPokemon, games)),
    [pokedexes, pokemon, allPokemon, games],
  );
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) =>
    setSelected((ids) => (ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]));
  return (
    <ModalShell
      title={t("modal.pokedexes")}
      onClose={onClose}
      structured
      footer={(requestClose) => (
        <ModalActions
          requestClose={requestClose}
          confirmLabel={t("common.confirm")}
          onConfirm={() => void onSave(selected)}
          confirmDisabled={eligible.length > 0 && selected.length === 0}
        />
      )}
    >
      {eligible.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {eligible.map((dex) => (
            <label key={dex.id} className="t-label gap-2 px-2">
              <input
                type="checkbox"
                checked={selected.includes(dex.id)}
                onChange={() => toggle(dex.id)}
              />
              {dex.name}
            </label>
          ))}
        </div>
      ) : (
        <p className="text-sm text-accent-yellow">{t("modal.noEligiblePokedex")}</p>
      )}
    </ModalShell>
  );
}
