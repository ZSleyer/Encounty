import { useState } from "react";
import { useI18n } from "../../contexts/I18nContext";
import { ModalShell, ModalActions } from "./ModalShell";

interface SetTimerModalProps {
  readonly currentMs: number;
  readonly onSave: (ms: number) => void;
  readonly onClose: () => void;
}

/** Modal dialog to set the hunt timer to an exact value. */
export function SetTimerModal({ currentMs, onSave, onClose }: Readonly<SetTimerModalProps>) {
  const { t } = useI18n();

  const initH = Math.floor(currentMs / 3600000);
  const initM = Math.floor((currentMs % 3600000) / 60000);
  const initS = Math.floor((currentMs % 60000) / 1000);

  const [hours, setHours] = useState(initH);
  const [minutes, setMinutes] = useState(initM);
  const [seconds, setSeconds] = useState(initS);

  const totalMs = () => Math.max(0, hours * 3600000 + minutes * 60000 + seconds * 1000);

  const inputClass = "w-full bg-bg-secondary border border-border-subtle rounded-none px-3 py-2 text-lg text-text-primary outline-none focus:border-accent-blue/50 transition-colors tabular-nums";

  const saveOnEnter = (e: React.KeyboardEvent, requestClose: () => void) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSave(totalMs());
      requestClose();
    }
  };

  return (
    <ModalShell
      title={t("timer.editTitle")}
      onClose={onClose}
      size="sm"
      footer={(requestClose) => (
        <ModalActions
          onConfirm={() => onSave(totalMs())}
          requestClose={requestClose}
          confirmLabel={t("common.save")}
          cancelLabel={t("common.cancel")}
        />
      )}
    >
      {(requestClose: () => void) => (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label htmlFor="timer-hours" className="block text-xs text-text-muted mb-1">
              {t("timer.hours")}
            </label>
            <input
              autoFocus
              onFocus={(e) => e.target.select()}
              id="timer-hours"
              type="number"
              min={0}
              value={hours}
              onChange={(e) => setHours(Math.max(0, Number.parseInt(e.target.value, 10) || 0))}
              onKeyDown={(e) => saveOnEnter(e, requestClose)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="timer-minutes" className="block text-xs text-text-muted mb-1">
              {t("timer.minutes")}
            </label>
            <input
              id="timer-minutes"
              type="number"
              min={0}
              max={59}
              value={minutes}
              onChange={(e) => setMinutes(Math.min(59, Math.max(0, Number.parseInt(e.target.value, 10) || 0)))}
              onKeyDown={(e) => saveOnEnter(e, requestClose)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="timer-seconds" className="block text-xs text-text-muted mb-1">
              {t("timer.seconds")}
            </label>
            <input
              id="timer-seconds"
              type="number"
              min={0}
              max={59}
              value={seconds}
              onChange={(e) => setSeconds(Math.min(59, Math.max(0, Number.parseInt(e.target.value, 10) || 0)))}
              onKeyDown={(e) => saveOnEnter(e, requestClose)}
              className={inputClass}
            />
          </div>
        </div>
      )}
    </ModalShell>
  );
}
