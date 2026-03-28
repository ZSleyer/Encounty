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
  Type, Loader2, ScanText, Play, ShieldBan,
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
        className="flex items-center justify-center gap-2 w-full py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold bg-accent-blue text-white shadow-lg shadow-accent-blue/20 hover:bg-accent-blue/90 hover:scale-[1.02] transition-all"
      >
        <Camera className="w-5 h-5 2xl:w-6 2xl:h-6" />
        {t("templateEditor.takeSnapshot")}
      </button>
    );
  }

  if (phase === "replay") {
    return (
      <div className="flex w-full gap-3">
        <button
          onClick={onBackToLive}
          className="flex-1 flex items-center justify-center gap-2 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold bg-white/10 text-white hover:bg-white/20 transition-all"
        >
          <Play className="w-4 h-4 2xl:w-5 2xl:h-5" />
          {t("templateEditor.backToLive")}
        </button>
        <button
          onClick={onUseFrame}
          className="flex-2 flex items-center justify-center gap-2 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold bg-accent-blue text-white shadow-lg shadow-accent-blue/20 hover:bg-accent-blue/90 hover:scale-[1.02] transition-all"
        >
          <Camera className="w-5 h-5 2xl:w-6 2xl:h-6" />
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
        className="flex-1 flex items-center justify-center gap-2 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold bg-white/10 text-white hover:bg-white/20 transition-all disabled:opacity-50"
      >
        <RefreshCw className="w-4 h-4 2xl:w-5 2xl:h-5" />
        {t("templateEditor.retake")}
      </button>
      <button
        onClick={onSave}
        disabled={isSaving}
        className="flex-2 flex items-center justify-center gap-2 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold bg-accent-blue text-white shadow-lg shadow-accent-blue/20 hover:bg-accent-blue/90 hover:scale-[1.02] transition-all disabled:opacity-50"
      >
        <Save className="w-5 h-5 2xl:w-6 2xl:h-6" />
        {isSaving ? t("templateEditor.saving") : t("templateEditor.saveTemplate")}
      </button>
    </div>
  );
}

// --- Region Overlay Item -----------------------------------------------------

/** Renders a single region overlay label on top of the snapshot. */
/** Hints displayed below the region list in snapshot phase. */
function SnapshotHints({ hasTextRegion, regionsEmpty, ocrError, t }: Readonly<{
  hasTextRegion: boolean;
  regionsEmpty: boolean;
  ocrError: string | null;
  t: (key: string) => string;
}>) {
  return (
    <div className="w-full max-w-4xl px-4 mb-2 flex flex-col items-center gap-1">
      {regionsEmpty && (
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
  );
}

function RegionOverlayItem({ region, index, snapshotWidth, snapshotHeight }: Readonly<{
  region: MatchedRegion;
  index: number;
  snapshotWidth: number;
  snapshotHeight: number;
}>) {
  const isNeg = region.polarity === "negative";
  const isText = region.type === "text";

  const negBorder = "border-red-500 bg-red-500/20 border-dashed";
  const posBorder = isText ? "border-purple-500 bg-purple-500/30" : "border-accent-blue bg-accent-blue/30";
  const borderStyle = isNeg ? negBorder : posBorder;

  const posLabelColor = isText ? "text-purple-400" : "text-accent-blue";
  const labelColor = isNeg ? "text-red-400" : posLabelColor;

  const posIcon = isText
    ? <Type className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />
    : <ImageIcon className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />;
  const regionIcon = isNeg
    ? <ShieldBan className="w-3 h-3 2xl:w-3.5 2xl:h-3.5 text-red-400" />
    : posIcon;

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
        {!isNeg && region.type === "text" && region.expected_text ? (
          <span className="opacity-80 ml-1 truncate max-w-15">"{region.expected_text}"</span>
        ) : null}
      </div>
    </div>
  );
}

// --- Edit mode image loader --------------------------------------------------

/** Loads an existing template image into the canvas when editing. */
function useEditModeImage(
  initialImageUrl: string | undefined,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  initialRegions: MatchedRegion[] | undefined,
  setSnapshotWidth: (w: number) => void,
  setSnapshotHeight: (h: number) => void,
  setPhase: (p: Phase) => void,
  setRegions: (r: MatchedRegion[]) => void,
) {
  useEffect(() => {
    if (!initialImageUrl || !canvasRef.current) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!canvasRef.current) return;
      canvasRef.current.width = img.naturalWidth;
      canvasRef.current.height = img.naturalHeight;
      setSnapshotWidth(img.naturalWidth);
      setSnapshotHeight(img.naturalHeight);
      const ctx = canvasRef.current.getContext("2d");
      ctx?.drawImage(img, 0, 0);
      setPhase("snapshot");
      if ((initialRegions?.length ?? 0) > 0) {
        setRegions(initialRegions!);
      }
    };
    img.src = initialImageUrl;
  }, [initialImageUrl]); // eslint-disable-line react-hooks/exhaustive-deps -- only run once on mount
}

// --- Heading resolver --------------------------------------------------------

/** Returns the heading and hint text for the current editor phase. */
function resolveHeadingAndHint(
  phase: Phase,
  isEditMode: boolean,
  t: (key: string) => string,
): { heading: string; hint: string } {
  if (isEditMode) return { heading: t("templateEditor.editTitle"), hint: t("templateEditor.editHint") };
  if (phase === "video") return { heading: t("templateEditor.step1Title"), hint: t("templateEditor.step1Hint") };
  if (phase === "replay") return { heading: t("templateEditor.replayTitle"), hint: t("templateEditor.replayHint") };
  return { heading: t("templateEditor.step2Title"), hint: t("templateEditor.step2Hint") };
}

// --- Video frame capture helper ----------------------------------------------

/** Grabs the current video frame onto the canvas, returns dimensions or null if unavailable. */
function grabVideoFrame(video: HTMLVideoElement | null, canvas: HTMLCanvasElement | null): { w: number; h: number } | null {
  if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) return null;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
  return { w: video.videoWidth, h: video.videoHeight };
}

// --- Region helpers ----------------------------------------------------------

/** Applies a partial update to a region, pre-filling text from pokemonName when switching to text type. */
function applyRegionUpdate(
  regions: MatchedRegion[],
  index: number,
  updates: Partial<MatchedRegion>,
  pokemonName?: string,
): MatchedRegion[] {
  const newReg = [...regions];
  const merged = { ...newReg[index], ...updates };
  if (updates.type === "text" && !merged.expected_text && pokemonName) {
    merged.expected_text = pokemonName;
  }
  newReg[index] = merged;
  return newReg;
}

// --- Drawing helpers ---------------------------------------------------------

/** Converts a drawn box (relative 0-1 coords) to a pixel-based MatchedRegion, or null if too small. */
function boxToRegion(
  box: { x: number; y: number; w: number; h: number } | null,
  canvas: HTMLCanvasElement | null,
): MatchedRegion | null {
  if (!box || !canvas || box.w <= 0.01 || box.h <= 0.01) return null;
  const pxW = Math.max(1, Math.floor(box.w * canvas.width));
  const pxH = Math.max(1, Math.floor(box.h * canvas.height));
  if (pxW <= 5 || pxH <= 5) return null;
  return {
    type: "image",
    expected_text: "",
    rect: {
      x: Math.floor(box.x * canvas.width),
      y: Math.floor(box.y * canvas.height),
      w: pxW,
      h: pxH,
    },
  };
}

// --- Pointer position helper -------------------------------------------------

type ImageBounds = { offsetX: number; offsetY: number; renderedW: number; renderedH: number };

/** Converts a mouse/touch event to relative 0-1 coordinates within the snapshot area. */
function computeRelativePos(
  e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>,
  container: HTMLDivElement | null,
  bounds: ImageBounds | null,
): { x: number; y: number } {
  if (!container) return { x: 0, y: 0 };
  const rect = container.getBoundingClientRect();
  const [clientX, clientY] = "touches" in e
    ? [e.touches[0].clientX, e.touches[0].clientY]
    : [e.clientX, e.clientY];

  const refW = bounds?.renderedW && bounds.renderedH > 0 ? bounds.renderedW : rect.width;
  const refH = bounds?.renderedW && bounds.renderedH > 0 ? bounds.renderedH : rect.height;
  const offX = bounds?.renderedW && bounds.renderedH > 0 ? bounds.offsetX : 0;
  const offY = bounds?.renderedW && bounds.renderedH > 0 ? bounds.offsetY : 0;

  const x = Math.max(0, Math.min(1, (clientX - rect.left - offX) / refW));
  const y = Math.max(0, Math.min(1, (clientY - rect.top - offY) / refH));
  return { x, y };
}

// --- Stream Wiring Hook ------------------------------------------------------

/** Wires the MediaStream to the video element when in video phase. */
function useStreamWiring(phase: Phase, videoEl: HTMLVideoElement | null, stream: MediaStream | null | undefined) {
  useEffect(() => {
    if (phase === "video" && videoEl && videoEl.srcObject !== stream) {
      videoEl.srcObject = stream ?? null;
      videoEl.play().catch(() => {});
    }
  }, [stream, phase, videoEl]);
}

// --- Image Bounds Hook -------------------------------------------------------

/** Tracks the rendered image area within an object-contain container, accounting for letterboxing. */
function useImageBounds(
  phase: Phase,
  snapshotWidth: number,
  snapshotHeight: number,
  containerRef: React.RefObject<HTMLDivElement | null>,
): ImageBounds | null {
  const [bounds, setBounds] = useState<ImageBounds | null>(null);

  const update = useCallback(() => {
    if (!containerRef.current || snapshotWidth === 0 || snapshotHeight === 0) {
      setBounds(null);
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const scale = Math.min(rect.width / snapshotWidth, rect.height / snapshotHeight);
    const renderedW = snapshotWidth * scale;
    const renderedH = snapshotHeight * scale;
    setBounds({
      offsetX: (rect.width - renderedW) / 2,
      offsetY: (rect.height - renderedH) / 2,
      renderedW,
      renderedH,
    });
  }, [snapshotWidth, snapshotHeight, containerRef]);

  useEffect(() => {
    if ((phase !== "snapshot" && phase !== "replay") || snapshotWidth === 0 || snapshotHeight === 0) {
      setBounds(null);
      return;
    }
    update();
    if (!containerRef.current) return;
    const observer = new ResizeObserver(update);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [phase, snapshotWidth, snapshotHeight, update, containerRef]);

  return bounds;
}

// --- Replay Frame Hook -------------------------------------------------------

/** Renders the selected replay frame to the canvas, updating dimensions if they change. */
function useReplayFrame(
  phase: Phase,
  selectedFrameIndex: number,
  replayBuffer: { getFrame: (i: number) => ImageData | null },
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  setSnapshotWidth: (w: number) => void,
  setSnapshotHeight: (h: number) => void,
) {
  useEffect(() => {
    if (phase !== "replay") return;
    const frame = replayBuffer.getFrame(selectedFrameIndex);
    if (!frame || !canvasRef.current) return;

    if (canvasRef.current.width !== frame.width) {
      canvasRef.current.width = frame.width;
      setSnapshotWidth(frame.width);
    }
    if (canvasRef.current.height !== frame.height) {
      canvasRef.current.height = frame.height;
      setSnapshotHeight(frame.height);
    }

    const ctx = canvasRef.current.getContext("2d");
    if (ctx) ctx.putImageData(frame, 0, 0);
  }, [phase, selectedFrameIndex, replayBuffer, canvasRef, setSnapshotWidth, setSnapshotHeight]);
}

// --- Replay Keyboard Hook ----------------------------------------------------

/** Handles left/right arrow key navigation during replay phase. */
function useReplayKeyboard(
  phase: Phase,
  frameCount: number,
  setIndex: React.Dispatch<React.SetStateAction<number>>,
) {
  useEffect(() => {
    if (phase !== "replay") return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        setIndex((prev) => Math.max(0, prev - step));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        setIndex((prev) => Math.min(frameCount - 1, prev + step));
      }
    };
    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [phase, frameCount, setIndex]);
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
  const replayBuffer = useReplayBuffer(stream ? videoEl : null, 30, 60);
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

  const { recognize, isRecognizing, ocrError } = useOCR({ backend: "onnx", lang: ocrLang });

  // Track the actual rendered image area within the object-contain container.
  const imageBounds = useImageBounds(phase, snapshotWidth, snapshotHeight, containerRef);

  // In edit mode, load the existing template image into the canvas immediately.
  useEditModeImage(initialImageUrl, canvasRef, initialRegions, setSnapshotWidth, setSnapshotHeight, setPhase, setRegions);

  // Wire the stream to the video element when in "video" phase
  useStreamWiring(phase, videoEl, stream);

  // Render selected replay frame to canvas
  useReplayFrame(phase, selectedFrameIndex, replayBuffer, canvasRef, setSnapshotWidth, setSnapshotHeight);

  // Keyboard navigation in replay phase
  useReplayKeyboard(phase, replayBuffer.frameCount, setSelectedFrameIndex);

  // --- Snapshot and replay handlers ------------------------------------------

  /** Fallback: capture the current video frame directly when no replay frames are buffered. */
  const captureCurrentFrame = () => {
    const frame = grabVideoFrame(videoEl, canvasRef.current);
    if (!frame) return;
    setSnapshotWidth(frame.w);
    setSnapshotHeight(frame.h);
    setPhase("snapshot");
    setRegions([]);
    setCurrentBox(null);
    setErrorMsg(null);
  };

  /** Stop the replay buffer and enter replay phase to browse captured frames. */
  const handleTakeSnapshot = () => {
    replayBuffer.stop();
    if (replayBuffer.frameCount > 0) {
      setSelectedFrameIndex(replayBuffer.frameCount - 1);
      setPhase("replay");
    } else {
      captureCurrentFrame();
    }
  };

  /** Use the currently selected replay frame as the snapshot to draw regions on. */
  const handleUseFrame = () => {
    if (!canvasRef.current) return;
    const frame = replayBuffer.getFrame(selectedFrameIndex);
    if (!frame) return;

    setSnapshotWidth(frame.width);
    setSnapshotHeight(frame.height);

    canvasRef.current.width = frame.width;
    canvasRef.current.height = frame.height;
    const ctx = canvasRef.current.getContext("2d");
    if (ctx) {
      ctx.putImageData(frame, 0, 0);
    }

    setPhase("snapshot");
    setRegions([]);
    setCurrentBox(null);
    setErrorMsg(null);
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
    const region = boxToRegion(currentBox, canvasRef.current);
    if (region) setRegions((prev) => [...prev, region]);
    setCurrentBox(null);
  };

  const updateRegion = (index: number, updates: Partial<MatchedRegion>) => {
    setRegions((prev) => applyRegionUpdate(prev, index, updates, pokemonName));
  };

  const deleteRegion = (index: number) => {
    setRegions(regions.filter((_, i) => i !== index));
  };

  const handleRunOCR = async (regionIndex: number) => {
    const region = regions[regionIndex];
    if (region?.type !== "text" || !canvasRef.current) return;

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = region.rect.w;
    cropCanvas.height = region.rect.h;
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) return;
    cropCtx.drawImage(
      canvasRef.current,
      region.rect.x, region.rect.y,
      region.rect.w, region.rect.h,
      0, 0,
      region.rect.w, region.rect.h,
    );

    const recognized = await recognize(cropCanvas, ocrLang);
    if (recognized) {
      updateRegion(regionIndex, { expected_text: recognized });
    }
  };

  const handleSave = async () => {
    if (phase !== "snapshot" || !canvasRef.current) return;

    let finalRegions = regions;
    if (finalRegions.length === 0) {
      finalRegions = [{
        type: "image",
        expected_text: "",
        rect: { x: 0, y: 0, w: canvasRef.current.width, h: canvasRef.current.height },
      }];
    }

    setIsSaving(true);
    setErrorMsg(null);
    try {
      const trimmedName = templateName.trim() || undefined;
      if (onUpdateRegions) {
        await onUpdateRegions(finalRegions, trimmedName);
      } else if (onSaveTemplate) {
        const base64Data = canvasRef.current.toDataURL("image/png");
        await onSaveTemplate({ imageBase64: base64Data, regions: finalRegions, name: trimmedName });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save template";
      setErrorMsg(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const hasTextRegion = regions.some((r) => r.type === "text");

  // --- Heading / hint for each phase -----------------------------------------

  const isEditMode = !!initialImageUrl || !!onUpdateRegions;
  const { heading, hint } = resolveHeadingAndHint(phase, isEditMode, t);

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
        <h2 className="text-xl 2xl:text-2xl font-bold mb-1">{heading}</h2>
        <p className="text-sm 2xl:text-base text-gray-400 mb-2">{hint}</p>
        {/* Template name input — always visible in snapshot/edit phase */}
        {(phase === "snapshot" || isEditMode) && (
          <input
            type="text"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder={t("templateEditor.templateName")}
            className="mx-auto w-full max-w-xs px-3 py-1.5 text-sm bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 outline-none focus:border-accent-blue/50 transition-colors text-center"
            aria-label={t("templateEditor.templateName")}
          />
        )}
      </div>

      <div
        ref={containerRef}
        className={`relative w-full max-w-[80vw] 2xl:max-w-[85vw] max-h-[55vh] 2xl:max-h-[60vh] aspect-video bg-black rounded-lg overflow-hidden shadow-2xl mb-3 flex items-center justify-center select-none touch-none ${
          phase === "snapshot" ? "cursor-crosshair" : "cursor-default"
        }`}
        onMouseDown={phase === "snapshot" ? onPointerDown : undefined}
        onMouseMove={phase === "snapshot" ? onPointerMove : undefined}
        onMouseUp={phase === "snapshot" ? onPointerUp : undefined}
        onMouseLeave={phase === "snapshot" ? onPointerUp : undefined}
        onTouchStart={phase === "snapshot" ? onPointerDown : undefined}
        onTouchMove={phase === "snapshot" ? onPointerMove : undefined}
        onTouchEnd={phase === "snapshot" ? onPointerUp : undefined}
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
              <div className="absolute top-3 right-3 flex items-center gap-2 bg-black/70 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs font-mono text-white">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                {Math.floor(replayBuffer.bufferedSeconds)}s / 30s
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
              <RegionOverlayItem
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
          {regions.map((r, i) => {
            const isNeg = r.polarity === "negative";
            const textOrAccent = r.type === "text" ? "text-purple-400" : "text-accent-blue";
            const editLabelColor = isNeg ? "text-red-400" : textOrAccent;
            return (
            <div key={`region-edit-${r.type}-${r.rect.x}-${r.rect.y}-${i}`} className={`flex items-center gap-2 bg-bg-card border rounded-lg px-3 py-2 shadow-lg transition-colors ${isNeg ? "border-red-500/50 hover:border-red-400" : "border-border-subtle hover:border-accent-blue/50"}`}>
              <span className={`font-mono font-bold w-5 shrink-0 ${editLabelColor}`}>
                #{i + 1}
              </span>
              {!isNeg && (
                <select
                  className="bg-bg-primary text-xs 2xl:text-sm p-1 2xl:p-1.5 rounded border border-border-subtle outline-none min-w-25 2xl:min-w-30"
                  value={r.type}
                  onChange={(e) => updateRegion(i, { type: e.target.value as "image" | "text" })}
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
                    onChange={(e) => updateRegion(i, { expected_text: e.target.value })}
                    className="bg-bg-primary text-xs 2xl:text-sm p-1 2xl:p-1.5 rounded border border-border-subtle outline-none min-w-30 2xl:min-w-35 focus:border-purple-400"
                  />
                  <button
                    title="Auto-recognize text (OCR)"
                    onClick={() => handleRunOCR(i)}
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
                onClick={() => updateRegion(i, { polarity: isNeg ? "positive" : "negative" })}
                className={`transition-colors p-1 ${isNeg ? "text-red-400 hover:text-green-400" : "text-text-muted hover:text-red-400"}`}
              >
                <ShieldBan className="w-4 h-4 2xl:w-5 2xl:h-5" />
              </button>
              <button
                title={t("templateEditor.deleteRegion")}
                onClick={() => deleteRegion(i)}
                className="text-text-muted hover:text-red-400 transition-colors p-1"
              >
                 <Trash2 className="w-4 h-4 2xl:w-5 2xl:h-5" />
              </button>
            </div>
            );
          })}
        </div>
      )}

      {/* Hints below region list */}
      {phase === "snapshot" && (
        <SnapshotHints hasTextRegion={hasTextRegion} regionsEmpty={regions.length === 0} ocrError={ocrError} t={t} />
      )}

      {/* Flow Controls */}
      <div className="flex flex-col items-center gap-3 w-full max-w-sm 2xl:max-w-md shrink-0">
        {isEditMode ? (
          <div className="flex w-full gap-3">
            <button
              onClick={onClose}
              disabled={isSaving}
              className="flex-1 flex items-center justify-center gap-2 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold bg-white/10 text-white hover:bg-white/20 transition-all disabled:opacity-50"
            >
              {t("templateEditor.cancel")}
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-2 flex items-center justify-center gap-2 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold bg-accent-blue text-white shadow-lg shadow-accent-blue/20 hover:bg-accent-blue/90 hover:scale-[1.02] transition-all disabled:opacity-50"
            >
              <Save className="w-5 h-5 2xl:w-6 2xl:h-6" />
              {isSaving ? t("templateEditor.saving") : t("templateEditor.saveTemplate")}
            </button>
          </div>
        ) : (
          <NewTemplateControls
            phase={phase}
            isSaving={isSaving}
            onTakeSnapshot={handleTakeSnapshot}
            onResetSnapshot={resetSnapshot}
            onSave={handleSave}
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
    </div>
  );

  return createPortal(modalContent, document.body);
}
