import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";

interface SetTimerModalProps {
  readonly currentMs: number;
  readonly onSave: (ms: number) => void;
  readonly onClose: () => void;
}

/** Modal dialog to set the hunt timer to an exact value. */
export function SetTimerModal({ currentMs, onSave, onClose }: Readonly<SetTimerModalProps>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const hoursRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  const initH = Math.floor(currentMs / 3600000);
  const initM = Math.floor((currentMs % 3600000) / 60000);
  const initS = Math.floor((currentMs % 60000) / 1000);

  const [hours, setHours] = useState(initH);
  const [minutes, setMinutes] = useState(initM);
  const [seconds, setSeconds] = useState(initS);

  useEffect(() => {
    dialogRef.current?.showModal();
    hoursRef.current?.focus();
    hoursRef.current?.select();
  }, []);

  const handleCancel = () => {
    dialogRef.current?.close();
    onClose();
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleBackdropClick = (e: MouseEvent) => {
      if (e.target === dialog) handleCancel();
    };
    dialog.addEventListener("click", handleBackdropClick);
    return () => dialog.removeEventListener("click", handleBackdropClick);
  }, [handleCancel]);

  const handleSave = () => {
    const totalMs = Math.max(0, hours * 3600000 + minutes * 60000 + seconds * 1000);
    onSave(totalMs);
    handleCancel();
  };

  const inputClass = "w-full bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2 text-lg text-text-primary outline-none focus:border-accent-blue/50 transition-colors tabular-nums";

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      className="m-auto bg-bg-card border border-border-subtle rounded-2xl p-6 w-full max-w-sm animate-slide-in backdrop:bg-black/70"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-text-primary">
          {t("timer.editTitle")}
        </h2>
        <button
          onClick={handleCancel}
          className="text-text-muted hover:text-text-primary transition-colors"
          aria-label={t("aria.close")}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <div>
          <label htmlFor="timer-hours" className="block text-xs text-text-muted mb-1">
            {t("timer.hours")}
          </label>
          <input
            ref={hoursRef}
            id="timer-hours"
            type="number"
            min={0}
            value={hours}
            onChange={(e) => setHours(Math.max(0, Number.parseInt(e.target.value, 10) || 0))}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } }}
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
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } }}
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
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } }}
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleCancel}
          className="flex-1 py-2 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:border-text-muted transition-colors text-sm"
        >
          {t("modal.cancel")}
        </button>
        <button
          onClick={handleSave}
          className="flex-1 py-2 rounded-lg bg-accent-blue hover:bg-accent-blue/80 text-white font-semibold text-sm transition-colors"
        >
          {t("modal.save")}
        </button>
      </div>
    </dialog>
  );
}
