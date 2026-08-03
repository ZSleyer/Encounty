/**
 * DetectorTutorial.tsx: the walkthrough of the Auto-Detection panel.
 *
 * It only owns the step list; the dimming, the cutout, the focus trap and the
 * step announcement live in the shared TutorialOverlay. Steps address their
 * target through the `data-detector-tutorial` attribute placed on the container
 * they point at.
 */
import { TutorialOverlay, type TutorialStep } from "../shared/TutorialOverlay";

type Props = Readonly<{
  onComplete: () => void;
}>;

const STEPS: readonly TutorialStep[] = [
  {
    target: "source",
    titleKey: "detectorTutorial.step1Title",
    textKey: "detectorTutorial.step1Text",
  },
  {
    target: "preview",
    titleKey: "detectorTutorial.step2Title",
    textKey: "detectorTutorial.step2Text",
  },
  {
    target: "templates",
    titleKey: "detectorTutorial.step3Title",
    textKey: "detectorTutorial.step3Text",
  },
  {
    target: "settings",
    titleKey: "detectorTutorial.step4Title",
    textKey: "detectorTutorial.step4Text",
  },
  {
    target: "controls",
    titleKey: "detectorTutorial.step5Title",
    textKey: "detectorTutorial.step5Text",
  },
];

/** Step-based walkthrough of the Auto-Detection panel. */
export function DetectorTutorial({ onComplete }: Props) {
  return (
    <TutorialOverlay
      steps={STEPS}
      attribute="data-detector-tutorial"
      namespace="detectorTutorial"
      onComplete={onComplete}
    />
  );
}
