/**
 * useInitFromAppState.ts: One-shot seeding of the settings draft from app state.
 */

import { useEffect, useState } from "react";

import { AppState, Settings as SettingsType } from "../../types";

/**
 * Seed the local settings draft from the app state exactly once, as soon as
 * the state arrives. Later app state updates are ignored so that they cannot
 * overwrite edits the user is still making.
 */
export function useInitFromAppState(
  appState: AppState | null,
  setSettings: (s: SettingsType | null) => void,
) {
  const [initialized, setInitialized] = useState(!!appState);
  useEffect(() => {
    if (appState && !initialized) {
      setSettings(appState.settings);
      setInitialized(true);
    }
  }, [appState, initialized, setSettings]);
}
