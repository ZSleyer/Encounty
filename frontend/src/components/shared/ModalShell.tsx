/**
 * ModalShell.tsx — Standard chrome for native <dialog> modals: t-panel
 * skin, header with title + close button, optional footer, and the shared
 * open/close lifecycle from useModalDialog. ModalActions provides the
 * canonical cancel/confirm button pair.
 */
import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import {
  useModalDialog,
  type BackdropCloseMode,
} from "../../hooks/useModalDialog";

/** Panel width per size step. */
const SIZE_CLASSES = {
  xs: "max-w-xs",
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
} as const;

/** Props for {@link ModalShell}. */
export interface ModalShellProps {
  /** Visible dialog title; pass an already translated string. */
  readonly title: string;
  /** Called after the close transition finishes; unmount the modal here. */
  readonly onClose: () => void;
  /** Panel width, defaults to "md". */
  readonly size?: keyof typeof SIZE_CLASSES;
  /** Backdrop close behavior, defaults to "click". */
  readonly backdropClose?: BackdropCloseMode;
  /** Title text size: "lg" (default) or the compact "sm" used by editor modals. */
  readonly titleSize?: "sm" | "lg";
  /** Danger styling: t-panel--danger skin and red title. */
  readonly destructive?: boolean;
  /** Rendered before the title (e.g. a warning icon). */
  readonly titleIcon?: ReactNode;
  /**
   * Structured layout for large modals: zero panel padding, hairline
   * borders around header/footer, and a scrollable body row.
   */
  readonly structured?: boolean;
  /**
   * Footer content. Pass a function to receive requestClose, so confirm
   * buttons can run their action and then play the close transition.
   */
  readonly footer?: ReactNode | ((requestClose: () => void) => ReactNode);
  /** Body content; pass a function to receive requestClose (e.g. Enter-to-save). */
  readonly children: ReactNode | ((requestClose: () => void) => ReactNode);
}

/**
 * Renders a native <dialog> with the Tempest modal anatomy. Escape, backdrop
 * click, and the X button all route through the CRT close transition.
 */
export function ModalShell({
  title,
  onClose,
  size = "md",
  backdropClose = "click",
  titleSize = "lg",
  destructive = false,
  titleIcon,
  structured = false,
  footer,
  children,
}: ModalShellProps) {
  const { t } = useI18n();
  const titleId = useId();
  const { dialogRef, requestClose } = useModalDialog({ onClose, backdropClose });

  const footerContent = typeof footer === "function" ? footer(requestClose) : footer;
  const bodyContent = typeof children === "function" ? children(requestClose) : children;
  const titleScale = titleSize === "sm" ? "text-sm" : "text-lg";
  const titleColor = destructive ? "text-accent-red" : "text-text-primary";

  const header = (
    <div
      className={`flex items-center justify-between ${
        structured ? "px-6 py-4 border-b border-border-subtle" : "mb-4"
      }`}
    >
      <div className="flex items-center gap-2">
        {titleIcon}
        <h2 id={titleId} className={`${titleScale} font-bold ${titleColor}`}>
          {title}
        </h2>
      </div>
      <button
        onClick={requestClose}
        aria-label={t("aria.close")}
        className="relative after:absolute after:-inset-2 after:content-[''] text-text-muted hover:text-text-primary transition-colors"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );

  return (
    <dialog
      ref={dialogRef}
      onCancel={requestClose}
      aria-labelledby={titleId}
      className={`m-auto t-panel ${destructive ? "t-panel--danger " : ""}${
        structured
          ? "p-0 max-h-[85vh] grid grid-rows-[auto_1fr_auto]"
          : "p-6"
      } w-full ${SIZE_CLASSES[size]} backdrop:bg-black/70`}
    >
      {header}
      {structured ? (
        <div className="overflow-y-auto px-6 py-4">{bodyContent}</div>
      ) : (
        bodyContent
      )}
      {footerContent && (
        <div className={structured ? "px-6 py-4 border-t border-border-subtle" : "mt-6"}>
          {footerContent}
        </div>
      )}
    </dialog>
  );
}

/** Props for {@link ModalActions}. */
export interface ModalActionsProps {
  /** Runs on confirm, before the close transition starts. */
  readonly onConfirm: () => void;
  /** Close handler from the ModalShell footer function or useModalDialog. */
  readonly requestClose: () => void;
  /** Confirm button label, defaults to t("common.confirm"). */
  readonly confirmLabel?: string;
  /** Cancel button label, defaults to t("common.cancel"). */
  readonly cancelLabel?: string;
  /** Danger styling for the confirm button. */
  readonly destructive?: boolean;
  /** Disables the confirm button. */
  readonly confirmDisabled?: boolean;
}

/**
 * Canonical modal footer: cancel on the left, confirm on the right, both
 * stretched. Confirm runs onConfirm and then plays the close transition.
 */
export function ModalActions({
  onConfirm,
  requestClose,
  confirmLabel,
  cancelLabel,
  destructive = false,
  confirmDisabled = false,
}: ModalActionsProps) {
  const { t } = useI18n();
  return (
    <div className="flex gap-3">
      <button
        onClick={requestClose}
        className="flex-1 px-4 py-2 rounded-none border border-border-subtle text-text-muted hover:text-text-primary hover:border-text-muted transition-colors text-sm whitespace-nowrap"
      >
        {cancelLabel ?? t("common.cancel")}
      </button>
      <button
        onClick={() => {
          onConfirm();
          requestClose();
        }}
        disabled={confirmDisabled}
        className={`flex-1 px-4 py-2 t-cut rounded-none font-semibold text-sm transition-colors shadow-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${
          destructive
            ? "bg-accent-red/80 hover:bg-accent-red border border-accent-red/50 text-white"
            : "bg-accent-blue hover:bg-accent-blue/80 text-bg-primary"
        }`}
      >
        {confirmLabel ?? t("common.confirm")}
      </button>
    </div>
  );
}
