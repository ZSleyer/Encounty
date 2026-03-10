import { useState, useEffect } from "react";
import { Save, RefreshCw, Keyboard, Layers } from "lucide-react";
import { OverlayEditor } from "../components/OverlayEditor";
import { useCounterStore } from "../hooks/useCounterState";
import { OverlaySettings } from "../types";
import { useI18n } from "../contexts/I18nContext";

const API = "/api";

export function OverlayEditorPage() {
  const { t } = useI18n();
  const { appState } = useCounterStore();

  const [overlayTarget, setOverlayTarget] = useState<string>("global");
  const [currentOverlay, setCurrentOverlay] = useState<OverlaySettings | null>(null);
  const [overlayDirty, setOverlayDirty] = useState(false);
  const [overlaySaving, setOverlaySaving] = useState(false);
  const [saved, setSaved] = useState(false);

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
    return <div className="p-6 text-text-muted">Lade…</div>;
  }

  const activePokemon =
    appState?.pokemon.find((p) => p.id === appState.active_id) ?? null;

  const handleTargetChange = (newTarget: string) => {
    if (overlayDirty) {
      if (!confirm(t("overlay.unsavedChanges"))) return;
    }
    setOverlayTarget(newTarget);
    if (newTarget === "global") {
      setCurrentOverlay(appState!.settings.overlay);
    } else {
      const p = appState!.pokemon.find((x) => x.id === newTarget);
      setCurrentOverlay(p?.overlay || appState!.settings.overlay);
    }
    setOverlayDirty(false);
  };

  const copyOverlayFrom = (sourceId: string) => {
    if (sourceId === "global") {
      setCurrentOverlay(appState!.settings.overlay);
    } else {
      const p = appState!.pokemon.find((x) => x.id === sourceId);
      if (p?.overlay) setCurrentOverlay(p.overlay);
    }
    setOverlayDirty(true);
  };

  const saveCurrentOverlay = async () => {
    if (!currentOverlay) return;
    setOverlaySaving(true);
    try {
      if (overlayTarget === "global") {
        const newSettings = { ...appState!.settings, overlay: currentOverlay };
        await fetch(`${API}/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newSettings),
        });
      } else {
        const p = appState!.pokemon.find((x) => x.id === overlayTarget);
        if (p) {
          const payload = {
            name: p.name,
            canonical_name: p.canonical_name,
            sprite_url: p.sprite_url,
            sprite_type: p.sprite_type,
            language: p.language,
            game: p.game,
            overlay: currentOverlay,
          };
          await fetch(`${API}/pokemon/${p.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        }
      }
      setOverlayDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error(err);
    }
    setOverlaySaving(false);
  };

  const deleteCustomOverlay = async () => {
    if (!confirm(t("overlay.deleteCustomConfirm"))) return;
    const p = appState!.pokemon.find((x) => x.id === overlayTarget);
    if (p) {
      setOverlaySaving(true);
      const payload = {
        name: p.name,
        canonical_name: p.canonical_name,
        sprite_url: p.sprite_url,
        sprite_type: p.sprite_type,
        language: p.language,
        game: p.game,
        overlay: null,
      };
      await fetch(`${API}/pokemon/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setCurrentOverlay(appState!.settings.overlay);
      setOverlayDirty(false);
      setOverlaySaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-transparent">
      <div className="switch-waves-container">
        <div className="switch-waves" />
      </div>
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-bg-secondary border-b border-border-subtle shrink-0 flex-wrap">
        <Layers className="w-4 h-4 text-accent-blue shrink-0" />
        <span className="text-sm font-semibold text-text-primary mr-2">
          {t("overlay.editorTitle")}
        </span>

        {/* Target selector */}
        <select
          value={overlayTarget}
          onChange={(e) => handleTargetChange(e.target.value)}
          className="bg-bg-card border border-border-subtle rounded-lg px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent-blue/50"
        >
          <option value="global">{t("overlay.globalDefault")}</option>
          <optgroup label={t("overlay.specificPokemon")}>
            {appState?.pokemon.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.overlay ? t("overlay.customized") : ""}
              </option>
            ))}
          </optgroup>
        </select>

        {/* Copy-from selector */}
        {overlayTarget !== "global" && (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) copyOverlayFrom(e.target.value);
            }}
            className="bg-bg-card border border-border-subtle rounded-lg px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent-blue/50"
          >
            <option value="" disabled>
              {t("overlay.copyFrom")}...
            </option>
            <option value="global">{t("overlay.global")}</option>
            <optgroup label={t("overlay.specificPokemon")}>
              {appState?.pokemon
                .filter((p) => p.id !== overlayTarget && p.overlay)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </optgroup>
          </select>
        )}

        {/* Delete custom overlay */}
        {overlayTarget !== "global" &&
          appState?.pokemon.find((p) => p.id === overlayTarget)?.overlay && (
            <button
              onClick={deleteCustomOverlay}
              disabled={overlaySaving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 text-sm transition-colors disabled:opacity-40"
            >
              {t("overlay.removeCustom")}
            </button>
          )}

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
            onClick={saveCurrentOverlay}
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
      <div className="flex-1 overflow-auto">
        <OverlayEditor
          settings={currentOverlay}
          activePokemon={
            overlayTarget === "global"
              ? activePokemon || undefined
              : appState?.pokemon.find((p) => p.id === overlayTarget)
          }
          onUpdate={(overlay) => {
            setCurrentOverlay(overlay);
            setOverlayDirty(true);
          }}
        />
      </div>
    </div>
  );
}
