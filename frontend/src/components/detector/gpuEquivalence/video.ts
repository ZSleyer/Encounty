/**
 * video.ts -- Video element and template loading for the equivalence run.
 *
 * Seeks fixture videos frame-accurately, captures frames as pixel data and
 * loads the template PNGs the scorers compare against.
 */
import { toGrayscale, downsampleGray } from "./cpuScoring";
import { type GroundTruthEntry } from "./fixtures";

/** Seek a video element to a specific time, with timeout. */
export function seekVideo(
  video: HTMLVideoElement,
  timeSec: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Seek timeout at ${timeSec.toFixed(3)}s`));
    }, 5000);

    // "seeked" alone is not enough: it can fire before the new frame is
    // actually presented, so canvas/WebGPU capture would still read the old
    // frame (in practice: every sample scores the very first frame). Wait for
    // both the seeked event and a presented video frame; a short fallback
    // covers seeks that land on the already-presented frame.
    let seeked = false;
    let framed = false;
    let frameFallback: ReturnType<typeof setTimeout> | null = null;

    const tryFinish = () => {
      if (!seeked) return;
      if (framed) {
        cleanup();
        resolve();
      } else if (frameFallback === null) {
        frameFallback = setTimeout(() => {
          cleanup();
          resolve();
        }, 150);
      }
    };

    const onSeeked = () => {
      seeked = true;
      tryFinish();
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      if (frameFallback !== null) clearTimeout(frameFallback);
      video.removeEventListener("seeked", onSeeked);
      signal.removeEventListener("abort", onAbort);
    };

    video.addEventListener("seeked", onSeeked, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(() => {
        framed = true;
        tryFinish();
      });
    } else {
      framed = true;
    }
    video.currentTime = timeSec;
  });
}

/** Wait for a video element to have loaded metadata and data. */
function waitForVideoReady(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Video load timeout"));
    }, 30000);

    const onReady = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error(`Video load error: ${video.error?.message ?? "unknown"}`));
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };

    video.addEventListener("loadeddata", onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Capture a frame from a video element as RGBA pixel data. */
export function captureFrame(video: HTMLVideoElement): {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const w = video.videoWidth;
  const h = video.videoHeight;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(video, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  return { pixels: imageData.data, width: w, height: h };
}

/** Create and wait for a video element to be ready. */
export async function loadVideoElement(
  videoName: string,
  signal: AbortSignal,
): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.crossOrigin = "anonymous";
  video.src = `/test-fixtures/${videoName}.mp4`;
  // A detached (or display:none) video is never composited, so seeks do not
  // present new frames: captures keep reading the first frame and
  // requestVideoFrameCallback never fires. Keep it in the DOM, invisible but
  // composited.
  video.style.position = "fixed";
  video.style.left = "0";
  video.style.bottom = "0";
  video.style.width = "4px";
  video.style.height = "4px";
  video.style.opacity = "0.01";
  video.style.pointerEvents = "none";
  document.body.appendChild(video);
  try {
    await waitForVideoReady(video, signal);
  } catch (e) {
    video.remove();
    throw e;
  }
  return video;
}

/** Clean up a video element after use. */
export function cleanupVideo(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute("src");
  video.load();
  video.remove();
}

/** Load a template PNG and return its bitmap and grayscale data. */
export async function loadTemplatePng(
  gt: GroundTruthEntry,
): Promise<{ bitmap: ImageBitmap; gray: Float32Array } | null> {
  const tmplUrl = `/test-fixtures/${gt.videoName}_${gt.pokemonName}_${gt.templateId}.png`;
  const tmplResp = await fetch(tmplUrl);
  if (!tmplResp.ok) return null;

  const tmplBlob = await tmplResp.blob();
  const tmplBitmap = await createImageBitmap(tmplBlob);

  const tmplCanvas = new OffscreenCanvas(tmplBitmap.width, tmplBitmap.height);
  const tmplCtx = tmplCanvas.getContext("2d")!;
  tmplCtx.drawImage(tmplBitmap, 0, 0);
  const tmplImageData = tmplCtx.getImageData(0, 0, tmplBitmap.width, tmplBitmap.height);
  const tmplGray = toGrayscale(tmplImageData.data, tmplBitmap.width, tmplBitmap.height);

  return { bitmap: tmplBitmap, gray: tmplGray };
}

/** Try to load a video, skipping its entries on failure. Returns null if skipped. */
export async function tryLoadVideo(
  videoName: string,
  gtEntries: GroundTruthEntry[],
  signal: AbortSignal,
  setProgress: (msg: string) => void,
  updateProgress: (frames: number) => void,
): Promise<HTMLVideoElement | null> {
  setProgress(`Loading video: ${videoName}.mp4...`);
  try {
    return await loadVideoElement(videoName, signal);
  } catch (e) {
    if (signal.aborted) return null;
    const msg = e instanceof Error ? e.message : String(e);
    setProgress(`Skipping ${videoName}: ${msg}`);
    for (const gt of gtEntries) {
      updateProgress(gt.encounters.length + gt.negativeFrames.length);
    }
    return null;
  }
}

/** Captures the current video frame as a small grayscale for frame deltas. */
export function captureDeltaGray(video: HTMLVideoElement): Float32Array {
  const captured = captureFrame(video);
  const gray = toGrayscale(captured.pixels, captured.width, captured.height);
  return downsampleGray(gray, captured.width, captured.height);
}
