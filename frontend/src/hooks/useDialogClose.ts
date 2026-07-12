/**
 * useDialogClose.ts — Plays the native <dialog> close transition (the CRT
 * collapse defined on `dialog` in index.css) before the component actually
 * unmounts.
 *
 * Calling `dialogRef.current?.close()` and the parent's `onClose` prop in the
 * same tick (the previous pattern everywhere) makes React remove the dialog
 * from the DOM before the browser paints a single transition frame — CSS
 * alone can't animate an element that's already gone. This hook defers
 * `onClose` until the close transition actually finishes (or a safety
 * timeout fires, in case a property never transitions — e.g. an already-hidden
 * dialog, or a browser that doesn't fire the event for some reason).
 */
import { useCallback, type RefObject } from "react";

/** Matches the clip-path transition duration on `dialog` in index.css. */
const CLOSE_TRANSITION_FALLBACK_MS = 320;

/**
 * Returns a close handler: closes the dialog, waits for its clip-path
 * transition to finish, then calls `onClose`. Safe to call even if the
 * dialog is already closed or unmounted.
 */
export function useDialogClose(
  dialogRef: RefObject<HTMLDialogElement | null>,
  onClose: () => void,
): () => void {
  return useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog || !dialog.open) {
      onClose();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      dialog.removeEventListener("transitionend", onEnd);
      clearTimeout(timer);
      onClose();
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.target === dialog && e.propertyName === "clip-path") finish();
    };
    dialog.addEventListener("transitionend", onEnd);
    const timer = setTimeout(finish, CLOSE_TRANSITION_FALLBACK_MS);
    dialog.close();
  }, [dialogRef, onClose]);
}
