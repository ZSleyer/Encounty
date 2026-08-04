/**
 * CatchMetaSummary.tsx: Read-only panel showing the recorded catch details of
 * one Pokémon, with the entry point for editing them.
 *
 * The panel is never hidden, not even without any recorded detail: it is the
 * only discovery surface for the edit action, so an empty state has to stay
 * visible and offer the same button.
 */
import { Pencil } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import type { CatchMeta } from "../../types";
import { refLabelFor, useCatchRefs } from "../../hooks/useCatchRefs";
import {
  IV_BORDER_CLASS,
  IV_PERFECT_TOTAL,
  IV_STATS,
  IV_TEXT_CLASS,
  IV_UNSET_GLYPH,
  hasCatchData,
  ivTone,
} from "./CatchMetaModal";

// --- Props ---

/** Props for {@link CatchMetaSummary}. */
export interface CatchMetaSummaryProps {
  /** Recorded details; absent or empty renders the empty state. */
  readonly meta?: CatchMeta;
  /** Opens the edit dialog; the button is hidden when omitted. */
  readonly onEdit?: () => void;
}

// --- Helpers ---

/** Determinant value as a display string; "" when the value is unset. */
function ivText(value?: number): string {
  return value === undefined ? "" : String(value);
}

// --- Component ---

/**
 * Renders the catch details of one Pokémon as a definition list inside a
 * Tempest panel. Slug-based fields (ball, nature, mark, ribbons) are resolved
 * against the reference catalogues; free-text fields render verbatim.
 */
export function CatchMetaSummary({ meta, onEdit }: CatchMetaSummaryProps) {
  const { t, locale } = useI18n();
  const refs = useCatchRefs();

  const pairs: { key: string; term: string; value: string }[] = [];
  if (meta?.location) pairs.push({ key: "location", term: t("catchMeta.location"), value: meta.location });
  if (meta?.ball) {
    pairs.push({ key: "ball", term: t("catchMeta.ball"), value: refLabelFor(refs.balls, meta.ball, locale) });
  }
  if (meta?.level !== undefined) {
    pairs.push({ key: "level", term: t("catchMeta.level"), value: String(meta.level) });
  }
  if (meta?.nature) {
    pairs.push({ key: "nature", term: t("catchMeta.nature"), value: refLabelFor(refs.natures, meta.nature, locale) });
  }
  if (meta?.ability) {
    pairs.push({ key: "ability", term: t("catchMeta.ability"), value: refLabelFor(refs.abilities, meta.ability, locale) });
  }
  if (meta?.mark) {
    pairs.push({ key: "mark", term: t("catchMeta.mark"), value: refLabelFor(refs.marks, meta.mark, locale) });
  }

  const ivValues = IV_STATS.map((stat) => ivText(meta?.[stat.key]));
  const hasIvs = ivValues.some((value) => value !== "");
  const ivTotal = ivValues.every((value) => value !== "")
    ? ivValues.reduce((sum, value) => sum + Number(value), 0)
    : null;
  const ribbons = meta?.ribbons ?? [];

  const editButton = onEdit && (
    <button
      type="button"
      onClick={onEdit}
      aria-label={t("catchMeta.edit")}
      className="relative after:absolute after:-inset-2 after:content-[''] t-label text-text-muted hover:text-text-primary transition-colors"
    >
      <Pencil className="w-3 h-3" />
    </button>
  );

  return (
    <div className="t-panel p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="t-label">{t("catchMeta.title")}</span>
        {editButton}
      </div>

      {hasCatchData(meta) ? (
        <dl className="mt-3 grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto_1fr] gap-x-4 gap-y-2 text-sm">
          {pairs.map((pair) => (
            <div key={pair.key} className="contents">
              <dt className="t-label self-center">{pair.term}</dt>
              <dd className="text-text-primary break-words">{pair.value}</dd>
            </div>
          ))}

          {hasIvs && (
            <div className="col-span-2 sm:col-span-4 flex flex-col gap-1.5">
              <dt className="t-label self-start">{t("catchMeta.ivs")}</dt>
              <dd>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {IV_STATS.map((stat, index) => (
                    <IvReadout
                      key={stat.key}
                      abbr={t(stat.abbrKey)}
                      value={ivValues[index]}
                    />
                  ))}
                </div>
                {ivTotal !== null && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-text-muted tabular-nums">
                      {t("catchMeta.ivTotal", { sum: ivTotal })}
                    </span>
                    {ivTotal === IV_PERFECT_TOTAL && (
                      <span className="t-label t-label--accent">
                        {t("catchMeta.ivPerfect")}
                      </span>
                    )}
                  </div>
                )}
              </dd>
            </div>
          )}

          {ribbons.length > 0 && (
            <div className="col-span-2 sm:col-span-4 flex flex-col gap-1.5">
              <dt className="t-label self-start">{t("catchMeta.ribbons")}</dt>
              <dd className="flex flex-wrap gap-1.5">
                {ribbons.map((slug) => (
                  <span
                    key={slug}
                    className="inline-flex items-center px-2 py-0.5 rounded-none border border-border-subtle bg-bg-secondary text-[11px] text-text-secondary"
                  >
                    {refLabelFor(refs.ribbons, slug, locale)}
                  </span>
                ))}
              </dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="mt-3 text-sm text-text-muted">{t("catchMeta.summaryEmpty")}</p>
      )}
    </div>
  );
}

// --- Determinant readout ---

interface IvReadoutProps {
  readonly abbr: string;
  /** Determinant value as a string; "" renders the unset state. */
  readonly value: string;
}

/**
 * One read-only determinant value. Repeats the editor's rules: dashed border
 * plus an en dash for unset, purple for 0, green for 31.
 */
function IvReadout({ abbr, value }: IvReadoutProps) {
  const tone = ivTone(value);
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="t-label">{abbr}</span>
      <span
        className={`w-full border px-2 py-1 text-sm text-center tabular-nums ${IV_BORDER_CLASS[tone]} ${IV_TEXT_CLASS[tone]}`}
      >
        {value === "" ? IV_UNSET_GLYPH : value}
      </span>
    </div>
  );
}
