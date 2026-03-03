import { useState, useEffect } from "react";
import {
  Save,
  FolderOpen,
  RefreshCw,
  Keyboard,
  Layers,
  Settings as SettingsIcon,
  Globe,
  Database,
  MonitorSmartphone,
} from "lucide-react";

import { HotkeySettings } from "../components/HotkeySettings";
import { OverlayEditor } from "../components/OverlayEditor";
import { useCounterStore } from "../hooks/useCounterState";
import { Settings as SettingsType, HotkeyMap, OverlaySettings } from "../types";
import { ALL_LANGUAGES } from "../utils/games";
import { useI18n } from "../contexts/I18nContext";

const API = "/api";

type Tab = "general" | "data" | "display" | "overlay";

export function Settings() {
  const { t } = useI18n();

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
      id: "general",
      label: t("settings.tabGeneral"),
      icon: <SettingsIcon className="w-4 h-4" />,
    },
    {
      id: "data",
      label: t("settings.tabData"),
      icon: <Database className="w-4 h-4" />,
    },
    {
      id: "display",
      label: t("settings.tabDisplay"),
      icon: <MonitorSmartphone className="w-4 h-4" />,
    },
    {
      id: "overlay",
      label: t("settings.tabOverlay"),
      icon: <Layers className="w-4 h-4" />,
    },
  ];

  const { appState } = useCounterStore();
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [hotkeys, setHotkeys] = useState<HotkeyMap | null>(null);
  const [saved, setSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [gamesSyncing, setGamesSyncing] = useState(false);
  const [gamesSyncResult, setGamesSyncResult] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("general");

  // Overlay Editor State
  const [overlayTarget, setOverlayTarget] = useState<string>("global");
  const [currentOverlay, setCurrentOverlay] = useState<OverlaySettings | null>(
    null,
  );
  const [overlayDirty, setOverlayDirty] = useState(false);
  const [overlaySaving, setOverlaySaving] = useState(false);

  // One-time init from appState
  const initialised = useState(false);
  useEffect(() => {
    if (appState && !initialised[0]) {
      setSettings(appState.settings);
      setHotkeys(appState.hotkeys);
      setCurrentOverlay(appState.settings.overlay);
      initialised[1](true);
    }
  }, [appState]);

  // Auto-save non‑overlay settings with debounce
  useEffect(() => {
    if (!settings) return;
    const t = setTimeout(() => {
      fetch(`${API}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      }).then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      });
    }, 800);
    return () => clearTimeout(t);
    // Only auto-save when non-overlay fields change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings?.output_dir,
    settings?.auto_save,
    settings?.browser_port,
    JSON.stringify(settings?.languages),
  ]);

  // Pause hotkeys (fully unregisters X11 grabs) only on overlay tab,
  // so the browser can receive all keydown events for the overlay editor.
  // On the hotkeys tab, HotkeySettings pauses/resumes per recording session.
  useEffect(() => {
    if (activeTab === "overlay") {
      fetch(`${API}/hotkeys/pause`, { method: "POST" }).catch(() => {});
    } else {
      fetch(`${API}/hotkeys/resume`, { method: "POST" }).catch(() => {});
    }
    return () => {
      fetch(`${API}/hotkeys/resume`, { method: "POST" }).catch(() => {});
    };
  }, [activeTab]);

  if (!settings || !hotkeys) {
    return <div className="p-6 text-gray-500">Lade…</div>;
  }

  const activePokemon =
    appState?.pokemon.find((p) => p.id === appState.active_id) ?? null;

  const toggleLanguage = (code: string) => {
    const current = settings.languages ?? ["de", "en"];
    const next = current.includes(code)
      ? current.filter((l) => l !== code)
      : [...current, code];
    // Keep at least one language active
    if (next.length === 0) return;
    setSettings({ ...settings, languages: next });
  };

  const handleTargetChange = (newTarget: string) => {
    if (overlayDirty) {
      if (
        !confirm(
          "Du hast ungespeicherte Änderungen am Overlay. Trotzdem wechseln?",
        )
      )
        return;
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
      if (p?.overlay) {
        setCurrentOverlay(p.overlay);
      }
    }
    setOverlayDirty(true);
  };

  const saveCurrentOverlay = async () => {
    if (!currentOverlay) return;
    setOverlaySaving(true);
    try {
      if (overlayTarget === "global") {
        const newSettings = { ...settings, overlay: currentOverlay };
        setSettings(newSettings);
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

  const updateHotkeys = (hk: HotkeyMap) => {
    setHotkeys(hk);
  };

  const syncPokemonData = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch(`${API}/sync/pokemon`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setSyncResult(
          `Sync abgeschlossen: ${data.added} neue Pokémon (${data.total} gesamt)`,
        );
      } else {
        setSyncResult(`Fehler: ${data.error}`);
      }
    } catch {
      setSyncResult("Sync fehlgeschlagen – keine Verbindung zu PokeAPI");
    } finally {
      setSyncing(false);
    }
  };

  const syncGamesData = async () => {
    setGamesSyncing(true);
    setGamesSyncResult(null);
    try {
      const res = await fetch(`${API}/games/sync`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        const { added, updated } = data;
        if (added === 0 && updated === 0) {
          setGamesSyncResult("Alles aktuell – keine Änderungen.");
        } else {
          setGamesSyncResult(
            `Sync abgeschlossen: ${added} neue Spiele, ${updated} Sprachen ergänzt.`,
          );
        }
      } else {
        setGamesSyncResult(`Fehler: ${data.error}`);
      }
    } catch {
      setGamesSyncResult("Sync fehlgeschlagen – keine Verbindung zu PokéAPI");
    } finally {
      setGamesSyncing(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border-subtle bg-bg-secondary flex-shrink-0">
        <h1 className="text-base font-bold text-white max-w-xl mx-auto w-full flex-1">
          {t("settings.title")}
        </h1>
        <div className="flex items-center gap-3">
          {activeTab === "overlay" && (
            <span className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-900/20 border border-amber-900/30 px-2.5 py-1 rounded-lg">
              <Keyboard className="w-3.5 h-3.5" /> {t("settings.hotkeysPaused")}
            </span>
          )}
          {saved && activeTab !== "overlay" && (
            <span className="flex items-center gap-1.5 text-xs text-accent-green">
              <Save className="w-3.5 h-3.5" /> {t("settings.saved")}
            </span>
          )}
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex justify-center border-b border-border-subtle bg-bg-secondary flex-shrink-0 px-6">
        <div className="relative flex max-w-xl w-full">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex justify-center items-center gap-2 px-2 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
          {/* Sliding indicator */}
          <div
            className="absolute bottom-0 h-px bg-accent-blue transition-all duration-300"
            style={{
              left: `${TABS.findIndex((t) => t.id === activeTab) * (100 / TABS.length)}%`,
              width: `${100 / TABS.length}%`,
            }}
          />
        </div>
      </div>

      {/* Tab content */}
      <main className="flex-1 overflow-auto p-6 settings-bg">
        <div className="max-w-xl mx-auto space-y-6 relative z-10">
          {/* ──────────────────────────────────────────────────
              GENERAL TAB
          ────────────────────────────────────────────────── */}
          {activeTab === "general" && (
            <>
              <section className="glass-card rounded-2xl p-6">
                <h2 className="text-sm font-semibold text-white mb-4">
                  {t("settings.server")}
                </h2>
                <div>
                  <label
                    htmlFor="browser-port"
                    className="block text-xs text-text-muted mb-1.5"
                  >
                    {t("settings.port")}
                  </label>
                  <input
                    id="browser-port"
                    type="number"
                    value={settings.browser_port}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        browser_port: Number(e.target.value),
                      })
                    }
                    min={1024}
                    max={65535}
                    className="w-32 bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent-blue/50 transition-colors"
                  />
                </div>
              </section>

              <section className="glass-card rounded-2xl p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                      <Save className="w-4 h-4 text-accent-green" />{" "}
                      {t("settings.autoSave")}
                    </h3>
                    <p className="text-xs text-text-muted mt-1">
                      {t("settings.autoSaveDesc")}
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      setSettings({
                        ...settings,
                        auto_save: !settings.auto_save,
                      })
                    }
                    className={`relative w-12 h-6 rounded-full transition-colors flex items-center px-1 ${
                      settings.auto_save
                        ? "bg-accent-green/80"
                        : "bg-bg-secondary border border-border-subtle"
                    }`}
                  >
                    <div
                      className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${settings.auto_save ? "translate-x-6" : "translate-x-0"}`}
                    />
                  </button>
                </div>
              </section>

              <section className="glass-card rounded-2xl p-6">
                <h2 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-accent-blue" />{" "}
                  {t("settings.languages")}
                </h2>
                <p className="text-xs text-text-muted mb-4">
                  {t("settings.languagesDesc")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {ALL_LANGUAGES.map(({ code, label, flag }) => {
                    const active = (
                      settings.languages ?? ["de", "en"]
                    ).includes(code);
                    return (
                      <button
                        key={code}
                        onClick={() => toggleLanguage(code)}
                        title={code}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                          active
                            ? "bg-accent-blue/20 border-accent-blue/50 text-white"
                            : "bg-bg-secondary border-border-subtle text-text-muted hover:text-white"
                        }`}
                      >
                        <span className="text-[14px] leading-none">{flag}</span>
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </>
          )}

          {/* ──────────────────────────────────────────────────
              DATA & SYNC TAB
          ────────────────────────────────────────────────── */}
          {activeTab === "data" && (
            <>
              <section className="glass-card rounded-2xl p-6">
                <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-accent-yellow" />{" "}
                  {t("settings.outputTitle")}
                </h2>
                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="output-dir"
                      className="block text-xs text-text-muted mb-1.5"
                    >
                      {t("settings.outputDir")}
                    </label>
                    <input
                      id="output-dir"
                      type="text"
                      value={settings.output_dir}
                      onChange={(e) =>
                        setSettings({ ...settings, output_dir: e.target.value })
                      }
                      placeholder="z.B. C:\OBS\counter oder ~/obs/counter"
                      className="w-full bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-text-faint/50 outline-none focus:border-accent-blue/50 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-2">
                      {t("settings.outputDesc")}
                    </label>
                    <div className="bg-bg-secondary/30 border border-border-subtle rounded-xl p-3">
                      <div className="flex flex-wrap gap-2">
                        {[
                          "encounters.txt",
                          "pokemon_name.txt",
                          "encounters_label.txt",
                          "session_duration.txt",
                          "encounters_today.txt",
                          "phase.txt",
                        ].map((f) => (
                          <span
                            key={f}
                            className="text-xs font-mono bg-bg-secondary border border-border-subtle px-2 py-1 rounded-md text-text-muted"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="glass-card rounded-2xl p-6">
                <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                  <Database className="w-4 h-4 text-accent-blue" />{" "}
                  {t("settings.syncPokemon")}
                </h2>
                <p className="text-xs text-text-muted mb-4">
                  {t("settings.syncPokemonDesc")}
                </p>
                <button
                  onClick={syncPokemonData}
                  disabled={syncing}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-bg-secondary hover:bg-bg-hover text-sm text-text-primary border border-border-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`}
                  />
                  {syncing
                    ? t("settings.syncing")
                    : t("settings.syncPokemonBtn")}
                </button>
                {syncResult && (
                  <p
                    className={`mt-3 text-xs ${syncResult.startsWith("Fehler") || syncResult.startsWith("Error") ? "text-accent-red" : "text-accent-green"}`}
                  >
                    {syncResult}
                  </p>
                )}
              </section>

              <section className="glass-card rounded-2xl p-6">
                <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                  <Database className="w-4 h-4 text-accent-blue" />{" "}
                  {t("settings.syncGames")}
                </h2>
                <p className="text-xs text-text-muted mb-4">
                  {t("settings.syncGamesDesc")}
                </p>
                <button
                  onClick={syncGamesData}
                  disabled={gamesSyncing}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-bg-secondary hover:bg-bg-hover text-sm text-text-primary border border-border-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${gamesSyncing ? "animate-spin" : ""}`}
                  />
                  {gamesSyncing
                    ? t("settings.syncing")
                    : t("settings.syncGamesBtn")}
                </button>
                {gamesSyncResult && (
                  <p
                    className={`mt-3 text-xs ${
                      gamesSyncResult.startsWith("Fehler") ||
                      gamesSyncResult.startsWith("Error")
                        ? "text-accent-red"
                        : "text-accent-green"
                    }`}
                  >
                    {gamesSyncResult}
                  </p>
                )}
              </section>
            </>
          )}

          {/* ──────────────────────────────────────────────────
              DISPLAY & HOTKEYS TAB
          ────────────────────────────────────────────────── */}
          {activeTab === "display" && (
            <>
              <section className="glass-card rounded-2xl p-6">
                <h2 className="text-sm font-semibold text-white mb-6">
                  {t("settings.hotkeysTitle")}
                </h2>
                <HotkeySettings hotkeys={hotkeys} onUpdate={updateHotkeys} />
              </section>
            </>
          )}
        </div>

        {/* Overlay */}
        {activeTab === "overlay" && currentOverlay && (
          <section className="bg-bg-card border border-border-subtle rounded-xl p-6">
            <div className="flex items-center justify-between mb-6 border-b border-border-subtle pb-4">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-accent-blue" /> Overlay-Editor
                (OBS Browser Source)
              </h2>
              <div className="flex items-center gap-3">
                <select
                  value={overlayTarget}
                  onChange={(e) => handleTargetChange(e.target.value)}
                  className="bg-bg-secondary border border-border-subtle rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-accent-blue/50"
                >
                  <option value="global">Globales Standard-Overlay</option>
                  <optgroup label="Spezifische Pokémon">
                    {appState?.pokemon.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.overlay ? "(Angepasst)" : ""}
                      </option>
                    ))}
                  </optgroup>
                </select>

                {overlayTarget !== "global" && (
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) copyOverlayFrom(e.target.value);
                    }}
                    className="bg-bg-secondary border border-border-subtle rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-accent-blue/50"
                  >
                    <option value="" disabled>
                      Kopieren von...
                    </option>
                    <option value="global">Globales Overlay</option>
                    <optgroup label="Anderes Pokémon">
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

                {overlayTarget !== "global" &&
                  appState?.pokemon.find((p) => p.id === overlayTarget)
                    ?.overlay && (
                    <button
                      onClick={async () => {
                        if (
                          !confirm(
                            "Spezifisches Overlay löschen und auf globales Overlay zurücksetzen?",
                          )
                        )
                          return;
                        const p = appState!.pokemon.find(
                          (x) => x.id === overlayTarget,
                        );
                        if (p) {
                          setOverlaySaving(true);
                          const payload = {
                            name: p.name,
                            canonical_name: p.canonical_name,
                            sprite_url: p.sprite_url,
                            sprite_type: p.sprite_type,
                            language: p.language,
                            game: p.game,
                            overlay: null, // Clear overlay
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
                      }}
                      disabled={overlaySaving}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 text-sm transition-colors"
                    >
                      Entfernen
                    </button>
                  )}

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
                  Speichern
                </button>
              </div>
            </div>

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
          </section>
        )}
      </main>
    </div>
  );
}
