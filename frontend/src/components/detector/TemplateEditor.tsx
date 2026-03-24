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
  onSaveTemplate?: (payload: { imageBase64: string; regions: MatchedRegion[] }) => Promise<void>;
  /** Called when updating regions of an existing template (edit mode). */
  onUpdateRegions?: (regions: MatchedRegion[]) => void | Promise<void>;
  /** Pre-load an existing template image by URL (edit mode). */
  initialImageUrl?: string;
  /** Pre-load existing regions (edit mode). */
  initialRegions?: MatchedRegion[];
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

// --- Main Component ----------------------------------------------------------

/** Template editor for creating new templates or editing existing ones. */
export function TemplateEditor({
  stream,
  onClose,
  onSaveTemplate,
  onUpdateRegions,
  initialImageUrl,
  initialRegions,
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
  const [imageBounds, setImageBounds] = useState<{
    offsetX: number; offsetY: number; renderedW: number; renderedH: number;
  } | null>(null);

  const updateImageBounds = useCallback(() => {
    if (!containerRef.current || snapshotWidth === 0 || snapshotHeight === 0) {
      setImageBounds(null);
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const scale = Math.min(rect.width / snapshotWidth, rect.height / snapshotHeight);
    const renderedW = snapshotWidth * scale;
    const renderedH = snapshotHeight * scale;
    setImageBounds({
      offsetX: (rect.width - renderedW) / 2,
      offsetY: (rect.height - renderedH) / 2,
      renderedW,
      renderedH,
    });
  }, [snapshotWidth, snapshotHeight]);

  useEffect(() => {
    if ((phase !== "snapshot" && phase !== "replay") || snapshotWidth === 0 || snapshotHeight === 0) {
      setImageBounds(null);
      return;
    }
    updateImageBounds();
    if (!containerRef.current) return;
    const observer = new ResizeObserver(updateImageBounds);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [phase, snapshotWidth, snapshotHeight, updateImageBounds]);

  // In edit mode, load the existing template image into the canvas immediately.
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
  }, [initialImageUrl]); // only run once on mount

  // Wire the stream to the video element when in "video" phase
  useEffect(() => {
    if (phase === "video" && videoEl && videoEl.srcObject !== stream) {
      videoEl.srcObject = stream ?? null;
      videoEl.play().catch(() => {});
    }
  }, [stream, phase, videoEl]);

  // Render selected replay frame to canvas
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
    if (ctx) {
      ctx.putImageData(frame, 0, 0);
    }
  }, [phase, selectedFrameIndex, replayBuffer]);

  // Keyboard navigation in replay phase
  useEffect(() => {
    if (phase !== "replay") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        setSelectedFrameIndex((prev) => Math.max(0, prev - step));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        setSelectedFrameIndex((prev) => Math.min(replayBuffer.frameCount - 1, prev + step));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase, replayBuffer.frameCount]);

  // --- Snapshot and replay handlers ------------------------------------------

  /** Stop the replay buffer and enter replay phase to browse captured frames. */
  const handleTakeSnapshot = () => {
    replayBuffer.stop();
    if (replayBuffer.frameCount > 0) {
      setSelectedFrameIndex(replayBuffer.frameCount - 1);
      setPhase("replay");
    } else {
      // Fallback: no frames buffered, capture current video frame directly
      if (!videoEl || !canvasRef.current) return;
      const video = videoEl;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      setSnapshotWidth(video.videoWidth);
      setSnapshotHeight(video.videoHeight);

      canvasRef.current.width = video.videoWidth;
      canvasRef.current.height = video.videoHeight;
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
      }
      setPhase("snapshot");
      setRegions([]);
      setCurrentBox(null);
      setErrorMsg(null);
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

  /** Go back to live video from replay — restarts the replay buffer. */
  const handleBackToLive = () => {
    setPhase("video");
    setSelectedFrameIndex(0);
    setCurrentBox(null);
    setRegions([]);
    setErrorMsg(null);
    replayBuffer.restart();
  };

  /** Reset the snapshot and go back to live video — restarts the replay buffer. */
  const resetSnapshot = () => {
    setPhase("video");
    setSelectedFrameIndex(0);
    setCurrentBox(null);
    setRegions([]);
    setErrorMsg(null);
    replayBuffer.restart();
  };

  // --- Region drawing --------------------------------------------------------

  const getRelativeMousePos = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    let clientX, clientY;

    if ("touches" in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    // Account for object-contain letterboxing
    if (imageBounds?.renderedW && imageBounds.renderedH > 0) {
      let x = (clientX - rect.left - imageBounds.offsetX) / imageBounds.renderedW;
      let y = (clientY - rect.top - imageBounds.offsetY) / imageBounds.renderedH;
      x = Math.max(0, Math.min(1, x));
      y = Math.max(0, Math.min(1, y));
      return { x, y };
    }

    let x = (clientX - rect.left) / rect.width;
    let y = (clientY - rect.top) / rect.height;
    x = Math.max(0, Math.min(1, x));
    y = Math.max(0, Math.min(1, y));
    return { x, y };
  };

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

    if (currentBox && currentBox.w > 0.01 && currentBox.h > 0.01 && canvasRef.current) {
      const pxX = Math.floor(currentBox.x * canvasRef.current.width);
      const pxY = Math.floor(currentBox.y * canvasRef.current.height);
      const pxW = Math.max(1, Math.floor(currentBox.w * canvasRef.current.width));
      const pxH = Math.max(1, Math.floor(currentBox.h * canvasRef.current.height));

      if (pxW > 5 && pxH > 5) {
        setRegions((prev) => [
          ...prev,
          {
            type: "image",
            expected_text: "",
            rect: { x: pxX, y: pxY, w: pxW, h: pxH },
          },
        ]);
      }
    }
    setCurrentBox(null);
  };

  const updateRegion = (index: number, updates: Partial<MatchedRegion>) => {
    const newReg = [...regions];
    const merged = { ...newReg[index], ...updates };
    // When switching to text type, pre-fill expected_text with the pokemon name
    if (updates.type === "text" && !merged.expected_text && pokemonName) {
      merged.expected_text = pokemonName;
    }
    newReg[index] = merged;
    setRegions(newReg);
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
      if (onUpdateRegions) {
        await onUpdateRegions(finalRegions);
      } else if (onSaveTemplate) {
        const base64Data = canvasRef.current.toDataURL("image/png");
        await onSaveTemplate({ imageBase64: base64Data, regions: finalRegions });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save template";
      setErrorMsg(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const hasTextRegion = regions.some((r) => r.type === "text");
  const isEditMode = !!initialImageUrl || !!onUpdateRegions;

  // --- Heading / hint for each phase -----------------------------------------

  const getHeadingAndHint = (): { heading: string; hint: string } => {
    if (isEditMode) {
      return { heading: t("templateEditor.editTitle"), hint: t("templateEditor.editHint") };
    }
    if (phase === "video") {
      return { heading: t("templateEditor.step1Title"), hint: t("templateEditor.step1Hint") };
    }
    if (phase === "replay") {
      return { heading: t("templateEditor.replayTitle"), hint: t("templateEditor.replayHint") };
    }
    return { heading: t("templateEditor.step2Title"), hint: t("templateEditor.step2Hint") };
  };

  const { heading, hint } = getHeadingAndHint();

  // --- Render ----------------------------------------------------------------

  const modalContent = (
    <div className="fixed inset-0 z-100 bg-black/95 flex flex-col items-center justify-center p-4 md:p-8 backdrop-blur-sm">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 md:top-8 md:right-8 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-110"
      >
        <X className="w-6 h-6 2xl:w-7 2xl:h-7" />
      </button>

      <div className="text-white text-center mb-4 mt-8 shrink-0">
        <h2 className="text-xl 2xl:text-2xl font-bold mb-1">{heading}</h2>
        <p className="text-sm 2xl:text-base text-gray-400">{hint}</p>
      </div>

      <div
        ref={containerRef}
        className={`relative w-full max-w-[80vw] 2xl:max-w-[85vw] max-h-[60vh] 2xl:max-h-[65vh] aspect-video bg-black rounded-lg overflow-hidden shadow-2xl mb-6 flex items-center justify-center select-none touch-none ${
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
            {snapshotWidth > 0 && regions.map((r, i) => {
              const isNeg = r.polarity === "negative";
              return (
                <div
                  key={`region-${r.type}-${r.rect.x}-${r.rect.y}-${i}`}
                  className={`absolute border-[3px] pointer-events-none transition-colors ${
                    isNeg
                      ? "border-red-500 bg-red-500/20 border-dashed"
                      : r.type === "text"
                        ? "border-purple-500 bg-purple-500/30"
                        : "border-accent-blue bg-accent-blue/30"
                  }`}
                  style={{
                    left: `${(r.rect.x / snapshotWidth) * 100}%`,
                    top: `${(r.rect.y / snapshotHeight) * 100}%`,
                    width: `${(r.rect.w / snapshotWidth) * 100}%`,
                    height: `${(r.rect.h / snapshotHeight) * 100}%`,
                  }}
                >
                  <div className="absolute -top-6 left-0 flex items-center gap-1 bg-black/80 px-1.5 py-0.5 2xl:px-2 2xl:py-1 rounded text-white font-mono text-xs 2xl:text-sm whitespace-nowrap shadow-lg ring-1 ring-black/30">
                    <strong className={isNeg ? "text-red-400" : r.type === "text" ? "text-purple-400" : "text-accent-blue"}>#{i + 1}</strong>
                    {isNeg ? (
                      <ShieldBan className="w-3 h-3 2xl:w-3.5 2xl:h-3.5 text-red-400" />
                    ) : r.type === "text" ? (
                      <Type className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />
                    ) : (
                      <ImageIcon className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />
                    )}
                    {isNeg && <span className="text-red-400 font-bold">NOT</span>}
                    {!isNeg && r.type === "text" && r.expected_text ? (
                      <span className="opacity-80 ml-1 truncate max-w-15">"{r.expected_text}"</span>
                    ) : null}
                  </div>
                </div>
              );
            })}

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
        <div className="w-full max-w-4xl 2xl:max-w-5xl flex flex-wrap justify-center gap-3 mb-2 max-h-32 2xl:max-h-40 overflow-y-auto px-4 scrollbar-thin scrollbar-thumb-border-subtle hover:scrollbar-thumb-border-strong text-white z-50 rounded-lg">
          {regions.map((r, i) => {
            const isNeg = r.polarity === "negative";
            return (
            <div key={`region-edit-${r.type}-${r.rect.x}-${r.rect.y}-${i}`} className={`flex items-center gap-2 bg-bg-card border rounded-lg px-3 py-2 shadow-lg transition-colors ${isNeg ? "border-red-500/50 hover:border-red-400" : "border-border-subtle hover:border-accent-blue/50"}`}>
              <span className={`font-mono font-bold w-5 shrink-0 ${isNeg ? "text-red-400" : r.type === "text" ? "text-purple-400" : "text-accent-blue"}`}>
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
        <div className="w-full max-w-4xl px-4 mb-4 flex flex-col items-center gap-1">
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
