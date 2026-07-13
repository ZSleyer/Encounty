/**
 * WindowControls — Frameless window controls (minimize, maximize/restore, close).
 *
 * Only renders inside Electron on Windows and Linux.
 */
import { useState, useEffect } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";

export function WindowControls() {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const api = globalThis.electronAPI;
    if (!api) return;
    return api.onMaximizedChange(setMaximized);
  }, []);

  // Hide on non-Electron and on macOS (which uses native traffic light buttons)
  if (!globalThis.electronAPI || globalThis.electronAPI.platform === 'darwin') {
    return null;
  }

  const api = globalThis.electronAPI;

  return (
    <div
      className="flex items-stretch h-full -mr-4"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <button
        onClick={() => api.minimize()}
        className="w-12 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
        title={t("aria.windowMinimize")}
        aria-label={t("aria.windowMinimize")}
      >
        <Minus className="w-4 h-4" />
      </button>
      <button
        onClick={() => api.maximize()}
        className="w-12 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
        title={maximized ? t("aria.windowRestore") : t("aria.windowMaximize")}
        aria-label={maximized ? t("aria.windowRestore") : t("aria.windowMaximize")}
      >
        {maximized ? (
          <Copy className="w-3.5 h-3.5" />
        ) : (
          <Square className="w-3.5 h-3.5" />
        )}
      </button>
      <button
        onClick={() => api.close()}
        className="w-12 flex items-center justify-center text-text-muted hover:text-white hover:bg-accent-red transition-colors"
        title={t("aria.windowClose")}
        aria-label={t("aria.windowClose")}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
