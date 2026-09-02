/**
 * UiZoomSetting.tsx: Zoom control for the whole interface.
 *
 * Windows display scaling shrinks the CSS pixel viewport: a maximised 1080p
 * window reports roughly 960x533 CSS pixels at 200% scaling. Users on such
 * machines cannot lower the OS scaling without shrinking every other
 * application, so the app carries its own zoom on top of it.
 *
 * Only rendered in Electron builds; the browser has the browser's own zoom.
 */
import { useEffect, useState } from "react";
import { ZoomIn } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";

/** Selectable zoom levels, mirroring the steps the keyboard shortcuts use. */
const ZOOM_LEVELS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/** Formats a zoom factor as the percentage shown in the picker. */
function formatZoom(factor: number): string {
  return `${Math.round(factor * 100)}%`;
}

/**
 * Renders the interface zoom picker, or nothing when the Electron zoom API is
 * unavailable.
 */
export function UiZoomSetting() {
  const { t } = useI18n();
  const [zoom, setZoom] = useState(1);
  const api = globalThis.electronAPI;
  const supported = typeof api?.setZoomFactor === "function";

  useEffect(() => {
    if (!supported) return;
    api
      ?.getZoomFactor?.()
      .then(setZoom)
      .catch(() => {
        /* keep the default */
      });
    // The keyboard shortcuts change the factor in the main process, so the
    // picker has to follow rather than own the value.
    return api?.onZoomChange?.(setZoom);
  }, [api, supported]);

  if (!supported) return null;

  const handleChange = (value: number) => {
    setZoom(value);
    api
      ?.setZoomFactor?.(value)
      .then(setZoom)
      .catch(() => {
        /* keep the optimistic value */
      });
  };

  // A stored factor can sit between two steps; show it rather than snapping the
  // picker to a value the window is not actually using.
  const levels = ZOOM_LEVELS.includes(zoom)
    ? ZOOM_LEVELS
    : [...ZOOM_LEVELS, zoom].sort((a, b) => a - b);

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm text-text-primary flex items-center gap-2">
          <ZoomIn className="w-3.5 h-3.5 text-accent-blue" />
          {t("settings.uiZoom")}
        </p>
        <p className="text-xs text-text-muted mt-0.5 max-w-sm">{t("settings.uiZoomDesc")}</p>
      </div>
      <select
        value={zoom}
        onChange={(e) => handleChange(Number(e.target.value))}
        aria-label={t("aria.uiZoom")}
        className="min-h-6 bg-bg-primary border border-border-subtle rounded-none px-3 py-1.5 text-xs font-medium text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
      >
        {levels.map((level) => (
          <option key={level} value={level}>
            {formatZoom(level)}
          </option>
        ))}
      </select>
    </div>
  );
}
