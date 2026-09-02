import { AlertTriangle } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { ModalShell, ModalActions } from "./ModalShell";
import { type BackdropCloseMode } from "../../hooks/useModalDialog";

interface ConfirmModalProps {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly isDestructive?: boolean;
  /**
   * Backdrop close behavior, defaults to "click". Pass "none" where an
   * accidental click outside must not count as picking the cancel action.
   */
  readonly backdropClose?: BackdropCloseMode;
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
  backdropClose,
  onConfirm,
  onClose,
}: Readonly<ConfirmModalProps>) {
  const { t } = useI18n();

  return (
    <ModalShell
      title={title}
      onClose={onClose}
      backdropClose={backdropClose}
      destructive={isDestructive}
      titleIcon={isDestructive ? <AlertTriangle className="w-5 h-5 text-accent-red" /> : undefined}
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
