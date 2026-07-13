import { AlertTriangle } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { ModalShell, ModalActions } from "./ModalShell";

interface ConfirmModalProps {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly isDestructive?: boolean;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}

/** Generic confirmation dialog with optional destructive styling. */
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

  return (
    <ModalShell
      title={title}
      onClose={onClose}
      destructive={isDestructive}
      titleIcon={
        isDestructive ? <AlertTriangle className="w-5 h-5 text-accent-red" /> : undefined
      }
      footer={(requestClose) => (
        <ModalActions
          onConfirm={onConfirm}
          requestClose={requestClose}
          confirmLabel={confirmLabel ?? t("common.confirm")}
          cancelLabel={cancelLabel ?? t("common.cancel")}
          destructive={isDestructive}
        />
      )}
    >
      <p className="text-sm text-text-secondary">{message}</p>
    </ModalShell>
  );
}
