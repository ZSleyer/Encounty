/**
 * PhaseHistory.tsx: the phases recorded under one archived catch.
 */
import { useI18n } from "../../contexts/I18nContext";
import { Fact } from "./Fact";
import { completionDate } from "./dexDetailHelpers";
import type { Pokemon } from "../../types";
import { pokemonDisplayName } from "../../utils/pokemon";
import { formatTimer } from "../../utils/timer";

/**
 * Phases recorded under one entry, with the two totals the dashboard reports
 * for a phased hunt. Rendered on every catch, so the phase history of a hunt
 * tracked in this app is finally visible in the pokedex too.
 */
export function PhaseHistory({
  children,
  totals,
}: {
  readonly children: Pokemon[];
  readonly totals: { encounters: number; timerMs: number };
}) {
  const { t, locale } = useI18n();
  if (children.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
      <h4 className="t-label w-fit">{t("phase.historyTitle")}</h4>
      <ul role="list" aria-label={t("aria.phaseList")} className="flex flex-col gap-2">
        {children.map((child) => (
          <li key={child.id} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="t-label t-label--accent">
                {t("phase.badge", { number: child.phase_number ?? 0 })}
              </span>
              <span className="text-sm text-text-primary">{pokemonDisplayName(child)}</span>
              {child.failed && (
                <span className="t-label t-label--danger">{t("dex.failedTag")}</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 @md:grid-cols-3">
              {completionDate(child, locale) && (
                <Fact
                  label={t(child.failed ? "dex.failedOn" : "dex.caughtOn")}
                  value={completionDate(child, locale)}
                />
              )}
              <Fact label={t("dex.encounters")} value={String(child.encounters ?? 0)} numeric />
              <Fact
                label={t("modal.timerLabel")}
                value={formatTimer(child.timer_accumulated_ms ?? 0)}
                numeric
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-3">
        <Fact label={t("phase.totalEncounters")} value={String(totals.encounters)} numeric />
        <Fact label={t("phase.totalTime")} value={formatTimer(totals.timerMs)} numeric />
      </div>
    </div>
  );
}
