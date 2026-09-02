/**
 * useHotkeyPause.ts: Suspends the global hotkeys while the overlay editor is
 * open, so typing into it never counts an encounter.
 */

import { useEffect } from "react";
import { apiUrl } from "../../utils/api";

/** Pauses hotkeys while the overlay editor tab is active. */
export function useHotkeyPause(activeTab: string) {
  useEffect(() => {
    if (activeTab === "overlay") {
      void fetch(apiUrl("/api/hotkeys/pause"), { method: "POST" }).catch(() => {});
    } else {
      void fetch(apiUrl("/api/hotkeys/resume"), { method: "POST" }).catch(() => {});
    }
  }, [activeTab]);
}
