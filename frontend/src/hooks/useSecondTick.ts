import { useEffect, useReducer } from "react";

/**
 * useSecondTick re-renders the calling component once per second while
 * `enabled` is true.
 *
 * Running timers are derived from a start timestamp rather than stored as a
 * counter, so nothing in the state changes as they advance. This hook supplies
 * the missing render trigger, and stops it while the timer is paused so an
 * idle dashboard does not wake up every second for nothing.
 */
export function useSecondTick(enabled: boolean): void {
  const [, tick] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => tick(), 1000);
    return () => clearInterval(id);
  }, [enabled]);
}
