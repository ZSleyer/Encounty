/**
 * useForceCounterOnArchive.ts: Keeps the panel off the detector tab for an
 * archived hunt, which has no detector to configure any more.
 */

import { useEffect } from "react";
import { Pokemon } from "../../types";
import type { PanelTab } from "./types";

/** Switches away from the detector tab when the viewed Pokemon gets archived. */
export function useForceCounterOnArchive(
  appState: { pokemon: Pokemon[]; active_id: string } | null,
  viewedPokemonId: string | null,
  rightPanelTab: string,
  setRightPanelTab: (tab: PanelTab) => void,
) {
  useEffect(() => {
    const viewed = appState?.pokemon.find((p) => p.id === (viewedPokemonId || appState?.active_id));
    if (viewed?.completed_at && rightPanelTab === "detector") {
      setRightPanelTab("counter");
    }
  }, [appState?.pokemon, viewedPokemonId, appState?.active_id, rightPanelTab]);
}
