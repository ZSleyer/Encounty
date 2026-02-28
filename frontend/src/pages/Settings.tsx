import { useState, useEffect } from "react";
import { Save, FolderOpen, RefreshCw } from "lucide-react";
import { HotkeySettings } from "../components/HotkeySettings";
import { OverlayEditor } from "../components/OverlayEditor";
import { useCounterStore } from "../hooks/useCounterState";
import { Settings as SettingsType, HotkeyMap } from "../types";

const API = "/api";

export function Settings() {
  const { appState } = useCounterStore();
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [hotkeys, setHotkeys] = useState<HotkeyMap | null>(null);
  const [saved, setSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  useEffect(() => {
    if (appState) {
      setSettings(appState.settings);
      setHotkeys(appState.hotkeys);
    }
  }, [appState]);

  if (!settings || !hotkeys) {
    return <div className="p-6 text-gray-500">Lade...</div>;
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

  const updateHotkeys = async (hk: HotkeyMap) => {
    setHotkeys(hk);
    await fetch(`${API}/hotkeys`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hk),
    });
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-bg-secondary">
        <h1 className="text-lg font-bold text-white">Einstellungen</h1>
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

      <main className="flex-1 overflow-auto p-6 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Column 1 */}
          <div className="space-y-6">
            {/* Hotkeys */}
            <section className="bg-bg-card border border-border-subtle rounded-xl p-6 shadow-sm">
              <h2 className="text-base font-semibold text-white mb-6 flex items-center gap-2">
                <span>⌨️</span> Globale Hotkeys
              </h2>
              <HotkeySettings hotkeys={hotkeys} onUpdate={updateHotkeys} />
            </section>

            {/* Server */}
            <section className="bg-bg-card border border-border-subtle rounded-xl p-6 shadow-sm">
              <h2 className="text-base font-semibold text-white mb-6 flex items-center gap-2">
                <span>🌐</span> Webserver & Overlay Port
              </h2>
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
                  className="w-40 bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent-blue/50 transition-colors"
                />
              </div>
            </section>
          </div>

          {/* Column 2 */}
          <div className="space-y-6">
            {/* Pokemon data sync */}
            <section className="bg-bg-card border border-border-subtle rounded-xl p-6 shadow-sm">
              <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
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

            {/* Emulator & AutoSave */}
            <section className="bg-bg-card border border-border-subtle rounded-xl p-6 shadow-sm space-y-6">
              <div className="pt-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                      <Save className="w-4 h-4 text-accent-green" />{" "}
                      Automatisches Speichern
                    </h3>
                    <p className="text-xs text-gray-500 mt-1">
                      Zählerstände sofort auf die Festplatte schreiben
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
                      className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
                        settings.auto_save ? "translate-x-6" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>
            </section>
          </div>

          {/* Column 2 */}
          <div className="space-y-6">
            <section className="bg-bg-card border border-border-subtle rounded-xl p-6 shadow-sm">
              <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
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

            {/* Advanced Overlay Editor */}
            <section className="bg-bg-card border border-border-subtle rounded-xl p-6 shadow-sm col-span-1 lg:col-span-2">
              <h2 className="text-base font-semibold text-white mb-6 flex items-center gap-2 border-b border-border-subtle pb-4">
                <span>🎨</span> Overlay-Editor (OBS)
              </h2>
              <OverlayEditor
                settings={settings.overlay}
                activePokemon={activePokemon || undefined}
                onUpdate={(overlay) => setSettings({ ...settings, overlay })}
              />
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
