/**
 * NewTemplateControls.tsx -- Phase-dependent action row of the template editor.
 *
 * Renders the primary and secondary buttons for whichever of the five
 * template-creation phases is active.
 */
import type React from "react";
import { Camera, Save, RefreshCw, Play, ArrowRight, BarChart3, ArrowLeft } from "lucide-react";
import type { Phase } from "./templateEditorTypes";

/** Flow controls for creating a new template (all 5 phases). */
export function NewTemplateControls({
  phase,
  isSaving,
  hasRegions,
  onTakeSnapshot,
  onResetSnapshot,
  onSave,
  onUseFrame,
  onBackToLive,
  onGoToTest,
  onPickFrame,
  onAdjustRegions,
  onLooksGood,
  onBackToTest,
  stabilityStatus,
  t,
}: Readonly<{
  phase: Phase;
  isSaving: boolean;
  hasRegions: boolean;
  /** Stability-analysis status button, rendered inside the test-phase control row. */
  stabilityStatus?: React.ReactNode;
  onTakeSnapshot: () => void;
  onResetSnapshot: () => void;
  onSave: () => void;
  onUseFrame: () => void;
  onBackToLive: () => void;
  onGoToTest: () => void;
  onPickFrame: () => void;
  onAdjustRegions: () => void;
  onLooksGood: () => void;
  onBackToTest: () => void;
  t: (k: string) => string;
}>) {
  if (phase === "video") {
    return (
      <button
        onClick={onTakeSnapshot}
        className="t-cut flex items-center justify-center gap-2 w-full px-6 py-4 2xl:py-5 rounded-none text-sm 2xl:text-base font-bold whitespace-nowrap bg-accent-blue text-bg-primary hover:bg-accent-blue/90 transition-colors"
      >
        <Camera className="w-5 h-5 2xl:w-6 2xl:h-6 shrink-0" />
        {t("templateEditor.takeSnapshot")}
      </button>
    );
  }

  if (phase === "replay") {
    return (
      <div className="flex w-full gap-3">
        <button
          onClick={onBackToLive}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-4 2xl:py-5 rounded-none border border-border-subtle bg-bg-card text-text-primary hover:bg-bg-hover text-sm 2xl:text-base font-bold whitespace-nowrap transition-colors"
        >
          <Play className="w-4 h-4 2xl:w-5 2xl:h-5 shrink-0" />
          {t("templateEditor.backToLive")}
        </button>
        <button
          onClick={onUseFrame}
          className="t-cut flex-2 flex items-center justify-center gap-2 px-6 py-4 2xl:py-5 rounded-none text-sm 2xl:text-base font-bold whitespace-nowrap bg-accent-blue text-bg-primary hover:bg-accent-blue/90 transition-colors"
        >
          <Camera className="w-5 h-5 2xl:w-6 2xl:h-6 shrink-0" />
          {t("templateEditor.useFrame")}
        </button>
      </div>
    );
  }

  if (phase === "snapshot") {
    return (
      <div className="flex w-full gap-3">
        <button
          onClick={onResetSnapshot}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-4 2xl:py-5 rounded-none border border-border-subtle bg-bg-card text-text-primary hover:bg-bg-hover text-sm 2xl:text-base font-bold whitespace-nowrap transition-colors"
        >
          <RefreshCw className="w-4 h-4 2xl:w-5 2xl:h-5 shrink-0" />
          {t("templateEditor.retake")}
        </button>
        <button
          onClick={onGoToTest}
          disabled={!hasRegions}
          className="t-cut flex-2 flex items-center justify-center gap-2 px-6 py-4 2xl:py-5 rounded-none text-sm 2xl:text-base font-bold whitespace-nowrap bg-accent-blue text-bg-primary hover:bg-accent-blue/90 transition-colors disabled:opacity-50"
        >
          <BarChart3 className="w-5 h-5 2xl:w-6 2xl:h-6 shrink-0" />
          {t("templateEditor.next")}
          <ArrowRight className="w-4 h-4 shrink-0" />
        </button>
      </div>
    );
  }

  if (phase === "test") {
    // w-max instead of w-full: four nowrap buttons overflow the max-w-md
    // parent, and content width lets the items-center parent keep the row
    // horizontally centered instead of overflowing to the right only.
    return (
      <div className="flex w-max max-w-none gap-3">
        {stabilityStatus}
        <button
          onClick={onPickFrame}
          className="flex items-center justify-center gap-2 px-4 py-4 2xl:py-5 rounded-none border border-border-subtle bg-bg-card text-text-primary hover:bg-bg-hover text-sm 2xl:text-base font-bold whitespace-nowrap transition-colors"
        >
          <Camera className="w-4 h-4 2xl:w-5 2xl:h-5 shrink-0" />
          {t("templateEditor.pickFrame")}
        </button>
        <button
          onClick={onAdjustRegions}
          className="flex items-center justify-center gap-2 px-4 py-4 2xl:py-5 rounded-none border border-border-subtle bg-bg-card text-text-primary hover:bg-bg-hover text-sm 2xl:text-base font-bold whitespace-nowrap transition-colors"
        >
          <RefreshCw className="w-4 h-4 2xl:w-5 2xl:h-5 shrink-0" />
          {t("templateEditor.adjustRegions")}
        </button>
        <button
          onClick={onLooksGood}
          className="t-cut flex-1 flex items-center justify-center gap-2 px-6 py-4 2xl:py-5 rounded-none text-sm 2xl:text-base font-bold whitespace-nowrap bg-accent-blue text-bg-primary hover:bg-accent-blue/90 transition-colors"
        >
          {t("templateEditor.next")}
          <ArrowRight className="w-5 h-5 2xl:w-6 2xl:h-6 shrink-0" />
        </button>
      </div>
    );
  }

  // confirm phase
  return (
    <div className="flex w-full gap-3">
      <button
        onClick={onBackToTest}
        className="flex-1 flex items-center justify-center gap-2 px-4 py-4 2xl:py-5 rounded-none border border-border-subtle bg-bg-card text-text-primary hover:bg-bg-hover text-sm 2xl:text-base font-bold whitespace-nowrap transition-colors"
      >
        <ArrowLeft className="w-4 h-4 2xl:w-5 2xl:h-5 shrink-0" />
        {t("templateEditor.back")}
      </button>
      <button
        onClick={onSave}
        disabled={isSaving}
        className="t-cut flex-2 flex items-center justify-center gap-2 px-6 py-4 2xl:py-5 rounded-none text-sm 2xl:text-base font-bold whitespace-nowrap bg-accent-blue text-bg-primary hover:bg-accent-blue/90 transition-colors disabled:opacity-50"
      >
        <Save className="w-5 h-5 2xl:w-6 2xl:h-6 shrink-0" />
        {isSaving ? t("templateEditor.saving") : t("templateEditor.saveTemplate")}
      </button>
    </div>
  );
}
