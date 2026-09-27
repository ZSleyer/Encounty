/**
 * useAutoSave.ts: Debounced persistence of the settings draft.
 */

import { useEffect } from "react";

import { Settings as SettingsType } from "../../types";
import { apiUrl } from "../../utils/api";
import { localizeApiError } from "../../utils/apiError";

/**
 * Persist the settings draft 800 ms after the last change and confirm with a
 * short toast. On a rejected save the backend discards the whole settings
 * block, so a failed response raises an error toast instead of a success one.
 * The dependency list is written by hand so that only the fields the page can
 * actually edit trigger a save.
 */
export function useAutoSave(
  settings: SettingsType | null,
  t: (key: string, options?: Record<string, string | number>) => string,
  pushToast: (toast: {
    type: "success" | "error";
    title: string;
    message?: string;
    duration?: number;
  }) => void,
) {
  useEffect(() => {
    if (!settings) return;
    const timer = setTimeout(() => {
      fetch(apiUrl("/api/settings"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      })
        .then(async (res) => {
          if (res.ok) {
            pushToast({ type: "success", title: t("settings.saved"), duration: 1500 });
            return;
          }
          const data = await res.json().catch(() => ({}));
          pushToast({
            type: "error",
            title: t("settings.outputDirError"),
            message: localizeApiError(data, t),
          });
        })
        .catch(() => {
          pushToast({ type: "error", title: t("settings.outputDirError") });
        });
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings?.output_enabled,
    settings?.output_dir,
    settings?.crisp_sprites,
    settings?.accent_color,
  ]);
}
