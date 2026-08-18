/**
 * CaughtChoiceModal.tsx: asks what a catch means for a hunt that can phase.
 *
 * With a phasing method a shiny is not automatically the end of the hunt: it is
 * either the target (the hunt is done) or a foreign shiny that only ends the
 * current phase. Both look identical to the app, so the "Caught!" button asks
 * instead of guessing. The phase branch continues in EndPhaseModal, which is
 * where the caught species is picked; this dialog only routes.
 *
 * Every running hunt sees this dialog so the hunter decides whether the target
 * or an off-target shiny was caught.
 */
import { useRef, type ReactNode } from "react";
import { PartyPopper, Split } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { ModalShell } from "../shared/ModalShell";
import { HelpPopover } from "../shared/HelpPopover";

// --- Types ---

/** What the user says happened. */
export type CaughtChoice = "caught" | "phase";

/** Props for {@link CaughtChoiceModal}. */
export interface CaughtChoiceModalProps {
  /** Name of the hunted species, shown in the "target caught" option. */
  readonly targetName: string;
  /** Number of the phase that is currently running (1-based). */
  readonly phaseNumber: number;
  /** Called with the picked branch after the close transition finished. */
  readonly onChoose: (choice: CaughtChoice) => void;
  /** Called after the close transition finishes; unmount the modal here. */
  readonly onClose: () => void;
}

// --- Component ---

/**
 * Renders the two-way choice between completing the hunt and ending the phase.
 *
 * The choice is reported after the dialog has closed, so the follow-up dialog of
 * the phase branch never overlaps with this one.
 */
export function CaughtChoiceModal({
  targetName,
  phaseNumber,
  onChoose,
  onClose,
}: CaughtChoiceModalProps) {
  const { t } = useI18n();
  const choiceRef = useRef<CaughtChoice | null>(null);

  const handleClose = () => {
    onClose();
    if (choiceRef.current) onChoose(choiceRef.current);
  };

  const pick = (choice: CaughtChoice, requestClose: () => void) => {
    choiceRef.current = choice;
    requestClose();
  };

  return (
    <ModalShell title={t("caughtChoice.title")} onClose={handleClose} size="md">
      {(requestClose) => (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2">
            <p className="text-sm text-text-muted">
              {t("caughtChoice.intro", { number: phaseNumber })}
            </p>
            <HelpPopover
              label={t("aria.phaseHelp")}
              title={t("phase.helpTitle")}
              align="right"
            >
              {t("phase.helpText")}
            </HelpPopover>
          </div>

          <ChoiceButton
            initialFocus
            icon={<PartyPopper className="h-4 w-4 text-accent-blue" aria-hidden="true" />}
            title={t("caughtChoice.target", { name: targetName })}
            description={t("caughtChoice.targetHint")}
            onClick={() => pick("caught", requestClose)}
          />
          <ChoiceButton
            icon={<Split className="h-4 w-4 text-accent-purple" aria-hidden="true" />}
            title={t("caughtChoice.phase")}
            description={t("caughtChoice.phaseHint")}
            onClick={() => pick("phase", requestClose)}
          />

          <button
            type="button"
            onClick={requestClose}
            className="mt-1 self-center rounded-none px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
          >
            {t("common.cancel")}
          </button>
        </div>
      )}
    </ModalShell>
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
}

/** One branch of the choice: icon, headline and a one-line consequence. */
function ChoiceButton({ icon, title, description, onClick, initialFocus }: ChoiceButtonProps) {
  return (
    <button
      data-autofocus={initialFocus ? true : undefined}
      type="button"
      onClick={onClick}
      className="t-cut flex w-full items-start gap-3 rounded-none border border-border-subtle bg-bg-secondary p-3 text-left transition-colors hover:border-accent-blue/50 hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-semibold text-text-primary">{title}</span>
        <span className="text-[11px] leading-relaxed text-text-muted">{description}</span>
      </span>
    </button>
  );
}
