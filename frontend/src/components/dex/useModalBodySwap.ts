/**
 * useModalBodySwap.ts: close-then-reopen bookkeeping for the override modal.
 *
 * A native `<dialog>` close is animated, so a control that wants to replace the
 * modal's body with another dialog cannot simply mount that one: the two would
 * stack. Instead the control asks the current dialog to close and records why,
 * and the recorded reason is what the shell's own onClose acts on once the
 * transition has finished.
 */
import { useRef } from "react";

/** What each recorded close reason should do once the dialog has closed. */
export interface ModalBodySwapTargets {
  /** Show the catch-metadata editor. */
  readonly onDetails: () => void;
  /** Show the removal confirmation. */
  readonly onConfirmRemove: () => void;
  /** Show the full hunt editor. */
  readonly onFullEditor: () => void;
  /** Show the editor of the phase draft with this key. */
  readonly onPhase: (key: string) => void;
  /** Close for good; no swap was pending. */
  readonly onClose: () => void;
}

/** The openers a body-swapping modal wires to its controls, plus its shell handler. */
export interface ModalBodySwap {
  readonly openDetails: (requestClose: () => void) => void;
  readonly openConfirmRemove: (requestClose: () => void) => void;
  readonly openFullEditor: (requestClose: () => void) => void;
  readonly openPhase: (key: string, requestClose: () => void) => void;
  readonly handleShellClose: () => void;
}

/**
 * Turns "open that other dialog" into "close this one, then open it".
 *
 * Each opener marks its pending reason and asks the shell to close;
 * {@link ModalBodySwap.handleShellClose} consumes at most one pending reason
 * and falls through to `onClose` when none is set, which is what makes Escape,
 * the backdrop and the header button still close the modal for good.
 */
export function useModalBodySwap(targets: ModalBodySwapTargets): ModalBodySwap {
  const pendingDetailsRef = useRef(false);
  const pendingConfirmRef = useRef(false);
  const pendingFullEditorRef = useRef(false);
  const pendingPhaseRef = useRef<string | null>(null);

  return {
    openDetails: (requestClose: () => void) => {
      pendingDetailsRef.current = true;
      requestClose();
    },
    openConfirmRemove: (requestClose: () => void) => {
      pendingConfirmRef.current = true;
      requestClose();
    },
    openFullEditor: (requestClose: () => void) => {
      pendingFullEditorRef.current = true;
      requestClose();
    },
    openPhase: (key: string, requestClose: () => void) => {
      pendingPhaseRef.current = key;
      requestClose();
    },
    handleShellClose: () => {
      if (pendingDetailsRef.current) {
        pendingDetailsRef.current = false;
        targets.onDetails();
        return;
      }
      if (pendingConfirmRef.current) {
        pendingConfirmRef.current = false;
        targets.onConfirmRemove();
        return;
      }
      if (pendingFullEditorRef.current) {
        pendingFullEditorRef.current = false;
        targets.onFullEditor();
        return;
      }
      if (pendingPhaseRef.current) {
        const key = pendingPhaseRef.current;
        pendingPhaseRef.current = null;
        targets.onPhase(key);
        return;
      }
      targets.onClose();
    },
  };
}
