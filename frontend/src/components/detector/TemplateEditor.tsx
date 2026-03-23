/**
 * TemplateEditor.tsx — Template creation and region editing for auto-detection.
 *
 * In new-template mode, shows a live preview from the sidecar capture stream,
 * lets the user take a replay-buffer snapshot, scrub through frames to pick
 * the best one, then draw detection regions on it.
 * In edit mode, loads an existing template image for region editing.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  X, Camera, Save, RefreshCw, Trash2, Image as ImageIcon,
  Type, Loader2, ScanText, ChevronLeft, ChevronRight,
} from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { MatchedRegion } from "../../types";
import { useOCR } from "../../hooks/useOCR";
import { apiUrl } from "../../utils/api";
import { useVideoStream } from "../../hooks/useVideoStream";
import { useMJPEGStream } from "../../hooks/useMJPEGStream";

export type TemplateEditorProps = Readonly<{
  /** Pokemon ID for fetching sidecar capture frames (new-template mode). */
  pokemonId?: string;
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

type Phase = "live" | "replay" | "snapshot";

// --- Replay buffer status type -----------------------------------------------

type ReplayStatus = {
  duration_sec: number;
  frame_count: number;
};

type SnapshotResponse = {
  frame_count: number;
  duration_sec: number;
  path: string;
};

// --- Live Preview Component --------------------------------------------------

/** Embedded live preview using the video/MJPEG stream hooks.
 *
 * Ensures the sidecar preview stream is active while mounted, so the
 * template editor always shows a live image even if the main panel's
 * 30-second preview timer has expired.
 */
function LivePreview({ pokemonId }: Readonly<{ pokemonId: string }>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Start preview stream on mount, stop on unmount.
  useEffect(() => {
    fetch(apiUrl(`/api/detector/${pokemonId}/preview/start`), {
      method: "POST",
    }).catch(() => {});
    return () => {
      fetch(apiUrl(`/api/detector/${pokemonId}/preview/stop`), {
        method: "POST",
      }).catch(() => {});
    };
  }, [pokemonId]);

  const streamUrl = apiUrl(`/api/detector/${pokemonId}/stream`);
  const mjpegUrl = apiUrl(`/api/detector/${pokemonId}/mjpeg`);
  const { active: videoActive } = useVideoStream(streamUrl, videoRef);
  useMJPEGStream(videoActive ? null : mjpegUrl, canvasRef);

  return (
    <>
      <video
        ref={videoRef}
        className={`w-full h-full object-contain ${videoActive ? "" : "hidden"}`}
        autoPlay
        muted
        playsInline
      />
      <canvas
        ref={canvasRef}
        className={`w-full h-full ${videoActive ? "hidden" : ""}`}
      />
    </>
  );
}

// --- Replay Scrubber Component -----------------------------------------------

/** Timeline scrubber for replay buffer frames. */
function ReplayScrubber({
  pokemonId,
  frameCount,
  durationSec,
  onUseFrame,
  onBackToLive,
  t,
}: Readonly<{
  pokemonId: string;
  frameCount: number;
  durationSec: number;
  onUseFrame: (blob: Blob) => void;
  onBackToLive: () => void;
  t: (k: string) => string;
}>) {
  const [currentIndex, setCurrentIndex] = useState(frameCount - 1);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const prevUrlRef = useRef<string | null>(null);
  const currentBlobRef = useRef<Blob | null>(null);

  // Fetch frame image when index changes
  useEffect(() => {
    if (frameCount === 0) return;

    let cancelled = false;
    setIsLoading(true);

    fetch(apiUrl(`/api/detector/${pokemonId}/replay/snapshot/${currentIndex}`))
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch frame");
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        currentBlobRef.current = blob;
        const url = URL.createObjectURL(blob);
        // Revoke previous URL to prevent memory leaks
        if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
        prevUrlRef.current = url;
        setFrameUrl(url);
      })
      .catch(() => {
        // Ignore fetch errors for rapid scrubbing
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pokemonId, currentIndex, frameCount]);

  // Cleanup object URL on unmount
  useEffect(() => {
    return () => {
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    };
  }, []);

  // Keyboard navigation: Arrow Left/Right +/-1, Shift+Arrow +/-5
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 5 : 1;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCurrentIndex((prev) => Math.max(0, prev - step));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setCurrentIndex((prev) => Math.min(frameCount - 1, prev + step));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [frameCount]);

  // Compute negative time offset from the newest frame
  const timeOffset = frameCount > 1
    ? -((frameCount - 1 - currentIndex) / (frameCount - 1)) * durationSec
    : 0;

  const handleUseFrame = () => {
    if (currentBlobRef.current) {
      onUseFrame(currentBlobRef.current);
    }
  };

  return (
    <div className="w-full flex flex-col items-center">
      {/* Frame display */}
      <div className="relative w-full max-w-[80vw] 2xl:max-w-[85vw] max-h-[55vh] 2xl:max-h-[60vh] aspect-video bg-black rounded-lg overflow-hidden shadow-2xl mb-4 flex items-center justify-center">
        {frameUrl ? (
          <img
            src={frameUrl}
            alt={`Replay frame ${currentIndex + 1}`}
            className="w-full h-full object-contain"
          />
        ) : (
          <Loader2 className="w-8 h-8 text-white/40 animate-spin" />
        )}
        {isLoading && frameUrl && (
          <div className="absolute top-2 right-2">
            <Loader2 className="w-4 h-4 text-white/60 animate-spin" />
          </div>
        )}
      </div>

      {/* Timeline controls */}
      <div className="w-full max-w-[80vw] 2xl:max-w-[85vw] px-4 mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
            disabled={currentIndex === 0}
            className="p-1.5 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <input
            type="range"
            min={0}
            max={Math.max(0, frameCount - 1)}
            value={currentIndex}
            onChange={(e) => setCurrentIndex(Number(e.target.value))}
            className="flex-1 h-2 rounded-full appearance-none bg-white/20 accent-accent-blue cursor-pointer"
          />

          <button
            onClick={() => setCurrentIndex((prev) => Math.min(frameCount - 1, prev + 1))}
            disabled={currentIndex >= frameCount - 1}
            className="p-1.5 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors disabled:opacity-30"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-between mt-2 text-xs text-white/50 font-mono">
          <span>{timeOffset.toFixed(1)}s</span>
          <span>{currentIndex + 1} / {frameCount}</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex w-full max-w-sm 2xl:max-w-md gap-3">
        <button
          onClick={onBackToLive}
          className="flex-1 flex items-center justify-center gap-2 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold bg-white/10 text-white hover:bg-white/20 transition-all"
        >
          <RefreshCw className="w-4 h-4 2xl:w-5 2xl:h-5" />
          {t("templateEditor.backToLive")}
        </button>
        <button
          onClick={handleUseFrame}
          disabled={!currentBlobRef.current}
          className="flex-2 flex items-center justify-center gap-2 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold bg-accent-blue text-white shadow-lg shadow-accent-blue/20 hover:bg-accent-blue/90 hover:scale-[1.02] transition-all disabled:opacity-50"
        >
          <Camera className="w-5 h-5 2xl:w-6 2xl:h-6" />
          {t("templateEditor.useFrame")}
        </button>
      </div>
    </div>
  );
}

// --- Flow Controls -----------------------------------------------------------

/** Flow controls for the "live" phase: snapshot button + buffer status. */
function LiveControls({
  pokemonId,
  onSnapshot,
  isCapturing,
  t,
}: Readonly<{
  pokemonId: string;
  onSnapshot: () => void;
  isCapturing: boolean;
  t: (k: string) => string;
}>) {
  const [bufferStatus, setBufferStatus] = useState<ReplayStatus | null>(null);

  // Poll replay buffer status every 2 seconds
  useEffect(() => {
    let cancelled = false;

    const poll = () => {
      fetch(apiUrl(`/api/detector/${pokemonId}/replay/status`))
        .then((res) => res.ok ? res.json() : null)
        .then((data: ReplayStatus | null) => {
          if (!cancelled && data) setBufferStatus(data);
        })
        .catch(() => {});
    };

    poll();
    const timer = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pokemonId]);

  const bufferLabel = bufferStatus
    ? `${Math.round(bufferStatus.duration_sec)}s / 30s`
    : null;

  return (
    <div className="flex flex-col items-center gap-2 w-full">
      <button
        onClick={onSnapshot}
        disabled={isCapturing}
        className="flex items-center justify-center gap-2 w-full py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold bg-accent-blue text-white shadow-lg shadow-accent-blue/20 hover:bg-accent-blue/90 hover:scale-[1.02] transition-all disabled:opacity-50"
      >
        {isCapturing ? (
          <Loader2 className="w-5 h-5 2xl:w-6 2xl:h-6 animate-spin" />
        ) : (
          <Camera className="w-5 h-5 2xl:w-6 2xl:h-6" />
        )}
        {isCapturing ? t("templateEditor.capturing") : t("templateEditor.takeSnapshot")}
      </button>
      {bufferLabel && (
        <div className="flex items-center gap-2 text-xs text-white/50">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="font-mono">{bufferLabel}</span>
        </div>
      )}
    </div>
  );
}

/** Flow controls for the "snapshot" phase: retake + save. */
function SnapshotControls({
  isSaving,
  onResetSnapshot,
  onSave,
  t,
}: Readonly<{
  isSaving: boolean;
  onResetSnapshot: () => void;
  onSave: () => void;
  t: (k: string) => string;
}>) {
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
  pokemonId,
  onClose,
  onSaveTemplate,
  onUpdateRegions,
  initialImageUrl,
  initialRegions,
  pokemonName,
  ocrLang = "eng",
}: TemplateEditorProps) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<Phase>("live");
  const [isCapturing, setIsCapturing] = useState(false);
  const [snapshotWidth, setSnapshotWidth] = useState(0);
  const [snapshotHeight, setSnapshotHeight] = useState(0);

  // Replay state
  const [replayFrameCount, setReplayFrameCount] = useState(0);
  const [replayDuration, setReplayDuration] = useState(0);

  // Array of confirmed regions (absolute pixel coords in the snapshot)
  const [regions, setRegions] = useState<MatchedRegion[]>([]);

  // Bounding box drawing state (relative coords 0.0 - 1.0)
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentBox, setCurrentBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { recognize, isRecognizing, ocrError } = useOCR(ocrLang);

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
    if (phase !== "snapshot" || snapshotWidth === 0 || snapshotHeight === 0) {
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

  // --- Replay buffer snapshot ------------------------------------------------

  /** Take a replay buffer snapshot and transition to the replay phase. */
  const handleTakeSnapshot = async () => {
    if (!pokemonId) return;
    setIsCapturing(true);
    setErrorMsg(null);
    try {
      const res = await fetch(apiUrl(`/api/detector/${pokemonId}/replay/snapshot`), {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setErrorMsg(body.error ?? t("detector.errCaptureFailed"));
        return;
      }
      const data = (await res.json()) as SnapshotResponse;
      setReplayFrameCount(data.frame_count);
      setReplayDuration(data.duration_sec);
      setPhase("replay");
    } catch {
      setErrorMsg(t("detector.errCaptureFailed"));
    } finally {
      setIsCapturing(false);
    }
  };

  /** Go back to live from replay, cleaning up the snapshot on the server. */
  const handleBackToLive = () => {
    if (pokemonId) {
      fetch(apiUrl(`/api/detector/${pokemonId}/replay/snapshot`), {
        method: "DELETE",
      }).catch(() => {});
    }
    setPhase("live");
    setReplayFrameCount(0);
    setReplayDuration(0);
    setErrorMsg(null);
  };

  /** Use a selected replay frame: draw it on the canvas and enter snapshot phase. */
  const handleUseFrame = async (blob: Blob) => {
    if (!canvasRef.current) return;
    try {
      const bitmap = await createImageBitmap(blob);
      canvasRef.current.width = bitmap.width;
      canvasRef.current.height = bitmap.height;
      setSnapshotWidth(bitmap.width);
      setSnapshotHeight(bitmap.height);

      const ctx = canvasRef.current.getContext("2d");
      if (ctx) ctx.drawImage(bitmap, 0, 0);
      bitmap.close();

      setPhase("snapshot");
      setRegions([]);
      setCurrentBox(null);
    } catch {
      setErrorMsg(t("detector.errCaptureFailed"));
    }
  };

  const resetSnapshot = () => {
    setPhase("live");
    setCurrentBox(null);
    setRegions([]);
    setErrorMsg(null);
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
    if (phase === "live") {
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

      {/* Replay phase uses its own layout with the scrubber */}
      {!isEditMode && phase === "replay" && pokemonId && (
        <ReplayScrubber
          pokemonId={pokemonId}
          frameCount={replayFrameCount}
          durationSec={replayDuration}
          onUseFrame={handleUseFrame}
          onBackToLive={handleBackToLive}
          t={t}
        />
      )}

      {/* Live + Snapshot + Replay phases use the shared container (canvas must
          exist during replay so handleUseFrame can draw the selected frame). */}
      {(phase === "live" || phase === "replay" || phase === "snapshot" || isEditMode) && (
        <>
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
            {/* Live preview when no snapshot has been taken yet */}
            {!isEditMode && phase === "live" && pokemonId && (
              <LivePreview pokemonId={pokemonId} />
            )}

            {/* Fallback when no pokemonId (should not happen in new-template mode) */}
            {!isEditMode && phase === "live" && !pokemonId && (
              <div className="w-full h-full flex flex-col items-center justify-center">
                <Camera className="w-12 h-12 2xl:w-14 2xl:h-14 text-white/20 mb-3" />
                <p className="text-sm text-white/40">{t("templateEditor.captureHint")}</p>
              </div>
            )}

            {/* Snapshot canvas layer */}
            <canvas
              ref={canvasRef}
              className={`w-full h-full object-contain pointer-events-none ${phase === "snapshot" ? "" : "hidden"}`}
            />

            {/* Overlay wrapper for regions and drawing box */}
            {phase === "snapshot" && imageBounds && (
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
                  <div
                    key={`region-${r.type}-${r.rect.x}-${r.rect.y}-${i}`}
                    className={`absolute border-[3px] pointer-events-none transition-colors ${
                      r.type === 'text'
                        ? 'border-purple-500 bg-purple-500/30'
                        : 'border-accent-blue bg-accent-blue/30'
                    }`}
                    style={{
                      left: `${(r.rect.x / snapshotWidth) * 100}%`,
                      top: `${(r.rect.y / snapshotHeight) * 100}%`,
                      width: `${(r.rect.w / snapshotWidth) * 100}%`,
                      height: `${(r.rect.h / snapshotHeight) * 100}%`,
                    }}
                  >
                    <div className="absolute -top-6 left-0 flex items-center gap-1 bg-black/80 px-1.5 py-0.5 2xl:px-2 2xl:py-1 rounded text-white font-mono text-xs 2xl:text-sm whitespace-nowrap shadow-lg ring-1 ring-black/30">
                      <strong className={r.type === 'text' ? 'text-purple-400' : 'text-accent-blue'}>#{i + 1}</strong>
                      {r.type === 'text' ? <Type className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" /> : <ImageIcon className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />}
                      {r.type === 'text' && r.expected_text ? (
                        <span className="opacity-80 ml-1 truncate max-w-15">"{r.expected_text}"</span>
                      ) : null}
                    </div>
                  </div>
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

          {/* Region List Editor */}
          {phase === "snapshot" && regions.length > 0 && (
            <div className="w-full max-w-4xl 2xl:max-w-5xl flex flex-wrap justify-center gap-3 mb-2 max-h-32 2xl:max-h-40 overflow-y-auto px-4 scrollbar-thin scrollbar-thumb-border-subtle hover:scrollbar-thumb-border-strong text-white z-50 rounded-lg">
              {regions.map((r, i) => (
                <div key={`region-edit-${r.type}-${r.rect.x}-${r.rect.y}-${i}`} className="flex items-center gap-2 bg-bg-card border border-border-subtle rounded-lg px-3 py-2 shadow-lg hover:border-accent-blue/50 transition-colors">
                  <span className={`font-mono font-bold w-5 shrink-0 ${r.type === 'text' ? 'text-purple-400' : 'text-accent-blue'}`}>
                    #{i + 1}
                  </span>
                  <select
                    className="bg-bg-primary text-xs 2xl:text-sm p-1 2xl:p-1.5 rounded border border-border-subtle outline-none min-w-25 2xl:min-w-30"
                    value={r.type}
                    onChange={(e) => updateRegion(i, { type: e.target.value as "image" | "text" })}
                  >
                    <option value="image">{t("templateEditor.regionImage")}</option>
                    <option value="text">{t("templateEditor.regionText")} (OCR)</option>
                  </select>
                  {r.type === "text" && (
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
                    title={t("templateEditor.deleteRegion")}
                    onClick={() => deleteRegion(i)}
                    className="text-text-muted hover:text-red-400 transition-colors p-1"
                  >
                     <Trash2 className="w-4 h-4 2xl:w-5 2xl:h-5" />
                  </button>
                </div>
              ))}
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
            ) : phase === "live" && pokemonId ? (
              <LiveControls
                pokemonId={pokemonId}
                onSnapshot={handleTakeSnapshot}
                isCapturing={isCapturing}
                t={t}
              />
            ) : phase === "snapshot" ? (
              <SnapshotControls
                isSaving={isSaving}
                onResetSnapshot={resetSnapshot}
                onSave={handleSave}
                t={t}
              />
            ) : null}

            {errorMsg && (
              <div className="w-full px-4 py-3 bg-red-500/10 text-red-500 text-sm 2xl:text-base text-center rounded-lg font-medium border border-red-500/20">
                {errorMsg}
              </div>
            )}
          </div>
        </>
      )}

      {/* Error display for replay phase */}
      {phase === "replay" && errorMsg && (
        <div className="w-full max-w-sm px-4 py-3 bg-red-500/10 text-red-500 text-sm 2xl:text-base text-center rounded-lg font-medium border border-red-500/20 mt-3">
          {errorMsg}
        </div>
      )}
    </div>
  );

  return createPortal(modalContent, document.body);
}
