/**
 * TemplateEditor.tsx — Template creation and region editing for auto-detection.
 *
 * In new-template mode, shows a live preview from the CaptureService stream,
 * lets the user take a replay-buffer snapshot via useReplayBuffer, scrub through
 * frames to pick the best one, then draw detection regions on it.
 * In edit mode, loads an existing template image for region editing.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  X, Camera, Save, RefreshCw, Trash2, Image as ImageIcon,
  Type, Loader2, ScanText, Play, ShieldBan, ArrowRight,
} from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { MatchedRegion } from "../../types";
import { useOCR } from "../../hooks/useOCR";
import { useReplayBuffer } from "../../hooks/useReplayBuffer";

// --- Props -------------------------------------------------------------------

export type TemplateEditorProps = Readonly<{
  /** Live video stream for new-template mode. If omitted, edit mode is assumed. */
  stream?: MediaStream;
  onClose: () => void;
  /** Called when saving a new template (new-template mode). */
  onSaveTemplate?: (payload: { imageBase64: string; regions: MatchedRegion[]; name?: string }) => Promise<void>;
  /** Called when updating regions of an existing template (edit mode). */
  onUpdateRegions?: (regions: MatchedRegion[], name?: string) => void | Promise<void>;
  /** Pre-load an existing template image by URL (edit mode). */
  initialImageUrl?: string;
  /** Pre-load existing regions (edit mode). */
  initialRegions?: MatchedRegion[];
  /** Initial template name for edit mode. */
  initialName?: string;
  /** Pokemon name -- pre-fills expected_text when switching a region to type "text". */
  pokemonName?: string;
  /** Tesseract language code for OCR auto-recognition (e.g. "deu", "eng"). */
  ocrLang?: string;
}>;

type Phase = "video" | "replay" | "snapshot";

// --- Flow Controls -----------------------------------------------------------

/** Flow controls for creating a new template (video/replay/snapshot phases). */
function NewTemplateControls({
  phase,
  isSaving,
  onTakeSnapshot,
  onResetSnapshot,
  onSave,
  onUseFrame,
  onBackToLive,
  t,
}: Readonly<{
  phase: Phase;
  isSaving: boolean;
  onTakeSnapshot: () => void;
  onResetSnapshot: () => void;
  onSave: () => void;
  onUseFrame: () => void;
  onBackToLive: () => void;
  t: (k: string) => string;
}>) {
  if (phase === "video") {
    return (
      <button
        onClick={onTakeSnapshot}
        className="flex items-center justify-center gap-2 w-full px-6 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold whitespace-nowrap bg-accent-blue text-white shadow-lg shadow-accent-blue/20 hover:bg-accent-blue/90 hover:scale-[1.02] transition-all"
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
          className="flex-1 flex items-center justify-center gap-2 px-4 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold whitespace-nowrap bg-white/10 text-white hover:bg-white/20 transition-all"
        >
          <Play className="w-4 h-4 2xl:w-5 2xl:h-5 shrink-0" />
          {t("templateEditor.backToLive")}
        </button>
        <button
          onClick={onUseFrame}
          className="flex-2 flex items-center justify-center gap-2 px-6 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold whitespace-nowrap bg-accent-blue text-white shadow-lg shadow-accent-blue/20 hover:bg-accent-blue/90 hover:scale-[1.02] transition-all"
        >
          <Camera className="w-5 h-5 2xl:w-6 2xl:h-6 shrink-0" />
          {t("templateEditor.useFrame")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full gap-3">
      <button
        onClick={onResetSnapshot}
        disabled={isSaving}
        className="flex-1 flex items-center justify-center gap-2 px-4 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold whitespace-nowrap bg-white/10 text-white hover:bg-white/20 transition-all disabled:opacity-50"
      >
        <RefreshCw className="w-4 h-4 2xl:w-5 2xl:h-5 shrink-0" />
        {t("templateEditor.retake")}
      </button>
      <button
        onClick={onSave}
        disabled={isSaving}
        className="flex-2 flex items-center justify-center gap-2 px-6 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold whitespace-nowrap bg-accent-blue text-white shadow-lg shadow-accent-blue/20 hover:bg-accent-blue/90 hover:scale-[1.02] transition-all disabled:opacity-50"
      >
        {isSaving ? t("templateEditor.saving") : t("templateEditor.next")}
        <ArrowRight className="w-5 h-5 2xl:w-6 2xl:h-6 shrink-0" />
      </button>
    </div>
  );
}

// --- Helpers -----------------------------------------------------------------

/** Compute relative mouse/touch position within the snapshot container. */
function computeRelativePos(
  e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>,
  container: HTMLDivElement | null,
  bounds: { offsetX: number; offsetY: number; renderedW: number; renderedH: number } | null,
): { x: number; y: number } {
  if (!container) return { x: 0, y: 0 };
  const rect = container.getBoundingClientRect();
  const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
  const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

  if (bounds?.renderedW && bounds.renderedH > 0) {
    const x = Math.max(0, Math.min(1, (clientX - rect.left - bounds.offsetX) / bounds.renderedW));
    const y = Math.max(0, Math.min(1, (clientY - rect.top - bounds.offsetY) / bounds.renderedH));
    return { x, y };
  }

  return {
    x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
  };
}

/** Compute and set image bounds for object-contain letterboxing. */
function computeImageBounds(
  container: HTMLDivElement | null,
  snapshotW: number,
  snapshotH: number,
  setImageBounds: React.Dispatch<React.SetStateAction<{
    offsetX: number; offsetY: number; renderedW: number; renderedH: number;
  } | null>>,
) {
  if (!container || snapshotW === 0 || snapshotH === 0) {
    setImageBounds(null);
    return;
  }
  const rect = container.getBoundingClientRect();
  const scale = Math.min(rect.width / snapshotW, rect.height / snapshotH);
  const renderedW = snapshotW * scale;
  const renderedH = snapshotH * scale;
  setImageBounds({
    offsetX: (rect.width - renderedW) / 2,
    offsetY: (rect.height - renderedH) / 2,
    renderedW,
    renderedH,
  });
}

/** Handle arrow key navigation in replay phase. */
function handleReplayKeyDown(
  e: KeyboardEvent,
  frameCount: number,
  setIndex: React.Dispatch<React.SetStateAction<number>>,
) {
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    setIndex((prev) => Math.max(0, prev - step));
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    setIndex((prev) => Math.min(frameCount - 1, prev + step));
  }
}

/** Convert a relative bounding box to a pixel region, clamped to canvas bounds. */
function boxToRegion(box: { x: number; y: number; w: number; h: number }, canvas: HTMLCanvasElement): MatchedRegion | null {
  const cw = canvas.width;
  const ch = canvas.height;
  // Clamp origin to [0, canvas size)
  const pxX = Math.max(0, Math.min(cw - 1, Math.floor(box.x * cw)));
  const pxY = Math.max(0, Math.min(ch - 1, Math.floor(box.y * ch)));
  // Clamp dimensions so region never exceeds canvas bounds
  const pxW = Math.max(1, Math.min(cw - pxX, Math.floor(box.w * cw)));
  const pxH = Math.max(1, Math.min(ch - pxY, Math.floor(box.h * ch)));
  if (pxW <= 5 || pxH <= 5) return null;
  return { type: "image", expected_text: "", rect: { x: pxX, y: pxY, w: pxW, h: pxH } };
}

/** Renders a single region overlay marker on the snapshot preview. */
function RegionOverlayMarker({ region, index, snapshotWidth, snapshotHeight }: Readonly<{
  region: MatchedRegion; index: number; snapshotWidth: number; snapshotHeight: number;
}>) {
  const isNeg = region.polarity === "negative";
  const isText = region.type === "text";

  let borderStyle: string;
  if (isNeg) borderStyle = "border-red-500 bg-red-500/20 border-dashed";
  else if (isText) borderStyle = "border-purple-500 bg-purple-500/30";
  else borderStyle = "border-accent-blue bg-accent-blue/30";

  let labelColor: string;
  if (isNeg) labelColor = "text-red-400";
  else if (isText) labelColor = "text-purple-400";
  else labelColor = "text-accent-blue";

  let regionIcon: React.ReactNode;
  if (isNeg) regionIcon = <ShieldBan className="w-3 h-3 2xl:w-3.5 2xl:h-3.5 text-red-400" />;
  else if (isText) regionIcon = <Type className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />;
  else regionIcon = <ImageIcon className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />;

  return (
    <div
      className={`absolute border-[3px] pointer-events-none transition-colors ${borderStyle}`}
      style={{
        left: `${(region.rect.x / snapshotWidth) * 100}%`,
        top: `${(region.rect.y / snapshotHeight) * 100}%`,
        width: `${(region.rect.w / snapshotWidth) * 100}%`,
        height: `${(region.rect.h / snapshotHeight) * 100}%`,
      }}
    >
      <div className="absolute -top-6 left-0 flex items-center gap-1 bg-black/80 px-1.5 py-0.5 2xl:px-2 2xl:py-1 rounded text-white font-mono text-xs 2xl:text-sm whitespace-nowrap shadow-lg ring-1 ring-black/30">
        <strong className={labelColor}>#{index + 1}</strong>
        {regionIcon}
        {isNeg && <span className="text-red-400 font-bold">NOT</span>}
        {!isNeg && isText && region.expected_text ? (
          <span className="opacity-80 ml-1 truncate max-w-15">"{region.expected_text}"</span>
        ) : null}
      </div>
    </div>
  );
}

/** Modal dialog for naming a template before saving. */
function TemplateNameDialog({ initialName, onConfirm, onCancel, t }: Readonly<{
  initialName: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
  t: (k: string) => string;
}>) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") onConfirm(name);
    if (e.key === "Escape") onCancel();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  };

  return createPortal(
    <div // NOSONAR — backdrop click is intentional dismiss behaviour
      className="fixed inset-0 z-120 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        className="relative bg-bg-card rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-border-subtle"
        role="dialog"
        aria-label={t("templateEditor.nameDialogTitle")}
      >
        <button
          onClick={onCancel}
          className="absolute top-3 right-3 p-1.5 rounded-full text-text-muted hover:bg-white/10 hover:text-text-primary transition-colors"
          aria-label={t("templateEditor.cancel")}
        >
          <X className="w-4 h-4" />
        </button>
        <h3 className="text-lg font-bold text-text-primary mb-4">{t("templateEditor.nameDialogTitle")}</h3>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("templateEditor.templateName")}
          className="w-full px-3 py-2 text-sm bg-white/10 border border-border-subtle rounded-lg text-text-primary placeholder-text-muted outline-none focus:border-accent-blue/50 transition-colors mb-4"
          aria-label={t("templateEditor.templateName")}
        />
        <button
          onClick={() => onConfirm(name)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap bg-accent-blue text-white hover:bg-accent-blue/90 transition-all"
        >
          <Save className="w-4 h-4 shrink-0" />
          {t("templateEditor.saveTemplate")}
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** Maps each phase to its step number (1-indexed). */
function phaseToStep(phase: Phase): number {
  if (phase === "video") return 1;
  if (phase === "replay") return 2;
  return 3;
}

/** Returns the heading and hint text for the current editor phase. */
function getHeadingAndHint(
  isEditMode: boolean,
  phase: Phase,
  t: (key: string) => string,
): { heading: string; hint: string } {
  if (isEditMode) {
    return { heading: t("templateEditor.editTitle"), hint: t("templateEditor.editHint") };
  }
  const step = phaseToStep(phase);
  return {
    heading: t(`templateEditor.step${step}Title`),
    hint: t(`templateEditor.step${step}Hint`),
  };
}

/** Visual step indicator showing progress through the 3-step template flow. */
function StepIndicator({ phase, t }: Readonly<{ phase: Phase; t: (k: string) => string }>) {
  const currentStep = phaseToStep(phase);
  const steps = [
    { step: 1, label: t("templateEditor.step1Title") },
    { step: 2, label: t("templateEditor.step2Title") },
    { step: 3, label: t("templateEditor.step3Title") },
  ];

  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {steps.map(({ step, label }) => {
        const isActive = step === currentStep;
        const isDone = step < currentStep;
        const stepLabel = label.replace(/^.*?:\s*/, "");
        return (
          <React.Fragment key={step}>
            {step > 1 && (
              <div className={`hidden sm:block w-6 h-px ${isDone ? "bg-accent-blue" : "bg-white/20"}`} />
            )}
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
              isActive
                ? "bg-accent-blue/20 text-accent-blue ring-1 ring-accent-blue/40"
                : isDone
                  ? "bg-white/10 text-white/70"
                  : "bg-white/5 text-white/30"
            }`}>
              <span className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold ${
                isActive
                  ? "bg-accent-blue text-white"
                  : isDone
                    ? "bg-white/20 text-white/70"
                    : "bg-white/10 text-white/30"
              }`}>
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

/** Persists the current template (new or updated regions). */
async function saveTemplate(opts: {
  phase: Phase;
  canvas: HTMLCanvasElement | null;
  regions: MatchedRegion[];
  templateName: string;
  onUpdateRegions: TemplateEditorProps["onUpdateRegions"];
  onSaveTemplate: TemplateEditorProps["onSaveTemplate"];
  setIsSaving: (v: boolean) => void;
  setErrorMsg: (v: string | null) => void;
}) {
  const { phase, canvas, regions, templateName, onUpdateRegions, onSaveTemplate, setIsSaving, setErrorMsg } = opts;
  if (phase !== "snapshot" || !canvas) return;

  let finalRegions = regions;
  if (finalRegions.length === 0) {
    finalRegions = [{
      type: "image",
      expected_text: "",
      rect: { x: 0, y: 0, w: canvas.width, h: canvas.height },
    }];
  }

  setIsSaving(true);
  setErrorMsg(null);
  try {
    const trimmedName = templateName.trim() || undefined;
    if (onUpdateRegions) {
      await onUpdateRegions(finalRegions, trimmedName);
    } else if (onSaveTemplate) {
      const base64Data = canvas.toDataURL("image/png");
      await onSaveTemplate({ imageBase64: base64Data, regions: finalRegions, name: trimmedName });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to save template";
    setErrorMsg(msg);
  } finally {
    setIsSaving(false);
  }
}

/** Wires a MediaStream to the video element when in video phase. */
function wireStreamToVideo(phase: Phase, videoEl: HTMLVideoElement | null, stream: MediaStream | undefined) {
  if (phase === "video" && videoEl && videoEl.srcObject !== stream) {
    videoEl.srcObject = stream ?? null;
    videoEl.play().catch(() => {});
  }
}

/** Loads an existing template image into the canvas for edit mode. */
function loadInitialImage(
  url: string | undefined,
  canvas: HTMLCanvasElement | null,
  initialRegions: MatchedRegion[] | undefined,
  setSnapshotWidth: (w: number) => void,
  setSnapshotHeight: (h: number) => void,
  setPhase: (p: Phase) => void,
  setRegions: (r: MatchedRegion[]) => void,
) {
  if (!url || !canvas) return;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    setSnapshotWidth(img.naturalWidth);
    setSnapshotHeight(img.naturalHeight);
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(img, 0, 0);
    setPhase("snapshot");
    if ((initialRegions?.length ?? 0) > 0) {
      setRegions(initialRegions!);
    }
  };
  img.src = url;
}

/** Renders a replay buffer frame onto the canvas, updating dimensions if needed. */
function renderReplayFrame(
  frame: ImageData | null,
  canvas: HTMLCanvasElement | null,
  setSnapshotWidth: (w: number) => void,
  setSnapshotHeight: (h: number) => void,
) {
  if (!frame || !canvas) return;
  if (canvas.width !== frame.width) {
    canvas.width = frame.width;
    setSnapshotWidth(frame.width);
  }
  if (canvas.height !== frame.height) {
    canvas.height = frame.height;
    setSnapshotHeight(frame.height);
  }
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.putImageData(frame, 0, 0);
}

/** Sets up a ResizeObserver for image bounds tracking in snapshot/replay phases. */
function observeImageBounds(
  phase: Phase,
  snapshotWidth: number,
  snapshotHeight: number,
  container: HTMLDivElement | null,
  updateBounds: () => void,
  setImageBounds: (v: null) => void,
): (() => void) | undefined {
  if ((phase !== "snapshot" && phase !== "replay") || snapshotWidth === 0 || snapshotHeight === 0) {
    setImageBounds(null);
    return;
  }
  updateBounds();
  if (!container) return;
  const observer = new ResizeObserver(updateBounds);
  observer.observe(container);
  return () => observer.disconnect();
}

/** Crops a region from the canvas and runs OCR on it, returning the recognized text or null. */
async function runRegionOCR(
  region: MatchedRegion | undefined,
  sourceCanvas: HTMLCanvasElement | null,
  recognize: (canvas: HTMLCanvasElement, lang: string) => Promise<string | null>,
  lang: string,
): Promise<string | null> {
  if (region?.type !== "text" || !sourceCanvas) return null;
  const crop = document.createElement("canvas");
  crop.width = region.rect.w;
  crop.height = region.rect.h;
  const ctx = crop.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(sourceCanvas, region.rect.x, region.rect.y, region.rect.w, region.rect.h, 0, 0, region.rect.w, region.rect.h);
  return recognize(crop, lang);
}

/** Captures the current video frame directly onto the canvas. */
function captureVideoFrame(
  videoEl: HTMLVideoElement | null, canvas: HTMLCanvasElement | null,
  setW: (w: number) => void, setH: (h: number) => void,
  setPhase: (p: Phase) => void, onReset: () => void,
) {
  if (!videoEl || !canvas) return;
  if (videoEl.videoWidth === 0 || videoEl.videoHeight === 0) return;
  setW(videoEl.videoWidth);
  setH(videoEl.videoHeight);
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.drawImage(videoEl, 0, 0, videoEl.videoWidth, videoEl.videoHeight);
  setPhase("snapshot");
  onReset();
}

/** Draws an ImageData frame onto the canvas, entering snapshot phase. */
function drawFrameToCanvas(
  frame: ImageData | null, canvas: HTMLCanvasElement | null,
  setW: (w: number) => void, setH: (h: number) => void,
  setPhase: (p: Phase) => void, onReset: () => void,
) {
  if (!frame || !canvas) return;
  setW(frame.width);
  setH(frame.height);
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.putImageData(frame, 0, 0);
  setPhase("snapshot");
  onReset();
}

/** Applies an update to a single region, pre-filling text fields with the pokemon name. */
function applyRegionUpdate(
  regions: MatchedRegion[], index: number, updates: Partial<MatchedRegion>, pokemonName?: string,
): MatchedRegion[] {
  const newReg = [...regions];
  const merged = { ...newReg[index], ...updates };
  if (updates.type === "text" && !merged.expected_text && pokemonName) {
    merged.expected_text = pokemonName;
  }
  newReg[index] = merged;
  return newReg;
}

/** Commits a drawn bounding box as a new region if large enough. */
function commitDrawnRegion(
  box: { x: number; y: number; w: number; h: number } | null,
  canvas: HTMLCanvasElement | null,
  setRegions: React.Dispatch<React.SetStateAction<MatchedRegion[]>>,
) {
  if (box && box.w > 0.01 && box.h > 0.01 && canvas) {
    const region = boxToRegion(box, canvas);
    if (region) setRegions((prev) => [...prev, region]);
  }
}

/** Single region editor card shown below the snapshot preview. */
function RegionEditCard({ region: r, index: i, onUpdate, onDelete, onRunOCR, isRecognizing, t }: Readonly<{
  region: MatchedRegion; index: number;
  onUpdate: (i: number, u: Partial<MatchedRegion>) => void;
  onDelete: (i: number) => void;
  onRunOCR: (i: number) => void;
  isRecognizing: boolean;
  t: (key: string) => string;
}>) {
  const isNeg = r.polarity === "negative";
  const textOrAccent = r.type === "text" ? "text-purple-400" : "text-accent-blue";
  const editLabelColor = isNeg ? "text-red-400" : textOrAccent;
  return (
    <div className={`flex items-center gap-2 bg-bg-card border rounded-lg px-3 py-2 shadow-lg transition-colors ${isNeg ? "border-red-500/50 hover:border-red-400" : "border-border-subtle hover:border-accent-blue/50"}`}>
      <span className={`font-mono font-bold w-5 shrink-0 ${editLabelColor}`}>
        #{i + 1}
      </span>
      {!isNeg && (
        <select
          className="bg-bg-primary text-xs 2xl:text-sm p-1 2xl:p-1.5 rounded border border-border-subtle outline-none min-w-25 2xl:min-w-30"
          value={r.type}
          onChange={(e) => onUpdate(i, { type: e.target.value as "image" | "text" })}
        >
          <option value="image">{t("templateEditor.regionImage")}</option>
          <option value="text">{t("templateEditor.regionText")} (OCR)</option>
        </select>
      )}
      {isNeg && (
        <span className="text-xs 2xl:text-sm text-red-400 font-medium px-1">
          {t("templateEditor.negativeRegion")}
        </span>
      )}
      {!isNeg && r.type === "text" && (
        <>
          <input
            type="text"
            placeholder={t("templateEditor.expectedText")}
            value={r.expected_text}
            onChange={(e) => onUpdate(i, { expected_text: e.target.value })}
            className="bg-bg-primary text-xs 2xl:text-sm p-1 2xl:p-1.5 rounded border border-border-subtle outline-none min-w-30 2xl:min-w-35 focus:border-purple-400"
          />
          <button
            title="Auto-recognize text (OCR)"
            onClick={() => onRunOCR(i)}
            disabled={isRecognizing}
            className="text-amber-400 hover:text-amber-300 disabled:opacity-40 transition-colors p-1"
          >
            {isRecognizing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ScanText className="w-4 h-4 2xl:w-5 2xl:h-5" />
            )}
          </button>
        </>
      )}
      <div className="w-px h-6 bg-border-subtle mx-1"></div>
      <button
        title={isNeg ? t("templateEditor.setPositive") : t("templateEditor.setNegative")}
        onClick={() => onUpdate(i, { polarity: isNeg ? "positive" : "negative" })}
        className={`transition-colors p-1 ${isNeg ? "text-red-400 hover:text-green-400" : "text-text-muted hover:text-red-400"}`}
      >
        <ShieldBan className="w-4 h-4 2xl:w-5 2xl:h-5" />
      </button>
      <button
        title={t("templateEditor.deleteRegion")}
        onClick={() => onDelete(i)}
        className="text-text-muted hover:text-red-400 transition-colors p-1"
      >
         <Trash2 className="w-4 h-4 2xl:w-5 2xl:h-5" />
      </button>
    </div>
  );
}

// --- Main Component ----------------------------------------------------------

/** Template editor for creating new templates or editing existing ones. */
export function TemplateEditor({
  stream,
  onClose,
  onSaveTemplate,
  onUpdateRegions,
  initialImageUrl,
  initialRegions,
  initialName,
  pokemonName,
  ocrLang = "eng",
}: TemplateEditorProps) {
  const { t } = useI18n();
  // Callback ref so React triggers a re-render when the video element mounts,
  // which lets useReplayBuffer receive the actual element instead of null.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const videoRef = useCallback((el: HTMLVideoElement | null) => { setVideoEl(el); }, []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<Phase>("video");
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(0);
  const [templateName, setTemplateName] = useState(initialName ?? "");

  // Browser-based replay buffer capturing from the stream at 60fps
  const replayBuffer = useReplayBuffer(stream ? videoEl : null);
  const [snapshotWidth, setSnapshotWidth] = useState(0);
  const [snapshotHeight, setSnapshotHeight] = useState(0);

  // Array of confirmed regions (absolute pixel coords in the snapshot)
  const [regions, setRegions] = useState<MatchedRegion[]>([]);

  // Bounding box drawing state (relative coords 0.0 - 1.0)
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentBox, setCurrentBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { recognize, isRecognizing, ocrError } = useOCR({ lang: ocrLang });

  // Track the actual rendered image area within the object-contain container.
  const [imageBounds, setImageBounds] = useState<{
    offsetX: number; offsetY: number; renderedW: number; renderedH: number;
  } | null>(null);

  const updateImageBounds = useCallback(
    () => computeImageBounds(containerRef.current, snapshotWidth, snapshotHeight, setImageBounds),
    [snapshotWidth, snapshotHeight],
  );

  useEffect(
    () => observeImageBounds(phase, snapshotWidth, snapshotHeight, containerRef.current, updateImageBounds, setImageBounds),
    [phase, snapshotWidth, snapshotHeight, updateImageBounds],
  );

  // In edit mode, load the existing template image into the canvas immediately.
  useEffect(
    () => loadInitialImage(initialImageUrl, canvasRef.current, initialRegions, setSnapshotWidth, setSnapshotHeight, setPhase, setRegions),
    [initialImageUrl], // only run once on mount
  );

  // Wire the stream to the video element when in "video" phase
  useEffect(
    () => wireStreamToVideo(phase, videoEl, stream),
    [stream, phase, videoEl],
  );

  // Render selected replay frame to canvas
  useEffect(() => {
    if (phase === "replay") {
      renderReplayFrame(replayBuffer.getFrame(selectedFrameIndex), canvasRef.current, setSnapshotWidth, setSnapshotHeight);
    }
  }, [phase, selectedFrameIndex, replayBuffer]);

  // Keyboard navigation in replay phase
  useEffect(() => {
    if (phase !== "replay") return;

    const handleKeyDown = (e: KeyboardEvent) =>
      handleReplayKeyDown(e, replayBuffer.frameCount, setSelectedFrameIndex);

    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [phase, replayBuffer.frameCount]);

  // --- Snapshot and replay handlers ------------------------------------------

  const resetToSnapshot = () => { setRegions([]); setCurrentBox(null); setErrorMsg(null); };

  /** Stop the replay buffer and enter replay phase to browse captured frames. */
  const handleTakeSnapshot = () => {
    replayBuffer.stop();
    if (replayBuffer.frameCount > 0) {
      setSelectedFrameIndex(replayBuffer.frameCount - 1);
      setPhase("replay");
    } else {
      captureVideoFrame(videoEl, canvasRef.current, setSnapshotWidth, setSnapshotHeight, setPhase, resetToSnapshot);
    }
  };

  /** Use the currently selected replay frame as the snapshot to draw regions on. */
  const handleUseFrame = () => {
    const frame = replayBuffer.getFrame(selectedFrameIndex);
    drawFrameToCanvas(frame, canvasRef.current, setSnapshotWidth, setSnapshotHeight, setPhase, resetToSnapshot);
  };

  /** Clear all state and return to live video, restarting the replay buffer. */
  const returnToLive = () => {
    setPhase("video");
    setSelectedFrameIndex(0);
    setCurrentBox(null);
    setRegions([]);
    setErrorMsg(null);
    replayBuffer.restart();
  };

  /** Go back to live video from replay — restarts the replay buffer. */
  const handleBackToLive = returnToLive;

  /** Reset the snapshot and go back to live video — restarts the replay buffer. */
  const resetSnapshot = returnToLive;

  // --- Region drawing --------------------------------------------------------

  const getRelativeMousePos = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) =>
    computeRelativePos(e, containerRef.current, imageBounds);

  const onPointerDown = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (phase !== "snapshot") return;
    setIsDrawing(true);
    const pos = getRelativeMousePos(e);
    setStartPos(pos);
    setCurrentBox({ x: pos.x, y: pos.y, w: 0, h: 0 });
  };

  const onPointerMove = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (!isDrawing || phase !== "snapshot") return;
    const pos = getRelativeMousePos(e);
    setCurrentBox({
      x: Math.min(startPos.x, pos.x),
      y: Math.min(startPos.y, pos.y),
      w: Math.abs(pos.x - startPos.x),
      h: Math.abs(pos.y - startPos.y),
    });
  };

  const onPointerUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    commitDrawnRegion(currentBox, canvasRef.current, setRegions);
    setCurrentBox(null);
  };

  const updateRegion = (index: number, updates: Partial<MatchedRegion>) =>
    setRegions((prev) => applyRegionUpdate(prev, index, updates, pokemonName));

  const deleteRegion = (index: number) => {
    setRegions(regions.filter((_, i) => i !== index));
  };

  const handleRunOCR = async (regionIndex: number) => {
    const recognized = await runRegionOCR(regions[regionIndex], canvasRef.current, recognize, ocrLang);
    if (recognized) updateRegion(regionIndex, { expected_text: recognized });
  };

  const [showNameDialog, setShowNameDialog] = useState(false);

  const handleSaveClick = () => setShowNameDialog(true);

  const confirmSave = (name: string) => {
    setShowNameDialog(false);
    setTemplateName(name);
    saveTemplate({ phase, canvas: canvasRef.current, regions, templateName: name, onUpdateRegions, onSaveTemplate, setIsSaving, setErrorMsg });
  };

  const hasTextRegion = regions.some((r) => r.type === "text");
  const isEditMode = !!initialImageUrl || !!onUpdateRegions;

  const { heading, hint } = getHeadingAndHint(isEditMode, phase, t);

  const isSnapshotPhase = phase === "snapshot";
  const cursorClass = isSnapshotPhase ? "cursor-crosshair" : "cursor-default";
  const pointerDown = isSnapshotPhase ? onPointerDown : undefined;
  const pointerMove = isSnapshotPhase ? onPointerMove : undefined;
  const pointerUp = isSnapshotPhase ? onPointerUp : undefined;

  // --- Render ----------------------------------------------------------------

  const modalContent = (
    <div className="fixed inset-0 z-100 bg-black/95 flex flex-col items-center justify-center p-4 md:p-6 backdrop-blur-sm overflow-y-auto">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 md:top-8 md:right-8 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-110"
      >
        <X className="w-6 h-6 2xl:w-7 2xl:h-7" />
      </button>

      <div className="text-white text-center mb-2 mt-4 shrink-0">
        {!isEditMode && (
          <div className="flex justify-center mb-3">
            <StepIndicator phase={phase} t={t} />
          </div>
        )}
        <h2 className="text-xl 2xl:text-2xl font-bold mb-1">{heading}</h2>
        <p className="text-sm 2xl:text-base text-gray-400 mb-2">{hint}</p>
      </div>

      {/* Region drawing surface — pointer events only active in snapshot phase */}
      {/* NOSONAR: non-native interactive element is intentional for freeform region drawing */}
      <div // NOSONAR
        ref={containerRef}
        className={`relative w-full max-w-[80vw] 2xl:max-w-[85vw] max-h-[55vh] 2xl:max-h-[60vh] aspect-video bg-black rounded-lg overflow-hidden shadow-2xl mb-3 flex items-center justify-center select-none touch-none ${cursorClass}`}
        onMouseDown={pointerDown}
        onMouseMove={pointerMove}
        onMouseUp={pointerUp}
        onMouseLeave={pointerUp}
        onTouchStart={pointerDown}
        onTouchMove={pointerMove}
        onTouchEnd={pointerUp}
      >
        {/* Video feed layer -- hidden in edit mode */}
        {!isEditMode && (
          <>
            <video
              ref={videoRef}
              className={`w-full h-full object-contain pointer-events-none ${phase === "video" ? "" : "hidden"}`}
              autoPlay
              playsInline
              muted
            />
            {phase === "video" && replayBuffer.isBuffering && (
              <div
                className="absolute top-3 right-3 flex items-center gap-2 bg-black/70 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs font-mono text-white"
                title={t("templateEditor.bufferLoopHint")}
              >
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                {Math.floor(replayBuffer.bufferedSeconds)}s / {replayBuffer.maxSeconds}s
                {replayBuffer.bufferedSeconds >= replayBuffer.maxSeconds && (
                  <RefreshCw className="w-3 h-3 text-white/60 animate-spin" style={{ animationDuration: "3s" }} aria-label={t("templateEditor.bufferLoopHint")} />
                )}
              </div>
            )}
          </>
        )}

        {/* Snapshot canvas layer */}
        <canvas
          ref={canvasRef}
          className={`w-full h-full object-contain pointer-events-none ${phase === "snapshot" || phase === "replay" ? "" : "hidden"}`}
        />

        {/* Overlay wrapper for regions and drawing box */}
        {(phase === "snapshot" || phase === "replay") && imageBounds && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: imageBounds.offsetX,
              top: imageBounds.offsetY,
              width: imageBounds.renderedW,
              height: imageBounds.renderedH,
            }}
          >
            {/* Existing regions */}
            {snapshotWidth > 0 && regions.map((r, i) => (
              <RegionOverlayMarker
                key={`region-${r.type}-${r.rect.x}-${r.rect.y}-${i}`}
                region={r}
                index={i}
                snapshotWidth={snapshotWidth}
                snapshotHeight={snapshotHeight}
              />
            ))}

            {/* Current drawing box */}
            {currentBox && currentBox.w > 0 && currentBox.h > 0 && (
              <div
                className="absolute border-2 border-yellow-400 border-dashed bg-yellow-400/15 pointer-events-none"
                style={{
                  left: `${currentBox.x * 100}%`,
                  top: `${currentBox.y * 100}%`,
                  width: `${currentBox.w * 100}%`,
                  height: `${currentBox.h * 100}%`,
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Replay Timeline */}
      {phase === "replay" && replayBuffer.frameCount > 0 && (
        <div className="w-full max-w-[80vw] 2xl:max-w-[85vw] mb-4 px-8">
          <div className="flex items-center gap-4">
            <span className="text-white text-sm 2xl:text-base font-mono shrink-0">
              {(() => {
                const totalSec = replayBuffer.bufferedSeconds;
                const secPerFrame = totalSec / replayBuffer.frameCount;
                const currentSec = selectedFrameIndex * secPerFrame;
                const relative = currentSec - totalSec;
                return Math.abs(relative) < 0.1 ? "now" : `${Math.round(relative)}s`;
              })()}
            </span>
            <input
              type="range"
              min={0}
              max={replayBuffer.frameCount - 1}
              value={selectedFrameIndex}
              onChange={(e) => setSelectedFrameIndex(Number(e.target.value))}
              className="flex-1 h-2 bg-white/20 rounded-lg appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent-blue [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-lg
                [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent-blue [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:shadow-lg"
            />
            <span className="text-white/60 text-xs 2xl:text-sm shrink-0">
              {selectedFrameIndex + 1} / {replayBuffer.frameCount}
            </span>
          </div>
          <p className="text-xs 2xl:text-sm text-text-muted text-center mt-2">
            {t("templateEditor.replayKeys")}
          </p>
        </div>
      )}



      {/* Region List Editor */}
      {phase === "snapshot" && regions.length > 0 && (
        <div className="w-full max-w-4xl 2xl:max-w-5xl flex flex-wrap justify-center gap-2 mb-2 max-h-28 2xl:max-h-36 overflow-y-auto px-4 scrollbar-thin scrollbar-thumb-border-subtle hover:scrollbar-thumb-border-strong text-white z-50 rounded-lg">
          {regions.map((r, i) => (
            <RegionEditCard
              key={`region-edit-${r.type}-${r.rect.x}-${r.rect.y}-${i}`}
              region={r}
              index={i}
              onUpdate={updateRegion}
              onDelete={deleteRegion}
              onRunOCR={handleRunOCR}
              isRecognizing={isRecognizing}
              t={t}
            />
          ))}
        </div>
      )}

      {/* Hints below region list */}
      {phase === "snapshot" && (
        <div className="w-full max-w-4xl px-4 mb-2 flex flex-col items-center gap-1">
          {regions.length === 0 && (
            <p className="text-xs 2xl:text-sm text-text-muted text-center">
              {t("templateEditor.noRegions")}
            </p>
          )}
          {hasTextRegion && (
            <p className="text-xs 2xl:text-sm text-amber-400 text-center">
              {t("templateEditor.ocrHint")}
            </p>
          )}
          {ocrError && (
            <p className="text-xs 2xl:text-sm text-red-400 text-center">
              OCR error: {ocrError}
            </p>
          )}
        </div>
      )}

      {/* Flow Controls */}
      <div className="flex flex-col items-center gap-3 w-full max-w-md 2xl:max-w-lg shrink-0">
        {isEditMode ? (
          <div className="flex w-full gap-3">
            <button
              onClick={onClose}
              disabled={isSaving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold whitespace-nowrap bg-white/10 text-white hover:bg-white/20 transition-all disabled:opacity-50"
            >
              {t("templateEditor.cancel")}
            </button>
            <button
              onClick={handleSaveClick}
              disabled={isSaving}
              className="flex-2 flex items-center justify-center gap-2 px-6 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold whitespace-nowrap bg-accent-blue text-white shadow-lg shadow-accent-blue/20 hover:bg-accent-blue/90 hover:scale-[1.02] transition-all disabled:opacity-50"
            >
              <Save className="w-5 h-5 2xl:w-6 2xl:h-6 shrink-0" />
              {isSaving ? t("templateEditor.saving") : t("templateEditor.saveTemplate")}
            </button>
          </div>
        ) : (
          <NewTemplateControls
            phase={phase}
            isSaving={isSaving}
            onTakeSnapshot={handleTakeSnapshot}
            onResetSnapshot={resetSnapshot}
            onSave={handleSaveClick}
            onUseFrame={handleUseFrame}
            onBackToLive={handleBackToLive}
            t={t}
          />
        )}

        {errorMsg && (
          <div className="w-full px-4 py-3 bg-red-500/10 text-red-500 text-sm 2xl:text-base text-center rounded-lg font-medium border border-red-500/20">
            {errorMsg}
          </div>
        )}
      </div>

      {/* Save name dialog */}
      {showNameDialog && (
        <TemplateNameDialog
          initialName={templateName}
          onConfirm={confirmSave}
          onCancel={() => setShowNameDialog(false)}
          t={t}
        />
      )}
    </div>
  );

  return createPortal(modalContent, document.body);
}
