import { useState, useEffect } from "react";
import { Save, FolderOpen, RefreshCw, Keyboard, Layers, Settings as SettingsIcon } from "lucide-react";
import { HotkeySettings } from "../components/HotkeySettings";
import { OverlayEditor } from "../components/OverlayEditor";
import { useCounterStore } from "../hooks/useCounterState";
import { Settings as SettingsType, HotkeyMap } from "../types";

const API = "/api";

type Tab = "general" | "hotkeys" | "output" | "overlay";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "Allgemein", icon: <SettingsIcon className="w-4 h-4" /> },
  { id: "hotkeys", label: "Hotkeys", icon: <Keyboard className="w-4 h-4" /> },
  { id: "output", label: "Ausgabe", icon: <FolderOpen className="w-4 h-4" /> },
  { id: "overlay", label: "Overlay", icon: <Layers className="w-4 h-4" /> },
];

export function Settings() {
  const { appState } = useCounterStore();
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [hotkeys, setHotkeys] = useState<HotkeyMap | null>(null);
  const [saved, setSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("general");

  useEffect(() => {
    if (appState) {
      setSettings(appState.settings);
      setHotkeys(appState.hotkeys);
    }
  }, [appState]);

  if (!settings || !hotkeys) {
    return <div className="p-6 text-gray-500">Lade…</div>;
  }

  const activePokemon = appState?.pokemon.find((p) => p.id === appState.active_id) ?? null;

  const saveSettings = async () => {
    await fetch(`${API}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const updateHotkeys = async (hk: HotkeyMap) => {
    setHotkeys(hk);
    await fetch(`${API}/hotkeys`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hk),
    });
  };

  const syncPokemonData = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch(`${API}/sync/pokemon`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setSyncResult(`Sync abgeschlossen: ${data.added} neue Pokémon (${data.total} gesamt)`);
      } else {
        setSyncResult(`Fehler: ${data.error}`);
      }
    } catch {
      setSyncResult("Sync fehlgeschlagen – keine Verbindung zu PokeAPI");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border-subtle bg-bg-secondary flex-shrink-0">
        <h1 className="text-base font-bold text-white">Einstellungen</h1>
        <button
          onClick={saveSettings}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            saved
              ? "bg-accent-green text-white"
              : "bg-accent-blue hover:bg-blue-500 text-white"
          }`}
        >
          <Save className="w-4 h-4" />
          {saved ? "Gespeichert!" : "Speichern"}
        </button>
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
                <label htmlFor="browser-port" className="block text-xs text-gray-400 mb-1.5">
                  Lokaler Port (Neustart erforderlich)
                </label>
                <input
                  id="browser-port"
                  type="number"
                  value={settings.browser_port}
                  onChange={(e) => setSettings({ ...settings, browser_port: Number(e.target.value) })}
                  min={1024}
                  max={65535}
                  className="w-32 bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent-blue/50 transition-colors"
                />
              </div>
            </section>

            <section className="bg-bg-card border border-border-subtle rounded-xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Save className="w-4 h-4 text-accent-green" /> Automatisches Speichern
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">Zählerstände sofort auf die Festplatte schreiben</p>
                </div>
                <button
                  onClick={() => setSettings({ ...settings, auto_save: !settings.auto_save })}
                  className={`relative w-12 h-6 rounded-full transition-colors flex items-center px-1 ${
                    settings.auto_save ? "bg-accent-green/80" : "bg-bg-secondary border border-border-subtle"
                  }`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${settings.auto_save ? "translate-x-6" : "translate-x-0"}`} />
                </button>
              </div>
            </section>

            <section className="bg-bg-card border border-border-subtle rounded-xl p-6">
              <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-accent-blue" /> Pokémon-Daten
              </h2>
              <p className="text-xs text-gray-500 mb-4">
                Pokédex von PokeAPI aktualisieren (neue Generationen, neue Formen).
              </p>
              <button
                onClick={syncPokemonData}
                disabled={syncing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-secondary hover:bg-bg-hover text-sm text-gray-300 hover:text-white border border-border-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Synchronisiere…" : "Pokémon-Daten aktualisieren"}
              </button>
              {syncResult && (
                <p className={`mt-3 text-xs ${syncResult.startsWith("Fehler") ? "text-red-400" : "text-accent-green"}`}>
                  {syncResult}
                </p>
              )}
            </section>
          </div>
        )}

        {/* Hotkeys */}
        {activeTab === "hotkeys" && (
          <div className="max-w-xl">
            <section className="bg-bg-card border border-border-subtle rounded-xl p-6">
              <h2 className="text-sm font-semibold text-white mb-6">Globale Hotkeys</h2>
              <HotkeySettings hotkeys={hotkeys} onUpdate={updateHotkeys} />
            </section>
          </div>
        )}

        {/* Output */}
        {activeTab === "output" && (
          <div className="max-w-xl">
            <section className="bg-bg-card border border-border-subtle rounded-xl p-6">
              <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-accent-yellow" /> Dateiausgabe (OBS)
              </h2>
              <div className="space-y-4">
                <div>
                  <label htmlFor="output-dir" className="block text-xs text-gray-400 mb-1.5">
                    Ausgabe-Ordner
                  </label>
                  <input
                    id="output-dir"
                    type="text"
                    value={settings.output_dir}
                    onChange={(e) => setSettings({ ...settings, output_dir: e.target.value })}
                    placeholder="z.B. C:\OBS\counter oder ~/obs/counter"
                    className="w-full bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-accent-blue/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-2">Erzeugte Textdateien:</label>
                  <div className="bg-bg-secondary/50 border border-border-subtle rounded-lg p-3">
                    <div className="flex flex-wrap gap-2">
                      {["encounters.txt", "pokemon_name.txt", "encounters_label.txt", "session_duration.txt", "encounters_today.txt", "phase.txt"].map((f) => (
                        <span key={f} className="text-xs font-mono bg-bg-primary border border-border-subtle px-2 py-1 rounded text-gray-300">
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
        {activeTab === "overlay" && (
          <section className="bg-bg-card border border-border-subtle rounded-xl p-6">
            <h2 className="text-sm font-semibold text-white mb-6 flex items-center gap-2 border-b border-border-subtle pb-4">
              <Layers className="w-4 h-4 text-accent-blue" /> Overlay-Editor (OBS Browser Source)
            </h2>
            <OverlayEditor
              settings={settings.overlay}
              activePokemon={activePokemon || undefined}
              onUpdate={(overlay) => setSettings({ ...settings, overlay })}
            />
          </section>
        )}
      </main>
    </div>
  );
}
