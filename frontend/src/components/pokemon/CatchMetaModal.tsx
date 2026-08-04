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
import { useId, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { useToast } from "../../contexts/ToastContext";
import type { CatchMeta, Pokemon } from "../../types";
import { ModalShell } from "../shared/ModalShell";
import { getGameGroup } from "../../utils/gameGroups";
import {
  refLabel,
  refLabelFor,
  useCatchRefs,
  type CatchRefEntry,
  type RibbonRef,
} from "../../hooks/useCatchRefs";

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

// --- Props ---

/** Props for {@link CatchMetaModal}. */
export interface CatchMetaModalProps {
  /** The caught Pokémon whose details are recorded; seeds the initial state. */
  readonly pokemon: Pokemon;
  /** Persists the metadata; rejects to keep the dialog open. */
  readonly onSubmit: (id: string, meta: CatchMeta) => Promise<void>;
  /** Called after the close transition finishes; unmount the modal here. */
  readonly onClose: () => void;
}

// --- Component ---

/**
 * Renders the catch metadata dialog for one Pokémon.
 *
 * The left footer button always skips: it closes without sending anything, so
 * the capture flow never forces data entry. The right one saves and keeps the
 * dialog open when the request fails, so nothing typed is lost.
 */
export function CatchMetaModal({ pokemon, onSubmit, onClose }: CatchMetaModalProps) {
  const { t, locale } = useI18n();
  const { push } = useToast();
  const refs = useCatchRefs(pokemon.game);

  const stored = pokemon.catch;
  const ids = {
    location: useId(),
    locationList: useId(),
    ball: useId(),
    level: useId(),
    nature: useId(),
    ability: useId(),
    abilityList: useId(),
    mark: useId(),
    ribbons: useId(),
  };

  const [location, setLocation] = useState(stored?.location ?? "");
  const [ball, setBall] = useState(stored?.ball ?? "");
  const [level, setLevel] = useState(stored?.level === undefined ? "" : String(stored.level));
  const [nature, setNature] = useState(stored?.nature ?? "");
  const [ability, setAbility] = useState(stored?.ability ?? "");
  const [mark, setMark] = useState(stored?.mark ?? "");
  const [ivs, setIvs] = useState<IvState>(() => seedIvs(stored));
  const [ribbons, setRibbons] = useState<string[]>(stored?.ribbons ?? []);
  const [submitting, setSubmitting] = useState(false);

  // --- Option lists ---

  const generation = getGameGroup(pokemon.game)?.generation ?? null;

  const ballOptions = useMemo(() => {
    if (generation === null) return sortedByLabel(refs.balls, locale);
    // A ball already stored on the Pokémon stays selectable even when it does
    // not belong to this generation, so editing cannot silently drop it.
    const usable = refs.balls.filter(
      (entry) => entry.generations?.includes(generation) || entry.slug === ball,
    );
    return sortedByLabel(usable, locale);
  }, [refs.balls, generation, locale, ball]);

  const natureOptions = useMemo(
    () => sortedByLabel(refs.natures, locale),
    [refs.natures, locale],
  );
  const markOptions = useMemo(
    () => sortedByLabel(refs.marks, locale),
    [refs.marks, locale],
  );

  // Datalists are rendered eagerly by the browser, so the location list is
  // capped: a game group carries up to ~250 entries.
  const locationOptions = useMemo(() => {
    const query = location.trim().toLowerCase();
    const matching = query
      ? refs.locations.filter((entry) =>
          refLabel(entry, locale).toLowerCase().startsWith(query),
        )
      : refs.locations;
    return matching.slice(0, 50);
  }, [refs.locations, location, locale]);

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

  const buildMeta = (): CatchMeta => {
    const meta: CatchMeta = {};
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
        {t("catchMeta.skip")}
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
        <p className="text-sm text-text-muted">{t("catchMeta.intro")}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor={ids.location} className="t-label">
              {t("catchMeta.location")}
            </label>
            <input
              data-autofocus
              id={ids.location}
              type="text"
              maxLength={120}
              list={ids.locationList}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={t("catchMeta.locationPlaceholder")}
              className={INPUT_CLASS}
            />
            {/* An empty catalogue leaves a plain text input behind, no error. */}
            <datalist id={ids.locationList}>
              {locationOptions.map((entry) => (
                <option key={entry.slug} value={refLabel(entry, locale)} />
              ))}
            </datalist>
          </div>

          <SelectField
            id={ids.ball}
            label={t("catchMeta.ball")}
            emptyLabel={t("catchMeta.ballNone")}
            options={ballOptions}
            value={ball}
            onChange={setBall}
            locale={locale}
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

          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.ability} className="t-label">
              {t("catchMeta.ability")}
            </label>
            <input
              id={ids.ability}
              type="text"
              maxLength={120}
              list={ids.abilityList}
              value={ability}
              onChange={(e) => setAbility(e.target.value)}
              placeholder={t("catchMeta.abilityPlaceholder")}
              className={INPUT_CLASS}
            />
            <datalist id={ids.abilityList}>
              {refs.abilities.map((entry) => (
                <option key={entry.slug} value={refLabel(entry, locale)} />
              ))}
            </datalist>
          </div>

          <SelectField
            id={ids.mark}
            label={t("catchMeta.mark")}
            emptyLabel={t("catchMeta.markNone")}
            options={markOptions}
            value={mark}
            onChange={setMark}
            locale={locale}
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
      </div>
    </ModalShell>
  );
}

// --- Select field ---

interface SelectFieldProps {
  readonly id: string;
  readonly label: string;
  /** Label of the leading empty option that clears the field. */
  readonly emptyLabel: string;
  readonly options: readonly CatchRefEntry[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly locale: string;
}

/** One labelled Tempest select over a reference catalogue. */
function SelectField({
  id,
  label,
  emptyLabel,
  options,
  value,
  onChange,
  locale,
}: SelectFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="t-label">
        {label}
      </label>
      <span className="t-select-wrap">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="t-select text-sm"
        >
          <option value="">{emptyLabel}</option>
          {options.map((entry) => (
            <option key={entry.slug} value={entry.slug}>
              {refLabel(entry, locale)}
            </option>
          ))}
        </select>
      </span>
    </div>
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
              className="inline-flex items-center gap-1 min-h-[24px] pl-2 pr-1 py-0.5 rounded-none border border-border-subtle bg-bg-secondary text-[11px] text-text-secondary"
            >
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
              className={`min-h-[24px] px-2 py-1 rounded-none border text-[11px] transition-colors ${
                active
                  ? "border-accent-blue/40 bg-accent-blue/10 text-accent-blue"
                  : "border-border-subtle text-text-muted hover:text-text-primary"
              }`}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
