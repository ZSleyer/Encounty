/**
 * FailedChoiceModal.tsx: asks what a failed encounter means for a hunt that can phase.
 *
 * With a phasing method a failed shiny is not automatically the end of the
 * hunt: it is either the target getting away or a foreign shiny that only ends
 * the current phase. Both look identical to the app, so the "Failed" button
 * asks instead of guessing.
 *
 * The target branch asks once more, because a target that got away does not
 * have to end the hunt either. A roamer that fled, a target knocked out by
 * accident or a lost raid can be archived as a failed phase and the hunt
 * carries on. That second question only appears once the first one has been
 * answered, so the common case stays a two-way choice. The foreign shiny
 * branch continues in EndPhaseModal (rendered in its "failed" variant), which
 * is where the encountered species is picked; this dialog only routes.
 *
 * Every running hunt sees this dialog so the hunter decides what happened.
 * Structurally a copy of CaughtChoiceModal, styled with the red accent instead
 * of the caught flow's blue/positive one.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { RotateCcw, Split, XCircle } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { ModalShell } from "../shared/ModalShell";
import { HelpPopover } from "../shared/HelpPopover";

// --- Types ---

/**
 * What the user says happened.
 *
 * "target" ends the hunt, "phase" ends the phase with a foreign shiny, and
 * "targetPhase" archives the target itself as a failed phase and leaves the
 * hunt running.
 */
export type FailedChoice = "target" | "phase" | "targetPhase";

/** Which question the dialog is currently asking. */
type Step = "what" | "scope";

/** Props for {@link FailedChoiceModal}. */
export interface FailedChoiceModalProps {
  /** Name of the hunted species, shown in the "target failed" option. */
  readonly targetName: string;
  /** Number of the phase that is currently running (1-based). */
  readonly phaseNumber: number;
  /** Called with the picked branch after the close transition finished. */
  readonly onChoose: (choice: FailedChoice) => void;
  /** Called after the close transition finishes; unmount the modal here. */
  readonly onClose: () => void;
}

// --- Component ---

/**
 * Renders the two-way choice between the target and a foreign shiny, and the
 * follow-up question of how far the target's failure reaches.
 *
 * The choice is reported after the dialog has closed, so the follow-up dialog of
 * the foreign shiny branch never overlaps with this one.
 */
export function FailedChoiceModal({
  targetName,
  phaseNumber,
  onChoose,
  onClose,
}: FailedChoiceModalProps) {
  const { t } = useI18n();
  const choiceRef = useRef<FailedChoice | null>(null);
  const [step, setStep] = useState<Step>("what");
  const scopeFirstRef = useRef<HTMLButtonElement>(null);

  // ModalShell only focuses once, when the dialog opens, so the second step
  // has to claim the focus itself or it would stay on the button that is gone.
  useEffect(() => {
    if (step === "scope") scopeFirstRef.current?.focus();
  }, [step]);

  const handleClose = () => {
    onClose();
    if (choiceRef.current) onChoose(choiceRef.current);
  };

  const pick = (choice: FailedChoice, requestClose: () => void) => {
    choiceRef.current = choice;
    requestClose();
  };

  return (
    <ModalShell
      title={step === "what" ? t("failChoice.title") : t("failChoice.scopeTitle")}
      onClose={handleClose}
      size="md"
    >
      {(requestClose) => (
        <div className="flex flex-col gap-3">
          {step === "what" ? (
            <WhatStep
              targetName={targetName}
              phaseNumber={phaseNumber}
              onTarget={() => setStep("scope")}
              onForeignShiny={() => pick("phase", requestClose)}
            />
          ) : (
            <ScopeStep
              targetName={targetName}
              firstButtonRef={scopeFirstRef}
              onPhaseOnly={() => pick("targetPhase", requestClose)}
              onWholeHunt={() => pick("target", requestClose)}
            />
          )}

          <button
            type="button"
            onClick={step === "what" ? requestClose : () => setStep("what")}
            className="mt-1 self-center rounded-none px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-red"
          >
            {step === "what" ? t("common.cancel") : t("common.back")}
          </button>
        </div>
      )}
    </ModalShell>
  );
}

// --- Steps ---

interface WhatStepProps {
  readonly targetName: string;
  readonly phaseNumber: number;
  readonly onTarget: () => void;
  readonly onForeignShiny: () => void;
}

/** First question: was it the target or a foreign shiny. */
function WhatStep({ targetName, phaseNumber, onTarget, onForeignShiny }: WhatStepProps) {
  const { t } = useI18n();
  return (
    <>
      <div className="flex items-start gap-2">
        <p className="text-sm text-text-muted">{t("failChoice.intro", { number: phaseNumber })}</p>
        <HelpPopover label={t("aria.phaseHelp")} title={t("phase.helpTitle")} align="right">
          {t("phase.helpText")}
        </HelpPopover>
      </div>

      <ChoiceButton
        initialFocus
        icon={<XCircle className="h-4 w-4 text-accent-red" aria-hidden="true" />}
        title={t("failChoice.target", { name: targetName })}
        description={t("failChoice.targetHint")}
        onClick={onTarget}
      />
      <ChoiceButton
        icon={<Split className="h-4 w-4 text-accent-red" aria-hidden="true" />}
        title={t("failChoice.phase")}
        description={t("failChoice.phaseHint")}
        onClick={onForeignShiny}
      />
    </>
  );
}

interface ScopeStepProps {
  readonly targetName: string;
  readonly firstButtonRef: RefObject<HTMLButtonElement | null>;
  readonly onPhaseOnly: () => void;
  readonly onWholeHunt: () => void;
}

/** Second question: does the escaped target end the phase or the whole hunt. */
function ScopeStep({ targetName, firstButtonRef, onPhaseOnly, onWholeHunt }: ScopeStepProps) {
  const { t } = useI18n();
  return (
    <>
      <p className="text-sm text-text-muted">{t("failChoice.scopeIntro", { name: targetName })}</p>

      <ChoiceButton
        buttonRef={firstButtonRef}
        icon={<RotateCcw className="h-4 w-4 text-accent-red" aria-hidden="true" />}
        title={t("failChoice.scopePhase")}
        description={t("failChoice.scopePhaseHint")}
        onClick={onPhaseOnly}
      />
      <ChoiceButton
        icon={<XCircle className="h-4 w-4 text-accent-red" aria-hidden="true" />}
        title={t("failChoice.scopeHunt")}
        description={t("failChoice.scopeHuntHint")}
        onClick={onWholeHunt}
      />
    </>
  );
}

// --- Choice button ---

interface ChoiceButtonProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly onClick: () => void;
  /** Marks this button as the element ModalShell focuses after showModal(). */
  readonly initialFocus?: boolean;
  /** Lets a step focus this button itself when it is not the first render. */
  readonly buttonRef?: RefObject<HTMLButtonElement | null>;
}

/** One branch of the choice: icon, headline and a one-line consequence. */
function ChoiceButton({
  icon,
  title,
  description,
  onClick,
  initialFocus,
  buttonRef,
}: ChoiceButtonProps) {
  return (
    <button
      ref={buttonRef}
      data-autofocus={initialFocus ? true : undefined}
      type="button"
      onClick={onClick}
      className="t-cut flex w-full items-start gap-3 rounded-none border border-border-subtle bg-bg-secondary p-3 text-left transition-colors hover:border-accent-red/50 hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-red"
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-semibold text-text-primary">{title}</span>
        <span className="text-[11px] leading-relaxed text-text-muted">{description}</span>
      </span>
    </button>
  );
}
