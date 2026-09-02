/**
 * BackupSection.tsx: Download of a backup archive and upload of one to restore.
 */

import { RefreshCw, Download, Upload, ArchiveRestore } from "lucide-react";

/**
 * BackupSection renders the backup card: a download button for the archive and
 * a hidden file input driven by the restore button.
 */
export function BackupSection({
  downloadBackup,
  restoring,
  restoreInputRef,
  onRestoreFile,
  t,
}: Readonly<{
  downloadBackup: () => void;
  restoring: boolean;
  restoreInputRef: React.RefObject<HTMLInputElement | null>;
  onRestoreFile: (file: File) => void;
  t: (key: string) => string;
}>) {
  return (
    <section className="glass-card rounded-none p-6 space-y-5">
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
          className="flex items-center gap-2 px-4 py-2 rounded-none bg-bg-secondary hover:bg-bg-hover text-sm text-text-primary border border-border-subtle transition-colors"
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
            if (f) onRestoreFile(f);
          }}
        />
        <button
          onClick={() => restoreInputRef.current?.click()}
          disabled={restoring}
          title={t("settings.tooltipRestore")}
          className="flex items-center gap-2 px-4 py-2 rounded-none bg-bg-secondary hover:bg-bg-hover text-sm text-text-primary border border-border-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
  );
}
