/**
 * HotkeyRow.tsx, the presentational pieces both hotkey sections render: one
 * binding row, the compact slot the per-hunt section stacks under an entry
 * name, the inline message below either of them and the "press a key" banner.
 * They live here so the global and the per-hunt section read as one page.
 */
import { Ref, ReactNode } from "react";
import { X } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";

// --- Shared bits ---

/** Colour of the leading status dot: recording, bound, or unbound. */
function dotClass(isRecording: boolean, hasCombo: boolean): string {
  if (isRecording) return "bg-accent-blue animate-pulse";
  return hasCombo ? "bg-accent-green" : "bg-border-subtle";
}

/** What the kbd shows: the live combo while recording, else the binding. */
function comboText(isRecording: boolean, liveModifiers: string, combo: string): string {
  if (isRecording) return liveModifiers ? `${liveModifiers}+…` : "…";
  return combo || "–";
}

/** Everything a binding needs apart from its label and its inline message. */
export interface HotkeyBindingProps {
  /** Current combo, or an empty string when unbound. */
  combo: string;
  isRecording: boolean;
  liveModifiers: string;
  /** Accessible names. Each has to name the binding, not just the verb. */
  recordAriaLabel: string;
  cancelAriaLabel: string;
  clearAriaLabel: string;
  recordTitle: string;
  clearTitle: string;
  onRecord: () => void;
  onCancel: () => void;
  onClear: () => void;
  /**
   * Ref on the record button. Clearing a binding removes the clear button that
   * was just activated, so the caller moves focus here instead of losing it.
   */
  recordButtonRef?: Ref<HTMLButtonElement>;
}

/**
 * The controls of one binding: the current combo, the record/cancel button and,
 * once something is bound, the clear button. Shared by the full-width row and
 * the compact per-entry slot so both keep the same targets and styling.
 */
export function HotkeyBindingControls({
  combo,
  isRecording,
  liveModifiers,
  recordAriaLabel,
  cancelAriaLabel,
  clearAriaLabel,
  recordTitle,
  clearTitle,
  onRecord,
  onCancel,
  onClear,
  recordButtonRef,
}: Readonly<HotkeyBindingProps>) {
  const { t } = useI18n();
  const showsUnsetHint = combo === "" && !isRecording;

  return (
    <div className="flex items-center gap-2 shrink-0">
      <kbd
        className={`px-2 py-1 border rounded-sm text-xs 2xl:text-sm font-mono min-w-18 2xl:min-w-21 text-center ${
          isRecording
            ? "bg-accent-blue/10 border-accent-blue/30 text-accent-blue"
            : "bg-bg-primary border-border-subtle text-text-secondary"
        }`}
      >
        {comboText(isRecording, liveModifiers, combo)}
      </kbd>
      {/* A bare dash carries no meaning when read out, so spell it out. */}
      {showsUnsetHint ? <span className="sr-only">{t("aria.hotkeyUnset")}</span> : null}

      <button
        type="button"
        ref={recordButtonRef}
        onClick={() => (isRecording ? onCancel() : onRecord())}
        aria-label={isRecording ? cancelAriaLabel : recordAriaLabel}
        title={isRecording ? t("tooltip.common.cancel") : recordTitle}
        className={`px-3 py-1 2xl:px-4 2xl:py-1.5 rounded-sm text-xs 2xl:text-sm transition-colors ${
          isRecording
            ? "bg-accent-blue/20 text-accent-blue border border-accent-blue/30"
            : "bg-bg-hover text-text-secondary hover:text-text-primary"
        }`}
      >
        {isRecording ? t("hotkeys.cancel") : t("hotkeys.record")}
      </button>

      {combo && !isRecording ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={clearAriaLabel}
          className="p-1 rounded-sm text-text-faint hover:text-accent-red transition-colors"
          title={clearTitle}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      ) : null}
    </div>
  );
}

// --- Full-width row ---

interface HotkeyRowProps extends HotkeyBindingProps {
  /** Visible name of the action, hunt or group this row binds. */
  label: string;
  /** Inline message rendered below the row, e.g. a conflict warning. */
  message?: ReactNode;
}

/**
 * One hotkey binding row: status dot, label, current combo, a record button
 * and, once something is bound, a clear button.
 */
export function HotkeyRow({ label, message, ...binding }: Readonly<HotkeyRowProps>) {
  return (
    <div className="space-y-1">
      <div
        className={`flex items-center justify-between bg-bg-secondary rounded-lg px-4 py-3 border transition-colors ${
          binding.isRecording ? "border-accent-blue/50" : "border-transparent"
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${dotClass(binding.isRecording, !!binding.combo)}`}
          />
          <span className="text-sm 2xl:text-base text-text-secondary">{label}</span>
        </div>

        <HotkeyBindingControls {...binding} />
      </div>

      {message}
    </div>
  );
}

// --- Compact slot ---

interface HotkeySlotProps extends HotkeyBindingProps {
  /** Name of the action this slot binds, e.g. "+1 Encounter". */
  actionLabel: string;
  /** Inline message rendered below the slot, e.g. a conflict warning. */
  message?: ReactNode;
}

/**
 * One action slot inside an entry card. It carries no background of its own:
 * several of them stack under a single entry name, so the card is what reads as
 * the block and the slot only needs to stay scannable and compact.
 */
export function HotkeySlot({ actionLabel, message, ...binding }: Readonly<HotkeySlotProps>) {
  return (
    <div className="space-y-1">
      {/* Wrapping instead of shrinking: on a narrow screen the controls drop
          under the action label rather than truncating it away. */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 py-1">
        <span className="flex items-center gap-3">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${dotClass(binding.isRecording, !!binding.combo)}`}
          />
          <span className="text-xs 2xl:text-sm text-text-secondary">{actionLabel}</span>
        </span>

        <HotkeyBindingControls {...binding} />
      </div>

      {message}
    </div>
  );
}

// --- Messages ---

interface HotkeyRowMessageProps {
  /** True when another entry already holds the combo. */
  conflict: boolean;
  text: string;
}

/**
 * Inline feedback under a row. A taken combo is an advisory status, any other
 * refusal is an error the user has to act on, so the two get different roles.
 */
export function HotkeyRowMessage({ conflict, text }: Readonly<HotkeyRowMessageProps>) {
  if (conflict) {
    return (
      <p role="status" aria-live="polite" className="text-xs 2xl:text-sm text-accent-yellow ml-4">
        ⚠ {text}
      </p>
    );
  }
  return (
    <p role="alert" className="text-xs 2xl:text-sm text-accent-red ml-4">
      {text}
    </p>
  );
}

/**
 * Banner shown while a row is capturing, naming the entry being bound and the
 * modifiers held so far.
 */
export function HotkeyRecordingBanner({
  entryName,
  liveModifiers,
}: Readonly<{ entryName: string; liveModifiers: string }>) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-4 p-3 bg-accent-blue/10 border border-accent-blue/20 rounded-lg"
    >
      <p className="text-sm 2xl:text-base text-accent-blue">
        ● {t("hotkeys.pressKey", { action: entryName })}
        {liveModifiers && (
          <span className="ml-2 font-mono text-text-primary">{liveModifiers}+…</span>
        )}
      </p>
      <p className="text-xs 2xl:text-sm text-text-secondary mt-1">{t("hotkeys.escToCancel")}</p>
    </div>
  );
}
