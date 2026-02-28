import { useRef, useEffect } from "react";
import { X, AlertTriangle } from "lucide-react";

interface Props {
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
  confirmLabel = "Bestätigen",
  cancelLabel = "Abbrechen",
  isDestructive = false,
  onConfirm,
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const handleCancel = () => {
    dialogRef.current?.close();
    onClose();
  };

  const handleConfirm = () => {
    onConfirm();
    handleCancel();
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      className="m-auto bg-bg-card border border-border-subtle rounded-2xl p-6 w-full max-w-sm animate-slide-in backdrop:bg-black/70"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {isDestructive && <AlertTriangle className="w-5 h-5 text-red-500" />}
          <h2 className="text-lg font-bold text-white">{title}</h2>
        </div>
        <button
          onClick={handleCancel}
          className="text-gray-500 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <p className="text-sm text-gray-400 mb-6">{message}</p>

      <div className="flex gap-3">
        <button
          onClick={handleCancel}
          className="flex-1 py-2 rounded-lg border border-border-subtle text-gray-400 hover:text-white hover:border-gray-500 transition-colors text-sm"
        >
          {cancelLabel}
        </button>
        <button
          onClick={handleConfirm}
          className={`flex-1 py-2 rounded-lg text-white font-semibold text-sm transition-colors shadow-sm ${
            isDestructive
              ? "bg-red-500/80 hover:bg-red-600 border border-red-500/50"
              : "bg-accent-blue hover:bg-blue-500"
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
