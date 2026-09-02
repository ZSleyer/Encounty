/**
 * DataSyncSection.tsx: Pokédex sync trigger and the database location picker.
 */

import { RefreshCw, Database, CheckCircle } from "lucide-react";

import { FolderPathInput } from "../../components/settings/FolderPathInput";
import type { SyncState } from "./sync";

/**
 * DataSyncSection renders the data card: the unified sync button with its
 * progress, success and error lines, plus the database relocation form.
 */
export function DataSyncSection({
  syncState,
  startUnifiedSync,
  dataPath,
  dbPathDraft,
  setDbPathDraft,
  dbPathSaving,
  commitDbPath,
  t,
}: Readonly<{
  syncState: SyncState;
  startUnifiedSync: () => void;
  dataPath: string | undefined;
  dbPathDraft: string;
  setDbPathDraft: (p: string) => void;
  dbPathSaving: boolean;
  commitDbPath: () => void;
  t: (key: string) => string;
}>) {
  return (
    <section className="glass-card rounded-none p-6 space-y-5">
      <h2 className="text-sm 2xl:text-base font-semibold text-text-primary flex items-center gap-2">
        <Database className="w-4 h-4 text-accent-blue" />
        {t("settings.sectionData")}
      </h2>

      {/* Unified sync, replays the first-start /api/setup/online flow. */}
      <div>
        <p className="text-sm text-text-primary">{t("settings.syncAllData")}</p>
        <p className="text-xs text-text-muted mt-0.5 mb-3">{t("settings.syncAllDataDesc")}</p>
        <button
          onClick={startUnifiedSync}
          disabled={syncState.running}
          title={t("settings.syncAllData")}
          className="flex items-center gap-2 px-4 py-2 rounded-none bg-bg-secondary hover:bg-bg-hover text-sm text-text-primary border border-border-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-blue)"
        >
          <RefreshCw className={`w-4 h-4 ${syncState.running ? "animate-spin" : ""}`} />
          {syncState.running ? t("settings.syncing") : t("settings.syncAllDataBtn")}
        </button>
        {syncState.running && (syncState.phase || syncState.step) && (
          <p className="mt-3 text-xs text-text-muted" aria-live="polite">
            {syncState.phase}
            {syncState.step ? `: ${syncState.step}` : ""}
          </p>
        )}
        {syncState.done && (
          <p
            className="mt-3 text-xs text-accent-green flex items-center gap-1.5"
            aria-live="polite"
          >
            <CheckCircle className="w-3.5 h-3.5" />
            {syncState.result
              ? `${t("settings.syncSuccess")} ${syncState.result.total} ${t("settings.syncSpecies")}, ${syncState.result.namesUpdated} ${t("settings.syncNamesUpdated")}`
              : t("settings.syncSuccessShort")}
          </p>
        )}
        {syncState.error && (
          <p className="mt-3 text-xs text-accent-red" aria-live="polite">
            {t("settings.syncError")} {syncState.error}
          </p>
        )}
      </div>

      <div className="border-t border-border-subtle/50" />

      {/* Database location, relocates the SQLite DB in place. */}
      <div>
        <p className="text-sm text-text-primary">{t("settings.dbPathTitle")}</p>
        <p className="text-xs text-text-muted mt-0.5 mb-3">{t("settings.dbPathDesc")}</p>
        {dataPath && (
          <p className="text-[10px] text-text-faint font-mono break-all mb-2">{dataPath}</p>
        )}
        <FolderPathInput
          value={dbPathDraft}
          onChange={setDbPathDraft}
          placeholder={dataPath ?? ""}
          dialogTitle={t("settings.dbPathTitle")}
          ariaLabel={t("settings.dbPathTitle")}
        />
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={commitDbPath}
            disabled={dbPathSaving || !dbPathDraft.trim() || dbPathDraft.trim() === dataPath}
            className="px-4 py-1.5 rounded-none bg-accent-blue hover:bg-accent-blue/80 text-white text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-blue)"
          >
            {dbPathSaving ? t("settings.syncing") : t("settings.dataLocationChange")}
          </button>
          <p className="text-[10px] text-text-faint">{t("settings.dbPathRestartHint")}</p>
        </div>
      </div>
    </section>
  );
}
