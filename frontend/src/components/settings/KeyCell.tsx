/**
 * KeyCell.tsx, the presentational pieces both hotkey sections render: the
 * single-button key cell, the inline message below a row and the visually
 * hidden live region that announces a running capture. Sharing them keeps the
 * global and the per-hunt section one consistent editor.
 */
import { useRef } from "react";
import { X } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { KeyCombo } from "../shared/KeyCombo";

// --- Key cell ---

/** Props of one bindable slot. */
export interface KeyCellProps {
  /** Current combo, or an empty string when unbound. */
  combo: string;
  isRecording: boolean;
  /** Modifiers held right now while this cell captures, e.g. "Ctrl+Shift". */
  liveModifiers: string;
  /**
   * What the cell binds, e.g. "+1 Encounter for Pikachu". It prefixes every
   * accessible name, because a bare combo says nothing about its target.
   */
  name: string;
  onStart: () => void;
  onCancel: () => void;
  onClear: () => void;
  /** Id of the inline message that belongs to this cell, if one is shown. */
  messageId?: string;
  /** True while that message reports a refused write. */
  hasError?: boolean;
}

/** Border and background of the cell for its current state. */
function cellStateClass(isRecording: boolean, hasError: boolean): string {
  if (isRecording) return "bg-accent-blue/10 border-accent-blue text-accent-blue";
  if (hasError) return "bg-bg-primary border-accent-red";
  return "bg-bg-primary border-border-input hover:border-border-default";
}

/**
 * KeyCell is one bindable slot as a single fixed-width button: it shows the
 * combo as keycaps, starts a capture on click, Enter or Space and clears the
 * binding on Delete or Backspace. A small clear button sits inside the cell
 * only while something is bound. The fixed width keeps every column of the
 * editor aligned, whether a slot is bound or not.
 */
export function KeyCell({
  combo,
  isRecording,
  liveModifiers,
  name,
  onStart,
  onCancel,
  onClear,
  messageId,
  hasError = false,
}: Readonly<KeyCellProps>) {
  const { t } = useI18n();
  const cellRef = useRef<HTMLButtonElement>(null);
  const isBound = combo !== "" && !isRecording;

  let valueText = combo || t("aria.hotkeyUnset");
  if (isRecording) valueText = t("hotkeys.recordingShort");

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    // While capturing, Delete and Backspace are keys to record, not commands.
    if (!isBound || (e.key !== "Delete" && e.key !== "Backspace")) return;
    e.preventDefault();
    onClear();
  };

  const handleClear = () => {
    // The clear button unmounts with the binding, so focus moves to the cell
    // first instead of falling back to the document.
    cellRef.current?.focus();
    onClear();
  };

  return (
    <div className="relative w-36 shrink-0">
      <button
        ref={cellRef}
        type="button"
        onClick={isRecording ? onCancel : onStart}
        onKeyDown={handleKeyDown}
        aria-label={t("hotkeys.cellLabel", { name, key: valueText })}
        aria-describedby={messageId}
        className={`w-full h-9 flex items-center gap-1.5 pl-2 ${isBound ? "pr-9" : "pr-2"} rounded-md border text-left overflow-hidden transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue ${cellStateClass(isRecording, hasError)}`}
      >
        <CellContent combo={combo} isRecording={isRecording} liveModifiers={liveModifiers} />
      </button>

      {isBound && (
        <button
          type="button"
          onClick={handleClear}
          aria-label={t("hotkeys.deleteFor", { name })}
          title={t("hotkeys.tooltipDelete")}
          className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-sm text-text-faint hover:text-accent-red hover:bg-bg-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Visible content of a cell. The accessible name already carries its text. */
function CellContent({
  combo,
  isRecording,
  liveModifiers,
}: Readonly<{ combo: string; isRecording: boolean; liveModifiers: string }>) {
  const { t } = useI18n();
  if (isRecording) {
    return (
      <>
        <span
          aria-hidden="true"
          className="w-1.5 h-1.5 rounded-full bg-accent-blue shrink-0 motion-safe:animate-pulse"
        />
        <span className="truncate text-xs 2xl:text-sm font-mono tabular-nums">
          {liveModifiers ? `${liveModifiers}+…` : t("hotkeys.recordingShort")}
        </span>
      </>
    );
  }
  if (combo) return <KeyCombo combo={combo} className="overflow-hidden" />;
  return (
    <span aria-hidden="true" className="text-xs 2xl:text-sm text-text-faint">
      –
    </span>
  );
}

// --- Messages ---

interface HotkeyRowMessageProps {
  /** Referenced by the cell's aria-describedby. */
  id?: string;
  /**
   * "error" is a refused write the user has to act on and is announced at
   * once. "warning" is an advisory state visible from the start, such as two
   * global actions sharing a key, and stays silent to not flood a page load.
   */
  tone: "error" | "warning";
  text: string;
}

/** Inline feedback below a row of the hotkey editor. */
export function HotkeyRowMessage({ id, tone, text }: Readonly<HotkeyRowMessageProps>) {
  if (tone === "error") {
    return (
      <p id={id} role="alert" className="text-xs 2xl:text-sm text-accent-red">
        {text}
      </p>
    );
  }
  return (
    <p id={id} className="text-xs 2xl:text-sm text-accent-yellow">
      <span aria-hidden="true">⚠ </span>
      {text}
    </p>
  );
}

// --- Live region ---

/**
 * Visually hidden status region announcing which slot is capturing. It stays
 * mounted while idle, because a live region that appears together with its
 * text is not reliably announced.
 */
export function HotkeyRecordingStatus({ name }: Readonly<{ name: string | null }>) {
  const { t } = useI18n();
  return (
    <p role="status" className="sr-only">
      {name ? `${t("hotkeys.pressKey", { action: name })}. ${t("hotkeys.escToCancel")}` : ""}
    </p>
  );
}
