/**
 * timer.ts — Shared timer utility functions used by Dashboard and Overlay.
 */
import type { Pokemon } from "../types";

/** Formats milliseconds as HH:MM:SS. */
export function formatTimer(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Computes the current total timer value for a Pokemon (accumulated + running). */
export function computeTimerMs(pokemon: Pokemon): number {
  const acc = pokemon.timer_accumulated_ms || 0;
  if (!pokemon.timer_started_at) return acc;
  return acc + (Date.now() - new Date(pokemon.timer_started_at).getTime());
}
