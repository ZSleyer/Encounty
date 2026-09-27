import { useState, useEffect, useCallback } from "react";
import { HotkeyMap } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { apiUrl } from "../../utils/api";
import { useHotkeyRecorder } from "../../hooks/useHotkeyRecorder";
import { HOTKEY_ACTIONS, readRejection, Translate, writeHotkey } from "./hotkeyActions";
import { HotkeyRecordingStatus, HotkeyRowMessage, KeyCell } from "./KeyCell";

interface HotkeySettingsProps {
  hotkeys: HotkeyMap;
  onUpdate: (hk: HotkeyMap) => void;
}

/** A refused write, pinned to the row that caused it. */
interface RowFeedback {
  action: keyof HotkeyMap;
  text: string;
}

/**
 * HotkeySettings binds the five global hotkeys that act on whichever hunt or
 * group is the current target. Each action is one row: its label and a single
 * key cell that records, shows and clears the binding.
 */
export function HotkeySettings({ hotkeys, onUpdate }: Readonly<HotkeySettingsProps>) {
  const { t } = useI18n();
  const [local, setLocal] = useState<HotkeyMap>(hotkeys);
  const [feedback, setFeedback] = useState<RowFeedback | null>(null);
  const [hotkeyAvailable, setHotkeyAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(apiUrl("/api/hotkeys/status"))
      .then((r) => r.json())
      .then((d) => setHotkeyAvailable(d.available))
      .catch(() => setHotkeyAvailable(false));
  }, []);

  const applyBinding = useCallback(
    (action: keyof HotkeyMap, combo: string) => {
      const updated = { ...local, [action]: combo };
      setLocal(updated);
      onUpdate(updated);
      globalThis.electronAPI?.syncHotkeys?.();
    },
    [local, onUpdate],
  );

  /** Writes one binding and pins a refusal to its row. */
  const write = useCallback(
    async (action: keyof HotkeyMap, combo: string) => {
      setFeedback(null);
      const res = await writeHotkey(`/api/hotkeys/${action}`, combo);
      if (res.ok) {
        applyBinding(action, combo);
        return;
      }
      setFeedback({ action, text: await readRejection(res, t) });
    },
    [applyBinding, t],
  );

  const { recording, liveModifiers, start, cancel } = useHotkeyRecorder<keyof HotkeyMap>(write);

  const startRecording = (action: keyof HotkeyMap) => {
    setFeedback(null);
    start(action);
  };

  const recordingLabel = HOTKEY_ACTIONS.find((a) => a.key === recording)?.labelKey;

  return (
    <div className="space-y-2">
      {hotkeyAvailable === false ? (
        <div className="mb-4 p-3 bg-accent-yellow/10 border border-accent-yellow/40 rounded-lg">
          <p className="text-xs text-accent-yellow">{t("hotkeys.unavailable")}</p>
          {globalThis.electronAPI?.platform === "linux" && (
            <p className="text-xs text-text-muted mt-1">
              {t("hotkeys.linuxHint").split("{cmd}")[0]}
              <code className="text-text-secondary">sudo usermod -aG input $USER</code>
              {t("hotkeys.linuxHint").split("{cmd}")[1]}
            </p>
          )}
        </div>
      ) : null}

      <ul className="space-y-1.5">
        {HOTKEY_ACTIONS.map(({ key, labelKey }) => {
          const label = t(labelKey);
          const isRecording = recording === key;
          const combo = local[key] ?? "";
          const message = rowMessage(
            feedback?.action === key ? feedback.text : null,
            duplicateOf(key, local),
            t,
          );
          const messageId = message ? `hotkey-msg-global-${key}` : undefined;

          return (
            <li
              key={key}
              className={`bg-bg-secondary rounded-lg px-3 py-1 border transition-colors ${
                isRecording ? "border-accent-blue/50" : "border-transparent"
              }`}
            >
              {/* Wrapping instead of shrinking: on a narrow screen the cell
                  drops under the label rather than squeezing it away. */}
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="text-sm text-text-secondary">{label}</span>
                <KeyCell
                  combo={combo}
                  isRecording={isRecording}
                  liveModifiers={isRecording ? liveModifiers : ""}
                  name={label}
                  onStart={() => startRecording(key)}
                  onCancel={cancel}
                  onClear={() => void write(key, "")}
                  messageId={messageId}
                  hasError={feedback?.action === key}
                />
              </div>
              {message && (
                <div className="mt-1">
                  <HotkeyRowMessage id={messageId} tone={message.tone} text={message.text} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <HotkeyRecordingStatus name={recordingLabel ? t(recordingLabel) : null} />
    </div>
  );
}

// --- Row messages ---

/** Label key of another global action that shares this action's combo. */
function duplicateOf(action: keyof HotkeyMap, map: HotkeyMap): string | null {
  const combo = map[action];
  if (!combo) return null;
  return HOTKEY_ACTIONS.find(({ key }) => key !== action && map[key] === combo)?.labelKey ?? null;
}

/**
 * Picks the message for one row. A refused write outranks the advisory local
 * duplicate warning, because it is the newer and the actionable one.
 */
function rowMessage(
  refusal: string | null,
  duplicateLabelKey: string | null,
  t: Translate,
): { tone: "error" | "warning"; text: string } | null {
  if (refusal) return { tone: "error", text: refusal };
  if (duplicateLabelKey) {
    return { tone: "warning", text: t("hotkeys.conflict", { action: t(duplicateLabelKey) }) };
  }
  return null;
}
