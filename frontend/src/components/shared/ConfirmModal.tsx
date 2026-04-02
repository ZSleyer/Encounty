import { useRef, useEffect } from "react";
import { X, AlertTriangle } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";

interface ConfirmModalProps {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly isDestructive?: boolean;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel,
  cancelLabel,
  isDestructive = false,
  onConfirm,
  onClose,
}: Readonly<ConfirmModalProps>) {
  const { t } = useI18n();
  const resolvedConfirm = confirmLabel ?? t("confirm.confirm");
  const resolvedCancel = cancelLabel ?? t("confirm.cancel");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const handleCancel = () => {
    dialogRef.current?.close();
    onClose();
  };

  // Close on backdrop click (imperative to avoid onClick on non-interactive <dialog>)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleBackdropClick = (e: MouseEvent) => {
      if (e.target === dialog) handleCancel();
    };
    dialog.addEventListener("click", handleBackdropClick);
    return () => dialog.removeEventListener("click", handleBackdropClick);
  }, [handleCancel]);

  const handleConfirm = () => {
    onConfirm();
    handleCancel();
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      className="m-auto bg-bg-card border border-border-subtle rounded-2xl p-6 w-full max-w-md animate-slide-in backdrop:bg-black/70"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {isDestructive && (
            <AlertTriangle className="w-5 h-5 text-accent-red" />
          )}
          <h2 className="text-lg font-bold text-text-primary">{title}</h2>
        </div>
        <button
          onClick={handleCancel}
          className="text-text-muted hover:text-text-primary transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <p className="text-sm text-text-secondary mb-6">{message}</p>

      <div className="flex gap-3">
        <button
          onClick={handleCancel}
          className="flex-1 px-4 py-2 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:border-text-muted transition-colors text-sm whitespace-nowrap"
        >
          {resolvedCancel}
        </button>
        <button
          onClick={handleConfirm}
          className={`flex-1 px-4 py-2 rounded-lg text-white font-semibold text-sm transition-colors shadow-sm whitespace-nowrap ${
            isDestructive
              ? "bg-accent-red/80 hover:bg-accent-red border border-accent-red/50"
              : "bg-accent-blue hover:bg-accent-blue/80"
          }`}
        >
          {resolvedConfirm}
        </button>
      </div>
    </dialog>
  );
}
