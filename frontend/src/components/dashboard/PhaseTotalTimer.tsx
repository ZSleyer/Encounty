/**
 * PhaseTotalTimer.tsx: Accumulated hunt time across all phases.
 */

import { Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { useSecondTick } from "../../hooks/useSecondTick";
import { computeTimerMs, formatTimer } from "../../utils/timer";

/**
 * PhaseTotalTimer renders the accumulated time across all phases of a hunt and
 * ticks once per second while the hunt timer runs, mirroring PokemonTimer.
 * The derived total is clock-free, so the running segment is added here.
 */
export function PhaseTotalTimer({
  pokemon,
  totalTimerMs,
}: Readonly<{ pokemon: Pokemon; totalTimerMs: number }>) {
  const { t } = useI18n();
  const isRunning = !!pokemon.timer_started_at;

  useSecondTick(isRunning);

  const runningMs = computeTimerMs(pokemon) - (pokemon.timer_accumulated_ms ?? 0);
  return (
    <span className="t-label gap-1">
      {t("phase.totalTime")}
      <span className="font-mono tabular-nums">{formatTimer(totalTimerMs + runningMs)}</span>
    </span>
  );
}
