/**
 * StepIndicator.tsx -- Progress indicator for the 5-step template flow.
 */
import React from "react";
import type { Phase } from "./templateEditorTypes";

/** Maps each phase to its step number (1-indexed). */
export function phaseToStep(phase: Phase): number {
  switch (phase) {
    case "video":
      return 1;
    case "replay":
      return 2;
    case "snapshot":
      return 3;
    case "test":
      return 4;
    case "confirm":
      return 5;
  }
}

/** Returns the label-text classes for a step based on active/done state. */
function getStepTextStyle(isActive: boolean, isDone: boolean): string {
  if (isActive) return "text-accent-blue";
  if (isDone) return "text-text-muted";
  return "text-text-faint";
}

/** Returns the number-badge classes for a step based on active/done state; done steps render as filled checkmarks (`.t-step.done .n` in the design system). */
function getStepBadgeStyle(isActive: boolean, isDone: boolean): string {
  if (isActive) return "border-accent-blue text-accent-blue";
  if (isDone) return "bg-accent-blue border-accent-blue text-bg-primary";
  return "border-border-subtle text-text-faint";
}

/** Visual step indicator showing progress through the 5-step template flow. */
export function StepIndicator({ phase, t }: Readonly<{ phase: Phase; t: (k: string) => string }>) {
  const currentStep = phaseToStep(phase);
  const steps = [
    { step: 1, label: t("templateEditor.step1Title") },
    { step: 2, label: t("templateEditor.step2Title") },
    { step: 3, label: t("templateEditor.step3Title") },
    { step: 4, label: t("templateEditor.step4Title") },
    { step: 5, label: t("templateEditor.step5Title") },
  ];

  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {steps.map(({ step, label }) => {
        const isActive = step === currentStep;
        const isDone = step < currentStep;
        const stepLabel = label.replace(/^.*?:\s*/, "");

        const textStyle = getStepTextStyle(isActive, isDone);
        const badgeStyle = getStepBadgeStyle(isActive, isDone);

        return (
          <React.Fragment key={step}>
            {step > 1 && (
              <div
                className={`hidden sm:block w-6 h-px ${isDone ? "bg-accent-blue" : "bg-border-subtle"}`}
              />
            )}
            <div
              className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${textStyle}`}
            >
              <span
                className={`w-4.5 h-4.5 flex items-center justify-center rounded-none border font-bold text-[10px] leading-none shrink-0 ${badgeStyle}`}
              >
                {isDone ? "✓" : step}
              </span>
              <span className="hidden sm:inline whitespace-nowrap">{stepLabel}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
