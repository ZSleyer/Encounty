/**
 * TotalHuntTime.tsx: accumulated hunt time across every entry in the snapshot.
 */
import { Clock } from "lucide-react";
import type { Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { useDurationFormat } from "../../contexts/ThemeContext";
import { useSecondTick } from "../../hooks/useSecondTick";
import { runningMsFor } from "../../utils/groupTotals";
import { formatDuration } from "../../utils/timer";

/**
 * TotalHuntTime renders the summed time of every hunt and ticks once per second
 * while any timer runs.
 *
 * A flat sum is correct here even though phases are separate entries: the
 * backend zeroes a parent when it freezes a phase, so no interval is counted
 * twice and none is lost. Kept as its own component so the per-second re-render
 * does not reach the rest of the quick-action bar.
 */
export function TotalHuntTime({ allPokemon }: Readonly<{ allPokemon: Pokemon[] }>) {
  const { t } = useI18n();
  const { durationFormat } = useDurationFormat();
  const isRunning = allPokemon.some((p) => !!p.timer_started_at);

  useSecondTick(isRunning);

  const accumulated = allPokemon.reduce((sum, p) => sum + (p.timer_accumulated_ms || 0), 0);
  const time = formatDuration(accumulated + runningMsFor(allPokemon), durationFormat);
  return (
    <span className="t-label gap-1 shrink-0 tabular-nums" title={t("sidebar.totalTime", { time })}>
      <Clock className="w-3 h-3 text-accent-blue" aria-hidden="true" />
      <span className="font-mono tabular-nums">{time}</span>
      <span className="sr-only">{t("aria.totalTimeAll")}</span>
    </span>
  );
}
