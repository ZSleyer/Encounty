/**
 * DexPhaseEntryModal.tsx: Editor for one phase of a hand-entered hunt.
 *
 * A phase is an off-target shiny caught during a hunt. For a hunt tracked in
 * Encounty the phase becomes its own completed entry; for a hunt entered by
 * hand it becomes its own specimen linked back to the main target. This modal
 * asks only for what a phase does not inherit: the species, the catch date,
 * the encounters spent in that phase and its duration. Game and hunt method
 * come from the main target, mirroring how a real phase inherits them.
 */
import { useId, useState } from "react";
import { useI18n } from "../../contexts/I18nContext";
import { ModalShell } from "../shared/ModalShell";
import { GenderSelector } from "../pokemon/GenderSelector";
import { PokemonSearchPicker, getPkmnName, usePokedex, type SearchResult } from "../pokemon/pokemonPicker";
import { getAvailableHuntMethods } from "../../utils/huntTypes";
import { getGameName } from "../../utils/games";
import { composeTimestamp, splitTimestamp } from "../../utils/manualEntry";
import type { CatchMeta, PokemonGender } from "../../types";

/** One phase being edited locally, before the whole hunt is saved. */
export interface PhaseDraft {
  /** Stable local identity, kept across reorders and reopenings. */
  key: string;
  /** Set once the draft has been persisted as an entry. */
  id?: string;
  /** Frozen 1-based number, never renumbered when a sibling is removed. */
  phase_number: number;
  /** Canonical slug of the phase species or form; empty until picked. */
  canonical_name: string;
  /** Display name of the picked species or form. */
  name: string;
  base_name?: string;
  form_name?: string;
  gender: string;
  completed_at: string;
  encounters: number;
  timer_accumulated_ms: number;
  /** True when the phase shiny was sighted but never caught. */
  failed?: boolean;
  meta?: CatchMeta;
}

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;

interface HuntFactsFieldsProps {
  readonly completedAt: string;
  readonly onCompletedAt: (value: string) => void;
  /** Time of day, empty when it was never recorded. */
  readonly completedTime: string;
  readonly onCompletedTime: (value: string) => void;
  readonly encounters: number;
  readonly onEncounters: (value: number) => void;
  readonly timerMs: number;
  readonly onTimerMs: (value: number) => void;
  /** Label of the date field, so a failed phase can say "failed on" instead. */
  readonly dateLabel?: string;
}

/**
 * Catch date, encounter count and duration, the three facts a hunt entered by
 * hand carries per entry. Shared by the main target and its phases, so the ids
 * come from useId(): two instances of these fields coexist while a phase is
 * being edited, and fixed ids would collide.
 */
export function HuntFactsFields({
  completedAt,
  onCompletedAt,
  completedTime,
  onCompletedTime,
  encounters,
  onEncounters,
  timerMs,
  onTimerMs,
  dateLabel,
}: HuntFactsFieldsProps) {
  const { t } = useI18n();
  const dateId = useId();
  const timeId = useId();
  const encountersId = useId();
  const timerId = useId();

  const hours = Math.floor(timerMs / HOUR_MS);
  const minutes = Math.floor((timerMs % HOUR_MS) / MINUTE_MS);
  const seconds = Math.floor((timerMs % MINUTE_MS) / SECOND_MS);

  const inputClass =
    "w-full bg-bg-secondary border border-border-subtle rounded-none px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue/50 transition-colors";

  return (
    <>
      {/* Two controls, not one combined field: leaving a combined field's time
          empty clears the date with it, and a catch from years ago has a known
          day but rarely a known minute. An empty time means local midnight. */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={dateId} className="block text-xs text-text-muted mb-1">
            {dateLabel ?? t("dex.caughtOn")}
          </label>
          <input
            id={dateId}
            type="date"
            value={completedAt}
            onChange={(event) => onCompletedAt(event.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={timeId} className="block text-xs text-text-muted mb-1">
            {t("dex.caughtAtTime")}
          </label>
          <input
            id={timeId}
            type="time"
            value={completedTime}
            onChange={(event) => onCompletedTime(event.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor={encountersId} className="block text-xs text-text-muted mb-1">
          {t("modal.encountersLabel")}
        </label>
        <input
          id={encountersId}
          type="number"
          min={0}
          value={encounters}
          onChange={(event) => onEncounters(Math.max(0, Number.parseInt(event.target.value, 10) || 0))}
          className={`${inputClass} tabular-nums`}
        />
      </div>

      <div>
        <span className="block text-xs text-text-muted mb-1">{t("modal.timerLabel")}</span>
        <div className="grid grid-cols-3 gap-3">
          {([
            ["h", t("timer.hours"), hours, HOUR_MS, undefined],
            ["m", t("timer.minutes"), minutes, MINUTE_MS, 59],
            ["s", t("timer.seconds"), seconds, SECOND_MS, 59],
          ] as const).map(([key, label, value, unit, max]) => (
            <div key={key}>
              <label htmlFor={`${timerId}-${key}`} className="block text-[10px] text-text-muted mb-0.5">
                {label}
              </label>
              <input
                id={`${timerId}-${key}`}
                type="number"
                min={0}
                max={max}
                value={value}
                onChange={(event) => {
                  const next = Math.min(max ?? Infinity, Math.max(0, Number.parseInt(event.target.value, 10) || 0));
                  onTimerMs(timerMs - value * unit + next * unit);
                }}
                className={`${inputClass} tabular-nums`}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

interface DexPhaseEntryModalProps {
  readonly draft: PhaseDraft;
  /** Game key of the main target; the phase inherits it. */
  readonly parentGame: string;
  /** Hunt method of the main target; the phase inherits it. */
  readonly parentHuntType: string;
  readonly onSave: (draft: PhaseDraft) => void;
  readonly onClose: () => void;
}

/** Modal for picking the species of one phase and its catch facts. */
export function DexPhaseEntryModal({
  draft,
  parentGame,
  parentHuntType,
  onSave,
  onClose,
}: DexPhaseEntryModalProps) {
  const { t, locale } = useI18n();
  const { allPokemon, games } = usePokedex();
  const errorId = useId();

  const [canonicalName, setCanonicalName] = useState(draft.canonical_name);
  const [gender, setGender] = useState(draft.gender);
  const [completedAt, setCompletedAt] = useState(() => splitTimestamp(draft.completed_at).date);
  const [completedTime, setCompletedTime] = useState(() => splitTimestamp(draft.completed_at).time);
  const [encounters, setEncounters] = useState(draft.encounters);
  const [timerMs, setTimerMs] = useState(draft.timer_accumulated_ms);
  const [failed, setFailed] = useState(draft.failed ?? false);
  const [showError, setShowError] = useState(false);
  const failedId = useId();

  const species = allPokemon.find((entry) =>
    entry.canonical === canonicalName || entry.forms?.some((form) => form.canonical === canonicalName)) ?? null;
  const pickedForm = species?.forms?.find((form) => form.canonical === canonicalName) ?? null;
  const gameEntry = games.find((entry) => entry.key === parentGame) ?? null;
  const methodLabel = getAvailableHuntMethods(parentGame).some((method) => method.key === parentHuntType)
    ? t(`huntType.${parentHuntType}`)
    : "";

  const handlePick = (entry: SearchResult) => {
    setCanonicalName(entry.canonical);
    if (entry.gender) setGender(entry.gender);
    setShowError(false);
  };

  const handleSave = () => {
    if (!canonicalName) {
      setShowError(true);
      return;
    }
    onSave({
      ...draft,
      canonical_name: canonicalName,
      name: selectedName,
      base_name: species ? getPkmnName(species, locale) : "",
      form_name: pickedForm ? getPkmnName(pickedForm, locale, t("dex.genderFormFemale")) : "",
      gender,
      completed_at: composeTimestamp(completedAt, completedTime),
      encounters,
      timer_accumulated_ms: timerMs,
      failed,
    });
  };

  const selectedName = species
    ? getPkmnName(pickedForm ?? species, locale, t("dex.genderFormFemale"))
    : "";

  return (
    <ModalShell title={t("phase.editTitle", { number: draft.phase_number })} onClose={onClose}>
      {(requestClose) => (
        <div className="flex flex-col gap-4">
          <div>
            <PokemonSearchPicker
              allPokemon={allPokemon}
              games={games}
              selectedGame={parentGame}
              language={locale}
              placeholder={t("phase.searchPlaceholder")}
              inputLabel={t("aria.phaseSearch")}
              selectedCanonical={canonicalName}
              autoFocus
              onPick={handlePick}
            />
            {showError && (
              <p id={errorId} role="alert" className="mt-2 text-xs text-accent-red">
                {t("phase.speciesRequired")}
              </p>
            )}
          </div>

          {species && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-primary">{selectedName}</p>
              <GenderSelector
                value={(gender || undefined) as PokemonGender | undefined}
                genderRate={species.gender_rate}
                onChange={(next) => setGender(next ?? "")}
              />
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
            {/* A phase that got away is still a phase: it keeps its encounters
                and its duration, it only never became a catch. */}
            <div className="flex items-center gap-2">
              <input
                id={failedId}
                type="checkbox"
                checked={failed}
                onChange={(event) => setFailed(event.target.checked)}
                className="h-4 w-4 shrink-0 accent-accent-red rounded-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-blue"
              />
              <label htmlFor={failedId} className="text-sm text-text-secondary">
                {t("phase.confirmFailed")}
              </label>
            </div>

            <HuntFactsFields
              completedAt={completedAt}
              onCompletedAt={setCompletedAt}
              completedTime={completedTime}
              onCompletedTime={setCompletedTime}
              encounters={encounters}
              onEncounters={setEncounters}
              timerMs={timerMs}
              onTimerMs={setTimerMs}
              dateLabel={t(failed ? "dex.failedOn" : "dex.caughtOn")}
            />
            <p className="text-xs text-text-faint">
              {t("phase.inheritedFromHunt")}
              {gameEntry ? `: ${getGameName(gameEntry, [locale, "en"])}` : ""}
              {methodLabel ? ` · ${methodLabel}` : ""}
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={requestClose}
              className="px-4 py-2 rounded-none border border-border-subtle text-text-muted hover:text-text-primary hover:border-text-muted transition-colors text-sm"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={handleSave}
              aria-describedby={showError ? errorId : undefined}
              className="px-5 py-2 t-cut rounded-none text-sm font-semibold transition-colors bg-accent-blue text-bg-primary hover:bg-accent-blue/90"
            >
              {t("common.save")}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
