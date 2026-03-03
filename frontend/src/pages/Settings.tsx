import { useState, useEffect } from "react";
import {
  Save,
  FolderOpen,
  RefreshCw,
  Settings as SettingsIcon,
  Globe,
  Database,
} from "lucide-react";

import { useCounterStore } from "../hooks/useCounterState";
import { Settings as SettingsType } from "../types";
import { ALL_LANGUAGES } from "../utils/games";
import { useI18n } from "../contexts/I18nContext";

const API = "/api";

export function Settings() {
  const { t } = useI18n();
  const { appState } = useCounterStore();
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [saved, setSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [gamesSyncing, setGamesSyncing] = useState(false);
  const [gamesSyncResult, setGamesSyncResult] = useState<string | null>(null);

  const initialised = useState(false);
  useEffect(() => {
    if (appState && !initialised[0]) {
      setSettings(appState.settings);
      initialised[1](true);
    }
  }, [appState]);

  // Auto-save with debounce
  useEffect(() => {
    if (!settings) return;
    const timer = setTimeout(() => {
      fetch(`${API}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      }).then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      });
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings?.output_dir,
    settings?.auto_save,
    settings?.browser_port,
    JSON.stringify(settings?.languages),
  ]);

  if (!settings) {
    return <div className="p-6 text-gray-500">Lade…</div>;
  }

  const toggleLanguage = (code: string) => {
    const current = settings.languages ?? ["de", "en"];
    const next = current.includes(code)
      ? current.filter((l) => l !== code)
      : [...current, code];
    if (next.length === 0) return;
    setSettings({ ...settings, languages: next });
  };

  const syncPokemonData = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch(`${API}/sync/pokemon`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setSyncResult(
          `${t("settings.syncSuccess")} ${data.added} neue Pokémon (${data.total} gesamt)`,
        );
      } else {
        setSyncResult(`${t("settings.syncError")} ${data.error}`);
      }
    } catch {
      setSyncResult(t("settings.syncFailed"));
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
          setGamesSyncResult(t("settings.syncNoChanges"));
        } else {
          setGamesSyncResult(
            `${t("settings.syncSuccess")} ${added} neue Spiele, ${updated} Sprachen ergänzt.`,
          );
        }
      } else {
        setGamesSyncResult(`${t("settings.syncError")} ${data.error}`);
      }
    } catch {
      setGamesSyncResult(t("settings.syncFailed"));
    } finally {
      setGamesSyncing(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto p-6 settings-bg">
      <div className="max-w-xl mx-auto space-y-6 relative z-10">
        {/* Saved indicator */}
        {saved && (
          <div className="flex items-center gap-1.5 text-xs text-accent-green">
            <Save className="w-3.5 h-3.5" /> {t("settings.saved")}
          </div>
        )}

        {/* ── General ─────────────────────────────────────── */}
        <section className="glass-card rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <SettingsIcon className="w-4 h-4 text-text-muted" />
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
              const active = (settings.languages ?? ["de", "en"]).includes(code);
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

        {/* ── Data & Sync ──────────────────────────────────── */}
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
            <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? t("settings.syncing") : t("settings.syncPokemonBtn")}
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
            {gamesSyncing ? t("settings.syncing") : t("settings.syncGamesBtn")}
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
      </div>
    </div>
  );
}
