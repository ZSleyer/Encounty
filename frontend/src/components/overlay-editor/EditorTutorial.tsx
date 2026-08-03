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
 */
import { useCallback } from "react";
import { TutorialOverlay, type TutorialStep } from "../shared/TutorialOverlay";
import type { ElementKey } from "../../utils/overlayElements";

type Props = Readonly<{
  onComplete: () => void;
  /** Selects the layer a step needs so the rows it points at exist. */
  onSelectElement?: (key: ElementKey) => void;
}>;

/** A walkthrough step, optionally tied to the layer that renders its target. */
interface EditorTutorialStep extends TutorialStep {
  /** Layer the editor selects before this step is shown. */
  readonly select?: ElementKey;
}

const STEPS: readonly EditorTutorialStep[] = [
  {
    target: "canvas",
    titleKey: "editorTutorial.step1Title",
    textKey: "editorTutorial.step1Text",
  },
  {
    target: "templates",
    titleKey: "editorTutorial.step2Title",
    textKey: "editorTutorial.step2Text",
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
    target: "affixes",
    titleKey: "editorTutorial.step6Title",
    textKey: "editorTutorial.step6Text",
    select: "counter",
  },
  {
    target: "sprite-cycle",
    titleKey: "editorTutorial.step7Title",
    textKey: "editorTutorial.step7Text",
    select: "sprite",
  },
  {
    target: "toolbar",
    titleKey: "editorTutorial.step8Title",
    textKey: "editorTutorial.step8Text",
  },
];

/** Step-based walkthrough of the Overlay Editor. */
export function EditorTutorial({ onComplete, onSelectElement }: Props) {
  const handleStepChange = useCallback(
    (index: number) => {
      const select = STEPS[index].select;
      if (select) onSelectElement?.(select);
    },
    [onSelectElement],
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
