/**
 * CPUDetector — CPU fallback for NCC template matching.
 *
 * Used when WebGPU is unavailable. Implements the same detection interface
 * as WebGPUDetector using OffscreenCanvas for frame capture and a pure
 * TypeScript port of the Go NCC algorithm (integral-image based).
 */

import type { DetectResult, TemplateData } from "./WebGPUDetector";
import {
  fitDimensions,
  pixelDelta,
  scoreRegionHybrid,
  andLogicAcrossRegions,
  applyNegativePenalty,
  cropTemplateGray,
  adaptiveBlockSizeForRegion,
  matchWholeTemplate,
} from "./math";

/** Source type accepted by CPUDetector: video element or transferable bitmap. */
type FrameSource = HTMLVideoElement | ImageBitmap;

// ---------------------------------------------------------------------------
// CPUDetector
// ---------------------------------------------------------------------------

/**
 * CPU-based NCC template matching engine.
 *
 * Provides the same public API shape as WebGPUDetector for duck-typing, but
 * runs entirely on the main thread (or a worker) using typed arrays and
 * integral images for sliding-window NCC.
 *
 * Usage:
 * ```ts
 * const detector = new CPUDetector();
 * const template = detector.loadTemplate(imageData);
 * const result = await detector.detect(videoEl, [template], { precision: 0.9 });
 * detector.destroy();
 * ```
 */
export class CPUDetector {
  private readonly canvas: OffscreenCanvas;
  private readonly ctx: OffscreenCanvasRenderingContext2D;
  private previousGray: Float32Array | null = null;

  /** Reusable canvas for region cropping (avoids creating 25+ canvases per frame). */
  private readonly cropCanvas: OffscreenCanvas;
  private readonly cropCtx: OffscreenCanvasRenderingContext2D;

  /** Reusable buffer for captureGrayscale (avoids allocation every frame). */
  private frameGrayBuf: Float32Array | null = null;

  /** Pool of Float32Array buffers keyed by length, for temporary crop data. */
  private readonly grayPool = new Map<number, Float32Array[]>();

  /** Reusable canvas for full-resolution frame in region matching (avoids ~33MB alloc per frame at 4K). */
  regionCanvas: OffscreenCanvas | null = null;
  regionCtx: OffscreenCanvasRenderingContext2D | null = null;

  constructor() {
    this.canvas = new OffscreenCanvas(1, 1);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2d context for CPUDetector");
    this.ctx = ctx;

    this.cropCanvas = new OffscreenCanvas(1, 1);
    const cropCtx = this.cropCanvas.getContext("2d", { willReadFrequently: true });
    if (!cropCtx) throw new Error("Failed to get 2d context for crop canvas");
    this.cropCtx = cropCtx;
  }

  /** Always returns true since no hardware requirements exist. */
  static isAvailable(): boolean {
    return typeof OffscreenCanvas !== "undefined";
  }

  /**
   * Load an image as a CPU-ready grayscale template.
   *
   * Converts to grayscale and precomputes mean and standard deviation.
   * Returns null if the template has near-zero variance.
   */
  loadTemplate(
    imageSource: ImageData | ImageBitmap,
    regions?: Array<{
      type: string;
      rect: { x: number; y: number; w: number; h: number };
      polarity?: "positive" | "negative";
    }>,
  ): TemplateData | null {
    let pixels: Uint8ClampedArray;
    let width: number;
    let height: number;

    if (imageSource instanceof ImageData) {
      pixels = imageSource.data;
      width = imageSource.width;
      height = imageSource.height;
    } else {
      const c = new OffscreenCanvas(imageSource.width, imageSource.height);
      const cx = c.getContext("2d");
      if (!cx) throw new Error("Failed to get 2d context for template");
      cx.drawImage(imageSource, 0, 0);
      const id = cx.getImageData(0, 0, c.width, c.height);
      pixels = id.data;
      width = id.width;
      height = id.height;
    }

    const n = width * height;
    const gray = new Float32Array(n);

    let sum = 0;
    for (let i = 0; i < n; i++) {
      const r = pixels[i * 4];
      const g = pixels[i * 4 + 1];
      const b = pixels[i * 4 + 2];
      // BT.601 luminance, 0-255 range (matching Go implementation)
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      gray[i] = lum;
      sum += lum;
    }

    const mean = sum / n;

    let varSum = 0;
    for (let i = 0; i < n; i++) {
      const d = gray[i] - mean;
      varSum += d * d;
    }
    const stdDev = Math.sqrt(varSum / n);

    if (stdDev < 1e-6) {
      return null;
    }

    return {
      gray,
      width,
      height,
      mean,
      stdDev,
      pixelCount: n,
      regions: regions ?? [],
    };
  }

  /**
   * Run a full detection cycle against all templates.
   *
   * Captures the video frame, downscales to maxDim, converts to grayscale,
   * computes pixel delta for deduplication, and runs NCC against each template.
   */
  async detect(
    source: FrameSource,
    templates: TemplateData[],
    config: {
      precision: number;
      crop?: { x: number; y: number; w: number; h: number };
      maxDim?: number;
      changeThreshold?: number;
    },
  ): Promise<DetectResult> {
    if (templates.length === 0) {
      throw new Error("No templates provided");
    }

    const maxDim = config.maxDim ?? 320;
    const frameGray = this.captureGrayscale(source, config.crop, maxDim);

    // Pixel delta for frame deduplication
    let frameDelta = 1;
    if (this.previousGray?.length === frameGray.gray.length) {
      frameDelta = pixelDelta(this.previousGray, frameGray.gray);
    }
    this.previousGray = frameGray.gray.slice(); // Must copy since frameGrayBuf is reused

    // NCC against each template
    let bestScore = 0;
    let bestIndex = 0;

    for (let i = 0; i < templates.length; i++) {
      const tmpl = templates[i];
      if (!tmpl.gray) continue;

      let score = matchTemplate(this, source, tmpl, frameGray, maxDim, config.crop);

      // Apply negative region penalty: high match on negative region suppresses detection
      const negRegions = tmpl.regions.filter(
        (r) => r.polarity === "negative",
      );
      if (negRegions.length > 0 && score > 0) {
        const negativeTmpl = { ...tmpl, regions: negRegions };
        const negScore = matchTemplate(this, source, negativeTmpl, frameGray, maxDim, config.crop);
        score = applyNegativePenalty(score, negScore);
      }

      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
      if (bestScore >= config.precision) break;
    }

    return { bestScore, score: bestScore, frameDelta, templateIndex: bestIndex };
  }

  /** Release resources. */
  destroy(): void {
    this.previousGray = null;
    this.frameGrayBuf = null;
    this.grayPool.clear();
    this.regionCanvas = null;
    this.regionCtx = null;
  }

  /** Acquire a Float32Array from the pool, or allocate a new one. */
  acquireGray(size: number): Float32Array {
    const pool = this.grayPool.get(size);
    if (pool && pool.length > 0) {
      const buf = pool.pop()!;
      buf.fill(0);
      return buf;
    }
    return new Float32Array(size);
  }

  /** Return a Float32Array to the pool for reuse (max 16 per size). */
  releaseGray(buf: Float32Array): void {
    const size = buf.length;
    let pool = this.grayPool.get(size);
    if (!pool) {
      pool = [];
      this.grayPool.set(size, pool);
    }
    if (pool.length < 16) {
      pool.push(buf);
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Capture a video frame, apply optional crop, downscale, and convert to
   * grayscale in 0-255 range (matching Go implementation).
   */
  private captureGrayscale(
    source: FrameSource,
    crop: { x: number; y: number; w: number; h: number } | undefined,
    maxDim: number,
  ): { gray: Float32Array; width: number; height: number } {
    const srcW = source instanceof ImageBitmap ? source.width : source.videoWidth;
    const srcH = source instanceof ImageBitmap ? source.height : source.videoHeight;
    const cx = crop?.x ?? 0;
    const cy = crop?.y ?? 0;
    const cw = crop?.w ?? srcW;
    const ch = crop?.h ?? srcH;

    const [dstW, dstH] = fitDimensions(cw, ch, maxDim);

    this.canvas.width = dstW;
    this.canvas.height = dstH;
    this.ctx.drawImage(source, cx, cy, cw, ch, 0, 0, dstW, dstH);
    const imageData = this.ctx.getImageData(0, 0, dstW, dstH);
    const pixels = imageData.data;

    // Reuse buffer if dimensions match, otherwise allocate a new one
    const n = dstW * dstH;
    if (this.frameGrayBuf?.length !== n) {
      this.frameGrayBuf = new Float32Array(n);
    }
    const gray = this.frameGrayBuf;

    for (let i = 0; i < n; i++) {
      const r = pixels[i * 4];
      const g = pixels[i * 4 + 1];
      const b = pixels[i * 4 + 2];
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    return { gray, width: dstW, height: dstH };
  }

  /**
   * Crop a region from a canvas context, scale to target size, convert to grayscale.
   *
   * Reuses the persistent crop canvas to avoid creating a new OffscreenCanvas
   * on every call (up to 25 calls per region in the sliding window).
   */
  cropGrayscale(
    ctx: OffscreenCanvasRenderingContext2D,
    x: number, y: number, w: number, h: number,
    dw: number, dh: number,
  ): { gray: Float32Array; width: number; height: number } {
    // Resize persistent crop canvas if dimensions changed
    if (this.cropCanvas.width !== dw || this.cropCanvas.height !== dh) {
      this.cropCanvas.width = dw;
      this.cropCanvas.height = dh;
    }
    this.cropCtx.drawImage(ctx.canvas, x, y, w, h, 0, 0, dw, dh);
    const pixels = this.cropCtx.getImageData(0, 0, dw, dh).data;
    const n = dw * dh;
    const gray = this.acquireGray(n);
    for (let i = 0; i < n; i++) {
      gray[i] = 0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2];
    }
    return { gray, width: dw, height: dh };
  }
}

// ---------------------------------------------------------------------------
// NCC implementation (port of Go backend/internal/detector/match.go)
// Pure math functions are in math.ts; this section contains functions that
// depend on browser APIs (OffscreenCanvas, CPUDetector instance).
// ---------------------------------------------------------------------------

/** Region geometry for sliding window scoring. */
interface SlidingWindowRegion {
  frameRx: number; frameRy: number;
  frameRw: number; frameRh: number;
  srcW: number; srcH: number;
  dw: number; dh: number;
}

/** Compute the best hybrid score for a single region using a sliding window search. */
function scoreRegionSlidingWindow(
  detector: CPUDetector,
  tmpCtx: OffscreenCanvasRenderingContext2D,
  tmplCrop: Float32Array,
  region: SlidingWindowRegion,
  blockSize: number,
): number {
  const { frameRx, frameRy, frameRw, frameRh, srcW, srcH, dw, dh } = region;
  let bestRegionScore = 0;
  const slideStep = 2;
  const slideRange = 4;

  for (let dy = -slideRange; dy <= slideRange; dy += slideStep) {
    for (let dx = -slideRange; dx <= slideRange; dx += slideStep) {
      const ox = Math.max(0, Math.min(frameRx + dx, srcW - frameRw));
      const oy = Math.max(0, Math.min(frameRy + dy, srcH - frameRh));

      const frameCrop = detector.cropGrayscale(tmpCtx, ox, oy, frameRw, frameRh, dw, dh);

      const combined = scoreRegionHybrid(frameCrop.gray, tmplCrop, dw, dh, blockSize);
      if (combined > bestRegionScore) bestRegionScore = combined;

      // Release pooled frame crop buffer after scoring
      detector.releaseGray(frameCrop.gray);
    }
  }

  return bestRegionScore;
}

/**
 * Match a single template against a video frame, respecting region definitions.
 *
 * When regions are defined, each region is matched independently against the
 * corresponding crop of the frame (AND-logic: minimum score across all regions).
 * When no regions are defined, the whole template is matched against the frame.
 * Matches the Go MatchWithRegions logic.
 */
function matchTemplate(
  detector: CPUDetector,
  source: FrameSource,
  tmpl: TemplateData,
  frameGray: { gray: Float32Array; width: number; height: number },
  maxDim: number,
  _crop?: { x: number; y: number; w: number; h: number },
): number {
  const regions = tmpl.regions ?? [];

  // No regions defined — fall back to whole-template matching
  if (regions.length === 0) {
    return matchWholeTemplate(frameGray, tmpl, maxDim);
  }

  // We need the full-resolution frame pixels for region cropping.
  const srcW = source instanceof ImageBitmap ? source.width : source.videoWidth;
  const srcH = source instanceof ImageBitmap ? source.height : source.videoHeight;
  if (srcW === 0 || srcH === 0) return 0;

  // Reuse the cached region canvas when dimensions match (avoids ~33MB alloc per frame at 4K)
  if (detector.regionCanvas?.width !== srcW || detector.regionCanvas?.height !== srcH) {
    detector.regionCanvas = new OffscreenCanvas(srcW, srcH);
    detector.regionCtx = detector.regionCanvas.getContext("2d", { willReadFrequently: true });
  }
  const tmpCtx = detector.regionCtx;
  if (!tmpCtx) return 0;
  tmpCtx.drawImage(source, 0, 0, srcW, srcH);

  const scaleX = srcW / tmpl.width;
  const scaleY = srcH / tmpl.height;

  // Region-scoped matching (AND-logic across all regions)
  const regionScores: number[] = [];

  for (const region of regions) {
    if (region.type !== "image") continue;

    const r = region.rect;
    const frameRx = Math.round(r.x * scaleX);
    const frameRy = Math.round(r.y * scaleY);
    const frameRw = Math.max(4, Math.round(r.w * scaleX));
    const frameRh = Math.max(4, Math.round(r.h * scaleY));

    const [dw, dh] = fitDimensions(r.w, r.h, maxDim);
    const tmplCrop = cropTemplateGray(tmpl, r.x, r.y, r.w, r.h, dw, dh);
    if (!tmplCrop) continue;

    const blockSize = adaptiveBlockSizeForRegion(dw, dh);
    const bestRegionScore = scoreRegionSlidingWindow(
      detector, tmpCtx, tmplCrop,
      { frameRx, frameRy, frameRw, frameRh, srcW, srcH, dw, dh },
      blockSize,
    );

    regionScores.push(bestRegionScore);
    // Early exit when any region scores too low to recover
    if (bestRegionScore < 0.3) return andLogicAcrossRegions(regionScores);
  }

  if (regionScores.length === 0) {
    return matchWholeTemplate(frameGray, tmpl, maxDim);
  }

  return andLogicAcrossRegions(regionScores);
}
