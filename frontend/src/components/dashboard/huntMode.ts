/**
 * huntMode.ts: Hunt-mode rules and detector start/stop logic.
 *
 * Decides what a hunt in "both", "timer" or "detector" mode is allowed to do
 * with the capture sources currently connected, and performs the side effects
 * (starting a detection loop, persisting a changed mode) that follow.
 */

import { Pokemon } from "../../types";
import { startDetectionForPokemon } from "../../engine/startDetection";
import { useCounterStore } from "../../hooks/useCounterState";
import { apiUrl } from "../../utils/api";
import type { HuntMode } from "./types";

/** Returns true if the Pokemon has at least one enabled detector template. */
export function hasDetectorReady(pokemon: Pokemon): boolean {
  const tmpls = pokemon.detector_config?.templates;
  if (!tmpls || tmpls.length === 0) return false;
  return tmpls.some((t) => t.enabled !== false);
}

/** Returns true when the timer start should be blocked because the hunt requires a detector source that is not connected. */
export function isTimerStartBlocked(
  pokemon: Pokemon,
  isCapturing: (id: string) => boolean,
): boolean {
  const mode = pokemon.hunt_mode || "both";
  if (mode === "timer") return false;
  // "both" falls back to timer-only only when detector is not configured at
  // all for this Pokémon (e.g. plain hand-counting). Once a DetectorConfig
  // exists, the user has opted into auto-detection and we must enforce
  // templates + source before any timer starts.
  if (mode === "both" && !pokemon.detector_config) return false;
  return !hasDetectorReady(pokemon) || !isCapturing(pokemon.id);
}

/** Returns true if a non-running Pokemon can be individually started given its hunt_mode and capture source state. */
export function canPokemonStart(pokemon: Pokemon, isCapturing: (id: string) => boolean): boolean {
  const mode = pokemon.hunt_mode || "both";
  if (mode === "timer") return true;
  return hasDetectorReady(pokemon) && isCapturing(pokemon.id);
}

// Shared toast key: a detection start can fail for several hunts at once, and
// one message is enough.
export const keyDetectorStart = "detector-start";

/** Color and pointer classes of the sidebar hunt start/stop button. */
export function huntButtonClass(anyRunning: boolean, canStart: boolean, mode: string): string {
  if (anyRunning) return "text-accent-red hover:bg-accent-red/10";
  if (!canStart) return "opacity-30 cursor-not-allowed text-text-muted";
  if (mode === "detector") return "text-accent-purple hover:bg-accent-purple/10";
  if (mode === "timer") return "text-accent-green hover:bg-accent-green/10";
  return "text-accent-blue hover:text-accent-blue hover:bg-accent-blue/10";
}

/** Starts detection for a single Pokemon if it meets all prerequisites. */
export function tryStartDetection(
  pokemon: Pokemon,
  capture: {
    isCapturing: (id: string) => boolean;
    getVideoElement: (id: string) => HTMLVideoElement | null;
  },
  setDetectorStatus: (
    id: string,
    status: { state: string; confidence: number; poll_ms: number; cooldown_remaining_ms?: number },
  ) => void,
  onFailure?: () => void,
): void {
  const cfg = pokemon.detector_config;
  if (!cfg) {
    onFailure?.();
    return;
  }
  // startDetectionForPokemon resolves to null when no detector is available or
  // no template could be loaded. Dropping that promise made a failed start look
  // exactly like a successful one.
  void startDetectionForPokemon({
    pokemonId: pokemon.id,
    templates: cfg.templates || [],
    config: cfg,
    getVideoElement: () => capture.getVideoElement(pokemon.id),
    onScore: (score, state, cooldownMs) =>
      setDetectorStatus(pokemon.id, {
        state,
        confidence: score,
        poll_ms: 100,
        cooldown_remaining_ms: cooldownMs,
      }),
  })
    .then((started) => {
      if (!started) onFailure?.();
    })
    .catch(() => onFailure?.());
}

/** Returns whether a Pokemon's detector should be started (not timer-only, has detector ready, not running, capturing). */
export function canStartDetector(
  pokemon: Pokemon,
  detectorStatus: Record<string, unknown>,
  capture: { isCapturing: (id: string) => boolean },
): boolean {
  const mode = pokemon.hunt_mode || "both";
  return (
    mode !== "timer" &&
    hasDetectorReady(pokemon) &&
    !detectorStatus[pokemon.id] &&
    capture.isCapturing(pokemon.id)
  );
}

/** Updates the hunt_mode for a Pokemon via the API with optimistic local update. */
export function updateHuntMode(pokemon: Pokemon, mode: HuntMode): void {
  if (pokemon.hunt_mode !== mode) {
    // Optimistic local update so both header and sidebar reflect the change instantly
    const store = useCounterStore.getState();
    if (store.appState) {
      store.setAppState({
        ...store.appState,
        pokemon: store.appState.pokemon.map((p) =>
          p.id === pokemon.id ? { ...p, hunt_mode: mode } : p,
        ),
      });
    }
    void fetch(apiUrl(`/api/pokemon/${pokemon.id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...pokemon, hunt_mode: mode }),
    }).catch(() => {});
  }
}
