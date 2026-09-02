/**
 * UpdateNotification.tsx: Startup prompt offering a newer version.
 *
 * Rendered before any download starts. It links to the changelog and adapts its
 * buttons to the build kind: package-managed builds only get a close button,
 * builds without in-app auto-update open the download page instead.
 */
import { ArrowUpCircle } from "lucide-react";
import { useI18n } from "../contexts/I18nContext";
import { useModalA11y } from "../hooks/useModalA11y";
import { PAGES_CHANGELOG_URL } from "../utils/links";

/** Dismissable modal shown on startup when a newer version is available. */
export function UpdateNotification({
  version,
  onUpdate,
  onDismiss,
  manualDownload,
  packageManaged,
}: Readonly<{
  version: string;
  onUpdate: () => void;
  onDismiss: () => void;
  manualDownload?: boolean;
  packageManaged?: boolean;
}>) {
  const { t } = useI18n();
  const containerRef = useModalA11y<HTMLDivElement>({ isOpen: true, onClose: onDismiss });
  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-notification-title"
      tabIndex={-1}
      className="fixed inset-0 z-90 bg-black/50 backdrop-blur-sm flex items-center-safe justify-center-safe animate-fadeIn"
    >
      <div className="t-panel p-10 flex flex-col items-center gap-5 max-w-md mx-4 shadow-2xl anim-t-crt-in">
        <div className="w-14 h-14 rounded-full border border-accent-blue/40 flex items-center justify-center">
          <ArrowUpCircle className="w-7 h-7 text-accent-blue" />
        </div>
        <div className="text-center space-y-1.5">
          <p id="update-notification-title" className="text-lg font-semibold text-text-primary">
            {t("update.newVersion")}
          </p>
          <p className="text-sm text-text-muted">{version}</p>
          <a
            href={PAGES_CHANGELOG_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-accent-blue hover:underline"
          >
            {t("update.changelog")}
          </a>
          {packageManaged && (
            <p className="text-xs text-text-muted pt-1.5">{t("update.packageManagerHint")}</p>
          )}
        </div>
        {/* Without the second button, half width keeps the same button metrics as the two-button row. */}
        <div className="flex gap-3 w-full">
          <button
            onClick={onDismiss}
            className={`${packageManaged ? "w-1/2 mx-auto" : "flex-1"} px-4 py-2.5 rounded-none border border-border-subtle text-text-muted hover:bg-bg-hover text-sm font-medium transition-colors`}
          >
            {packageManaged ? t("common.close") : t("update.later")}
          </button>
          {!packageManaged && (
            <button
              onClick={onUpdate}
              className="flex-1 px-4 py-2.5 rounded-none bg-accent-blue hover:bg-accent-blue/80 text-white text-sm font-semibold transition-colors"
            >
              {manualDownload ? t("update.openDownload") : t("update.updateNow")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
