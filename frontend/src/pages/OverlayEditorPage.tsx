/**
 * OverlayEditorPage.tsx: Default layout editor page.
 *
 * Edits the app-level settings.overlay (the "Default Layout").
 * Uses a hardcoded preview Pokemon (Torchic/Flemmli) so the editor
 * always has something to render, independent of tracked hunts.
 */
import { useState, useEffect, useRef } from "react";
import { useBlocker } from "react-router";
import { Save, RefreshCw, Keyboard, Layers, AlertTriangle } from "lucide-react";
import { OverlayEditor } from "../components/overlay-editor/OverlayEditor";
import { OverlayBrowserSourceButton } from "../components/shared/OverlayBrowserSourceButton";
import { useCounterStore } from "../hooks/useCounterState";
import { OverlaySettings, Pokemon } from "../types";
import { useI18n } from "../contexts/I18nContext";
import { useToast } from "../contexts/ToastContext";
import { getSpriteUrl } from "../utils/sprites";
import { apiUrl } from "../utils/api";
import { useModalA11y } from "../hooks/useModalA11y";

/** Hardcoded preview Pokemon for the default layout editor. */
function makePreviewPokemon(): Pokemon {
  return {
    id: "preview-torchic",
    name: "Flemmli",
    canonical_name: "torchic",
    sprite_url: getSpriteUrl(255, "pokemon-black-white", "shiny", "classic", "torchic"),
    sprite_type: "shiny",
    encounters: 42,
    is_active: false,
    created_at: new Date().toISOString(),
    language: "de",
    game: "WHITE-2",
    overlay_mode: "default",
    timer_accumulated_ms: 1_800_000,
    // Without targets the sprite cycling would have nothing to cycle through.
    phase_targets: [
      {
        canonical_name: "zigzagoon",
        name: "Zigzachs",
        sprite_url: getSpriteUrl(263, "pokemon-black-white", "shiny", "classic", "zigzagoon"),
      },
      {
        canonical_name: "poochyena",
        name: "Fiffyen",
        sprite_url: getSpriteUrl(261, "pokemon-black-white", "shiny", "classic", "poochyena"),
      },
    ],
  };
}

/**
 * Synthetic finished phases for the default layout editor. They give the phase,
 * total counter and total timer elements something to derive, which the single
 * hardcoded preview Pokemon cannot do on its own.
 */
function makePreviewPhaseChildren(parent: Pokemon): Pokemon[] {
  const base = {
    is_active: false,
    language: parent.language,
    game: parent.game,
    overlay_mode: "default" as const,
    sprite_type: "shiny" as const,
    created_at: parent.created_at,
    completed_at: parent.created_at,
    phase_of: parent.id,
  };
  return [
    {
      ...base,
      id: "preview-phase-1",
      name: "Zigzachs",
      canonical_name: "zigzagoon",
      sprite_url: getSpriteUrl(263, "pokemon-black-white", "shiny", "classic", "zigzagoon"),
      encounters: 512,
      timer_accumulated_ms: 5_400_000,
      phase_number: 1,
    },
    {
      ...base,
      id: "preview-phase-2",
      name: "Fiffyen",
      canonical_name: "poochyena",
      sprite_url: getSpriteUrl(261, "pokemon-black-white", "shiny", "classic", "poochyena"),
      encounters: 287,
      timer_accumulated_ms: 3_600_000,
      phase_number: 2,
    },
  ];
}

export function OverlayEditorPage() {
  const { t } = useI18n();
  const { push, dismissByKey } = useToast();
  const appState = useCounterStore((s) => s.appState);

  const [currentOverlay, setCurrentOverlay] = useState<OverlaySettings | null>(
    appState?.settings.overlay ?? null,
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
  const unsavedDialogOpen = blocker.state === "blocked";

  // react-router only exposes `proceed`/`reset` while the blocker is in the
  // "blocked" state, and a blocked navigation may be resolved exactly once:
  // calling `proceed` again after it left "blocked" throws an invariant error
  // from the router. This latch makes the dialog buttons idempotent for the
  // current blocked navigation without duplicating the router's state.
  const navigationResolvedRef = useRef(false);
  if (!unsavedDialogOpen) navigationResolvedRef.current = false;

  /**
   * Reports a dialog button that arrived without a usable blocker handle.
   * The handlers below are closures over the blocker of the render that
   * produced them; if the navigation resolved in between, the handle is gone
   * and the button would otherwise do nothing at all.
   */
  const reportBlockerUnavailable = (action: string) => {
    console.warn(
      `Overlay editor: cannot ${action} the pending navigation, blocker state is "${blocker.state}".`,
    );
    push({ type: "error", title: t("overlay.errLeaveFailed"), key: "overlay-leave" });
  };

  /** Cancels the blocked navigation and keeps the user in the editor. */
  const stayInEditor = () => {
    if (navigationResolvedRef.current) return;
    if (!blocker.reset) {
      reportBlockerUnavailable("cancel");
      return;
    }
    navigationResolvedRef.current = true;
    blocker.reset();
  };

  /** Discards the unsaved changes and lets the blocked navigation continue. */
  const discardAndLeave = () => {
    if (navigationResolvedRef.current) return;
    if (!blocker.proceed) {
      reportBlockerUnavailable("continue");
      return;
    }
    navigationResolvedRef.current = true;
    blocker.proceed();
  };

  const unsavedDialogRef = useModalA11y<HTMLDivElement>({
    isOpen: unsavedDialogOpen,
    onClose: stayInEditor,
  });

  const [previewPokemon] = useState(() => makePreviewPokemon());
  const [previewPokemonList] = useState(() => [
    previewPokemon,
    ...makePreviewPhaseChildren(previewPokemon),
  ]);

  const [isInitialised, setInitialised] = useState(!!appState);
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
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-accent-blue border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-muted">{t("nav.connecting")}</p>
        </div>
      </div>
    );
  }

  const saveOverlay = async () => {
    if (!currentOverlay || !appState) return;
    setOverlaySaving(true);
    try {
      const newSettings = { ...appState.settings, overlay: currentOverlay };
      const res = await fetch(apiUrl("/api/settings"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSettings),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      dismissByKey("overlay-save");
      setOverlayDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error(err);
      push({ type: "error", title: t("overlay.errSaveFailed"), key: "overlay-save" });
    }
    setOverlaySaving(false);
  };

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-bg-secondary border-b border-border-subtle shrink-0 flex-wrap">
        <Layers className="w-4 h-4 text-accent-blue shrink-0" />
        <h1 className="text-sm font-semibold text-text-primary mr-2">
          {t("overlay.defaultTitle")}
        </h1>

        <div className="ml-auto flex items-center gap-3">
          {/* OBS URL split button (per-Pokemon or universal) */}
          <OverlayBrowserSourceButton pokemonId={previewPokemon.id} />

          {/* Hotkeys paused badge */}
          <span className="hotkeys-paused-badge flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-none border">
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
            className="t-cut flex items-center gap-2 px-4 py-1.5 rounded-none bg-accent-blue hover:bg-accent-blue/80 text-white font-semibold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
          previewPokemonList={previewPokemonList}
          onUpdate={(overlay) => {
            setCurrentOverlay(overlay);
            setOverlayDirty(true);
          }}
        />
      </main>

      {/* Unsaved-changes confirmation modal */}
      {unsavedDialogOpen && (
        <div // NOSONAR: backdrop click dismisses unsaved-changes dialog
          ref={unsavedDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="overlay-unsaved-title"
          tabIndex={-1}
          className="fixed inset-0 z-90 bg-black/50 backdrop-blur-sm flex items-center-safe justify-center-safe animate-fadeIn"
          onClick={(e) => {
            if (e.target === e.currentTarget) stayInEditor();
          }}
        >
          <div className="bg-bg-secondary border border-border-subtle rounded-none p-8 flex flex-col items-center gap-5 max-w-md mx-4 shadow-2xl">
            <div className="w-14 h-14 rounded-full border border-accent-yellow/40 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-accent-yellow" />
            </div>
            <div className="text-center space-y-1.5">
              <p id="overlay-unsaved-title" className="text-lg font-semibold text-text-primary">
                {t("overlay.unsavedTitle")}
              </p>
              <p className="text-sm text-text-muted">{t("overlay.unsavedDesc")}</p>
            </div>
            <div className="flex gap-3 w-full">
              <button
                type="button"
                onClick={stayInEditor}
                className="flex-1 px-4 py-2.5 rounded-none border border-border-subtle text-text-muted hover:bg-bg-hover text-sm font-medium transition-colors"
              >
                {t("overlay.unsavedStay")}
              </button>
              <button
                type="button"
                onClick={discardAndLeave}
                className="flex-1 px-4 py-2.5 rounded-none bg-accent-red hover:brightness-110 text-bg-primary text-sm font-semibold transition-colors"
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
