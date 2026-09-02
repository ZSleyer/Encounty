/**
 * OutputSection.tsx: File output card, meaning the OBS text files written to
 * disk and the folder they land in.
 */

import { FolderOpen, Monitor, Check } from "lucide-react";

import { Settings as SettingsType } from "../../types";
import { FolderPathInput } from "./FolderPathInput";
import { Toggle } from "../../components/shared/Toggle";

/**
 * OutputSection renders the file output card: the master toggle, the copyable
 * OBS path card and the output folder picker.
 */
export function OutputSection({
  settings,
  setSettings,
  obsPathCopied,
  copyObsPath,
  t,
}: Readonly<{
  settings: SettingsType;
  setSettings: (s: SettingsType) => void;
  obsPathCopied: boolean;
  copyObsPath: () => void;
  t: (key: string) => string;
}>) {
  return (
    <section className="glass-card rounded-none p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm 2xl:text-base font-semibold text-text-primary flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-accent-yellow" />
          {t("settings.sectionOutput")}
        </h2>
        <Toggle
          enabled={settings.output_enabled}
          onChange={() => setSettings({ ...settings, output_enabled: !settings.output_enabled })}
          label={t("settings.sectionOutput")}
          color="bg-accent-blue/80"
        />
      </div>

      <div
        className={`space-y-4 transition-all duration-300 ${settings.output_enabled ? "" : "opacity-30 pointer-events-none grayscale"}`}
      >
        {/* OBS file output info card, mimics ObsUrlCardButton on the dashboard. */}
        <button
          type="button"
          onClick={copyObsPath}
          title={settings.output_dir}
          aria-label={t("settings.obsCopyPath")}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-none bg-bg-card border border-border-subtle hover:border-accent-blue/40 hover:bg-accent-blue/5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-blue)"
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
              {settings.output_dir || "–"}
            </p>
            <p className="text-[10px] text-text-faint mt-0.5">{t("settings.obsFileOutputDesc")}</p>
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
  );
}
