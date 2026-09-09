/**
 * timer.ts: Shared timer utility functions used by Dashboard and Overlay.
 */
import type { Pokemon } from "../types";

/** Milliseconds in one day, the threshold at which the day part appears. */
const DAY_MS = 86_400_000;

/**
 * DurationFormat selects how a duration is spelled out: "hms" lets the hours
 * run unbounded, "dhms" splits whole days off into a leading segment.
 */
export type DurationFormat = "hms" | "dhms";

/** Formats milliseconds as HH:MM:SS. */
export function formatTimer(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * formatDuration renders a duration either as HH:MM:SS or as D:HH:MM:SS.
 *
 * Kept separate from formatTimer, which the OBS overlay and every per-hunt
 * timer render with: those call sites must keep their exact output regardless
 * of the display preference chosen for the aggregate figures.
 *
 * In "dhms" the day part is dropped below 24 hours, so a short hunt reads the
 * same in both formats, and it carries no leading zero: a day count has no
 * natural width to pad to.
 */
export function formatDuration(ms: number, format: DurationFormat): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  if (format === "hms" || safe < DAY_MS) return formatTimer(safe);
  const days = Math.floor(safe / DAY_MS);
  return `${days}:${formatTimer(safe % DAY_MS)}`;
}

/** Computes the current total timer value for a Pokemon (accumulated + running). */
export function computeTimerMs(pokemon: Pokemon): number {
  const acc = pokemon.timer_accumulated_ms || 0;
  if (!pokemon.timer_started_at) return acc;
  return acc + (Date.now() - new Date(pokemon.timer_started_at).getTime());
}
