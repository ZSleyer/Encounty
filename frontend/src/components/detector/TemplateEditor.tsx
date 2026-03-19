import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, Camera, Save, RefreshCw, Trash2, Image as ImageIcon, Type, Loader2, ScanText } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { MatchedRegion } from "../../types";
import { useOCR } from "../../hooks/useOCR";

export type TemplateEditorProps = Readonly<{
  /** Live video stream for new-template mode. If omitted, edit mode is assumed. */
  stream?: MediaStream;
  onClose: () => void;
  /** Called when saving a new template (new-template mode). */
  onSaveTemplate?: (payload: { imageBase64: string; regions: MatchedRegion[] }) => Promise<void>;
  /** Called when updating regions of an existing template (edit mode). */
  onUpdateRegions?: (regions: MatchedRegion[]) => Promise<void>;
  /** Pre-load an existing template image by URL (edit mode). */
  initialImageUrl?: string;
  /** Pre-load existing regions (edit mode). */
  initialRegions?: MatchedRegion[];
  /** Pokémon name — pre-fills expected_text when switching a region to type "text". */
  pokemonName?: string;
  /** Tesseract language code for OCR auto-recognition (e.g. "deu", "eng"). */
  ocrLang?: string;
}>;

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<"video" | "snapshot">("video");
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

  const { recognize, isRecognizing, ocrError } = useOCR(ocrLang);

  // Track the actual rendered image area within the object-contain container.
  // object-contain can produce letterboxing — overlays and mouse coords must
  // be relative to the image, not the full container.
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

  useEffect(() => {
    if (phase === "video" && videoRef.current && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream ?? null;
      videoRef.current.play().catch(() => {});
    }
  }, [stream, phase]);

  const handleTakeSnapshot = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
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

    // Start with no pre-drawn regions — the game layout varies too much
    // to guess useful coordinates automatically.
    setRegions([]);

    setCurrentBox(null);
    setErrorMsg(null);
  };

  const resetSnapshot = () => {
    setPhase("video");
    setCurrentBox(null);
    setRegions([]);
    setErrorMsg(null);
  };

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

    // Account for object-contain letterboxing: map mouse position
    // relative to the actual rendered image area, not the full container.
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
      // Map to absolute pixels
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
    // When switching to text type, pre-fill expected_text with the pokémon name
    // if the field is currently empty, so the user has a useful starting point.
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
    if (!region || region.type !== "text" || !canvasRef.current) return;

    // Crop the canvas to the region rect.
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
    // If no regions were drawn, make the whole image one 'image' region
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
        // Edit mode: only update regions, no image upload.
        await onUpdateRegions(finalRegions);
      } else if (onSaveTemplate) {
        // New template mode: upload image + regions.
        const base64Data = canvasRef.current.toDataURL("image/jpeg", 0.9);
        await onSaveTemplate({ imageBase64: base64Data, regions: finalRegions });
      }
    } catch (e: any) {
      setErrorMsg(e.message || "Failed to save template");
    } finally {
      setIsSaving(false);
    }
  };

  // Whether any region uses OCR text matching
  const hasTextRegion = regions.some((r) => r.type === "text");

  // Edit mode: either an initial image URL was provided, or we only have onUpdateRegions.
  const isEditMode = !!initialImageUrl || !!onUpdateRegions;

  const modalContent = (
    <div className="fixed inset-0 z-100 bg-black/95 flex flex-col items-center justify-center p-4 md:p-8 backdrop-blur-sm">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 md:top-8 md:right-8 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-110"
      >
        <X className="w-6 h-6 2xl:w-7 2xl:h-7" />
      </button>

      <div className="text-white text-center mb-4 mt-8 shrink-0">
        <h2 className="text-xl 2xl:text-2xl font-bold mb-1">
          {isEditMode
            ? t("templateEditor.editTitle")
            : phase === "video"
            ? t("templateEditor.step1Title")
            : t("templateEditor.step2Title")}
        </h2>
        <p className="text-sm 2xl:text-base text-gray-400">
          {isEditMode
            ? t("templateEditor.editHint")
            : phase === "video"
            ? t("templateEditor.step1Hint")
            : t("templateEditor.step2Hint")}
        </p>
      </div>

      <div
        ref={containerRef}
        className="relative w-full max-w-[80vw] 2xl:max-w-[85vw] max-h-[60vh] 2xl:max-h-[65vh] aspect-video bg-black rounded-lg overflow-hidden shadow-2xl mb-6 flex items-center justify-center cursor-crosshair select-none touch-none"
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={onPointerUp}
        onMouseLeave={onPointerUp}
        onTouchStart={onPointerDown}
        onTouchMove={onPointerMove}
        onTouchEnd={onPointerUp}
      >
        {/* Video feed layer — hidden in edit mode */}
        {!isEditMode && (
          <video
            ref={videoRef}
            className={`w-full h-full object-contain pointer-events-none ${phase === "video" ? "" : "hidden"}`}
            autoPlay
            playsInline
            muted
          />
        )}

        {/* Snapshot canvas layer */}
        <canvas
          ref={canvasRef}
          className={`w-full h-full object-contain pointer-events-none ${phase === "snapshot" ? "" : "hidden"}`}
        />

        {/* Overlay wrapper — positioned to match the rendered image area
            within the object-contain container, so percentage-based region
            positioning is correct even with letterboxing. */}
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
                    ? 'border-purple-500 bg-purple-500/20'
                    : 'border-accent-blue bg-accent-blue/20'
                }`}
                style={{
                  left: `${(r.rect.x / snapshotWidth) * 100}%`,
                  top: `${(r.rect.y / snapshotHeight) * 100}%`,
                  width: `${(r.rect.w / snapshotWidth) * 100}%`,
                  height: `${(r.rect.h / snapshotHeight) * 100}%`,
                }}
              >
                <div className="absolute -top-6 left-0 flex items-center gap-1 bg-black/80 px-1.5 py-0.5 2xl:px-2 2xl:py-1 rounded text-white font-mono text-xs 2xl:text-sm whitespace-nowrap shadow-md">
                  <strong className={r.type === 'text' ? 'text-purple-400' : 'text-accent-blue'}>#{i + 1}</strong>
                  {r.type === 'text' ? <Type className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" /> : <ImageIcon className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />}
                  {r.type === 'text' && r.expected_text ? (
                    <span className="opacity-80 ml-1 truncate max-w-[60px]">"{r.expected_text}"</span>
                  ) : null}
                </div>
              </div>
            ))}

            {/* Current drawing box */}
            {currentBox && currentBox.w > 0 && currentBox.h > 0 && (
              <div
                className="absolute border-2 border-white border-dashed bg-white/10 pointer-events-none"
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
                className="bg-bg-primary text-xs 2xl:text-sm p-1 2xl:p-1.5 rounded border border-border-subtle outline-none min-w-[100px] 2xl:min-w-[120px]"
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
                    className="bg-bg-primary text-xs 2xl:text-sm p-1 2xl:p-1.5 rounded border border-border-subtle outline-none min-w-[120px] 2xl:min-w-[140px] focus:border-purple-400"
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
          // Edit mode: just show Save/Cancel
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
        ) : phase === "video" ? (
          // New template mode: take snapshot
          <button
            onClick={handleTakeSnapshot}
            className="flex items-center justify-center gap-2 w-full py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold bg-accent-blue text-white shadow-lg shadow-accent-blue/20 hover:bg-accent-blue/90 hover:scale-[1.02] transition-all"
          >
            <Camera className="w-5 h-5 2xl:w-6 2xl:h-6" />
            {t("templateEditor.takeSnapshot")}
          </button>
        ) : (
          // New template mode: retake or save
          <div className="flex w-full gap-3">
            <button
              onClick={resetSnapshot}
              disabled={isSaving}
              className="flex-1 flex items-center justify-center gap-2 py-4 2xl:py-5 rounded-xl text-sm 2xl:text-base font-bold bg-white/10 text-white hover:bg-white/20 transition-all disabled:opacity-50"
            >
              <RefreshCw className="w-4 h-4 2xl:w-5 2xl:h-5" />
              {t("templateEditor.retake")}
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
