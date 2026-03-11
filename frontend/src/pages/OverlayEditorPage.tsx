/**
 * OverlayEditorPage.tsx — Default layout editor page.
 *
 * Edits the app-level settings.overlay (the "Default Layout").
 * Uses a hardcoded preview Pokemon (Torchic/Flemmli) so the editor
 * always has something to render, independent of tracked hunts.
 */
import { useState, useEffect } from "react";
import { Save, RefreshCw, Keyboard, Layers } from "lucide-react";
import { OverlayEditor } from "../components/OverlayEditor";
import { useCounterStore } from "../hooks/useCounterState";
import { OverlaySettings, Pokemon } from "../types";
import { useI18n } from "../contexts/I18nContext";
import { getSpriteUrl } from "../utils/sprites";

const API = "/api";

/** Hardcoded preview Pokemon for the default layout editor. */
function makePreviewPokemon(): Pokemon {
  return {
    id: "preview-torchic",
    name: "Flemmli",
    canonical_name: "torchic",
    sprite_url: getSpriteUrl(255, "", "shiny", "3d", "torchic"),
    sprite_type: "shiny",
    encounters: 42,
    is_active: false,
    created_at: new Date().toISOString(),
    language: "de",
    game: "",
    overlay_mode: "default",
  };
}

export function OverlayEditorPage() {
  const { t } = useI18n();
  const { appState } = useCounterStore();

  const [currentOverlay, setCurrentOverlay] = useState<OverlaySettings | null>(
    null,
  );
  const [overlayDirty, setOverlayDirty] = useState(false);
  const [overlaySaving, setOverlaySaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const previewPokemon = useState(() => makePreviewPokemon())[0];

  const initialised = useState(false);
  useEffect(() => {
    if (appState && !initialised[0]) {
      setCurrentOverlay(appState.settings.overlay);
      initialised[1](true);
    }
  }, [appState]);

  // Pause hotkeys on mount, resume on unmount
  useEffect(() => {
    fetch(`${API}/hotkeys/pause`, { method: "POST" }).catch(() => {});
    return () => {
      fetch(`${API}/hotkeys/resume`, { method: "POST" }).catch(() => {});
    };
  }, []);

  if (!currentOverlay) {
    return <div className="p-6 text-text-muted">Lade...</div>;
  }

  const saveOverlay = async () => {
    if (!currentOverlay || !appState) return;
    setOverlaySaving(true);
    try {
      const newSettings = { ...appState.settings, overlay: currentOverlay };
      await fetch(`${API}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSettings),
      });
      setOverlayDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error(err);
    }
    setOverlaySaving(false);
  };

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-bg-secondary border-b border-border-subtle shrink-0 flex-wrap">
        <Layers className="w-4 h-4 text-accent-blue shrink-0" />
        <span className="text-sm font-semibold text-text-primary mr-2">
          {t("overlay.defaultTitle")}
        </span>

        <div className="ml-auto flex items-center gap-3">
          {/* Hotkeys paused badge */}
          <span className="hotkeys-paused-badge flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border">
            <Keyboard className="w-3.5 h-3.5" /> {t("settings.hotkeysPaused")}
          </span>

          {/* Saved indicator */}
          {saved && (
            <span className="flex items-center gap-1.5 text-xs text-accent-green">
              <Save className="w-3.5 h-3.5" /> {t("settings.saved")}
            </span>
          )}

          {/* Save button */}
          <button
            onClick={saveOverlay}
            disabled={!overlayDirty || overlaySaving}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-accent-blue hover:bg-blue-500 text-white font-semibold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {overlaySaving ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {t("overlay.saveOverlay")}
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0 overflow-auto">
        <OverlayEditor
          settings={currentOverlay}
          activePokemon={previewPokemon}
          onUpdate={(overlay) => {
            setCurrentOverlay(overlay);
            setOverlayDirty(true);
          }}
        />
      </div>
    </div>
  );
}
