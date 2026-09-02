/**
 * UpdateOverlay.tsx: Blocking overlay for an update that is already running.
 *
 * Shown once the user has accepted an update: it covers the whole app while
 * electron-updater downloads, installs, and restarts, and reports the download
 * percentage as it arrives.
 */
import { useI18n } from "../contexts/I18nContext";
import { useModalA11y } from "../hooks/useModalA11y";

/** updateOverlayTitle names the current step, with the download percentage once
 *  electron-updater reports progress. */
export function updateOverlayTitle(
  t: (key: string) => string,
  updateState: "downloading" | "installing" | "restarting",
  percent: number | null,
): string {
  if (updateState === "restarting") return t("update.restarting");
  if (updateState === "installing") return t("update.installing");
  return percent === null
    ? t("update.downloading")
    : `${t("update.downloading")} ${Math.round(percent)}%`;
}

/** Full-screen blocking overlay shown while an update is downloading, being
 *  installed, or restarting. */
export function UpdateOverlay({
  updateState,
  version,
  percent,
}: Readonly<{
  updateState: "downloading" | "installing" | "restarting";
  version: string;
  percent: number | null;
}>) {
  const { t } = useI18n();
  // Not cancelable: an update install/restart can't be interrupted, so Escape is a no-op.
  const containerRef = useModalA11y<HTMLDivElement>({ isOpen: true, onClose: () => {} });
  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-overlay-title"
      tabIndex={-1}
      className="fixed inset-0 z-100 bg-black/80 backdrop-blur-sm flex items-center-safe justify-center-safe animate-fadeIn"
    >
      <div className="t-panel p-12 flex flex-col items-center gap-6 max-w-md mx-4 shadow-2xl anim-t-crt-in">
        <div className="w-16 h-16 border-3 border-accent-blue border-t-transparent rounded-full animate-spin" />
        <div className="text-center space-y-2">
          <p id="update-overlay-title" className="text-lg font-semibold text-text-primary">
            {updateOverlayTitle(t, updateState, percent)}
          </p>
          <p className="text-sm text-text-muted">
            {t("update.updatingTo")} {version}
          </p>
        </div>
        <p className="text-xs text-text-faint">{t("update.doNotClose")}</p>
      </div>
    </div>
  );
}
