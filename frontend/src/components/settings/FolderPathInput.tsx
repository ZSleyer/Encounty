/**
 * FolderPathInput.tsx — reusable folder path input with native picker.
 *
 * Renders a text input for a folder path alongside a "Choose folder"
 * button that opens the Electron native folder picker. When running
 * outside of Electron (e.g. a plain browser during development), the
 * picker button is still rendered for layout parity but is disabled
 * with a tooltip explaining that the feature requires the desktop app.
 */
import type { JSX } from "react";
import { FolderOpen } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";

type FolderPathInputProps = Readonly<{
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  dialogTitle?: string;
  ariaLabel: string;
}>;

/**
 * Controlled folder path input with a native folder picker button.
 *
 * The picker delegates to `globalThis.electronAPI.openFolderDialog`.
 * When that API is unavailable (browser context), the button remains
 * visible but disabled so the layout stays consistent across environments.
 */
export function FolderPathInput(props: FolderPathInputProps): JSX.Element {
  const { t } = useI18n();
  // Capture the picker once so both the disabled check and the click
  // handler see the same reference; electronAPI is injected by preload.
  const picker = globalThis.electronAPI?.openFolderDialog;
  const pickerAvailable = typeof picker === "function";

  const handlePick = async (): Promise<void> => {
    if (!pickerAvailable) return;
    try {
      const result = await picker(props.dialogTitle);
      if (result) props.onChange(result);
    } catch {
      // Electron rarely rejects the folder dialog; swallow silently
      // to avoid surfacing transient IPC errors in the settings UI.
    }
  };

  const chooseLabel = t("settings.chooseFolder");
  const disabledTooltip = t("settings.electronOnly");

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        aria-label={props.ariaLabel}
        className="flex-1 bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2 text-sm 2xl:text-base text-text-primary placeholder-text-faint/50 outline-none focus:border-accent-blue/50 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-blue)"
      />
      <button
        type="button"
        onClick={handlePick}
        disabled={!pickerAvailable}
        aria-disabled={!pickerAvailable}
        aria-label={chooseLabel}
        title={pickerAvailable ? chooseLabel : disabledTooltip}
        className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-secondary hover:bg-bg-hover text-sm text-text-primary border border-border-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-blue)"
      >
        <FolderOpen className="w-4 h-4" />
        {chooseLabel}
      </button>
    </div>
  );
}
