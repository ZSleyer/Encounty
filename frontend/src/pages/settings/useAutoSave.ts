/**
 * useAutoSave.ts: Debounced persistence of the settings draft.
 */

import { useEffect } from "react";

import { Settings as SettingsType } from "../../types";
import { apiUrl } from "../../utils/api";

/**
 * Persist the settings draft 800 ms after the last change and confirm with a
 * short toast. The dependency list is written by hand so that only the fields
 * the page can actually edit trigger a save.
 */
export function useAutoSave(
  settings: SettingsType | null,
  t: (key: string) => string,
  pushToast: (toast: { type: "success"; title: string; duration?: number }) => void,
) {
  useEffect(() => {
    if (!settings) return;
    const timer = setTimeout(() => {
      fetch(apiUrl("/api/settings"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      }).then(() => {
        pushToast({ type: "success", title: t("settings.saved"), duration: 1500 });
      });
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings?.output_enabled,
    settings?.output_dir,
    settings?.crisp_sprites,
    settings?.accent_color,
    JSON.stringify(settings?.languages),
  ]);
}
