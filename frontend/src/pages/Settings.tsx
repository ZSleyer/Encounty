import { useState, useEffect, useRef, useMemo } from "react";
import {
  FolderOpen,
  RefreshCw,
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
  Sun,
  Moon,
  Bot,
  Shield,
  AlertTriangle,
  Monitor,
  Check,
  CheckCircle,
} from "lucide-react";

import { useCounterStore } from "../hooks/useCounterState";
import { AppState, Settings as SettingsType, AccentColor, ACCENT_COLORS } from "../types";

/**
 * Visual swatch hex per accent preset. The actual --accent-blue values applied
 * by the app live in index.css; this map only powers the picker buttons. Use
 * the dark-mode value so the swatch reads well against the card background.
 */
const ACCENT_SWATCH: Record<AccentColor, string> = {
  blue: "#4a9eff",
  purple: "#b970ff",
  green: "#34d67a",
  cyan: "#22d3ee",
  pink: "#ec4899",
  orange: "#fb923c",
};
import { ALL_LANGUAGES } from "../utils/games";
import { useI18n } from "../contexts/I18nContext";
import { useTheme } from "../contexts/ThemeContext";
import { useToast } from "../contexts/ToastContext";
import { CountryFlag } from "../components/shared/CountryFlag";
import { LicenseDialog } from "../components/settings/LicenseDialog";
import { MacPermissions } from "../components/settings/MacPermissions";
import { LOCALES } from "../utils/i18n";
import type { Locale } from "../locales";
import { apiUrl, wsUrl } from "../utils/api";
import { FolderPathInput } from "../components/settings/FolderPathInput";

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
  label,
  color = "bg-accent-green/80",
}: Readonly<{
  enabled: boolean;
  onChange: () => void;
  label?: string;
  color?: string;
}>) {
  return (
    <button
      onClick={onChange}
      role="switch"
      aria-checked={enabled}
      aria-label={label}
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

const BASE_SECTIONS: SectionDef[] = [
  {
    id: "display",
    titleKey: "settings.sectionDisplay",
    icon: <Image className="w-4 h-4 text-accent-blue" />,
    keywords: ["sprite", "crisp", "pixel", "scharf", "darstellung", "display", "language", "sprache", "theme", "dark", "light", "dunkel", "hell", "locale", "deutsch", "english", "accent", "akzent", "farbe", "color"],
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
    keywords: ["about", "über", "lizenz", "license", "version", "info", "pokeapi", "showdown", "api"],
  },
];

const PERMISSIONS_SECTION: SectionDef = {
  id: "permissions",
  titleKey: "settings.sectionPermissions",
  icon: <Shield className="w-4 h-4 text-accent-green" />,
  keywords: ["permissions", "berechtigungen", "accessibility", "screen", "recording", "macos"],
};

/** Build the sections array, conditionally including macOS permissions. */
function buildSections(): SectionDef[] {
  if (globalThis.electronAPI?.platform === "darwin") {
    // Insert permissions before the about section
    const sections = [...BASE_SECTIONS];
    const aboutIdx = sections.findIndex((s) => s.id === "about");
    sections.splice(aboutIdx, 0, PERMISSIONS_SECTION);
    return sections;
  }
  return BASE_SECTIONS;
}

const SECTIONS = buildSections();

/** Apply crisp-sprites DOM attribute and update settings state. */
function applyCrispSprites(
  v: boolean,
  setSettings: (updater: (s: SettingsType | null) => SettingsType | null) => void,
): void {
  setSettings((s) => (s ? { ...s, crisp_sprites: v } : s));
  if (v) {
    document.documentElement.dataset.crispSprites = "";
  } else {
    delete document.documentElement.dataset.crispSprites;
  }
}

/** Apply the chosen accent color preset and update settings state. */
function applyAccentColor(
  v: AccentColor,
  setSettings: (updater: (s: SettingsType | null) => SettingsType | null) => void,
): void {
  setSettings((s) => (s ? { ...s, accent_color: v } : s));
  document.documentElement.dataset.accent = v;
}

/** Aggregate sync state surfaced by `runUnifiedSync`. */
interface SyncState {
  running: boolean;
  phase: string;
  step: string;
  error: string | null;
  done: boolean;
}

const SYNC_IDLE: SyncState = { running: false, phase: "", step: "", error: null, done: false };

/**
 * Run the unified Pokémon + Games sync flow.
 *
 * Reuses the first-start `POST /api/setup/online` endpoint, which already
 * chains both syncs and broadcasts `sync_progress` / `system_ready` events
 * over the WebSocket. A short-lived dedicated socket is opened for the
 * duration of the run so that the Settings UI does not need to share
 * messages with the global app store.
 */
function runUnifiedSync(
  setState: (updater: (s: SyncState) => SyncState) => void,
): void {
  setState(() => ({ ...SYNC_IDLE, running: true }));

  let ws: WebSocket | null = null;
  let closed = false;
  const finish = (errorMsg: string | null) => {
    if (closed) return;
    closed = true;
    if (ws) ws.close();
    setState((s) => ({ ...s, running: false, error: errorMsg, done: errorMsg === null }));
  };

  try {
    ws = new WebSocket(wsUrl());
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { type: string; payload: unknown };
        if (msg.type === "sync_progress") {
          const p = msg.payload as { phase: string; step: string; error?: string };
          if (p.step === "error" && p.error) {
            finish(p.error);
            return;
          }
          setState((s) => ({ ...s, phase: p.phase, step: p.step }));
        } else if (msg.type === "system_ready") {
          finish(null);
        }
      } catch {
        // Ignore unparseable frames
      }
    };
    ws.onerror = () => finish("websocket error");
  } catch {
    finish("websocket failed");
    return;
  }

  fetch(apiUrl("/api/setup/online"), { method: "POST" }).catch(() => {
    finish("request failed");
  });
}

async function performRestore(
  file: File,
  t: (key: string) => string,
  pushToast: (toast: { type: "success" | "error"; title: string; message?: string }) => void,
  setRestoring: (v: boolean) => void,
  restoreInputRef: React.RefObject<HTMLInputElement | null>,
): Promise<void> {
  setRestoring(true);
  const form = new FormData();
  form.append("backup", file);
  try {
    const res = await fetch(apiUrl("/api/restore"), { method: "POST", body: form });
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
}

function useVisibleSections(
  search: string,
  t: (key: string) => string,
): string[] {
  return useMemo(() => {
    if (!search.trim()) return SECTIONS.map((s) => s.id);
    const q = search.toLowerCase();
    return SECTIONS.filter(
      (s) =>
        t(s.titleKey).toLowerCase().includes(q) ||
        s.keywords.some((kw) => kw.includes(q)),
    ).map((s) => s.id);
  }, [search, t]);
}

function useInitFromAppState(
  appState: AppState | null,
  setSettings: (s: SettingsType | null) => void,
) {
  const [initialised, setInitialised] = useState(!!appState);
  useEffect(() => {
    if (appState && !initialised) {
      setSettings(appState.settings);
      setInitialised(true);
    }
  }, [appState, initialised, setSettings]);
}

function useAutoSave(
  settings: SettingsType | null,
  t: (key: string) => string,
  pushToast: (toast: { type: "success"; title: string; duration?: number }) => void,
) {
  useEffect(() => {
    if (!settings) return;
    const timer = setTimeout(() => {
      fetch(apiUrl("/api/settings"), {
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
    settings?.crisp_sprites,
    settings?.accent_color,
    JSON.stringify(settings?.languages),
  ]);
}

function useLazyLicenses(
  licensesOpen: boolean,
  count: number,
  setLicenses: (data: LicenseEntry[]) => void,
) {
  useEffect(() => {
    if (licensesOpen && count === 0) {
      fetch(apiUrl("/api/licenses"))
        .then((r) => r.json())
        .then((data: LicenseEntry[]) => setLicenses(data))
        .catch(() => {});
    }
  }, [licensesOpen, count, setLicenses]);
}

function useSearchFocusShortcut(searchRef: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [searchRef]);
}

function toggleLang(
  code: string,
  settings: SettingsType,
  setSettings: (s: SettingsType) => void,
): void {
  const current = settings.languages ?? ["de", "en"];
  const next = current.includes(code)
    ? current.filter((l) => l !== code)
    : [...current, code];
  if (next.length === 0) return;
  setSettings({ ...settings, languages: next });
}

// --- Display section ---------------------------------------------------------

function DisplaySection({ settings, theme, toggleTheme, locale, setLocale, setCrispSprites, setAccentColor, toggleLanguage, t }: Readonly<{
  settings: SettingsType;
  theme: string;
  toggleTheme: () => void;
  locale: string;
  setLocale: (code: Locale) => void;
  setCrispSprites: (v: boolean) => void;
  setAccentColor: (v: AccentColor) => void;
  toggleLanguage: (code: string) => void;
  t: (key: string) => string;
}>) {
  const activeAccent = settings.accent_color ?? "blue";
  return (
    <section className="glass-card rounded-2xl p-6 space-y-5">
      <h2 className="text-sm 2xl:text-base font-semibold text-text-primary flex items-center gap-2">
        <Image className="w-4 h-4 text-accent-blue" />
        {t("settings.sectionDisplay")}
      </h2>

      {/* Theme */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-text-primary flex items-center gap-2">
            {theme === "dark" ? <Moon className="w-3.5 h-3.5 text-accent-blue" /> : <Sun className="w-3.5 h-3.5 text-accent-yellow" />}
            {t("settings.themeDark")} / {t("settings.themeLight")}
          </p>
        </div>
        <div className="flex items-center border border-border-subtle rounded-lg overflow-hidden">
          <button
            onClick={() => { if (theme !== "dark") toggleTheme(); }}
            aria-label={t("settings.themeDark")}
            aria-pressed={theme === "dark"}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              theme === "dark"
                ? "bg-accent-blue/15 text-accent-blue"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            <Moon className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { if (theme !== "light") toggleTheme(); }}
            aria-label={t("settings.themeLight")}
            aria-pressed={theme === "light"}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              theme === "light"
                ? "bg-accent-blue/15 text-accent-blue"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            <Sun className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="border-t border-border-subtle/50" />

      {/* UI Language */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-text-primary flex items-center gap-2">
            <Globe className="w-3.5 h-3.5 text-accent-blue" />
            {t("settings.uiLanguage") || "UI Language"}
          </p>
        </div>
        <div className="flex items-center border border-border-subtle rounded-lg overflow-hidden">
          {LOCALES.map((l) => (
            <button
              key={l.code}
              onClick={() => setLocale(l.code)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                locale === l.code
                  ? "bg-accent-blue/15 text-accent-blue"
                  : "text-text-muted hover:text-text-primary"
              }`}
              title={l.machineTranslated ? `${l.label} (${t("settings.autoTranslated")})` : l.label}
            >
              {l.code.toUpperCase()}
              {l.machineTranslated && (
                <Bot className="inline w-2.5 h-2.5 ml-0.5 text-text-faint" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-border-subtle/50" />

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
          label={t("settings.crispSprites")}
          color="bg-accent-blue/80"
        />
      </div>

      <div className="border-t border-border-subtle/50" />

      {/* Accent color picker */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-text-primary">
            {t("settings.accentColor")}
          </p>
          <p className="text-xs text-text-muted mt-0.5 max-w-sm">
            {t("settings.accentColorDesc")}
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label={t("settings.accentColor")}
          className="flex items-center gap-2"
        >
          {ACCENT_COLORS.map((c) => {
            const selected = activeAccent === c;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={t(`settings.accentColor.${c}`)}
                title={t(`settings.accentColor.${c}`)}
                onClick={() => setAccentColor(c)}
                data-accent={c}
                className={`relative h-8 w-8 rounded-full border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card focus-visible:ring-(--accent-blue) ${
                  selected
                    ? "border-text-primary scale-110"
                    : "border-border-subtle hover:scale-105"
                }`}
                style={{ backgroundColor: ACCENT_SWATCH[c] }}
              >
                {selected && (
                  <span className="sr-only">{t("settings.accentColorActive")}</span>
                )}
              </button>
            );
          })}
        </div>
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
  );
}

// --- Main component ----------------------------------------------------------

export function Settings() {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { push: pushToast } = useToast();
  const { appState } = useCounterStore();
  const [settings, setSettings] = useState<SettingsType | null>(appState?.settings ?? null);
  const [syncState, setSyncState] = useState<SyncState>(SYNC_IDLE);
  const [restoring, setRestoring] = useState(false);
  // Local-only display value for the database location text input.
  // The actual move is triggered explicitly via the "change" button so
  // that typing a partial path does not relocate the DB on every keystroke.
  const [dbPathDraft, setDbPathDraft] = useState<string>(appState?.data_path ?? "");
  const [dbPathSaving, setDbPathSaving] = useState(false);
  const [obsPathCopied, setObsPathCopied] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [licensesOpen, setLicensesOpen] = useState(false);
  const [dataSourcesOpen, setDataSourcesOpen] = useState(false);
  const [trademarkOpen, setTrademarkOpen] = useState(false);
  const [licenses, setLicenses] = useState<LicenseEntry[]>([]);
  const [expandedLicense, setExpandedLicense] = useState<string | null>(null);
  const [showLicenseDialog, setShowLicenseDialog] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const setCrispSprites = (v: boolean) => applyCrispSprites(v, setSettings);

  const setAccentColor = (v: AccentColor) => applyAccentColor(v, setSettings);

  useInitFromAppState(appState, setSettings);
  useLazyLicenses(licensesOpen, licenses.length, setLicenses);
  useSearchFocusShortcut(searchRef);
  useAutoSave(settings, t, pushToast);

  // Auto-clear the "done" badge a few seconds after a successful sync.
  useEffect(() => {
    if (!syncState.done) return;
    const timer = setTimeout(() => setSyncState(SYNC_IDLE), 3000);
    return () => clearTimeout(timer);
  }, [syncState.done]);

  // Keep the local DB path draft in sync with the backend-reported path
  // whenever the upstream value changes (e.g. after a successful relocate).
  useEffect(() => {
    if (appState?.data_path) setDbPathDraft(appState.data_path);
  }, [appState?.data_path]);

  const visibleSections = useVisibleSections(search, t);

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-accent-blue border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-muted">{t("nav.connecting")}</p>
        </div>
      </div>
    );
  }

  const toggleLanguage = (code: string) => toggleLang(code, settings, setSettings);

  const startUnifiedSync = () => runUnifiedSync(setSyncState);

  const commitDbPath = async () => {
    const newPath = dbPathDraft.trim();
    if (!newPath || newPath === appState?.data_path) return;
    setDbPathSaving(true);
    try {
      const res = await fetch(apiUrl("/api/settings/config-path"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: newPath }),
      });
      if (res.ok) {
        pushToast({ type: "success", title: t("settings.dbPathChanged") });
      } else {
        const data = await res.json().catch(() => ({}));
        pushToast({ type: "error", title: t("settings.dbPathError"), message: data.error });
      }
    } catch {
      pushToast({ type: "error", title: t("settings.dbPathError") });
    } finally {
      setDbPathSaving(false);
    }
  };

  const copyObsPath = () => {
    if (!settings.output_dir) return;
    navigator.clipboard.writeText(settings.output_dir).then(() => {
      setObsPathCopied(true);
      setTimeout(() => setObsPathCopied(false), 2000);
    }).catch(() => {});
  };

  const downloadBackup = () => {
    const a = document.createElement("a");
    a.href = apiUrl("/api/backup");
    a.download = "encounty-backup.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleRestoreFile = (file: File) => {
    performRestore(file, t, pushToast, setRestoring, restoreInputRef);
  };

  const show = (id: string) => visibleSections.includes(id);

  return (
    <main id="main-content" className="flex-1 flex flex-col min-h-0 bg-transparent">
      <div className="flex-1 min-h-0 overflow-auto p-6 relative z-10">
        <div className="max-w-2xl 2xl:max-w-3xl mx-auto space-y-6">
          <h1 className="sr-only">{t("settings.title")}</h1>
          {/* ── Search ───────────────────────────────────────── */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("settings.search")}
              aria-label={t("settings.search")}
              className="w-full bg-bg-secondary border border-border-subtle rounded-xl pl-9 pr-4 py-2.5 text-sm 2xl:text-base text-text-primary placeholder-text-faint/50 outline-none focus:border-accent-blue/50 transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label={t("settings.clearSearch") || "Clear search"}
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

          {show("display") && (
            <DisplaySection
              settings={settings}
              theme={theme}
              toggleTheme={toggleTheme}
              locale={locale}
              setLocale={setLocale}
              setCrispSprites={setCrispSprites}
              setAccentColor={setAccentColor}
              toggleLanguage={toggleLanguage}
              t={t}
            />
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
                  label={t("settings.sectionOutput")}
                  color="bg-accent-yellow/80"
                />
              </div>

              <div
                className={`space-y-4 transition-all duration-300 ${settings.output_enabled ? "" : "opacity-30 pointer-events-none grayscale"}`}
              >
                {/* OBS file output info card — mimics ObsUrlCardButton on the dashboard. */}
                <button
                  type="button"
                  onClick={copyObsPath}
                  title={settings.output_dir}
                  aria-label={t("settings.obsCopyPath")}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-bg-card border border-border-subtle hover:border-accent-blue/40 hover:bg-accent-blue/5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-blue)"
                >
                  {obsPathCopied ? (
                    <Check className="w-5 h-5 text-accent-green shrink-0" />
                  ) : (
                    <Monitor className="w-5 h-5 text-accent-blue shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary">
                      {obsPathCopied ? t("settings.obsPathCopied") : t("settings.obsFileOutputTitle")}
                    </p>
                    <p className="text-xs font-mono text-text-muted truncate">
                      {settings.output_dir || "—"}
                    </p>
                    <p className="text-[10px] text-text-faint mt-0.5">
                      {t("settings.obsFileOutputDesc")}
                    </p>
                  </div>
                </button>

                <div>
                  <label htmlFor="output-dir" className="block text-xs text-text-muted mb-1.5">
                    {t("settings.outputDir")}
                  </label>
                  <FolderPathInput
                    value={settings.output_dir}
                    onChange={(p) => setSettings({ ...settings, output_dir: p })}
                    placeholder="z.B. C:\OBS\counter oder ~/obs/counter"
                    dialogTitle={t("settings.outputDir")}
                    ariaLabel={t("settings.outputDir")}
                  />
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

              {/* Unified sync — replays the first-start /api/setup/online flow. */}
              <div>
                <p className="text-sm text-text-primary">{t("settings.syncAllData")}</p>
                <p className="text-xs text-text-muted mt-0.5 mb-3">
                  {t("settings.syncAllDataDesc")}
                </p>
                <button
                  onClick={startUnifiedSync}
                  disabled={syncState.running}
                  title={t("settings.syncAllData")}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-bg-secondary hover:bg-bg-hover text-sm text-text-primary border border-border-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-blue)"
                >
                  <RefreshCw className={`w-4 h-4 ${syncState.running ? "animate-spin" : ""}`} />
                  {syncState.running ? t("settings.syncing") : t("settings.syncAllDataBtn")}
                </button>
                {syncState.running && (syncState.phase || syncState.step) && (
                  <p className="mt-3 text-xs text-text-muted" aria-live="polite">
                    {syncState.phase}
                    {syncState.step ? ` — ${syncState.step}` : ""}
                  </p>
                )}
                {syncState.done && (
                  <p className="mt-3 text-xs text-accent-green flex items-center gap-1.5" aria-live="polite">
                    <CheckCircle className="w-3.5 h-3.5" />
                    {t("settings.syncSuccess")}
                  </p>
                )}
                {syncState.error && (
                  <p className="mt-3 text-xs text-accent-red" aria-live="polite">
                    {t("settings.syncError")} {syncState.error}
                  </p>
                )}
              </div>

              <div className="border-t border-border-subtle/50" />

              {/* Database location — relocates the SQLite DB in place. */}
              <div>
                <p className="text-sm text-text-primary">{t("settings.dbPathTitle")}</p>
                <p className="text-xs text-text-muted mt-0.5 mb-3">
                  {t("settings.dbPathDesc")}
                </p>
                {appState?.data_path && (
                  <p className="text-[10px] text-text-faint font-mono break-all mb-2">
                    {appState.data_path}
                  </p>
                )}
                <FolderPathInput
                  value={dbPathDraft}
                  onChange={setDbPathDraft}
                  placeholder={appState?.data_path ?? ""}
                  dialogTitle={t("settings.dbPathTitle")}
                  ariaLabel={t("settings.dbPathTitle")}
                />
                <div className="flex items-center gap-3 mt-3">
                  <button
                    onClick={commitDbPath}
                    disabled={
                      dbPathSaving ||
                      !dbPathDraft.trim() ||
                      dbPathDraft.trim() === appState?.data_path
                    }
                    className="px-4 py-1.5 rounded-lg bg-accent-blue hover:bg-accent-blue/80 text-white text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-blue)"
                  >
                    {dbPathSaving ? t("settings.syncing") : t("settings.dataLocationChange")}
                  </button>
                  <p className="text-[10px] text-text-faint">{t("settings.dbPathRestartHint")}</p>
                </div>
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
                  aria-label={t("settings.restoreBtn")}
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

          {/* ── Permissions (macOS only) ─────────────────────── */}
          {show("permissions") && (
            <section className="glass-card rounded-2xl p-6 space-y-5">
              <h2 className="text-sm 2xl:text-base font-semibold text-text-primary flex items-center gap-2">
                <Shield className="w-4 h-4 text-accent-green" />
                {t("settings.sectionPermissions")}
              </h2>
              <MacPermissions />
            </section>
          )}

          {/* ── About / Licenses ─────────────────────────────── */}
          {show("about") && (
            <section className="glass-card rounded-2xl p-6 space-y-4">
              <h2 className="text-sm 2xl:text-base font-semibold text-text-primary flex items-center gap-2">
                <Info className="w-4 h-4 text-text-muted" />
                {t("settings.sectionAbout")}
              </h2>

              <div className="flex items-center justify-between gap-4">
                <p className="text-xs text-text-muted">
                  {t("licenses.project")}{" "}
                  <a
                    href="https://www.gnu.org/licenses/agpl-3.0.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-blue hover:underline"
                  >
                    GNU AGPL-3.0
                  </a>{"."}
                </p>
                <button
                  onClick={() => setShowLicenseDialog(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-secondary hover:bg-bg-hover border border-border-subtle text-xs text-text-muted hover:text-text-primary transition-colors shrink-0"
                >
                  <Scale className="w-3 h-3" />
                  {t("license.showDialog")}
                </button>
              </div>

              {showLicenseDialog && (
                <LicenseDialog onAccept={() => setShowLicenseDialog(false)} />
              )}

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

              {/* Data Sources & APIs */}
              <button
                onClick={() => setDataSourcesOpen(!dataSourcesOpen)}
                className="w-full flex items-center justify-between py-1"
              >
                <span className="text-sm text-text-primary flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-text-muted" />
                  {t("licenses.dataSources")}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-text-muted transition-transform duration-200 ${dataSourcesOpen ? "rotate-180" : ""}`}
                />
              </button>

              {dataSourcesOpen && (
                <div className="space-y-2">
                  <p className="text-xs text-text-muted">{t("licenses.dataSourcesDesc")}</p>
                  <div className="space-y-1">
                    {[
                      { name: "PokéAPI", url: "https://pokeapi.co", desc: "Pokémon data & sprites" },
                      { name: "PokéSprite", url: "https://github.com/msikma/pokesprite", desc: "Box sprites" },
                      { name: "Pokémon Showdown", url: "https://pokemonshowdown.com", desc: "Animated sprites" },
                    ].map((src) => (
                      <div
                        key={src.name}
                        className="bg-bg-secondary/30 border border-border-subtle rounded-lg px-3 py-2 flex items-center gap-3"
                      >
                        <span className="text-xs text-text-primary font-medium flex-1 min-w-0 truncate">
                          {src.name}
                        </span>
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-accent-blue hover:underline shrink-0"
                        >
                          {src.url.replace("https://", "")}
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Trademark Notice */}
              <button
                onClick={() => setTrademarkOpen(!trademarkOpen)}
                className="w-full flex items-center justify-between py-1"
              >
                <span className="text-sm text-text-primary flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-text-muted" />
                  {t("licenses.trademarkTitle")}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-text-muted transition-transform duration-200 ${trademarkOpen ? "rotate-180" : ""}`}
                />
              </button>

              {trademarkOpen && (
                <p className="text-xs text-text-muted leading-relaxed">
                  {t("licenses.trademark")}
                </p>
              )}
            </section>
          )}

          {/* Bottom spacer for comfortable scrolling */}
          <div className="h-2" />
        </div>
      </div>
    </main>
  );
}
