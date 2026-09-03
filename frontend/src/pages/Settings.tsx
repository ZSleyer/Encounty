/**
 * Settings.tsx: Settings page shell.
 *
 * Owns the settings draft, the search field and the active tab, and decides
 * which of the section cards in ./settings is rendered. The sections
 * themselves live in their own modules.
 */

import { useState, useEffect, useRef } from "react";
import { Search, Shield } from "lucide-react";

import { useCounterStore } from "../hooks/useCounterState";
import { Settings as SettingsType, AccentColor } from "../types";
import { useI18n } from "../contexts/I18nContext";
import { useTheme } from "../contexts/ThemeContext";
import { useToast } from "../contexts/ToastContext";
import { AboutSection } from "./settings/AboutSection";
import { MacPermissions } from "./settings/MacPermissions";
import { apiUrl } from "../utils/api";
import { useFocusShortcut } from "../hooks/useFocusShortcut";
import { copyWithFlag } from "../utils/clipboard";
import { SECTIONS, type SettingsTab } from "./settings/sections";
import { SettingsTabBar } from "./settings/SettingsTabBar";
import { DisplaySection } from "./settings/DisplaySection";
import { OutputSection } from "./settings/OutputSection";
import { DataSyncSection } from "./settings/DataSyncSection";
import { BackupSection } from "./settings/BackupSection";
import { applyCrispSprites, applyAccentColor } from "./settings/settingsState";
import { runUnifiedSync, SYNC_IDLE, type SyncState } from "./settings/sync";
import { performRestore } from "./settings/restore";
import { useVisibleSections } from "./settings/useVisibleSections";
import { useInitFromAppState } from "./settings/useInitFromAppState";
import { useAutoSave } from "./settings/useAutoSave";

/** Settings page: search, tab bar and the section cards of the active tab. */
export function Settings() {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { push: pushToast } = useToast();
  const appState = useCounterStore((s) => s.appState);
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
  // Active tab is deliberately component-local: it resets when leaving the page.
  const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");
  const searchRef = useRef<HTMLInputElement>(null);

  const setCrispSprites = (v: boolean) => applyCrispSprites(v, setSettings);

  const setAccentColor = (v: AccentColor) => applyAccentColor(v, setSettings);

  useInitFromAppState(appState, setSettings);
  useFocusShortcut(searchRef);
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

  const startUnifiedSync = () => runUnifiedSync(setSyncState);

  const commitDbPath = async () => {
    const newPath = dbPathDraft.trim();
    if (!newPath || newPath === appState?.data_path) return;
    setDbPathSaving(true);
    try {
      const res = await fetch(apiUrl("/api/settings/db-path"), {
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
    copyWithFlag(settings.output_dir, setObsPathCopied);
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

  // While the search field is non-empty the active tab is ignored and all
  // matching sections are rendered flat; otherwise the active tab decides.
  const searching = search.trim().length > 0;
  const show = (id: string) => {
    if (searching) return visibleSections.includes(id);
    return SECTIONS.find((s) => s.id === id)?.tab === activeTab;
  };

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
              onKeyDown={(e) => {
                // Escape clears the search and returns to the tab view.
                if (e.key === "Escape") setSearch("");
              }}
              placeholder={t("settings.search")}
              aria-label={t("settings.search")}
              className="w-full bg-bg-secondary border border-border-subtle rounded-none pl-9 pr-4 py-2.5 text-sm 2xl:text-base text-text-primary placeholder-text-faint/50 outline-none focus:border-accent-blue/50 transition-colors"
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

          {/* ── Tab bar (hidden while searching) ─────────────── */}
          {!searching && <SettingsTabBar activeTab={activeTab} onSelect={setActiveTab} t={t} />}

          {searching && visibleSections.length === 0 && (
            <p className="text-sm text-text-muted text-center py-8">{t("settings.noResults")}</p>
          )}

          <div
            role={searching ? undefined : "tabpanel"}
            id={searching ? undefined : `settings-panel-${activeTab}`}
            aria-labelledby={searching ? undefined : `settings-tab-${activeTab}`}
            className="space-y-6"
          >
            {show("display") && (
              <DisplaySection
                settings={settings}
                theme={theme}
                toggleTheme={toggleTheme}
                locale={locale}
                setLocale={setLocale}
                setCrispSprites={setCrispSprites}
                setAccentColor={setAccentColor}
                t={t}
              />
            )}

            {/* ── File Output ──────────────────────────────────── */}
            {show("output") && (
              <OutputSection
                settings={settings}
                setSettings={setSettings}
                obsPathCopied={obsPathCopied}
                copyObsPath={copyObsPath}
                t={t}
              />
            )}

            {/* ── Data & Sync ──────────────────────────────────── */}
            {show("data") && (
              <DataSyncSection
                syncState={syncState}
                startUnifiedSync={startUnifiedSync}
                dataPath={appState?.data_path}
                dbPathDraft={dbPathDraft}
                setDbPathDraft={setDbPathDraft}
                dbPathSaving={dbPathSaving}
                commitDbPath={commitDbPath}
                t={t}
              />
            )}

            {/* ── Backup & Restore ─────────────────────────────── */}
            {show("backup") && (
              <BackupSection
                downloadBackup={downloadBackup}
                restoring={restoring}
                restoreInputRef={restoreInputRef}
                onRestoreFile={handleRestoreFile}
                t={t}
              />
            )}

            {/* ── Capture ──────────────────────────────────────── */}
            {/* ── Permissions (macOS only) ─────────────────────── */}
            {show("permissions") && (
              <section className="glass-card rounded-none p-6 space-y-5">
                <h2 className="text-sm 2xl:text-base font-semibold text-text-primary flex items-center gap-2">
                  <Shield className="w-4 h-4 text-accent-green" />
                  {t("settings.sectionPermissions")}
                </h2>
                <MacPermissions />
              </section>
            )}

            {/* ── About / Licenses ─────────────────────────────── */}
            {show("about") && <AboutSection t={t} />}
          </div>

          {/* Bottom spacer for comfortable scrolling */}
          <div className="h-2" />
        </div>
      </div>
    </main>
  );
}
