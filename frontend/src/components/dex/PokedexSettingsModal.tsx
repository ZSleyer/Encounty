import { useRef, useState } from "react";
import type { GameEntry } from "../../types";
import { FORM_CATEGORIES, type UserPokedex } from "../../utils/userPokedex";
import { ModalShell } from "../shared/ModalShell";
import { useI18n } from "../../contexts/I18nContext";
import { getGameName } from "../../utils/games";
import { ConfirmModal } from "../shared/ConfirmModal";

export function PokedexSettingsModal({
  pokedex,
  games,
  onSave,
  onClose,
}: Readonly<{
  pokedex: UserPokedex;
  games: GameEntry[];
  onSave: (value: UserPokedex) => Promise<void>;
  onClose: () => void;
}>) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState(pokedex);
  const [includeSpecies, setIncludeSpecies] = useState(pokedex.include_species.join(", "));
  const [excludeSpecies, setExcludeSpecies] = useState(pokedex.exclude_species.join(", "));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [discardClose, setDiscardClose] = useState<(() => void) | null>(null);
  const allowClose = useRef(false);
  const inputClass =
    "w-full border border-border-subtle bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-faint focus:border-accent-blue/50";
  const toggle = <T,>(items: T[], item: T) =>
    items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
  const value = {
    ...draft,
    include_species: parseSpeciesIds(includeSpecies),
    exclude_species: parseSpeciesIds(excludeSpecies),
  };
  const dirty =
    JSON.stringify(normalizePokedex(value)) !== JSON.stringify(normalizePokedex(pokedex));
  const guardClose = (proceed: () => void) => {
    if (!dirty || allowClose.current) proceed();
    else setDiscardClose(() => proceed);
  };
  return (
    <>
      <ModalShell
        title={t("dex.settingsTitle")}
        onClose={onClose}
        onBeforeClose={guardClose}
        structured
        footer={(requestClose) => (
          <div className="flex gap-3">
            <button
              className="flex-1 border border-border-subtle px-4 py-2 text-sm text-text-muted transition-colors hover:border-text-muted hover:text-text-primary"
              onClick={requestClose}
            >
              {t("common.cancel")}
            </button>
            <button
              disabled={saving}
              className="t-cut flex-1 bg-accent-blue px-4 py-2 text-sm font-semibold text-bg-primary transition-colors hover:bg-accent-blue/80 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => {
                setSaving(true);
                setError("");
                void onSave(value)
                  .then(() => {
                    allowClose.current = true;
                    requestClose();
                  })
                  .catch(() => setError(t("dex.settingsConflict")))
                  .finally(() => setSaving(false));
              }}
            >
              {t("common.save")}
            </button>
          </div>
        )}
      >
        <div className="space-y-5">
          {error && (
            <p role="alert" className="text-sm text-accent-red">
              {error}
            </p>
          )}
          <div>
            <div className="mb-1 flex items-center gap-2">
              <label htmlFor="pokedex-name" className="text-xs text-text-muted">
                {t("dex.settingsName")}
              </label>
              {draft.id === "default" && (
                <span className="t-label t-label--accent">{t("dex.defaultMarker")}</span>
              )}
            </div>
            <input
              id="pokedex-name"
              type="text"
              autoComplete="off"
              className={inputClass}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <fieldset>
            <legend className="mb-2 text-xs text-text-muted">{t("dex.settingsGenerations")}</legend>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 9 }, (_, i) => i + 1).map((generation) => (
                <label key={generation} className="t-label gap-2 px-2">
                  <input
                    type="checkbox"
                    checked={draft.generations.includes(generation)}
                    onChange={() =>
                      setDraft({ ...draft, generations: toggle(draft.generations, generation) })
                    }
                  />
                  Gen {generation}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-text-faint">{t("dex.settingsEmptyAll")}</p>
          </fieldset>
          <GameMultiSelect
            label={t("dex.settingsTargetGames")}
            games={games}
            languages={[locale]}
            value={draft.target_games}
            onChange={(target_games) => setDraft({ ...draft, target_games })}
            emptyHint={t("dex.settingsEmptyAll")}
            addLabel={t("dex.addGame")}
            generationLabel={t("modal.generation")}
          />
          <fieldset>
            <legend className="mb-2 text-xs text-text-muted">{t("dex.settingsForms")}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {FORM_CATEGORIES.map((category) => (
                <label key={category} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.form_categories.includes(category)}
                    onChange={() =>
                      setDraft({
                        ...draft,
                        form_categories: toggle(draft.form_categories, category),
                      })
                    }
                  />
                  {t(`dex.formCategory.${category}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={draft.living_dex}
                onChange={() => setDraft({ ...draft, living_dex: !draft.living_dex })}
              />
              {t("dex.settingsLivingDex")}
            </label>
            <p className="mt-1 text-xs text-text-faint">{t("dex.settingsLivingDexDesc")}</p>
          </div>
          <GameMultiSelect
            label={t("dex.settingsCatchGames")}
            games={games}
            languages={[locale]}
            value={draft.catch_games}
            onChange={(catch_games) => setDraft({ ...draft, catch_games })}
            emptyHint={t("dex.settingsEmptyAll")}
            addLabel={t("dex.addGame")}
            generationLabel={t("modal.generation")}
          />
          <label className="block text-xs text-text-muted">
            {t("dex.settingsIncludeSpecies")}
            <input
              className={`${inputClass} mt-1`}
              value={includeSpecies}
              onChange={(e) => setIncludeSpecies(e.target.value)}
            />
          </label>
          <label className="block text-xs text-text-muted">
            {t("dex.settingsExcludeSpecies")}
            <input
              className={`${inputClass} mt-1`}
              value={excludeSpecies}
              onChange={(e) => setExcludeSpecies(e.target.value)}
            />
          </label>
        </div>
      </ModalShell>
      {discardClose && (
        <ConfirmModal
          title={t("dex.unsavedTitle")}
          message={t("dex.unsavedMessage")}
          confirmLabel={t("dex.unsavedDiscard")}
          isDestructive
          onConfirm={() => {
            const proceed = discardClose;
            setDiscardClose(null);
            proceed();
          }}
          onClose={() => setDiscardClose(null)}
        />
      )}
    </>
  );
}

function GameMultiSelect({
  label,
  games,
  languages,
  value,
  onChange,
  emptyHint,
  addLabel,
  generationLabel,
}: Readonly<{
  label: string;
  games: GameEntry[];
  languages: string[];
  value: string[];
  onChange: (value: string[]) => void;
  emptyHint: string;
  addLabel: string;
  generationLabel: string;
}>) {
  const groups = games
    .filter((game) => !value.includes(game.key))
    .reduce<Record<number, GameEntry[]>>((result, game) => {
      (result[game.generation] ??= []).push(game);
      return result;
    }, {});
  return (
    <fieldset>
      <legend className="mb-1 text-xs text-text-muted">{label}</legend>
      <div className="t-select-wrap">
        <select
          className="t-select"
          value=""
          onChange={(event) => event.target.value && onChange([...value, event.target.value])}
        >
          <option value="">{addLabel}</option>
          {Object.entries(groups).map(([generation, entries]) => (
            <optgroup key={generation} label={`${generationLabel} ${generation}`}>
              {entries.map((game) => (
                <option key={game.key} value={game.key}>
                  {getGameName(game, languages)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {value.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {value.map((key) => {
            const game = games.find((entry) => entry.key === key);
            return (
              <button
                type="button"
                key={key}
                className="t-label hover:text-accent-red"
                onClick={() => onChange(value.filter((item) => item !== key))}
              >
                {game ? getGameName(game, languages) : key} ×
              </button>
            );
          })}
        </div>
      ) : (
        <p className="mt-1 text-xs text-text-faint">{emptyHint}</p>
      )}
    </fieldset>
  );
}

function parseSpeciesIds(value: string): number[] {
  return [
    ...new Set(
      value
        .split(",")
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];
}

function normalizePokedex(pokedex: UserPokedex): UserPokedex {
  const sorted = <T extends string | number>(values: T[]) =>
    [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b)));
  return {
    ...pokedex,
    generations: sorted(pokedex.generations),
    target_games: sorted(pokedex.target_games),
    catch_games: sorted(pokedex.catch_games),
    form_categories: sorted(pokedex.form_categories),
    include_species: sorted(pokedex.include_species),
    exclude_species: sorted(pokedex.exclude_species),
  };
}
