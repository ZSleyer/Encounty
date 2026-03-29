/**
 * WindowControls — Frameless window controls (minimize, maximize/restore, close).
 *
 * Only renders inside Electron on Windows and Linux.
 */
import { useState, useEffect } from "react";
import { Minus, Square, Copy, X } from "lucide-react";

export function WindowControls() {
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
        title="Minimize"
      >
        <Minus className="w-4 h-4" />
      </button>
      <button
        onClick={() => api.maximize()}
        className="w-12 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
        title={maximized ? "Restore" : "Maximize"}
      >
        {maximized ? (
          <Copy className="w-3.5 h-3.5" />
        ) : (
          <Square className="w-3.5 h-3.5" />
        )}
      </button>
      <button
        onClick={() => api.close()}
        className="w-12 flex items-center justify-center text-text-muted hover:text-white hover:bg-red-600 transition-colors"
        title="Close"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
