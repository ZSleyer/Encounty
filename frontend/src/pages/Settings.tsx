import { useState, useEffect, useRef } from "react";
import {
  Save,
  FolderOpen,
  RefreshCw,
  Settings as SettingsIcon,
  Globe,
  Database,
  Download,
  Upload,
  ArchiveRestore,
} from "lucide-react";

import { useCounterStore } from "../hooks/useCounterState";
import { Settings as SettingsType } from "../types";
import { ALL_LANGUAGES } from "../utils/games";
import { useI18n } from "../contexts/I18nContext";
import { useToast } from "../contexts/ToastContext";

const API = "/api";

export function Settings() {
  const { t } = useI18n();
  const { push: pushToast } = useToast();
  const { appState } = useCounterStore();
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [gamesSyncing, setGamesSyncing] = useState(false);
  const [gamesSyncResult, setGamesSyncResult] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  const setCrispSprites = (v: boolean) => {
    setSettings((s) => s ? { ...s, crisp_sprites: v } : s);
    // Immediate visual feedback before the debounced save completes
    if (v) document.documentElement.setAttribute("data-crisp-sprites", "");
    else document.documentElement.removeAttribute("data-crisp-sprites");
  };

  const initialised = useState(false);
  useEffect(() => {
    if (appState && !initialised[0]) {
      setSettings(appState.settings);
      initialised[1](true);
    }
  }, [appState]);

  // Auto-save with debounce → toast on save
  useEffect(() => {
    if (!settings) return;
    const timer = setTimeout(() => {
      fetch(`${API}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      }).then(() => {
        pushToast({ type: "success", title: t("settings.saved"), duration: 1500 });
      });
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings?.output_dir,
    settings?.auto_save,
    settings?.browser_port,
    settings?.crisp_sprites,
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

  const downloadBackup = () => {
    const a = document.createElement("a");
    a.href = `${API}/backup`;
    a.download = "encounty-backup.zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleRestoreFile = async (file: File) => {
    setRestoring(true);
    const form = new FormData();
    form.append("backup", file);
    try {
      const res = await fetch(`${API}/restore`, { method: "POST", body: form });
      if (res.ok) {
        pushToast({ type: "success", title: t("settings.restoreSuccess") });
      } else {
        const data = await res.json().catch(() => ({}));
        pushToast({
          type: "error",
          title: t("settings.restoreError"),
          message: data.error ?? String(res.status),
        });
      }
    } catch {
      pushToast({ type: "error", title: t("settings.restoreError") });
    } finally {
      setRestoring(false);
      if (restoreInputRef.current) restoreInputRef.current.value = "";
    }
  };

  return (
    <div className="flex-1 overflow-auto p-6 settings-bg">
      <div className="max-w-5xl mx-auto relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ── Left column: General ─────────────────────────── */}
          <div className="space-y-6">
            {/* Server */}
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

            {/* Auto-save */}
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
                  className={`relative w-12 h-6 rounded-full transition-colors flex items-center px-1 flex-shrink-0 ${
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

            {/* Crisp sprites */}
            <section className="glass-card rounded-2xl p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <span className="text-base leading-none">🔍</span>
                    {t("settings.crispSprites")}
                  </h3>
                  <p className="text-xs text-text-muted mt-1 max-w-xs">
                    {t("settings.crispSpritesDesc")}
                  </p>
                </div>
                <button
                  onClick={() => setCrispSprites(!(settings.crisp_sprites ?? false))}
                  className={`relative w-12 h-6 rounded-full transition-colors flex items-center px-1 flex-shrink-0 mt-0.5 ${
                    (settings.crisp_sprites ?? false)
                      ? "bg-accent-blue/80"
                      : "bg-bg-secondary border border-border-subtle"
                  }`}
                >
                  <div
                    className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${(settings.crisp_sprites ?? false) ? "translate-x-6" : "translate-x-0"}`}
                  />
                </button>
              </div>
            </section>

            {/* Languages */}
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

            {/* Backup & Restore */}
            <section className="glass-card rounded-2xl p-6">
              <h2 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
                <ArchiveRestore className="w-4 h-4 text-accent-purple" />
                {t("settings.backupTitle")}
              </h2>

              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs text-text-muted mb-2">
                    {t("settings.backupDesc")}
                  </p>
                  <button
                    onClick={downloadBackup}
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-bg-secondary hover:bg-bg-hover text-sm text-text-primary border border-border-subtle transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    {t("settings.backupBtn")}
                  </button>
                </div>

                <div className="glow-line-h rounded" />

                <div>
                  <p className="text-xs text-text-muted mb-2">
                    {t("settings.restoreDesc")}
                  </p>
                  <input
                    ref={restoreInputRef}
                    type="file"
                    accept=".zip"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleRestoreFile(f);
                    }}
                  />
                  <button
                    onClick={() => restoreInputRef.current?.click()}
                    disabled={restoring}
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-bg-secondary hover:bg-bg-hover text-sm text-text-primary border border-border-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {restoring ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    {t("settings.restoreBtn")}
                  </button>
                </div>
              </div>
            </section>
          </div>

          {/* ── Right column: Data & Sync ────────────────────── */}
          <div className="space-y-6">
            {/* File Output */}
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

            {/* Sync Pokémon */}
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

            {/* Sync Games */}
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
          </div>
        </div>
      </div>
    </div>
  );
}
