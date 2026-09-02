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
import { useEffect, useId, useMemo, useState } from "react";
import { useI18n } from "../../contexts/I18nContext";
import { useToast } from "../../contexts/ToastContext";
import type {
  CatchMeta,
  CatchMetaUpdate,
  EvolutionStep,
  PokemonGender,
  ShinyVariant,
} from "../../types";
import { ModalShell } from "../shared/ModalShell";
import { getGameGroup, gameSupportsShinyVariant } from "../../utils/gameGroups";
import { ShinyVariantSelect } from "./ShinyVariantSelect";
import { getBallIconUrl, getMarkIconUrl } from "../../utils/catchIcons";
import { useCatchRefs } from "../../hooks/useCatchRefs";
import { usePokedex } from "./pokemonPicker";
import { getGenderSpriteUrl, isCustomSprite } from "../../utils/sprites";
import { defaultGender, GenderSelector } from "./GenderSelector";
import { ComboField, INPUT_CLASS, SelectField } from "./catchMetaFields";
import { ballFitsGame, digitsOnly, matchingRefs, sortedByLabel } from "./catchRefHelpers";
import { EvolutionEditor } from "./EvolutionEditor";
import { RibbonPicker } from "./RibbonPicker";
import { IV_MAX, IV_STATS, IvFieldset, seedIvs, type IvKey, type IvState } from "./catchMetaIvs";

// --- Helpers ---

/** True when the metadata carries at least one recorded detail. */
export function hasCatchData(meta?: CatchMeta): boolean {
  if (!meta) return false;
  return Object.values(meta).some((value) =>
    Array.isArray(value) ? value.length > 0 : value !== undefined && value !== "",
  );
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
export function CatchMetaModal({
  pokemon,
  onSubmit,
  onClose,
  mode = "capture",
}: CatchMetaModalProps) {
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
  const [shinyVariant, setShinyVariant] = useState<"" | ShinyVariant>(stored?.shiny_variant ?? "");
  const [ivs, setIvs] = useState<IvState>(() => seedIvs(stored));
  const [ribbons, setRibbons] = useState<string[]>(stored?.ribbons ?? []);
  const [evolutions, setEvolutions] = useState<EvolutionStep[]>(stored?.evolutions ?? []);
  const species = allPokemon.find(
    (entry) =>
      entry.canonical === pokemon.canonical_name ||
      entry.forms?.some((form) => form.canonical === pokemon.canonical_name),
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

  const natureOptions = useMemo(() => sortedByLabel(refs.natures, locale), [refs.natures, locale]);
  const markOptions = useMemo(() => sortedByLabel(refs.marks, locale), [refs.marks, locale]);

  // Both suggestion lists are rendered eagerly, so they are capped: a game
  // group carries up to ~250 locations and the ability catalog is flat and
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
    if (shinyVariant) meta.shiny_variant = shinyVariant;
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
        {
          canonical_name: pokemon.canonical_name,
          game: pokemon.game,
          sprite_type: pokemon.sprite_type,
          sprite_style: pokemon.sprite_style,
        },
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
        {mode === "capture" && <p className="text-sm text-text-muted">{t("catchMeta.intro")}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {pokemon.name && (
            <div className="sm:col-span-2 flex flex-col gap-1.5">
              <label htmlFor={ids.nickname} className="t-label">
                {t("catchMeta.nickname")}
              </label>
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
            </div>
          )}

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

        {gameSupportsShinyVariant(pokemon.game) && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-secondary">{t("catchMeta.shinyVariant")}</span>
            <ShinyVariantSelect
              value={shinyVariant}
              onChange={setShinyVariant}
              ariaLabel={t("aria.shinyVariant")}
              anyLabelKey="catchMeta.shinyVariantNone"
            />
          </div>
        )}

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
