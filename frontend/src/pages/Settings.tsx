import { useState, useEffect } from "react";
import {
  Save,
  FolderOpen,
  RefreshCw,
  RefreshCcw,
  Keyboard,
  Layers,
  Settings as SettingsIcon,
  Power,
  Globe,
} from "lucide-react";

import { HotkeySettings } from "../components/HotkeySettings";
import { OverlayEditor } from "../components/OverlayEditor";
import { useCounterStore } from "../hooks/useCounterState";
import { Settings as SettingsType, HotkeyMap, OverlaySettings } from "../types";
import { ALL_LANGUAGES } from "../utils/games";

const API = "/api";

type Tab = "general" | "hotkeys" | "output" | "overlay";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: "general",
    label: "Allgemein",
    icon: <SettingsIcon className="w-4 h-4" />,
  },
  { id: "hotkeys", label: "Hotkeys", icon: <Keyboard className="w-4 h-4" /> },
  { id: "output", label: "Ausgabe", icon: <FolderOpen className="w-4 h-4" /> },
  { id: "overlay", label: "Overlay", icon: <Layers className="w-4 h-4" /> },
];

export function Settings() {
  const { appState } = useCounterStore();
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [hotkeys, setHotkeys] = useState<HotkeyMap | null>(null);
  const [saved, setSaved] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [gamesSyncing, setGamesSyncing] = useState(false);
  const [gamesSyncResult, setGamesSyncResult] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("general");
  const [quitting, setQuitting] = useState(false);
  const [restarting, setRestarting] = useState(false);

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

  // Pause hotkeys (fully unregisters X11 grabs) when on overlay or hotkeys tab,
  // so the browser can receive all keydown events without interference.
  useEffect(() => {
    if (activeTab === "overlay" || activeTab === "hotkeys") {
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

  const saveSettings = async () => {
    await fetch(`${API}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const quitApp = async () => {
    if (!confirm("Encounty wirklich beenden?")) return;
    setQuitting(true);
    await fetch(`${API}/quit`, { method: "POST" }).catch(() => {});
  };

  const restartApp = async () => {
    if (!confirm("Encounty wirklich neu starten?")) return;
    setRestarting(true);
    await fetch(`${API}/restart`, { method: "POST" }).catch(() => {});
    setTimeout(() => window.location.reload(), 1500);
  };

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

  const updateHotkeys = async (hk: HotkeyMap) => {
    setHotkeys(hk);
    setHotkeyError(null);
    const res = await fetch(`${API}/hotkeys`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hk),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setHotkeyError(data.error ?? "Fehler beim Speichern der Hotkeys");
    }
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
        <h1 className="text-base font-bold text-white">Einstellungen</h1>
        <div className="flex items-center gap-3">
          {activeTab === "overlay" && (
            <span className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-900/20 border border-amber-900/30 px-2.5 py-1 rounded-lg">
              <Keyboard className="w-3.5 h-3.5" /> Hotkeys pausiert
            </span>
          )}
          {saved && activeTab !== "overlay" && (
            <span className="flex items-center gap-1.5 text-xs text-accent-green">
              <Save className="w-3.5 h-3.5" /> Gespeichert
            </span>
          )}
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex border-b border-border-subtle bg-bg-secondary flex-shrink-0 px-6">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.id
                ? "border-accent-blue text-white"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <main className="flex-1 overflow-auto p-6">
        {/* General */}
        {activeTab === "general" && (
          <div className="max-w-xl space-y-6">
            <section className="bg-bg-card border border-border-subtle rounded-xl p-6">
              <h2 className="text-sm font-semibold text-white mb-4">Server</h2>
              <div>
                <label
                  htmlFor="browser-port"
                  className="block text-xs text-gray-400 mb-1.5"
                >
                  Lokaler Port (Neustart erforderlich)
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

            <section className="bg-bg-card border border-border-subtle rounded-xl p-6">
              <h2 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
                <Globe className="w-4 h-4 text-accent-blue" />{" "}
                Spielnamen-Sprachen
              </h2>
              <p className="text-xs text-gray-500 mb-4">
                Welche Sprachen in der Spielauswahl angezeigt werden. Ältere
                Spiele haben nicht alle Übersetzungen.
              </p>
              <div className="flex flex-wrap gap-2">
                {ALL_LANGUAGES.map(({ code, label, flag }) => {
                  const active = (settings.languages ?? ["de", "en"]).includes(
                    code,
                  );
                  return (
                    <button
                      key={code}
                      onClick={() => toggleLanguage(code)}
                      title={code}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        active
                          ? "bg-accent-blue/20 border-accent-blue/50 text-white"
                          : "bg-bg-secondary border-border-subtle text-gray-500 hover:text-gray-300"
                      }`}
                    >
                      <span>{flag}</span>
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="bg-bg-card border border-border-subtle rounded-xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Save className="w-4 h-4 text-accent-green" /> Automatisches
                    Speichern
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Zählerstände sofort auf die Festplatte schreiben
                  </p>
                </div>
                <button
                  onClick={() =>
                    setSettings({ ...settings, auto_save: !settings.auto_save })
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

            <section className="bg-bg-card border border-border-subtle rounded-xl p-6">
              <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-accent-blue" /> Pokémon-Daten
              </h2>
              <p className="text-xs text-gray-500 mb-4">
                Pokédex von PokeAPI aktualisieren (neue Generationen, neue
                Formen).
              </p>
              <button
                onClick={syncPokemonData}
                disabled={syncing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-secondary hover:bg-bg-hover text-sm text-gray-300 hover:text-white border border-border-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCw
                  className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`}
                />
                {syncing ? "Synchronisiere…" : "Pokémon-Daten aktualisieren"}
              </button>
              {syncResult && (
                <p
                  className={`mt-3 text-xs ${syncResult.startsWith("Fehler") ? "text-red-400" : "text-accent-green"}`}
                >
                  {syncResult}
                </p>
              )}
            </section>

            <section className="bg-bg-card border border-border-subtle rounded-xl p-6">
              <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-accent-blue" /> Spieldaten
              </h2>
              <p className="text-xs text-gray-500 mb-4">
                Neue Spiele und fehlende Übersetzungen von PokéAPI laden.
                Bestehende Einträge werden nicht überschrieben.
              </p>
              <button
                onClick={syncGamesData}
                disabled={gamesSyncing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-secondary hover:bg-bg-hover text-sm text-gray-300 hover:text-white border border-border-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCw
                  className={`w-4 h-4 ${gamesSyncing ? "animate-spin" : ""}`}
                />
                {gamesSyncing ? "Synchronisiere…" : "Spieldaten aktualisieren"}
              </button>
              {gamesSyncResult && (
                <p
                  className={`mt-3 text-xs ${
                    gamesSyncResult.startsWith("Fehler")
                      ? "text-red-400"
                      : "text-accent-green"
                  }`}
                >
                  {gamesSyncResult}
                </p>
              )}
            </section>

            <section className="bg-bg-card border border-red-900/40 rounded-xl p-6">
              <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <Power className="w-4 h-4 text-red-400" /> App-Steuerung
              </h2>
              <div className="flex gap-3">
                <button
                  id="btn-restart-app"
                  onClick={restartApp}
                  disabled={restarting || quitting}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-secondary hover:bg-amber-900/30 text-sm text-amber-400 hover:text-amber-300 border border-amber-900/40 hover:border-amber-700/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RefreshCcw
                    className={`w-4 h-4 ${restarting ? "animate-spin" : ""}`}
                  />
                  {restarting ? "Neustart…" : "Neu starten"}
                </button>
                <button
                  id="btn-quit-app"
                  onClick={quitApp}
                  disabled={quitting || restarting}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-secondary hover:bg-red-900/30 text-sm text-red-400 hover:text-red-300 border border-red-900/40 hover:border-red-700/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Power
                    className={`w-4 h-4 ${quitting ? "animate-pulse" : ""}`}
                  />
                  {quitting ? "Wird beendet…" : "Beenden"}
                </button>
              </div>
            </section>
          </div>
        )}

        {/* Hotkeys */}
        {activeTab === "hotkeys" && (
          <div className="max-w-xl">
            <section className="bg-bg-card border border-border-subtle rounded-xl p-6">
              <h2 className="text-sm font-semibold text-white mb-6">
                Globale Hotkeys
              </h2>
              <HotkeySettings hotkeys={hotkeys} onUpdate={updateHotkeys} />
              {hotkeyError && (
                <p className="mt-3 text-xs text-red-400">{hotkeyError}</p>
              )}
            </section>
          </div>
        )}

        {/* Output */}
        {activeTab === "output" && (
          <div className="max-w-xl">
            <section className="bg-bg-card border border-border-subtle rounded-xl p-6">
              <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-accent-yellow" />{" "}
                Dateiausgabe (OBS)
              </h2>
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="output-dir"
                    className="block text-xs text-gray-400 mb-1.5"
                  >
                    Ausgabe-Ordner
                  </label>
                  <input
                    id="output-dir"
                    type="text"
                    value={settings.output_dir}
                    onChange={(e) =>
                      setSettings({ ...settings, output_dir: e.target.value })
                    }
                    placeholder="z.B. C:\OBS\counter oder ~/obs/counter"
                    className="w-full bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-accent-blue/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-2">
                    Erzeugte Textdateien:
                  </label>
                  <div className="bg-bg-secondary/50 border border-border-subtle rounded-lg p-3">
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
                          className="text-xs font-mono bg-bg-primary border border-border-subtle px-2 py-1 rounded text-gray-300"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

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
