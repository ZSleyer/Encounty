/**
 * CloseTabWarning.tsx: Guard against losing a running hunt to Ctrl+W.
 *
 * Only reachable in the browser build, where the app cannot veto a tab close
 * the way Electron can. It offers staying on the page or quitting the backend.
 */
import { AlertTriangle } from "lucide-react";
import { useI18n } from "../contexts/I18nContext";
import { useModalA11y } from "../hooks/useModalA11y";

/** Confirmation modal shown when the user tries to close the tab via Ctrl+W / Cmd+W. */
export function CloseTabWarning({
  onStay,
  onQuit,
}: Readonly<{
  onStay: () => void;
  onQuit: () => void;
}>) {
  const { t } = useI18n();
  const containerRef = useModalA11y<HTMLDivElement>({ isOpen: true, onClose: onStay });
  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="close-warning-title"
      tabIndex={-1}
      className="fixed inset-0 z-95 bg-black/50 backdrop-blur-sm flex items-center-safe justify-center-safe animate-fadeIn"
    >
      <div className="t-panel p-8 flex flex-col items-center gap-5 max-w-md mx-4 shadow-2xl anim-t-crt-in">
        <div className="w-14 h-14 rounded-full border border-accent-yellow/40 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-accent-yellow" />
        </div>
        <div className="text-center space-y-1.5">
          <p id="close-warning-title" className="text-lg font-semibold text-text-primary">
            {t("app.closeWarning")}
          </p>
          <p className="text-sm text-text-muted">{t("app.closeWarningDesc")}</p>
        </div>
        <div className="flex gap-3 w-full">
          <button
            onClick={onStay}
            className="flex-1 px-4 py-2.5 rounded-none bg-accent-blue hover:bg-accent-blue/80 text-white text-sm font-semibold transition-colors"
          >
            {t("app.closeWarningStay")}
          </button>
          <button
            onClick={onQuit}
            className="flex-1 px-4 py-2.5 rounded-none border border-border-subtle text-text-muted hover:bg-bg-hover text-sm font-medium transition-colors"
          >
            {t("app.closeWarningQuit")}
          </button>
        </div>
      </div>
    </div>
  );
}
