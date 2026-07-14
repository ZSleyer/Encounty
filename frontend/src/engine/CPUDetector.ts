/**
 * CPUDetector: CPU fallback for NCC template matching.
 *
 * Used when WebGPU is unavailable. Implements the same detection interface
 * as WebGPUDetector using OffscreenCanvas for frame capture and a pure
 * TypeScript port of the Go NCC algorithm (integral-image based).
 */

import type { DetectResult, TemplateData } from "./WebGPUDetector";
import {
  fitDimensions,
  pixelDelta,
  scoreRegionHybridWithStats,
  precomputeRegionTemplateStats,
  bilinearResampleGray,
  categoryScoresFromGroups,
  mergeCategoryScores,
  newCategoryMerge,
  cropTemplateGray,
  adaptiveBlockSizeForRegion,
  matchWholeTemplate,
  IntegralImagePool,
  type RegionTemplateStats,
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

  /** Reusable buffer for captureGrayscale (avoids allocation every frame). */
  private frameGrayBuf: Float32Array | null = null;

  /** Pool of Float32Array buffers keyed by length, for temporary crop data. */
  private readonly grayPool = new Map<number, Float32Array[]>();

  /** Pool of Float64Array buffers for integral image reuse across frames. */
  private readonly iiPool = new IntegralImagePool();

  /** Reusable canvas for full-resolution frame in region matching (avoids ~33MB alloc per frame at 4K). */
  regionCanvas: OffscreenCanvas | null = null;
  regionCtx: OffscreenCanvasRenderingContext2D | null = null;

  constructor() {
    this.canvas = new OffscreenCanvas(1, 1);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2d context for CPUDetector");
    this.ctx = ctx;
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
      category?: string;
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
    // Ping-pong the two grayscale buffers instead of copying the whole frame
    // every cycle: the current frame becomes previousGray, and the old
    // previousGray buffer is handed back to captureGrayscale for the next
    // frame. captureGrayscale reallocates it if the dimensions change.
    const recycledPrev = this.previousGray;
    this.previousGray = frameGray.gray;
    this.frameGrayBuf = recycledPrev;

    // Draw the full-resolution source once per frame, shared across every
    // template, instead of redrawing it inside matchTemplate per template.
    const srcW = source instanceof ImageBitmap ? source.width : source.videoWidth;
    const srcH = source instanceof ImageBitmap ? source.height : source.videoHeight;
    const needsRegionFrame = templates.some(
      (t) => t.gray && t.regions.length > 0,
    );
    if (needsRegionFrame && srcW > 0 && srcH > 0) {
      this.drawRegionFrame(source, srcW, srcH);
    }

    // NCC against each template
    let bestScore = 0;
    let bestIndex = 0;
    const merge = newCategoryMerge();

    for (let i = 0; i < templates.length; i++) {
      const tmpl = templates[i];
      if (!tmpl.gray) continue;
      if (tmpl.regions.length === 0) continue;

      const templateScores = matchTemplate(
        this, source, tmpl, frameGray, maxDim, config.crop, this.iiPool,
      );

      // Merge per-category scores across templates by taking the max.
      const templateBest = mergeCategoryScores(merge, templateScores, i);
      if (templateBest > bestScore) {
        bestScore = templateBest;
        bestIndex = i;
      }

      // Early exit is only safe with a single default category: with multiple
      // categories, later templates may carry scores for other categories.
      const onlyDefaultCategory =
        Object.keys(merge.scores).length === 1 && "" in merge.scores;
      if (onlyDefaultCategory && bestScore >= config.precision) break;
    }

    return {
      bestScore,
      score: bestScore,
      frameDelta,
      templateIndex: bestIndex,
      categoryScores: merge.scores,
      categoryWinners: merge.winners,
    };
  }

  /** Release resources. */
  destroy(): void {
    this.previousGray = null;
    this.frameGrayBuf = null;
    this.grayPool.clear();
    this.iiPool.clear();
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
   * Ensure the full-resolution region canvas exists at the source size and
   * draw the current frame into it once per detection cycle.
   *
   * Region matching for every template reads from this single draw, so the
   * ~33MB (at 4K) full-res draw + canvas allocation happens once per frame
   * rather than once per template.
   */
  drawRegionFrame(source: FrameSource, srcW: number, srcH: number): void {
    if (this.regionCanvas?.width !== srcW || this.regionCanvas?.height !== srcH) {
      this.regionCanvas = new OffscreenCanvas(srcW, srcH);
      this.regionCtx = this.regionCanvas.getContext("2d", { willReadFrequently: true });
    }
    this.regionCtx?.drawImage(source, 0, 0, srcW, srcH);
  }

  /**
   * Read a rectangle from a canvas context at full resolution and convert it
   * to grayscale (0-255 range).
   *
   * One call per region per frame; the sliding-window search resamples its
   * windows from the returned buffer instead of issuing further readbacks.
   * The buffer is pooled; callers release it via `releaseGray()`.
   */
  readGrayscale(
    ctx: OffscreenCanvasRenderingContext2D,
    x: number, y: number, w: number, h: number,
  ): Float32Array {
    const pixels = ctx.getImageData(x, y, w, h).data;
    const n = w * h;
    const gray = this.acquireGray(n);
    for (let i = 0; i < n; i++) {
      gray[i] = 0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2];
    }
    return gray;
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

/**
 * Compute the best hybrid score for a single region using a sliding window
 * search.
 *
 * Performs a SINGLE canvas readback covering the region plus the slide range,
 * converts it to grayscale once, and extracts each of the 25 shifted windows
 * via bilinear resampling from that buffer (previously every window cost its
 * own drawImage + getImageData round trip). Template statistics are
 * precomputed once per region and reused for every window.
 */
function scoreRegionSlidingWindow(
  detector: CPUDetector,
  tmpCtx: OffscreenCanvasRenderingContext2D,
  tmplCrop: Float32Array,
  region: SlidingWindowRegion,
  stats: RegionTemplateStats,
): number {
  const { frameRx, frameRy, frameRw, frameRh, srcW, srcH, dw, dh } = region;
  let bestRegionScore = 0;
  const slideStep = 2;
  const slideRange = 4;

  // One padded readback covering all window positions (clamped to the frame)
  const padX = Math.max(0, frameRx - slideRange);
  const padY = Math.max(0, frameRy - slideRange);
  const padW = Math.min(srcW - padX, frameRw + 2 * slideRange);
  const padH = Math.min(srcH - padY, frameRh + 2 * slideRange);
  if (padW <= 0 || padH <= 0) return 0;

  const padGray = detector.readGrayscale(tmpCtx, padX, padY, padW, padH);
  const frameCrop = detector.acquireGray(dw * dh);

  for (let dy = -slideRange; dy <= slideRange; dy += slideStep) {
    for (let dx = -slideRange; dx <= slideRange; dx += slideStep) {
      const ox = Math.max(0, Math.min(frameRx + dx, srcW - frameRw));
      const oy = Math.max(0, Math.min(frameRy + dy, srcH - frameRh));

      bilinearResampleGray(
        padGray, padW, padH,
        ox - padX, oy - padY, frameRw, frameRh,
        frameCrop, dw, dh,
      );

      const combined = scoreRegionHybridWithStats(frameCrop, tmplCrop, stats);
      if (combined > bestRegionScore) bestRegionScore = combined;
    }
  }

  detector.releaseGray(frameCrop);
  detector.releaseGray(padGray);
  return bestRegionScore;
}

/**
 * Match a single template against a video frame, respecting region definitions.
 *
 * When regions are defined, each region is matched independently against the
 * corresponding crop of the frame. Regions are grouped by category and
 * AND-combined (minimum score) within each category. When no regions are
 * defined, the whole template is matched against the frame and mapped to the
 * default category "". Matches the Go MatchWithRegions logic.
 */
function matchTemplate(
  detector: CPUDetector,
  source: FrameSource,
  tmpl: TemplateData,
  frameGray: { gray: Float32Array; width: number; height: number },
  maxDim: number,
  _crop?: { x: number; y: number; w: number; h: number },
  pool?: IntegralImagePool,
): Record<string, number> {
  const regions = tmpl.regions ?? [];

  // No regions defined, fall back to whole-template matching (default category)
  if (regions.length === 0) {
    return { "": matchWholeTemplate(frameGray, tmpl, maxDim, pool) };
  }

  // We need the full-resolution frame pixels for region cropping. The source
  // was already drawn into the shared region canvas once for this frame by
  // detect() (via drawRegionFrame), so we only read from it here.
  const srcW = source instanceof ImageBitmap ? source.width : source.videoWidth;
  const srcH = source instanceof ImageBitmap ? source.height : source.videoHeight;
  if (srcW === 0 || srcH === 0) return {};

  const tmpCtx = detector.regionCtx;
  if (!tmpCtx) return {};

  const scaleX = srcW / tmpl.width;
  const scaleY = srcH / tmpl.height;

  // Region-scoped matching: group region scores by category, AND-combine
  // (minimum) within each category. Each category is scored independently so a
  // low region in one category never drags down another category.
  const scoresByCategory = new Map<string, number[]>();
  // Categories that already short-circuited because a region scored too low.
  const shortCircuited = new Set<string>();

  for (const region of regions) {
    if (region.type !== "image") continue;

    const category = region.category ?? "";
    // Skip remaining regions of a category that already short-circuited.
    if (shortCircuited.has(category)) continue;

    const r = region.rect;
    const frameRx = Math.round(r.x * scaleX);
    const frameRy = Math.round(r.y * scaleY);
    const frameRw = Math.max(4, Math.round(r.w * scaleX));
    const frameRh = Math.max(4, Math.round(r.h * scaleY));

    const [dw, dh] = fitDimensions(r.w, r.h, maxDim);
    const tmplCrop = cropTemplateGray(tmpl, r.x, r.y, r.w, r.h, dw, dh);
    if (!tmplCrop) continue;

    const blockSize = adaptiveBlockSizeForRegion(dw, dh);
    // Template-side statistics are constant across all window positions
    const stats = precomputeRegionTemplateStats(tmplCrop, dw, dh, blockSize);
    const bestRegionScore = scoreRegionSlidingWindow(
      detector, tmpCtx, tmplCrop,
      { frameRx, frameRy, frameRw, frameRh, srcW, srcH, dw, dh },
      stats,
    );

    let group = scoresByCategory.get(category);
    if (!group) {
      group = [];
      scoresByCategory.set(category, group);
    }
    group.push(bestRegionScore);

    // Early exit when a region scores too low to recover, but only within its
    // own category group, never across categories.
    if (bestRegionScore < 0.3) shortCircuited.add(category);
  }

  if (scoresByCategory.size === 0) {
    return { "": matchWholeTemplate(frameGray, tmpl, maxDim, pool) };
  }

  return categoryScoresFromGroups(scoresByCategory);
}
