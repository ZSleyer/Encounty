/**
 * restore.ts: Upload of a backup archive to the restore endpoint.
 */

import { apiUrl } from "../../utils/api";

/**
 * Upload a backup archive to `/api/restore` and report the outcome as a toast.
 *
 * The file input is reset afterwards so that picking the same archive twice
 * still fires a change event.
 */
export async function performRestore(
  file: File,
  t: (key: string) => string,
  pushToast: (toast: { type: "success" | "error"; title: string; message?: string }) => void,
  setRestoring: (v: boolean) => void,
  restoreInputRef: React.RefObject<HTMLInputElement | null>,
): Promise<void> {
  setRestoring(true);
  const form = new FormData();
  form.append("backup", file);
  try {
    const res = await fetch(apiUrl("/api/restore"), { method: "POST", body: form });
    if (res.ok) {
      pushToast({ type: "success", title: t("settings.restoreSuccess") });
    } else {
      const data = await res.json().catch(() => ({}));
      pushToast({
        type: "error",
        title: t("settings.restoreError"),
        message: data.error ?? String(res.status),
      });
    }
  } catch {
    pushToast({ type: "error", title: t("settings.restoreError") });
  } finally {
    setRestoring(false);
    if (restoreInputRef.current) restoreInputRef.current.value = "";
  }
}
