/**
 * CatchMetaModal.tsx: Dialog that records the optional details of a caught
 * shiny: location, ball, level, nature, ability, mark, the six determinant
 * values and any ribbons.
 *
 * The same component serves the capture moment (fresh catch, right after the
 * hunt was completed) and later editing from the Dex, because it seeds its
 * state from `pokemon.catch`. Every field is optional and every input is
 * constrained so an invalid value cannot be typed in the first place, which is
 * why there is no validation pass and no `aria-invalid` anywhere (WCAG 3.3.1
 * prefers prevention over error messages).
 */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { useToast } from "../../contexts/ToastContext";
import type { CatchMeta, CatchMetaUpdate, EvolutionStep, PokemonGender } from "../../types";
import { ModalShell } from "../shared/ModalShell";
import { getGameGroup } from "../../utils/gameGroups";
import {
  CatchIcon,
  getBallIconUrl,
  getMarkIconUrl,
  getRibbonIconUrl,
} from "../../utils/catchIcons";
import {
  refLabel,
  refLabelFor,
  useCatchRefs,
  type BallRef,
  type CatchRefEntry,
  type RibbonRef,
} from "../../hooks/useCatchRefs";
import { buildFormStrip, getPkmnName, PokemonSearchPicker, usePokedex, type PickOrigin, type SearchResult } from "./pokemonPicker";
import { getGenderSpriteUrl, isCustomSprite } from "../../utils/sprites";
import { defaultGender, GenderSelector } from "./GenderSelector";

// --- Determinant value model ---

/** Key of one determinant value inside {@link CatchMeta}. */
export type IvKey = "hp" | "atk" | "def" | "sp_atk" | "sp_def" | "speed";

/** One determinant value slot with its visible abbreviation and full name. */
export interface IvStat {
  readonly key: IvKey;
  /** i18n key of the short visible label, e.g. "SP-ATK". */
  readonly abbrKey: string;
  /** i18n key of the spelled-out stat name used in the accessible label. */
  readonly nameKey: string;
}

/** The six determinant values in their canonical display order. */
export const IV_STATS: readonly IvStat[] = [
  { key: "hp", abbrKey: "catchMeta.stat.hp", nameKey: "aria.stat.hp" },
  { key: "atk", abbrKey: "catchMeta.stat.atk", nameKey: "aria.stat.atk" },
  { key: "def", abbrKey: "catchMeta.stat.def", nameKey: "aria.stat.def" },
  { key: "sp_atk", abbrKey: "catchMeta.stat.spatk", nameKey: "aria.stat.spatk" },
  { key: "sp_def", abbrKey: "catchMeta.stat.spdef", nameKey: "aria.stat.spdef" },
  { key: "speed", abbrKey: "catchMeta.stat.speed", nameKey: "aria.stat.speed" },
];

/** Sum of six perfect determinant values. */
export const IV_PERFECT_TOTAL = 186;

/** Highest value a single determinant value can reach. */
const IV_MAX = 31;

/** Visual state of one determinant value. */
export type IvTone = "unset" | "min" | "max" | "normal";

/** Placeholder glyph for an unset determinant value (en dash, never em). */
export const IV_UNSET_GLYPH = "–";

/**
 * Classifies a determinant value for display. The input is the raw string of
 * the editor, where "" means unset; the summary passes "" for `undefined`.
 */
export function ivTone(value: string): IvTone {
  if (value === "") return "unset";
  const numeric = Number(value);
  if (numeric === IV_MAX) return "max";
  if (numeric === 0) return "min";
  return "normal";
}

/**
 * Border per determinant tone. Dashed versus solid carries the unset state
 * without relying on colour (WCAG 1.4.1).
 */
export const IV_BORDER_CLASS: Record<IvTone, string> = {
  unset: "border-dashed border-border-subtle",
  min: "border-solid border-accent-purple/40",
  max: "border-solid border-accent-green/40",
  normal: "border-solid border-border-subtle",
};

/** Glyph colour per determinant tone. */
export const IV_TEXT_CLASS: Record<IvTone, string> = {
  unset: "text-text-faint",
  min: "text-accent-purple",
  max: "text-accent-green",
  normal: "text-text-primary",
};

/** Editor state of the six determinant values; "" means unset. */
type IvState = Record<IvKey, string>;

/** Empty determinant state, used for a fresh catch. */
const EMPTY_IVS: IvState = {
  hp: "",
  atk: "",
  def: "",
  sp_atk: "",
  sp_def: "",
  speed: "",
};

// --- Helpers ---

/** Shared input skin, mirroring the form fields of PokemonFormModal. */
const INPUT_CLASS =
  "w-full bg-bg-secondary border border-border-subtle rounded-none px-3 py-2 text-sm text-text-primary placeholder-text-faint focus:border-accent-blue/50 transition-colors";

/** How many suggestions a free-text field offers at once. */
const SUGGESTION_LIMIT = 50;

/**
 * Catalogue entries whose localized name starts with what was typed, capped at
 * {@link SUGGESTION_LIMIT}. An empty query offers the head of the catalogue.
 */
function matchingRefs(
  entries: readonly CatchRefEntry[],
  query: string,
  locale: string,
): CatchRefEntry[] {
  const needle = query.trim().toLowerCase();
  const matching = needle
    ? entries.filter((entry) => refLabel(entry, locale).toLowerCase().startsWith(needle))
    : entries;
  return matching.slice(0, SUGGESTION_LIMIT);
}

/** Renders a numeric string, keeping "" for unset. Non-digits are dropped. */
function digitsOnly(raw: string, maxLength: number): string {
  return raw.replace(/\D/g, "").slice(0, maxLength);
}

/** True when the metadata carries at least one recorded detail. */
export function hasCatchData(meta?: CatchMeta): boolean {
  if (!meta) return false;
  return Object.values(meta).some((value) =>
    Array.isArray(value) ? value.length > 0 : value !== undefined && value !== "",
  );
}

/** Seeds the determinant editor state from stored metadata. */
function seedIvs(meta?: CatchMeta): IvState {
  const seeded = { ...EMPTY_IVS };
  for (const stat of IV_STATS) {
    const value = meta?.[stat.key];
    // A stored 0 is a fact, not an absence, so it must survive the seeding.
    if (typeof value === "number") seeded[stat.key] = String(value);
  }
  return seeded;
}

/** Localized names sorted for the current locale. */
function sortedByLabel<T extends CatchRefEntry>(entries: T[], locale: string): T[] {
  return [...entries].sort((a, b) =>
    refLabel(a, locale).localeCompare(refLabel(b, locale), locale),
  );
}

/**
 * Reports whether a ball can be obtained in the given game. A ball scoped to
 * game keys wins over the generation, because the Legends Arceus balls are
 * reported for generation 8 and 9 although they exist in a single game, and
 * their German names collide with the regular balls of those generations.
 */
function ballFitsGame(entry: BallRef, gameKey: string, generation: number): boolean {
  if (entry.games?.length) return entry.games.includes(gameKey);
  return entry.generations?.includes(generation) ?? false;
}

// --- Props ---

/**
 * Minimal structural shape {@link CatchMetaModal} needs from a Pokémon: it
 * only ever reads `id`, `game` and `catch`. A full {@link Pokemon} always
 * satisfies this, so every real call site needs no change, but it also lets a
 * caller with no real Pokémon (e.g. a manual dex override) hand in a
 * synthetic stand-in instead of fabricating a whole `Pokemon`.
 */
export interface CatchMetaModalPokemon {
  readonly id: string;
  readonly name?: string;
  readonly game: string;
  readonly nickname?: string;
  readonly catch?: CatchMeta;
  readonly canonical_name?: string;
  readonly sprite_url?: string;
  readonly sprite_type?: "normal" | "shiny";
  readonly sprite_style?: "box" | "animated" | "3d" | "artwork" | "classic";
  readonly gender?: PokemonGender;
  readonly failed?: boolean;
}

/** Props for {@link CatchMetaModal}. */
export interface CatchMetaModalProps {
  /** The caught Pokémon whose details are recorded; seeds the initial state. */
  readonly pokemon: CatchMetaModalPokemon;
  /** Persists the metadata; rejects to keep the dialog open. */
  readonly onSubmit: (id: string, meta: CatchMetaUpdate) => Promise<void>;
  /** Called after the close transition finishes; unmount the modal here. */
  readonly onClose: () => void;
  /**
   * "capture" (default) is the moment right after a hunt completes, where the
   * left footer button offers to skip recording details entirely. "edit"
   * reopens an already-recorded catch (or a manual override) later, where
   * "skip" reads wrong: the same button still closes without saving, only its
   * label switches to "cancel".
   */
  readonly mode?: "capture" | "edit";
}

// --- Component ---

/**
 * Renders the catch metadata dialog for one Pokémon.
 *
 * The left footer button always skips: it closes without sending anything, so
 * the capture flow never forces data entry. The right one saves and keeps the
 * dialog open when the request fails, so nothing typed is lost.
 */
export function CatchMetaModal({ pokemon, onSubmit, onClose, mode = "capture" }: CatchMetaModalProps) {
  const { t, locale } = useI18n();
  const { push } = useToast();
  const refs = useCatchRefs(pokemon.game);
  const { allPokemon, games } = usePokedex();

  const stored = pokemon.catch;
  const ids = {
    nickname: useId(),
    location: useId(),
    ball: useId(),
    level: useId(),
    nature: useId(),
    ability: useId(),
    mark: useId(),
    ribbons: useId(),
  };

  const [nickname, setNickname] = useState(pokemon.nickname ?? stored?.nickname ?? "");
  const [location, setLocation] = useState(stored?.location ?? "");
  const [ball, setBall] = useState(stored?.ball ?? "");
  const [level, setLevel] = useState(stored?.level === undefined ? "" : String(stored.level));
  const [nature, setNature] = useState(stored?.nature ?? "");
  const [ability, setAbility] = useState(stored?.ability ?? "");
  const [mark, setMark] = useState(stored?.mark ?? "");
  const [ivs, setIvs] = useState<IvState>(() => seedIvs(stored));
  const [ribbons, setRibbons] = useState<string[]>(stored?.ribbons ?? []);
  const [evolutions, setEvolutions] = useState<EvolutionStep[]>(stored?.evolutions ?? []);
  const species = allPokemon.find(
    (entry) => entry.canonical === pokemon.canonical_name || entry.forms?.some((form) => form.canonical === pokemon.canonical_name),
  );
  const [gender, setGender] = useState<PokemonGender | undefined>(
    pokemon.gender ?? defaultGender(species?.gender_rate),
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (pokemon.gender || gender) return;
    setGender(defaultGender(species?.gender_rate));
  }, [pokemon.gender, gender, species?.gender_rate]);

  // --- Option lists ---

  const generation = getGameGroup(pokemon.game)?.generation ?? null;

  const ballOptions = useMemo(() => {
    if (generation === null) return sortedByLabel(refs.balls, locale);
    // A ball already stored on the Pokémon stays selectable even when it does
    // not belong to this game, so editing cannot silently drop it.
    const usable = refs.balls.filter(
      (entry) => ballFitsGame(entry, pokemon.game, generation) || entry.slug === ball,
    );
    return sortedByLabel(usable, locale);
  }, [refs.balls, generation, locale, ball, pokemon.game]);

  const natureOptions = useMemo(
    () => sortedByLabel(refs.natures, locale),
    [refs.natures, locale],
  );
  const markOptions = useMemo(
    () => sortedByLabel(refs.marks, locale),
    [refs.marks, locale],
  );

  // Both suggestion lists are rendered eagerly, so they are capped: a game
  // group carries up to ~250 locations and the ability catalogue is flat and
  // global with several hundred entries.
  const locationOptions = useMemo(
    () => matchingRefs(refs.locations, location, locale),
    [refs.locations, location, locale],
  );
  const abilityOptions = useMemo(
    () => matchingRefs(refs.abilities, ability, locale),
    [refs.abilities, ability, locale],
  );

  // --- Determinant values ---

  const setIv = (key: IvKey, raw: string) => {
    const digits = digitsOnly(raw, 2);
    // Reject the keystroke instead of clamping: clamping would need a live
    // region to stay perceivable, rejecting keeps the field truthful.
    if (digits !== "" && Number(digits) > IV_MAX) return;
    setIvs((prev) => ({ ...prev, [key]: digits }));
  };

  const ivTotal = useMemo(() => {
    if (IV_STATS.some((stat) => ivs[stat.key] === "")) return null;
    return IV_STATS.reduce((sum, stat) => sum + Number(ivs[stat.key]), 0);
  }, [ivs]);

  const changeLevel = (raw: string) => {
    const digits = digitsOnly(raw, 3);
    if (digits !== "" && Number(digits) > 100) return;
    setLevel(digits);
  };

  const toggleRibbon = (slug: string) => {
    setRibbons((prev) =>
      prev.includes(slug) ? prev.filter((entry) => entry !== slug) : [...prev, slug],
    );
  };

  // --- Submit ---

  const buildMeta = (): CatchMetaUpdate => {
    const meta: CatchMetaUpdate = {};
    if (nickname.trim()) meta.nickname = nickname.trim();
    if (gender) meta.gender = gender;
    if (location.trim()) meta.location = location.trim();
    if (nature) meta.nature = nature;
    if (ability.trim()) meta.ability = ability.trim();
    if (ball) meta.ball = ball;
    if (mark) meta.mark = mark;
    if (level !== "") meta.level = Number(level);
    for (const stat of IV_STATS) {
      const value = ivs[stat.key];
      // "0" is a recorded fact and must serialize as 0, not be dropped.
      if (value !== "") meta[stat.key] = Number(value);
    }
    if (ribbons.length > 0) meta.ribbons = [...ribbons];
    if (evolutions.length > 0) meta.evolutions = [...evolutions];
    if (pokemon.canonical_name && pokemon.sprite_type && !isCustomSprite(pokemon.sprite_url)) {
      const spriteURL = getGenderSpriteUrl(
        { canonical_name: pokemon.canonical_name, game: pokemon.game, sprite_type: pokemon.sprite_type, sprite_style: pokemon.sprite_style },
        allPokemon,
        gender,
      );
      if (spriteURL) meta.sprite_url = spriteURL;
    }
    return meta;
  };

  const handleSave = async (requestClose: () => void) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(pokemon.id, buildMeta());
      requestClose();
    } catch {
      push({ type: "error", title: t("catchMeta.errSaveFailed") });
    } finally {
      setSubmitting(false);
    }
  };

  // --- Render ---

  const footer = (requestClose: () => void) => (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={requestClose}
        className="flex-1 px-4 py-2 rounded-none border border-border-subtle text-text-muted hover:text-text-primary hover:border-text-muted transition-colors text-sm whitespace-nowrap"
      >
        {mode === "edit" ? t("common.cancel") : t("catchMeta.skip")}
      </button>
      <button
        type="button"
        onClick={() => void handleSave(requestClose)}
        disabled={submitting}
        className="flex-1 px-4 py-2 t-cut rounded-none font-semibold text-sm transition-colors shadow-sm whitespace-nowrap bg-accent-blue hover:bg-accent-blue/80 text-bg-primary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {t("common.save")}
      </button>
    </div>
  );

  return (
    <ModalShell
      title={hasCatchData(stored) ? t("catchMeta.editTitle") : t("catchMeta.title")}
      onClose={onClose}
      size="xl"
      structured
      footer={footer}
    >
      <div className="flex flex-col gap-5">
        {mode === "capture" && (
          <p className="text-sm text-text-muted">{t("catchMeta.intro")}</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {pokemon.name && <div className="sm:col-span-2 flex flex-col gap-1.5">
            <label htmlFor={ids.nickname} className="t-label">{t("catchMeta.nickname")}</label>
            <input
              id={ids.nickname}
              data-autofocus
              type="text"
              maxLength={60}
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder={t("catchMeta.nicknamePlaceholder")}
              className={INPUT_CLASS}
            />
          </div>}

          {pokemon.canonical_name && (
            <GenderSelector value={gender} genderRate={species?.gender_rate} onChange={setGender} />
          )}

          <ComboField
            id={ids.location}
            label={t("catchMeta.location")}
            placeholder={t("catchMeta.locationPlaceholder")}
            options={locationOptions}
            value={location}
            onChange={setLocation}
            locale={locale}
            className="sm:col-span-2"
          />

          <SelectField
            id={ids.ball}
            label={t("catchMeta.ball")}
            emptyLabel={t("catchMeta.ballNone")}
            options={ballOptions}
            value={ball}
            onChange={setBall}
            locale={locale}
            iconFor={getBallIconUrl}
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.level} className="t-label">
              {t("catchMeta.level")}
            </label>
            <input
              id={ids.level}
              type="text"
              inputMode="numeric"
              maxLength={3}
              value={level}
              onChange={(e) => changeLevel(e.target.value)}
              aria-label={t("aria.catchMetaLevel")}
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </div>

          <SelectField
            id={ids.nature}
            label={t("catchMeta.nature")}
            emptyLabel={t("catchMeta.natureNone")}
            options={natureOptions}
            value={nature}
            onChange={setNature}
            locale={locale}
          />

          <ComboField
            id={ids.ability}
            label={t("catchMeta.ability")}
            placeholder={t("catchMeta.abilityPlaceholder")}
            options={abilityOptions}
            value={ability}
            onChange={setAbility}
            locale={locale}
          />

          <SelectField
            id={ids.mark}
            label={t("catchMeta.mark")}
            emptyLabel={t("catchMeta.markNone")}
            options={markOptions}
            value={mark}
            onChange={setMark}
            locale={locale}
            iconFor={getMarkIconUrl}
          />
        </div>

        <IvFieldset ivs={ivs} total={ivTotal} onChange={setIv} />

        <RibbonPicker
          labelId={ids.ribbons}
          ribbons={refs.ribbons}
          selected={ribbons}
          locale={locale}
          onToggle={toggleRibbon}
        />

        {pokemon.canonical_name && mode === "edit" && !pokemon.failed && (
          <EvolutionEditor
            originCanonical={pokemon.canonical_name}
            evolutions={evolutions}
            onChange={setEvolutions}
            allPokemon={allPokemon}
            games={games}
            selectedGame={pokemon.game}
            language={locale}
          />
        )}
      </div>
    </ModalShell>
  );
}

export function directEvolutionCandidates(allPokemon: import("./pokemonPicker").PokemonData[], currentCanonical: string) {
  const currentSpecies = allPokemon.find((entry) =>
    entry.canonical === currentCanonical || entry.forms?.some((form) => form.canonical === currentCanonical),
  );
  return currentSpecies ? allPokemon.filter((entry) => entry.evolves_from_id === currentSpecies.id) : [];
}

function EvolutionEditor({ originCanonical, evolutions, onChange, allPokemon, games, selectedGame, language }: Readonly<{
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
    const species = allPokemon.find((entry) => entry.canonical === canonical || entry.forms?.some((form) => form.canonical === canonical));
    const form = species?.forms?.find((entry) => entry.canonical === canonical);
    return form ? getPkmnName(form, language, t("dex.genderFormFemale")) : species ? getPkmnName(species, language) : canonical;
  };
  const add = (entry: SearchResult, origin: PickOrigin) => {
    const base = allPokemon.find((candidate) => candidate.id === entry.id);
    if (origin === "search" && base && buildFormStrip(base, selectedGame, games, language).length > 0) return;
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
        <button type="button" onClick={() => onChange(evolutions.slice(0, -1))} className="self-start t-label text-text-muted hover:text-accent-red">
          {t("catchMeta.evolutionUndo")}
        </button>
      )}
    </section>
  );
}

// --- Combo field ---

interface ComboFieldProps {
  readonly id: string;
  readonly label: string;
  readonly placeholder: string;
  /** Suggestions to offer; the caller filters and caps them. */
  readonly options: readonly CatchRefEntry[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly locale: string;
  /** Focus on mount; also marks the field for useModalDialog. */
  readonly autoFocus?: boolean;
  /** Extra classes for the wrapping cell, e.g. a grid span. */
  readonly className?: string;
}

/**
 * Free-text field with a Tempest suggestion list over a reference catalogue.
 *
 * Replaces `<datalist>`, whose popup the browser draws in its own chrome and
 * which no stylesheet can reach. The list is built from the same primitives as
 * the species picker: focusable rows instead of `role="option"`, so every entry
 * is reachable with the Tab key (WCAG 2.1.1), and a fixed, anchor-positioned
 * box so the scrollable modal body cannot clip it.
 *
 * Typing stays free-form. The catalogue only suggests, so a location a game
 * table does not carry can still be recorded.
 */
function ComboField({
  id,
  label,
  placeholder,
  options,
  value,
  onChange,
  locale,
  autoFocus,
  className,
}: ComboFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const instanceId = useId();
  // useId() yields colons, which are not valid in a CSS dashed-ident.
  const anchorName = `--combo-${instanceId.replace(/[^a-zA-Z0-9]/g, "-")}`;
  const [open, setOpen] = useState(false);

  const suggestions = open ? options : [];

  /** Closes the list once focus leaves the field and its suggestions. */
  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setOpen(false);
  };

  /**
   * Escape closes the list and returns focus to the field. The event must not
   * bubble: inside a <dialog> the browser would read the same keypress as a
   * close request and dismiss the whole modal.
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || suggestions.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    inputRef.current?.focus();
    setOpen(false);
  };

  const pick = (entry: CatchRefEntry) => {
    onChange(refLabel(entry, locale));
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <label htmlFor={id} className="t-label">
        {label}
      </label>
      <div onBlur={handleBlur} onKeyDown={handleKeyDown}>
        <input
          ref={inputRef}
          data-autofocus={autoFocus ? true : undefined}
          id={id}
          type="text"
          maxLength={120}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            // Typing reopens a list that Escape closed.
            setOpen(true);
          }}
          // Opened by clicking or typing, never by focus alone: the field is
          // autofocused on mount and a list unfolding over the untouched form
          // would hide the fields below it before anything was asked for.
          onClick={() => setOpen(true)}
          placeholder={placeholder}
          style={{ anchorName } as CSSProperties}
          className={INPUT_CLASS}
        />
        {suggestions.length > 0 && (
          <div
            style={
              {
                positionAnchor: anchorName,
                positionArea: "block-end span-inline-end",
                // Without a fallback the list only ever opens downwards and runs off
                // the bottom of short windows. flip-block moves it above the field.
                positionTryFallbacks: "flip-block",
                width: "anchor-size(width)",
                marginBlockStart: "0.25rem",
              } as CSSProperties
            }
            className="fixed bg-bg-secondary border border-border-subtle rounded-none z-50 shadow-xl max-h-[min(13rem,45vh)] overflow-x-hidden overflow-y-auto"
          >
            {suggestions.map((entry) => (
              <button
                key={entry.slug}
                type="button"
                // Keep the press from moving focus at all: browsers that do not
                // focus a clicked button (Safari) would otherwise blur the
                // field and unmount the row before its click fires.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(entry)}
                className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-hover transition-colors truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
              >
                {refLabel(entry, locale)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Select field ---

interface SelectFieldProps {
  readonly id: string;
  readonly label: string;
  /** Label of the leading empty entry that clears the field. */
  readonly emptyLabel: string;
  readonly options: readonly CatchRefEntry[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly locale: string;
  /** Icon URL of one entry; omit for catalogues without icons. */
  readonly iconFor?: (slug: string) => string;
}

/** How long two keystrokes still count as one typeahead prefix, in ms. */
const TYPEAHEAD_WINDOW = 700;

/**
 * One labelled dropdown over a reference catalogue.
 *
 * Built from a button and a popup instead of a native `<select>` because an
 * `<option>` cannot carry an image, and the ball and mark catalogues are far
 * easier to read with their game icons than by name alone. Trigger and popup
 * borrow the Tempest select skin (`t-select-wrap` draws the chevron), so the
 * field looks exactly like the native control it replaces.
 *
 * Keyboard support mirrors what the native control offered: the trigger opens
 * on Enter or Space and moves focus onto the current entry, entries are plain
 * focusable buttons and therefore Tab-reachable (WCAG 2.1.1), typing a few
 * letters jumps to the matching entry, and Escape closes without bubbling into
 * the surrounding dialog.
 */
function SelectField({
  id,
  label,
  emptyLabel,
  options,
  value,
  onChange,
  locale,
  iconFor,
}: SelectFieldProps) {
  const instanceId = useId();
  const labelId = `${instanceId}-label`;
  // useId() yields colons, which are not valid in a CSS dashed-ident.
  const anchorName = `--select-${instanceId.replace(/[^a-zA-Z0-9]/g, "-")}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ prefix: "", at: 0 });
  const [open, setOpen] = useState(false);

  const currentLabel = value ? refLabelFor(options, value, locale) : emptyLabel;

  // Opening lands on the current entry, so the list starts where the native
  // control would have, instead of forcing a walk from the top.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const active = list?.querySelector<HTMLButtonElement>('[data-active="true"]');
    (active ?? list?.querySelector("button"))?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const pick = (slug: string) => {
    onChange(slug);
    close();
  };

  /** Closes the popup once focus leaves the trigger and the list. */
  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setOpen(false);
  };

  /**
   * Escape closes the popup, printable keys jump to the entry starting with
   * what was typed. Escape must not bubble: inside a <dialog> the browser
   * would read the same keypress as a close request for the whole modal.
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    const now = Date.now();
    const prefix =
      now - typed.current.at > TYPEAHEAD_WINDOW ? e.key : typed.current.prefix + e.key;
    typed.current = { prefix, at: now };
    const needle = prefix.toLowerCase();
    const rows = [...(listRef.current?.querySelectorAll("button") ?? [])];
    const hit = rows.find((row) => row.textContent?.trim().toLowerCase().startsWith(needle));
    if (!hit) return;
    e.preventDefault();
    hit.focus();
  };

  const entries = [{ slug: "", name: emptyLabel }, ...options.map((entry) => ({
    slug: entry.slug,
    name: refLabel(entry, locale),
  }))];

  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="t-label">
        {label}
      </span>
      <div onBlur={handleBlur} onKeyDown={handleKeyDown}>
        <span className="t-select-wrap" style={{ anchorName } as CSSProperties}>
          <button
            ref={triggerRef}
            id={id}
            type="button"
            aria-expanded={open}
            aria-haspopup="true"
            // Self-reference keeps the visible entry name inside the accessible
            // name, which a bare aria-label would have replaced (WCAG 2.5.3).
            aria-labelledby={`${labelId} ${id}`}
            onClick={() => setOpen((wasOpen) => !wasOpen)}
            className="t-select text-sm flex items-center gap-2 text-left"
          >
            {iconFor && <IconSlot src={value ? iconFor(value) : ""} />}
            <span className="flex-1 min-w-0 truncate">{currentLabel}</span>
          </button>
        </span>

        {open && (
          <div
            ref={listRef}
            // Fixed instead of absolute: the dialog body scrolls and would clip
            // an absolutely positioned popup. CSS anchor positioning keeps the
            // box under the trigger without JS measuring; the properties are
            // not in React's CSSProperties yet.
            style={
              {
                positionAnchor: anchorName,
                positionArea: "block-end span-inline-end",
                // Without a fallback the list only ever opens downwards and runs off
                // the bottom of short windows. flip-block moves it above the field.
                positionTryFallbacks: "flip-block",
                width: "anchor-size(width)",
                marginBlockStart: "0.25rem",
              } as CSSProperties
            }
            className="fixed bg-bg-secondary border border-border-subtle rounded-none z-50 shadow-xl max-h-[min(13rem,45vh)] overflow-x-hidden overflow-y-auto"
          >
            {entries.map((entry) => (
              <button
                key={entry.slug || "none"}
                type="button"
                data-active={entry.slug === value ? "true" : undefined}
                aria-current={entry.slug === value ? "true" : undefined}
                // Keep the press from moving focus at all: browsers that do not
                // focus a clicked button (Safari) would otherwise blur the list
                // and unmount the row before its click fires.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(entry.slug)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue ${
                  entry.slug === value
                    ? "bg-accent-blue/10 text-accent-blue"
                    : "text-text-primary hover:bg-bg-hover"
                }`}
              >
                {iconFor && <IconSlot src={entry.slug ? iconFor(entry.slug) : ""} />}
                <span className="flex-1 min-w-0 truncate">{entry.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Fixed-size icon cell. Keeps its width while the entry has no icon, otherwise
 * the labels of a catalogue would sit at two different indents.
 */
function IconSlot({ src }: { readonly src: string }) {
  return (
    <span className="w-5 h-5 shrink-0 flex items-center justify-center">
      <CatchIcon src={src} className="max-w-full max-h-full object-contain" />
    </span>
  );
}

// --- Determinant values ---

interface IvFieldsetProps {
  readonly ivs: IvState;
  /** Sum of all six values, or null while at least one is unset. */
  readonly total: number | null;
  readonly onChange: (key: IvKey, raw: string) => void;
}

/** The six determinant value cells as one labelled group. */
function IvFieldset({ ivs, total, onChange }: IvFieldsetProps) {
  const { t } = useI18n();
  return (
    <fieldset className="border-0 p-0 m-0">
      <legend className="t-label">{t("catchMeta.ivs")}</legend>
      <p className="mt-2 text-xs text-text-muted">{t("catchMeta.ivsHint")}</p>
      <div className="mt-2 grid grid-cols-3 sm:grid-cols-6 gap-2">
        {IV_STATS.map((stat) => (
          <IvCell
            key={stat.key}
            stat={stat}
            value={ivs[stat.key]}
            onChange={(raw) => onChange(stat.key, raw)}
          />
        ))}
      </div>
      {total !== null && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-text-muted tabular-nums">
            {t("catchMeta.ivTotal", { sum: total })}
          </span>
          {total === IV_PERFECT_TOTAL && (
            <span className="t-label t-label--accent">{t("catchMeta.ivPerfect")}</span>
          )}
        </div>
      )}
    </fieldset>
  );
}

interface IvCellProps {
  readonly stat: IvStat;
  readonly value: string;
  readonly onChange: (raw: string) => void;
}

/**
 * One determinant value input.
 *
 * `type="number"` is deliberately avoided: its value sanitization makes ""
 * unreachable through a digit-stripping handler, it ignores maxLength, and its
 * spinners turn "unset" into an ambiguous state.
 */
function IvCell({ stat, value, onChange }: IvCellProps) {
  const { t } = useI18n();
  const id = useId();
  const tone = ivTone(value);
  const abbr = t(stat.abbrKey);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="t-label justify-center">
        {abbr}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        maxLength={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={IV_UNSET_GLYPH}
        // The accessible name repeats the visible abbreviation (WCAG 2.5.3).
        aria-label={t("aria.catchMetaIv", { abbr, stat: t(stat.nameKey) })}
        className={`w-full bg-bg-secondary border rounded-none px-2 py-2 text-sm text-center tabular-nums placeholder-text-faint transition-colors ${IV_BORDER_CLASS[tone]} ${IV_TEXT_CLASS[tone]}`}
      />
    </div>
  );
}

// --- Ribbons ---

interface RibbonPickerProps {
  readonly labelId: string;
  readonly ribbons: readonly RibbonRef[];
  readonly selected: readonly string[];
  readonly locale: string;
  readonly onToggle: (slug: string) => void;
}

/**
 * Ribbon selection: a filter field over the flat catalogue plus a toggle
 * button per ribbon, with the current selection repeated as removable chips.
 */
function RibbonPicker({
  labelId,
  ribbons,
  selected,
  locale,
  onToggle,
}: RibbonPickerProps) {
  const { t } = useI18n();
  const filterId = useId();
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return ribbons;
    return ribbons.filter((entry) =>
      refLabel(entry, locale).toLowerCase().includes(needle),
    );
  }, [ribbons, query, locale]);

  const nameOf = (slug: string) => refLabelFor(ribbons, slug, locale);

  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="t-label self-start">
        {t("catchMeta.ribbons")}
      </span>

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((slug) => (
            <span
              key={slug}
              className="inline-flex items-center gap-1 min-h-[24px] pl-1.5 pr-1 py-0.5 rounded-none border border-border-subtle bg-bg-secondary text-[11px] text-text-secondary"
            >
              <CatchIcon
                src={getRibbonIconUrl(slug)}
                className="w-4 h-4 object-contain shrink-0"
              />
              {nameOf(slug)}
              {/* Sibling button, never nested inside another interactive element. */}
              <button
                type="button"
                onClick={() => onToggle(slug)}
                aria-label={t("aria.catchMetaRibbonToggle", { name: nameOf(slug) })}
                className="p-0.5 min-h-[24px] rounded-none text-text-muted hover:text-text-primary transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-text-faint">{t("catchMeta.ribbonEmpty")}</p>
      )}

      <label htmlFor={filterId} className="sr-only">
        {t("catchMeta.ribbonSearch")}
      </label>
      <input
        id={filterId}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("catchMeta.ribbonSearch")}
        className={INPUT_CLASS}
      />

      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto"
      >
        {visible.map((entry) => {
          const name = refLabel(entry, locale);
          const active = selected.includes(entry.slug);
          return (
            <button
              key={entry.slug}
              type="button"
              onClick={() => onToggle(entry.slug)}
              aria-pressed={active}
              aria-label={t("aria.catchMetaRibbonToggle", { name })}
              className={`inline-flex items-center gap-1 min-h-[24px] pl-1.5 pr-2 py-1 rounded-none border text-[11px] transition-colors ${
                active
                  ? "border-accent-blue/40 bg-accent-blue/10 text-accent-blue"
                  : "border-border-subtle text-text-muted hover:text-text-primary"
              }`}
            >
              <CatchIcon
                src={getRibbonIconUrl(entry.slug)}
                className="w-4 h-4 object-contain shrink-0"
              />
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
