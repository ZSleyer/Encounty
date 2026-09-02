/**
 * CloseTabWarning.tsx: Guard against losing a running hunt to Ctrl+W.
 *
 * Only reachable in the browser build, where the app cannot veto a tab close
 * the way Electron can. It offers staying on the page or quitting the backend.
 */
import { useRef } from "react";
import { useI18n } from "../contexts/I18nContext";
import { ConfirmModal } from "../components/shared/ConfirmModal";

/** Confirmation modal shown when the user tries to close the tab via Ctrl+W / Cmd+W. */
export function CloseTabWarning({
  onStay,
  onQuit,
}: Readonly<{
  onStay: () => void;
  onQuit: () => void;
}>) {
  const { t } = useI18n();
  // ModalActions closes the dialog after running onConfirm, and closing is what
  // ConfirmModal reports as onClose. Here onClose carries a real action rather
  // than just dismissal, so quitting would otherwise also tell the app to stay.
  const quitting = useRef(false);
  return (
    <ConfirmModal
      title={t("app.closeWarning")}
      message={t("app.closeWarningDesc")}
      cancelLabel={t("app.closeWarningStay")}
      confirmLabel={t("app.closeWarningQuit")}
      isDestructive
      // Quitting the backend stops a running hunt, so a stray click on the
      // backdrop must not be one of the ways out of this dialog.
      backdropClose="none"
      onConfirm={() => {
        quitting.current = true;
        onQuit();
      }}
      onClose={() => {
        if (quitting.current) return;
        onStay();
      }}
    />
  );
}
