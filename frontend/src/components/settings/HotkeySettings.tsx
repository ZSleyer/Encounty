import { useState, useEffect, useCallback, useRef } from "react";
import { HotkeyMap } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { apiUrl } from "../../utils/api";
import { useHotkeyRecorder } from "../../hooks/useHotkeyRecorder";
import { HOTKEY_ACTIONS, HotkeyRejection, readRejection, writeHotkey } from "./hotkeyActions";
import { HotkeyRecordingBanner, HotkeyRow, HotkeyRowMessage } from "./HotkeyRow";

interface HotkeySettingsProps {
  hotkeys: HotkeyMap;
  onUpdate: (hk: HotkeyMap) => void;
}

/** A refused write, pinned to the row that caused it. */
type RowFeedback = HotkeyRejection & { action: keyof HotkeyMap };

/**
 * HotkeySettings binds the five global hotkeys that act on whichever hunt or
 * group is the current target.
 */
export function HotkeySettings({ hotkeys, onUpdate }: Readonly<HotkeySettingsProps>) {
  const { t } = useI18n();
  const [local, setLocal] = useState<HotkeyMap>(hotkeys);
  const [feedback, setFeedback] = useState<RowFeedback | null>(null);
  const [hotkeyAvailable, setHotkeyAvailable] = useState<boolean | null>(null);
  const recordButtons = useRef(new Map<string, HTMLButtonElement | null>());

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

  const commitRecording = useCallback(
    async (action: keyof HotkeyMap, combo: string) => {
      setFeedback(null);
      const res = await writeHotkey(`/api/hotkeys/${action}`, combo);
      if (res.ok) {
        applyBinding(action, combo);
        return;
      }
      setFeedback({ action, ...(await readRejection(res, t)) });
    },
    [applyBinding, t],
  );

  const { recording, liveModifiers, start, cancel } =
    useHotkeyRecorder<keyof HotkeyMap>(commitRecording);

  const startRecording = (action: keyof HotkeyMap) => {
    setFeedback(null);
    start(action);
  };

  const deleteBinding = async (action: keyof HotkeyMap) => {
    setFeedback(null);
    const res = await writeHotkey(`/api/hotkeys/${action}`, "");
    if (!res.ok) return;
    // The clear button disappears with the binding, so hand focus to the
    // record button of the same row before it unmounts.
    recordButtons.current.get(action)?.focus();
    applyBinding(action, "");
  };

  const recordingLabel = HOTKEY_ACTIONS.find((a) => a.key === recording)?.labelKey ?? "";

  return (
    <div className="space-y-3">
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

      {HOTKEY_ACTIONS.map(({ key, labelKey }) => {
        const label = t(labelKey);
        const isRecording = recording === key;
        const currentCombo = local[key] ?? "";
        const conflictAction = currentCombo
          ? HOTKEY_ACTIONS.find(({ key: k }) => k !== key && local[k] === currentCombo)
          : undefined;

        return (
          <HotkeyRow
            key={key}
            label={label}
            combo={currentCombo}
            isRecording={isRecording}
            liveModifiers={liveModifiers}
            recordAriaLabel={t("hotkeys.recordFor", { name: label })}
            cancelAriaLabel={t("hotkeys.cancelFor", { name: label })}
            clearAriaLabel={t("hotkeys.deleteFor", { name: label })}
            recordTitle={t("hotkeys.tooltipRecord")}
            clearTitle={t("hotkeys.tooltipDelete")}
            onRecord={() => startRecording(key)}
            onCancel={cancel}
            onClear={() => deleteBinding(key)}
            recordButtonRef={(el) => {
              recordButtons.current.set(key, el);
            }}
            message={renderRowMessage({
              feedback: feedback?.action === key ? feedback : null,
              conflictText: conflictAction
                ? t("hotkeys.conflict", { action: t(conflictAction.labelKey) })
                : null,
            })}
          />
        );
      })}

      {recording && (
        <HotkeyRecordingBanner entryName={t(recordingLabel)} liveModifiers={liveModifiers} />
      )}
    </div>
  );
}

/**
 * Picks the message for one row. A refused write outranks the advisory local
 * duplicate warning, because it is the newer and the actionable one.
 */
function renderRowMessage({
  feedback,
  conflictText,
}: Readonly<{ feedback: HotkeyRejection | null; conflictText: string | null }>) {
  if (feedback) return <HotkeyRowMessage conflict={feedback.conflict} text={feedback.text} />;
  if (conflictText) return <HotkeyRowMessage conflict text={conflictText} />;
  return null;
}
