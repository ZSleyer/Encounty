/**
 * catchMetaIvs.tsx: The determinant value (IV) model of a recorded catch and
 * the editor cells that render it.
 *
 * The model half (keys, tone classification, display classes) is shared with
 * CatchMetaSummary, which renders the same six values read-only, so it lives
 * apart from the dialog that edits them.
 */
import { useId } from "react";
import { useI18n } from "../../contexts/I18nContext";
import type { CatchMeta } from "../../types";

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
export const IV_MAX = 31;

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
 * without relying on color (WCAG 1.4.1).
 */
export const IV_BORDER_CLASS: Record<IvTone, string> = {
  unset: "border-dashed border-border-subtle",
  min: "border-solid border-accent-purple/40",
  max: "border-solid border-accent-green/40",
  normal: "border-solid border-border-subtle",
};

/** Glyph color per determinant tone. */
export const IV_TEXT_CLASS: Record<IvTone, string> = {
  unset: "text-text-faint",
  min: "text-accent-purple",
  max: "text-accent-green",
  normal: "text-text-primary",
};

/** Editor state of the six determinant values; "" means unset. */
export type IvState = Record<IvKey, string>;

/** Empty determinant state, used for a fresh catch. */
export const EMPTY_IVS: IvState = {
  hp: "",
  atk: "",
  def: "",
  sp_atk: "",
  sp_def: "",
  speed: "",
};

/** Seeds the determinant editor state from stored metadata. */
export function seedIvs(meta?: CatchMeta): IvState {
  const seeded = { ...EMPTY_IVS };
  for (const stat of IV_STATS) {
    const value = meta?.[stat.key];
    // A stored 0 is a fact, not an absence, so it must survive the seeding.
    if (typeof value === "number") seeded[stat.key] = String(value);
  }
  return seeded;
}

// --- Determinant value editor ---

interface IvFieldsetProps {
  readonly ivs: IvState;
  /** Sum of all six values, or null while at least one is unset. */
  readonly total: number | null;
  readonly onChange: (key: IvKey, raw: string) => void;
}

/** The six determinant value cells as one labeled group. */
export function IvFieldset({ ivs, total, onChange }: IvFieldsetProps) {
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
