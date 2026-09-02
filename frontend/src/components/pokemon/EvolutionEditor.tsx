/**
 * EvolutionEditor.tsx: Evolution chain block of the catch metadata dialog. It
 * records which species a caught shiny was evolved into after the catch, one
 * direct step at a time.
 */
import { useI18n } from "../../contexts/I18nContext";
import type { EvolutionStep } from "../../types";
import {
  buildFormStrip,
  getPkmnName,
  PokemonSearchPicker,
  type PickOrigin,
  type SearchResult,
} from "./pokemonPicker";

/**
 * The species that evolve directly from the one identified by `currentCanonical`.
 * A canonical naming a form resolves to its base species first, because the
 * evolution graph is keyed on species ids.
 */
export function directEvolutionCandidates(
  allPokemon: import("./pokemonPicker").PokemonData[],
  currentCanonical: string,
) {
  const currentSpecies = allPokemon.find(
    (entry) =>
      entry.canonical === currentCanonical ||
      entry.forms?.some((form) => form.canonical === currentCanonical),
  );
  return currentSpecies
    ? allPokemon.filter((entry) => entry.evolves_from_id === currentSpecies.id)
    : [];
}

/**
 * Editor for the evolution chain of a caught shiny.
 *
 * The chain is shown as an ordered list starting at the caught species, and
 * the picker below it only offers the direct evolutions of whatever the chain
 * currently ends on, so an impossible jump cannot be recorded.
 */
export function EvolutionEditor({
  originCanonical,
  evolutions,
  onChange,
  allPokemon,
  games,
  selectedGame,
  language,
}: Readonly<{
  originCanonical: string;
  evolutions: EvolutionStep[];
  onChange: (steps: EvolutionStep[]) => void;
  allPokemon: import("./pokemonPicker").PokemonData[];
  games: import("../../types").GameEntry[];
  selectedGame: string;
  language: string;
}>) {
  const { t } = useI18n();
  const currentCanonical = evolutions[evolutions.length - 1]?.canonical_name ?? originCanonical;
  const nextSpecies = directEvolutionCandidates(allPokemon, currentCanonical);
  const label = (canonical: string) => {
    const species = allPokemon.find(
      (entry) =>
        entry.canonical === canonical || entry.forms?.some((form) => form.canonical === canonical),
    );
    const form = species?.forms?.find((entry) => entry.canonical === canonical);
    return form
      ? getPkmnName(form, language, t("dex.genderFormFemale"))
      : species
        ? getPkmnName(species, language)
        : canonical;
  };
  const add = (entry: SearchResult, origin: PickOrigin) => {
    const base = allPokemon.find((candidate) => candidate.id === entry.id);
    if (
      origin === "search" &&
      base &&
      buildFormStrip(base, selectedGame, games, language).length > 0
    )
      return;
    if (entry.canonical === currentCanonical) return;
    onChange([...evolutions, { canonical_name: entry.canonical, gender: entry.gender }]);
  };
  return (
    <section className="flex flex-col gap-2 border-t border-border-subtle pt-4">
      <div>
        <h3 className="t-label">{t("catchMeta.evolutionTitle")}</h3>
        <p className="mt-1 text-xs text-text-muted">{t("catchMeta.evolutionHint")}</p>
      </div>
      <ol className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
        <li className="t-label t-label--accent">{label(originCanonical)}</li>
        {evolutions.map((step, index) => (
          <li key={`${step.canonical_name}-${index}`} className="contents">
            <span aria-hidden="true">→</span>
            <span className="t-label t-label--accent">{label(step.canonical_name)}</span>
          </li>
        ))}
      </ol>
      <PokemonSearchPicker
        allPokemon={nextSpecies}
        games={games}
        selectedGame={selectedGame}
        language={language}
        placeholder={t("catchMeta.evolutionSearch")}
        inputLabel={t("catchMeta.evolutionSearch")}
        selectedCanonical={currentCanonical}
        onPick={add}
      />
      {evolutions.length > 0 && (
        <button
          type="button"
          onClick={() => onChange(evolutions.slice(0, -1))}
          className="self-start t-label text-text-muted hover:text-accent-red"
        >
          {t("catchMeta.evolutionUndo")}
        </button>
      )}
    </section>
  );
}
