/**
 * useModalDialog.ts — Shared lifecycle for native <dialog> modals: opens the
 * dialog via showModal() on mount, wires the CRT close transition
 * (useDialogClose), and installs the chosen backdrop-close behavior.
 * Replaces the showModal/backdrop-click effects that used to be copy-pasted
 * into every modal component.
 */
import { useEffect, useRef, type RefObject } from "react";
import { useDialogClose } from "./useDialogClose";

/**
 * How clicking/pressing outside the dialog panel closes the modal.
 *
 * - "click": close when a click lands on the dialog element itself (the
 *   backdrop area of a native <dialog>). The default.
 * - "mousedown-outside": close only when the press *originates* outside the
 *   dialog rectangle. Drag-safe: drags that start inside (e.g. on a color
 *   slider) and end over the backdrop do not close the modal.
 * - "none": outside clicks never close the modal (Escape still works).
 */
export type BackdropCloseMode = "click" | "mousedown-outside" | "none";

/** Options for {@link useModalDialog}. */
export interface UseModalDialogOptions {
  /** Called after the close transition finishes; unmount the modal here. */
  readonly onClose: () => void;
  /** Backdrop close behavior, defaults to "click". */
  readonly backdropClose?: BackdropCloseMode;
}

/** Return value of {@link useModalDialog}. */
export interface UseModalDialogResult {
  /** Attach to the <dialog> element. */
  readonly dialogRef: RefObject<HTMLDialogElement | null>;
  /** Closes the dialog with the CRT transition, then calls onClose. */
  readonly requestClose: () => void;
}

/**
 * Manages a native <dialog> modal: showModal() on mount, transition-aware
 * close handler, and backdrop-close listeners. Callers still render the
 * <dialog> themselves (or use ModalShell for the standard chrome) and should
 * pass `onCancel={requestClose}` so Escape routes through the same path.
 */
export function useModalDialog({
  onClose,
  backdropClose = "click",
}: UseModalDialogOptions): UseModalDialogResult {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestClose = useDialogClose(dialogRef, onClose);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || backdropClose === "none") return;

    if (backdropClose === "click") {
      // Imperative listener to avoid onClick on the non-interactive <dialog>.
      const handleBackdropClick = (e: MouseEvent) => {
        if (e.target === dialog) requestClose();
      };
      dialog.addEventListener("click", handleBackdropClick);
      return () => dialog.removeEventListener("click", handleBackdropClick);
    }

    // "mousedown-outside": only presses originating outside the panel close it.
    const handleDocMouseDown = (e: MouseEvent) => {
      const rect = dialog.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!inside) requestClose();
    };
    document.addEventListener("mousedown", handleDocMouseDown);
    return () => document.removeEventListener("mousedown", handleDocMouseDown);
  }, [backdropClose, requestClose]);

  return { dialogRef, requestClose };
}
