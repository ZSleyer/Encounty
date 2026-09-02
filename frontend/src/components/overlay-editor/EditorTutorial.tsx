/**
 * EditorTutorial.tsx: the walkthrough of the Overlay Editor.
 *
 * It only owns the step list; the dimming, the cutout, the focus trap and the
 * step announcement live in the shared TutorialOverlay. Steps address their
 * target through the `data-tutorial` attribute placed on the container they
 * point at.
 *
 * Some steps talk about rows that the property panel only renders for a
 * specific layer, for instance the affix fields of a value layer or the sprite's
 * phase cycling. Those steps name that layer in `select`, and the editor
 * switches to it before the step is measured.
 *
 * Other steps talk about something that only exists inside a dialog: the
 * template list and the color editor. Those steps name it in `modal`, and the
 * editor opens a read-only copy of that dialog for the duration of the step.
 */
import { useCallback, useEffect, useRef } from "react";
import { TutorialOverlay, type TutorialStep } from "../shared/TutorialOverlay";
import type { ElementKey } from "../../utils/overlayElements";

/** Dialog a step points into. The editor opens it while the step is shown. */
export type EditorTutorialModal = "templates" | "text-color";

type Props = Readonly<{
  onComplete: () => void;
  /** Selects the layer a step needs so the rows it points at exist. */
  onSelectElement?: (key: ElementKey) => void;
  /**
   * Opens the dialog a step points into, or closes the open one when passed
   * null. The editor answers with a copy that cannot write anything back.
   */
  onOpenModal?: (modal: EditorTutorialModal | null) => void;
}>;

/** A walkthrough step, optionally tied to the layer or dialog holding its target. */
interface EditorTutorialStep extends TutorialStep {
  /** Layer the editor selects before this step is shown. */
  readonly select?: ElementKey;
  /** Dialog the editor opens before this step is shown. */
  readonly modal?: EditorTutorialModal;
}

const STEPS: readonly EditorTutorialStep[] = [
  {
    target: "canvas",
    titleKey: "editorTutorial.step1Title",
    textKey: "editorTutorial.step1Text",
  },
  {
    target: "template-list",
    titleKey: "editorTutorial.step2Title",
    textKey: "editorTutorial.step2Text",
    modal: "templates",
  },
  {
    target: "layers",
    titleKey: "editorTutorial.step3Title",
    textKey: "editorTutorial.step3Text",
  },
  {
    target: "properties",
    titleKey: "editorTutorial.step4Title",
    textKey: "editorTutorial.step4Text",
    select: "counter",
  },
  {
    target: "text-style",
    titleKey: "editorTutorial.step5Title",
    textKey: "editorTutorial.step5Text",
    select: "counter",
  },
  {
    target: "text-color-type",
    titleKey: "editorTutorial.step6Title",
    textKey: "editorTutorial.step6Text",
    select: "counter",
    modal: "text-color",
  },
  {
    target: "affixes",
    titleKey: "editorTutorial.step7Title",
    textKey: "editorTutorial.step7Text",
    select: "counter",
  },
  {
    target: "sprite-cycle",
    titleKey: "editorTutorial.step8Title",
    textKey: "editorTutorial.step8Text",
    select: "sprite",
  },
  {
    target: "toolbar",
    titleKey: "editorTutorial.step9Title",
    textKey: "editorTutorial.step9Text",
  },
];

/** Step-based walkthrough of the Overlay Editor. */
export function EditorTutorial({ onComplete, onSelectElement, onOpenModal }: Props) {
  // Skipping, finishing and Escape all unmount the walkthrough, so the dialog a
  // step opened is closed from the cleanup rather than from each exit path.
  const openModalRef = useRef(onOpenModal);
  openModalRef.current = onOpenModal;
  useEffect(() => () => openModalRef.current?.(null), []);

  const handleStepChange = useCallback(
    (index: number) => {
      const { select, modal } = STEPS[index];
      if (select) onSelectElement?.(select);
      // Passed on every step, so leaving a modal step closes its dialog no
      // matter whether the user went forward or back.
      onOpenModal?.(modal ?? null);
    },
    [onSelectElement, onOpenModal],
  );

  return (
    <TutorialOverlay
      steps={STEPS}
      attribute="data-tutorial"
      namespace="editorTutorial"
      onStepChange={handleStepChange}
      onComplete={onComplete}
    />
  );
}
