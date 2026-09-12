/**
 * overlayActions.ts: Orchestration of the per-hunt overlay settings.
 *
 * Resolves which overlay a hunt currently shows and applies the mode switches,
 * saves and imports the overlay tab triggers. The actual persistence call is
 * injected, so this module stays free of React and of the API client.
 */

import { AppState, OverlayMode, OverlaySettings, Pokemon } from "../../types";
import { resolveOverlay } from "../../utils/overlay";

/** Resolves the overlay settings for a given viewed Pokemon. */
function resolveCurrentOverlay(
  appState: {
    pokemon: Pokemon[];
    active_id: string;
    settings: { overlay: OverlaySettings };
  } | null,
  viewedPokemonId: string | null,
): OverlaySettings | null {
  if (!appState) return null;
  const viewed = appState.pokemon.find((p) => p.id === (viewedPokemonId || appState.active_id));
  if (!viewed) return null;
  const mode = viewed.overlay_mode || "default";
  return mode === "custom" && viewed.overlay
    ? viewed.overlay
    : resolveOverlay(viewed, appState.pokemon, appState.settings.overlay);
}

/** Resolves overlay settings from a copy source (global or another Pokemon). */
function resolveCopySource(
  sourceId: string,
  pokemon: Pokemon[],
  globalOverlay: OverlaySettings,
): OverlaySettings | null {
  if (sourceId === "global") return globalOverlay;
  const p = pokemon.find((x) => x.id === sourceId);
  return p ? resolveOverlay(p, pokemon, globalOverlay) : null;
}

/** Applies a new overlay mode to the given Pokemon and updates the editor state. */
async function applyOverlayMode(
  newMode: "default" | "custom",
  pokemon: Pokemon,
  appState: AppState,
  updateOverlay: (id: string, mode: OverlayMode, overlay: OverlaySettings | null) => Promise<void>,
  setOverlay: (o: OverlaySettings) => void,
) {
  if (newMode === "default") {
    await updateOverlay(pokemon.id, "default", null);
    setOverlay(appState.settings.overlay);
  } else if (newMode === "custom") {
    const resolved = resolveOverlay(pokemon, appState.pokemon, appState.settings.overlay);
    setOverlay(resolved);
    await updateOverlay(pokemon.id, "custom", resolved);
  }
}

/** Syncs the overlay editor state when the viewed Pokemon or active ID changes. */
export function syncOverlayState(
  appState: AppState | null,
  viewedPokemonId: string | null,
  setCurrentOverlay: (o: OverlaySettings) => void,
  setOverlayDirty: (dirty: boolean) => void,
): void {
  const overlay = resolveCurrentOverlay(appState, viewedPokemonId);
  if (overlay) {
    setCurrentOverlay(overlay);
    setOverlayDirty(false);
  }
}

/**
 * Switches overlay mode for a given Pokemon.
 *
 * Leaving "custom" throws the hand-built layout away, so that direction asks
 * first via the shared confirmation modal instead of applying straight away.
 */
export function changePokemonOverlayMode(
  newMode: "default" | "custom",
  pokemon: Pokemon | null,
  appState: AppState,
  t: (key: string) => string,
  updateOverlay: (id: string, mode: OverlayMode, overlay: OverlaySettings | null) => Promise<void>,
  setOverlay: (o: OverlaySettings) => void,
  setConfirmConfig: React.Dispatch<
    React.SetStateAction<{
      isOpen: boolean;
      title: string;
      message: string;
      isDestructive: boolean;
      onConfirm: () => void;
    }>
  >,
): void {
  if (!pokemon) return;
  const currentMode = pokemon.overlay_mode || "default";
  const needsConfirm = currentMode === "custom" && newMode !== "custom";
  if (!needsConfirm) {
    void applyOverlayMode(newMode, pokemon, appState, updateOverlay, setOverlay);
    return;
  }
  setConfirmConfig({
    isOpen: true,
    title: t("overlay.confirmModeChangeTitle"),
    message: t("overlay.confirmModeChange"),
    isDestructive: true,
    onConfirm: () => {
      void applyOverlayMode(newMode, pokemon, appState, updateOverlay, setOverlay);
    },
  });
}

/** Saves the current custom overlay if both overlay and Pokemon are available. */
export async function saveOverlayIfReady(
  overlay: OverlaySettings | null,
  pokemon: Pokemon | null,
  updateOverlay: (id: string, mode: OverlayMode, overlay: OverlaySettings | null) => Promise<void>,
): Promise<void> {
  if (!overlay || !pokemon) return;
  await updateOverlay(pokemon.id, "custom", overlay);
}

/** Copies overlay settings from a source Pokemon or global defaults. */
export function applyCopyOverlay(
  sourceId: string,
  appState: AppState,
  setOverlay: (o: OverlaySettings) => void,
  setDirty: (dirty: boolean) => void,
): void {
  const overlay = resolveCopySource(sourceId, appState.pokemon, appState.settings.overlay);
  if (overlay) setOverlay(overlay);
  setDirty(true);
}
