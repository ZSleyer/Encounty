/**
 * OverlayEditorPage.tsx — Default layout editor page.
 *
 * Edits the app-level settings.overlay (the "Default Layout").
 * Uses a hardcoded preview Pokemon (Torchic/Flemmli) so the editor
 * always has something to render, independent of tracked hunts.
 */
import { useState, useEffect, useRef } from "react";
import { useBlocker } from "react-router";
import {
  Save,
  RefreshCw,
  Keyboard,
  Layers,
  Monitor,
  AlertTriangle,
} from "lucide-react";
import { OverlayEditor } from "../components/overlay-editor/OverlayEditor";
import { useCounterStore } from "../hooks/useCounterState";
import { OverlaySettings, Pokemon } from "../types";
import { useI18n } from "../contexts/I18nContext";
import { getSpriteUrl } from "../utils/sprites";
import { apiUrl } from "../utils/api";

/** Hardcoded preview Pokemon for the default layout editor. */
function makePreviewPokemon(): Pokemon {
  return {
    id: "preview-torchic",
    name: "Flemmli",
    canonical_name: "torchic",
    sprite_url: getSpriteUrl(
      255,
      "pokemon-black-white",
      "shiny",
      "classic",
      "torchic",
    ),
    sprite_type: "shiny",
    encounters: 42,
    is_active: false,
    created_at: new Date().toISOString(),
    language: "de",
    game: "WHITE-2",
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

  // Warn on browser/tab close when there are unsaved changes
  const dirtyRef = useRef(false);
  dirtyRef.current = overlayDirty;
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    globalThis.addEventListener("beforeunload", handler);
    return () => globalThis.removeEventListener("beforeunload", handler);
  }, []);

  const blocker = useBlocker(overlayDirty);

  const [previewPokemon] = useState(() => makePreviewPokemon());

  const [isInitialised, setInitialised] = useState(false);
  useEffect(() => {
    if (appState && !isInitialised) {
      setCurrentOverlay(appState.settings.overlay);
      setInitialised(true);
    }
  }, [appState]);

  // Pause hotkeys on mount, resume on unmount
  useEffect(() => {
    fetch(apiUrl("/api/hotkeys/pause"), { method: "POST" }).catch(() => {});
    return () => {
      fetch(apiUrl("/api/hotkeys/resume"), { method: "POST" }).catch(() => {});
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
      await fetch(apiUrl("/api/settings"), {
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
          {/* OBS hint */}
          <span className="flex items-center gap-1.5 text-xs text-text-muted">
            <Monitor className="w-3.5 h-3.5" />
            {t("overlay.obsHintDashboard")}
          </span>

          {/* Hotkeys paused badge */}
          <span className="hotkeys-paused-badge flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border">
            <Keyboard className="w-4 h-4" /> {t("settings.hotkeysPaused")}
          </span>

          {/* Saved indicator */}
          {saved && (
            <span className="flex items-center gap-1.5 text-xs text-accent-green">
              <Save className="w-4 h-4" /> {t("settings.saved")}
            </span>
          )}

          {/* Save button */}
          <button
            onClick={saveOverlay}
            disabled={!overlayDirty || overlaySaving}
            aria-label={t("aria.saveOverlay")}
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
      <main id="main-content" className="flex-1 min-h-0 overflow-auto">
        <OverlayEditor
          settings={currentOverlay}
          activePokemon={previewPokemon}
          onUpdate={(overlay) => {
            setCurrentOverlay(overlay);
            setOverlayDirty(true);
          }}
        />
      </main>

      {/* Unsaved-changes confirmation modal */}
      {blocker.state === "blocked" && (
        <div className="fixed inset-0 z-90 bg-black/50 backdrop-blur-sm flex items-center justify-center animate-fadeIn">
          <div className="bg-bg-secondary border border-border-subtle rounded-2xl p-8 flex flex-col items-center gap-5 max-w-md mx-4 shadow-2xl">
            <div className="w-14 h-14 rounded-full bg-amber-500/15 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-amber-500" />
            </div>
            <div className="text-center space-y-1.5">
              <p className="text-lg font-semibold text-text-primary">
                {t("overlay.unsavedTitle")}
              </p>
              <p className="text-sm text-text-muted">
                {t("overlay.unsavedDesc")}
              </p>
            </div>
            <div className="flex gap-3 w-full">
              <button
                type="button"
                onClick={() => blocker.reset?.()}
                className="flex-1 px-4 py-2.5 rounded-xl border border-border-subtle text-text-muted hover:bg-bg-hover text-sm font-medium transition-colors"
              >
                {t("overlay.unsavedStay")}
              </button>
              <button
                type="button"
                onClick={() => blocker.proceed?.()}
                className="flex-1 px-4 py-2.5 rounded-xl bg-accent-red hover:bg-red-500 text-white text-sm font-semibold transition-colors"
              >
                {t("overlay.unsavedDiscard")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
