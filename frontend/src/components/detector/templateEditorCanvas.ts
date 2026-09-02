/**
 * templateEditorCanvas.ts -- Video, canvas and OCR side effects of the editor.
 *
 * Wires the capture stream to the preview video, moves frames onto the
 * snapshot canvas, tracks the letterboxed image bounds and runs OCR on a
 * single region crop.
 */
import { MatchedRegion } from "../../types";
import { preprocessForOCR } from "../../engine/ocrPreprocess";
import type { Phase } from "./templateEditorTypes";

/** Wires a MediaStream to the video element when in video phase. */
export function wireStreamToVideo(
  phase: Phase,
  videoEl: HTMLVideoElement | null,
  stream: MediaStream | undefined,
) {
  if (phase === "video" && videoEl && videoEl.srcObject !== stream) {
    videoEl.srcObject = stream ?? null;
    videoEl.play().catch(() => {});
  }
}

/** Loads an existing template image into the canvas for edit mode. */
export function loadInitialImage(
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
export function renderReplayFrame(
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

/** Restores the stored match frame onto the canvas so scrubbing previews don't leak into the saved template. */
export function restoreMatchFrame(matchFrame: ImageData | null, canvas: HTMLCanvasElement | null) {
  if (!matchFrame || !canvas) return;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.putImageData(matchFrame, 0, 0);
}

/** Sets up a ResizeObserver for image bounds tracking in snapshot/replay phases. */
export function observeImageBounds(
  phase: Phase,
  snapshotWidth: number,
  snapshotHeight: number,
  container: HTMLDivElement | null,
  updateBounds: () => void,
  setImageBounds: (v: null) => void,
): (() => void) | undefined {
  if (
    (phase !== "snapshot" && phase !== "replay" && phase !== "test" && phase !== "confirm") ||
    snapshotWidth === 0 ||
    snapshotHeight === 0
  ) {
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
export async function runRegionOCR(
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
  ctx.drawImage(
    sourceCanvas,
    region.rect.x,
    region.rect.y,
    region.rect.w,
    region.rect.h,
    0,
    0,
    region.rect.w,
    region.rect.h,
  );
  // Upscale and binarize the crop first; raw game-font crops are usually too
  // small and low-contrast for tesseract to read reliably.
  return recognize(preprocessForOCR(crop), lang);
}

/** Captures the current video frame directly onto the canvas. */
export function captureVideoFrame(
  videoEl: HTMLVideoElement | null,
  canvas: HTMLCanvasElement | null,
  setW: (w: number) => void,
  setH: (h: number) => void,
  setPhase: (p: Phase) => void,
  onReset: () => void,
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
export function drawFrameToCanvas(
  frame: ImageData | null,
  canvas: HTMLCanvasElement | null,
  setW: (w: number) => void,
  setH: (h: number) => void,
  setPhase: (p: Phase) => void,
  onReset: () => void,
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
