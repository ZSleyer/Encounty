import { useState, useEffect, useRef, useMemo } from "react";
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
  Scale,
  ChevronDown,
  Search,
  Image,
  Info,
} from "lucide-react";

import { useCounterStore } from "../hooks/useCounterState";
import { Settings as SettingsType } from "../types";
import { ALL_LANGUAGES } from "../utils/games";
import { useI18n } from "../contexts/I18nContext";
import { useToast } from "../contexts/ToastContext";
import { CountryFlag } from "../components/CountryFlag";

const API = "/api";

// --- Licenses types ----------------------------------------------------------

interface LicenseEntry {
  name: string;
  version: string;
  license: string;
  text: string;
  source: string;
}

// --- Toggle switch -----------------------------------------------------------

function Toggle({
  enabled,
  onChange,
  color = "bg-accent-green/80",
}: {
  readonly enabled: boolean;
  readonly onChange: () => void;
  readonly color?: string;
}) {
  return (
    <button
      onClick={onChange}
      className={`relative w-12 h-6 2xl:w-14 2xl:h-7 rounded-full transition-colors flex items-center px-1 shrink-0 ${
        enabled ? color : "bg-bg-secondary border border-border-subtle"
      }`}
    >
      <div
        className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${enabled ? "translate-x-6" : "translate-x-0"}`}
      />
    </button>
  );
}

// --- Section wrapper ---------------------------------------------------------

interface SectionDef {
  readonly id: string;
  readonly titleKey: string;
  readonly icon: React.ReactNode;
  readonly keywords: string[];
}

const SECTIONS: SectionDef[] = [
  {
    id: "general",
    titleKey: "settings.sectionGeneral",
    icon: <SettingsIcon className="w-4 h-4 text-text-muted" />,
    keywords: ["server", "port", "auto", "save", "speichern", "allgemein", "general"],
  },
  {
    id: "display",
    titleKey: "settings.sectionDisplay",
    icon: <Image className="w-4 h-4 text-accent-blue" />,
    keywords: ["sprite", "crisp", "pixel", "scharf", "darstellung", "display", "language", "sprache"],
  },
  {
    id: "output",
    titleKey: "settings.sectionOutput",
    icon: <FolderOpen className="w-4 h-4 text-accent-yellow" />,
    keywords: ["obs", "datei", "file", "output", "ausgabe", "text", "folder"],
  },
  {
    id: "data",
    titleKey: "settings.sectionData",
    icon: <Database className="w-4 h-4 text-accent-blue" />,
    keywords: ["sync", "daten", "data", "pokemon", "pokédex", "spiel", "game", "api", "update"],
  },
  {
    id: "backup",
    titleKey: "settings.sectionBackup",
    icon: <ArchiveRestore className="w-4 h-4 text-accent-purple" />,
    keywords: ["backup", "restore", "sicherung", "wiederherstellen", "export", "import", "zip"],
  },
  {
    id: "about",
    titleKey: "settings.sectionAbout",
    icon: <Info className="w-4 h-4 text-text-muted" />,
    keywords: ["about", "über", "lizenz", "license", "version", "info"],
  },
];

// --- Main component ----------------------------------------------------------

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
  const [search, setSearch] = useState("");
  const [licensesOpen, setLicensesOpen] = useState(false);
  const [licenses, setLicenses] = useState<LicenseEntry[]>([]);
  const [expandedLicense, setExpandedLicense] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const setCrispSprites = (v: boolean) => {
    setSettings((s) => (s ? { ...s, crisp_sprites: v } : s));
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

  // Fetch license data from API (lazy, on first expand)
  useEffect(() => {
    if (licensesOpen && licenses.length === 0) {
      fetch(`${API}/licenses`)
        .then((r) => r.json())
        .then((data: LicenseEntry[]) => setLicenses(data))
        .catch(() => {});
    }
  }, [licensesOpen]);

  // Ctrl+K focuses search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Auto-save with debounce
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
    settings?.output_enabled,
    settings?.output_dir,
    settings?.auto_save,
    settings?.browser_port,
    settings?.crisp_sprites,
    JSON.stringify(settings?.languages),
  ]);

  const visibleSections = useMemo(() => {
    if (!search.trim()) return SECTIONS.map((s) => s.id);
    const q = search.toLowerCase();
    return SECTIONS.filter(
      (s) =>
        t(s.titleKey).toLowerCase().includes(q) ||
        s.keywords.some((kw) => kw.includes(q)),
    ).map((s) => s.id);
  }, [search, t]);

  if (!settings) {
    return <div className="p-6 text-text-muted">Lade…</div>;
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

  const show = (id: string) => visibleSections.includes(id);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-transparent">
      <div className="switch-waves-container">
        <div className="switch-waves" />
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-6 relative z-10">
        <div className="max-w-2xl 2xl:max-w-3xl mx-auto space-y-6">
          {/* ── Search ───────────────────────────────────────── */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("settings.search")}
              className="w-full bg-bg-secondary border border-border-subtle rounded-xl pl-9 pr-4 py-2.5 text-sm 2xl:text-base text-text-primary placeholder-text-faint/50 outline-none focus:border-accent-blue/50 transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-faint hover:text-text-muted transition-colors"
              >
                <span className="text-xs">Esc</span>
              </button>
            )}
          </div>

          {visibleSections.length === 0 && (
            <p className="text-sm text-text-muted text-center py-8">
              {t("settings.noResults")}
            </p>
          )}

          {/* ── General ──────────────────────────────────────── */}
          {show("general") && (
            <section className="glass-card rounded-2xl p-6 space-y-5">
              <h2 className="text-sm 2xl:text-base font-semibold text-text-primary flex items-center gap-2">
                <SettingsIcon className="w-4 h-4 text-text-muted" />
                {t("settings.sectionGeneral")}
              </h2>

              {/* Server port */}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-text-primary">{t("settings.server")}</p>
                  <p className="text-xs text-text-muted mt-0.5">{t("settings.port")}</p>
                </div>
                <input
                  id="browser-port"
                  type="number"
                  value={settings.browser_port}
                  onChange={(e) =>
                    setSettings({ ...settings, browser_port: Number(e.target.value) })
                  }
                  min={1024}
                  max={65535}
                  className="w-28 2xl:w-32 bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2 text-sm 2xl:text-base text-text-primary outline-none focus:border-accent-blue/50 transition-colors text-right"
                />
              </div>

              <div className="border-t border-border-subtle/50" />

              {/* Auto-save */}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-text-primary flex items-center gap-2">
                    <Save className="w-3.5 h-3.5 text-accent-green" />
                    {t("settings.autoSave")}
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {t("settings.autoSaveDesc")}
                  </p>
                </div>
                <Toggle
                  enabled={settings.auto_save}
                  onChange={() => setSettings({ ...settings, auto_save: !settings.auto_save })}
                />
              </div>
            </section>
          )}

          {/* ── Display ──────────────────────────────────────── */}
          {show("display") && (
            <section className="glass-card rounded-2xl p-6 space-y-5">
              <h2 className="text-sm 2xl:text-base font-semibold text-text-primary flex items-center gap-2">
                <Image className="w-4 h-4 text-accent-blue" />
                {t("settings.sectionDisplay")}
              </h2>

              {/* Crisp sprites */}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-text-primary">
                    {t("settings.crispSprites")}
                  </p>
                  <p className="text-xs text-text-muted mt-0.5 max-w-sm">
                    {t("settings.crispSpritesDesc")}
                  </p>
                </div>
                <Toggle
                  enabled={settings.crisp_sprites ?? false}
                  onChange={() => setCrispSprites(!(settings.crisp_sprites ?? false))}
                  color="bg-accent-blue/80"
                />
              </div>

              <div className="border-t border-border-subtle/50" />

              {/* Languages */}
              <div>
                <p className="text-sm text-text-primary flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-accent-blue" />
                  {t("settings.languages")}
                </p>
                <p className="text-xs text-text-muted mt-0.5 mb-3">
                  {t("settings.languagesDesc")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {ALL_LANGUAGES.map(({ code, label }) => {
                    const active = (settings.languages ?? ["de", "en"]).includes(code);
                    return (
                      <button
                        key={code}
                        onClick={() => toggleLanguage(code)}
                        title={code}
                        className={`flex items-center gap-1.5 px-3 py-1.5 2xl:px-4 2xl:py-2 rounded-full text-xs 2xl:text-sm font-medium border transition-colors ${
                          active
                            ? "bg-accent-blue/20 border-accent-blue/50 text-text-primary"
                            : "bg-bg-secondary border-border-subtle text-text-muted hover:text-text-primary"
                        }`}
                      >
                        <CountryFlag code={code} className="w-4 h-3" />
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {/* ── File Output ──────────────────────────────────── */}
          {show("output") && (
            <section className="glass-card rounded-2xl p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm 2xl:text-base font-semibold text-text-primary flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-accent-yellow" />
                  {t("settings.sectionOutput")}
                </h2>
                <Toggle
                  enabled={settings.output_enabled}
                  onChange={() =>
                    setSettings({ ...settings, output_enabled: !settings.output_enabled })
                  }
                  color="bg-accent-yellow/80"
                />
              </div>

              <div
                className={`space-y-4 transition-all duration-300 ${!settings.output_enabled ? "opacity-30 pointer-events-none grayscale" : ""}`}
              >
                <div>
                  <label htmlFor="output-dir" className="block text-xs text-text-muted mb-1.5">
                    {t("settings.outputDir")}
                  </label>
                  <input
                    id="output-dir"
                    type="text"
                    value={settings.output_dir}
                    onChange={(e) => setSettings({ ...settings, output_dir: e.target.value })}
                    placeholder="z.B. C:\OBS\counter oder ~/obs/counter"
                    className="w-full bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2 text-sm 2xl:text-base text-text-primary placeholder-text-faint/50 outline-none focus:border-accent-blue/50 transition-colors"
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
          )}

          {/* ── Data & Sync ──────────────────────────────────── */}
          {show("data") && (
            <section className="glass-card rounded-2xl p-6 space-y-5">
              <h2 className="text-sm 2xl:text-base font-semibold text-text-primary flex items-center gap-2">
                <Database className="w-4 h-4 text-accent-blue" />
                {t("settings.sectionData")}
              </h2>

              {/* Sync Pokemon */}
              <div>
                <p className="text-sm text-text-primary">{t("settings.syncPokemon")}</p>
                <p className="text-xs text-text-muted mt-0.5 mb-3">
                  {t("settings.syncPokemonDesc")}
                </p>
                <button
                  onClick={syncPokemonData}
                  disabled={syncing}
                  title={t("settings.tooltipSyncPokemon")}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-bg-secondary hover:bg-bg-hover text-sm text-text-primary border border-border-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? t("settings.syncing") : t("settings.syncPokemonBtn")}
                </button>
                {syncResult && (
                  <p
                    className={`mt-3 text-xs ${
                      syncResult.startsWith("Fehler") || syncResult.startsWith("Error")
                        ? "text-accent-red"
                        : "text-accent-green"
                    }`}
                  >
                    {syncResult}
                  </p>
                )}
              </div>

              <div className="border-t border-border-subtle/50" />

              {/* Sync Games */}
              <div>
                <p className="text-sm text-text-primary">{t("settings.syncGames")}</p>
                <p className="text-xs text-text-muted mt-0.5 mb-3">
                  {t("settings.syncGamesDesc")}
                </p>
                <button
                  onClick={syncGamesData}
                  disabled={gamesSyncing}
                  title={t("settings.tooltipSyncGames")}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-bg-secondary hover:bg-bg-hover text-sm text-text-primary border border-border-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RefreshCw className={`w-4 h-4 ${gamesSyncing ? "animate-spin" : ""}`} />
                  {gamesSyncing ? t("settings.syncing") : t("settings.syncGamesBtn")}
                </button>
                {gamesSyncResult && (
                  <p
                    className={`mt-3 text-xs ${
                      gamesSyncResult.startsWith("Fehler") || gamesSyncResult.startsWith("Error")
                        ? "text-accent-red"
                        : "text-accent-green"
                    }`}
                  >
                    {gamesSyncResult}
                  </p>
                )}
              </div>
            </section>
          )}

          {/* ── Backup & Restore ─────────────────────────────── */}
          {show("backup") && (
            <section className="glass-card rounded-2xl p-6 space-y-5">
              <h2 className="text-sm 2xl:text-base font-semibold text-text-primary flex items-center gap-2">
                <ArchiveRestore className="w-4 h-4 text-accent-purple" />
                {t("settings.sectionBackup")}
              </h2>

              {appState?.data_path && (
                <div className="p-3 rounded-xl bg-bg-secondary/50 border border-border-subtle">
                  <p className="text-xs text-text-muted mb-1.5">{t("settings.dataPath")}</p>
                  <p className="text-xs text-text-primary break-all select-all font-mono opacity-80">
                    {appState.data_path}
                  </p>
                </div>
              )}

              {/* Backup */}
              <div>
                <p className="text-xs text-text-muted mb-2">{t("settings.backupDesc")}</p>
                <button
                  onClick={downloadBackup}
                  title={t("settings.tooltipBackup")}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-bg-secondary hover:bg-bg-hover text-sm text-text-primary border border-border-subtle transition-colors"
                >
                  <Download className="w-4 h-4" />
                  {t("settings.backupBtn")}
                </button>
              </div>

              <div className="border-t border-border-subtle/50" />

              {/* Restore */}
              <div>
                <p className="text-xs text-text-muted mb-2">{t("settings.restoreDesc")}</p>
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
                  title={t("settings.tooltipRestore")}
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
            </section>
          )}

          {/* ── About / Licenses ─────────────────────────────── */}
          {show("about") && (
            <section className="glass-card rounded-2xl p-6 space-y-4">
              <h2 className="text-sm 2xl:text-base font-semibold text-text-primary flex items-center gap-2">
                <Info className="w-4 h-4 text-text-muted" />
                {t("settings.sectionAbout")}
              </h2>

              <p className="text-xs text-text-muted">
                {t("licenses.project")}{" "}
                <a
                  href="https://www.gnu.org/licenses/agpl-3.0.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-blue hover:underline"
                >
                  GNU AGPL-3.0
                </a>
                .
              </p>

              {/* Collapsible licenses */}
              <button
                onClick={() => setLicensesOpen(!licensesOpen)}
                className="w-full flex items-center justify-between py-1"
              >
                <span className="text-sm text-text-primary flex items-center gap-2">
                  <Scale className="w-3.5 h-3.5 text-text-muted" />
                  {t("licenses.title")}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-text-muted transition-transform duration-200 ${licensesOpen ? "rotate-180" : ""}`}
                />
              </button>

              {licensesOpen && (
                <div className="space-y-2">
                  <p className="text-xs text-text-muted">{t("licenses.desc")}</p>
                  {licenses.length === 0 ? (
                    <p className="text-xs text-text-faint py-2">Loading…</p>
                  ) : (
                    <div className="space-y-1">
                      {licenses.map((dep) => (
                        <div
                          key={`${dep.source}-${dep.name}`}
                          className="bg-bg-secondary/30 border border-border-subtle rounded-lg overflow-hidden"
                        >
                          <button
                            onClick={() =>
                              setExpandedLicense(
                                expandedLicense === dep.name ? null : dep.name,
                              )
                            }
                            className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-bg-hover/50 transition-colors"
                          >
                            <span className="text-xs text-text-primary font-medium flex-1 min-w-0 truncate">
                              {dep.name}
                            </span>
                            <span className="text-[10px] text-text-faint shrink-0">
                              {dep.version}
                            </span>
                            <span className="inline-block px-1.5 py-0.5 rounded bg-bg-secondary border border-border-subtle text-text-muted font-mono text-[10px] shrink-0">
                              {dep.license}
                            </span>
                            <ChevronDown
                              className={`w-3 h-3 text-text-faint transition-transform duration-150 shrink-0 ${expandedLicense === dep.name ? "rotate-180" : ""}`}
                            />
                          </button>
                          {expandedLicense === dep.name && dep.text && (
                            <pre className="px-3 py-2 text-[10px] leading-relaxed text-text-muted border-t border-border-subtle/50 max-h-48 overflow-auto whitespace-pre-wrap wrap-break-word">
                              {dep.text}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Bottom spacer for comfortable scrolling */}
          <div className="h-2" />
        </div>
      </div>
    </div>
  );
}
