/**
 * CPUDetector — CPU fallback for NCC template matching.
 *
 * Used when WebGPU is unavailable. Implements the same detection interface
 * as WebGPUDetector using OffscreenCanvas for frame capture and a pure
 * TypeScript port of the Go NCC algorithm (integral-image based).
 */

import type { DetectResult, TemplateData } from "./WebGPUDetector";

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
  private grayPool = new Map<number, Float32Array[]>();

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
        // Score negative regions using the same hybrid match pipeline
        const negativeTmpl = { ...tmpl, regions: negRegions };
        const negScore = matchTemplate(this, source, negativeTmpl, frameGray, maxDim, config.crop);
        score = score * Math.max(0, 1 - negScore);
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
    if (!this.frameGrayBuf || this.frameGrayBuf.length !== n) {
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
// ---------------------------------------------------------------------------

/** Internal template representation with required gray data for CPU matching. */
interface GrayTemplate {
  gray: Float32Array;
  width: number;
  height: number;
  mean: number;
  stdDev: number;
}

/** Select adaptive block size for SSIM based on region dimensions. */
function adaptiveBlockSizeForRegion(dw: number, dh: number): number {
  const regionMinDim = Math.min(dw, dh);
  if (regionMinDim < 64) return 8;
  if (regionMinDim <= 256) return 16;
  return 32;
}

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

      const ssimScore = blockSSIM(frameCrop.gray, tmplCrop, dw, dh, blockSize);
      const nccScore = pearsonCorrelation(frameCrop.gray, tmplCrop);
      const histScore = histogramCorrelation(frameCrop.gray, tmplCrop);
      const madScore = madSimilarity(frameCrop.gray, tmplCrop);

      // Hybrid: weighted combination of SSIM, NCC, MAD, and histogram
      const combined = 0.333 * ssimScore + 0.278 * nccScore + 0.222 * madScore + 0.167 * histScore;
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

  const tmpCanvas = new OffscreenCanvas(srcW, srcH);
  const tmpCtx = tmpCanvas.getContext("2d", { willReadFrequently: true });
  if (!tmpCtx) return 0;
  tmpCtx.drawImage(source, 0, 0, srcW, srcH);

  const scaleX = srcW / tmpl.width;
  const scaleY = srcH / tmpl.height;

  // Region-scoped matching (AND-logic across all regions)
  let minScore = 1;
  let evaluated = 0;

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

    evaluated++;
    if (bestRegionScore < minScore) minScore = bestRegionScore;
    if (minScore < 0.3) return minScore;
  }

  if (evaluated === 0) {
    return matchWholeTemplate(frameGray, tmpl, maxDim);
  }

  return minScore;
}

/** Match whole template (no regions) against the pre-downscaled frame. */
function matchWholeTemplate(
  frameGray: { gray: Float32Array; width: number; height: number },
  tmpl: TemplateData,
  maxDim: number,
): number {
  if (tmpl.width <= 128 && tmpl.height <= 128) {
    return matchMultiScale(frameGray.gray, frameGray.width, frameGray.height, tmpl);
  }
  const tmplGray = downscaleTemplate(tmpl, maxDim);
  return ncc(frameGray.gray, frameGray.width, frameGray.height, tmplGray);
}

/** Crop a region from a template's gray data and scale to target size. */
function cropTemplateGray(
  tmpl: TemplateData,
  rx: number, ry: number, rw: number, rh: number,
  dw: number, dh: number,
): Float32Array | null {
  if (!tmpl.gray || rw < 4 || rh < 4) return null;
  const n = dw * dh;
  const gray = new Float32Array(n);
  const scaleX = rw / dw;
  const scaleY = rh / dh;

  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(Math.floor(x * scaleX) + rx, tmpl.width - 1);
      const sy = Math.min(Math.floor(y * scaleY) + ry, tmpl.height - 1);
      gray[y * dw + x] = tmpl.gray[sy * tmpl.width + sx];
    }
  }
  return gray;
}

/**
 * Pearson correlation coefficient between two same-sized grayscale buffers.
 *
 * Returns a value in [0, 1] (negative correlations are clamped to 0).
 * Used as a global NCC measure for hybrid scoring alongside block-SSIM.
 */
function pearsonCorrelation(a: Float32Array, b: Float32Array): number {
  const n = a.length;
  let sumA = 0, sumB = 0, sumA2 = 0, sumB2 = 0, sumAB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i]; sumB += b[i];
    sumA2 += a[i] * a[i]; sumB2 += b[i] * b[i];
    sumAB += a[i] * b[i];
  }
  const meanA = sumA / n, meanB = sumB / n;
  const varA = sumA2 / n - meanA * meanA;
  const varB = sumB2 / n - meanB * meanB;
  const cov = sumAB / n - meanA * meanB;
  const denom = Math.sqrt(varA) * Math.sqrt(varB);
  if (denom < 1e-6) return 0;
  return Math.max(0, cov / denom);
}

/**
 * Histogram correlation between two grayscale buffers.
 *
 * Computes 64-bin gray histograms for both images and returns their
 * correlation coefficient. Used as a fast pre-filter to reject frames
 * where the overall brightness distribution is clearly different from
 * the template, even if local pixel structures partially match.
 */
function histogramCorrelation(a: Float32Array, b: Float32Array): number {
  const BINS = 64;
  const histA = new Float64Array(BINS);
  const histB = new Float64Array(BINS);
  const scale = BINS / 256; // pixel values are 0-255

  for (let i = 0; i < a.length; i++) {
    const binA = Math.min(Math.floor(a[i] * scale), BINS - 1);
    const binB = Math.min(Math.floor(b[i] * scale), BINS - 1);
    histA[binA]++;
    histB[binB]++;
  }

  // Normalize histograms
  const nA = a.length || 1;
  const nB = b.length || 1;
  for (let i = 0; i < BINS; i++) {
    histA[i] /= nA;
    histB[i] /= nB;
  }

  // Correlation coefficient (OpenCV HISTCMP_CORREL)
  let meanA = 0, meanB = 0;
  for (let i = 0; i < BINS; i++) {
    meanA += histA[i];
    meanB += histB[i];
  }
  meanA /= BINS;
  meanB /= BINS;

  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < BINS; i++) {
    const da = histA[i] - meanA;
    const db = histB[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }

  const denom = Math.sqrt(varA * varB);
  if (denom < 1e-12) return 0;
  return Math.max(0, cov / denom);
}

/**
 * Mean Absolute Difference similarity between two same-sized grayscale buffers.
 *
 * Returns 1 - (MAD / 128), clamped to [0, 1]. A score of 1.0 means identical
 * pixels, 0.0 means average difference >= 128 gray levels. MAD directly measures
 * pixel-level fidelity and catches false positives from structurally similar but
 * content-different frames that fool correlation-based metrics.
 */
function madSimilarity(a: Float32Array, b: Float32Array): number {
  const n = a.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += Math.abs(a[i] - b[i]);
  }
  return Math.max(0, 1 - sum / (n * 128));
}

/**
 * Block-based SSIM for direct 1:1 region comparison.
 *
 * Divides both crops into blocks, computes SSIM per block, and returns
 * the median score. This is much more discriminative than global NCC because
 * it catches local mismatches that global statistics would average out.
 */
function blockSSIM(
  frameCrop: Float32Array,
  tmplCrop: Float32Array,
  w: number,
  h: number,
  blockSize: number = 32,
): number {
  const L = 255;
  const c1 = (0.01 * L) ** 2;
  const c2 = (0.03 * L) ** 2;

  const blocksX = Math.max(1, Math.floor(w / blockSize));
  const blocksY = Math.max(1, Math.floor(h / blockSize));
  const scores: number[] = [];

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const ox = bx * blockSize;
      const oy = by * blockSize;
      const bw = Math.min(blockSize, w - ox);
      const bh = Math.min(blockSize, h - oy);
      if (bw < 4 || bh < 4) continue;

      const bn = bw * bh;
      let fSum = 0, tSum = 0, fSum2 = 0, tSum2 = 0, ftSum = 0;
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const idx = (oy + y) * w + (ox + x);
          const fv = frameCrop[idx];
          const tv = tmplCrop[idx];
          fSum += fv; tSum += tv;
          fSum2 += fv * fv; tSum2 += tv * tv;
          ftSum += fv * tv;
        }
      }

      const fMean = fSum / bn;
      const tMean = tSum / bn;
      const fVar = Math.max(0, fSum2 / bn - fMean * fMean);
      const tVar = Math.max(0, tSum2 / bn - tMean * tMean);
      const cov = ftSum / bn - fMean * tMean;
      const fStd = Math.sqrt(fVar);
      const tStd = Math.sqrt(tVar);

      const lum = (2 * fMean * tMean + c1) / (fMean * fMean + tMean * tMean + c1);
      const con = (2 * fStd * tStd + c2) / (fVar + tVar + c2);
      const str = (cov + c2 / 2) / (fStd * tStd + c2 / 2);

      scores.push(Math.max(0, lum * con * str));
    }
  }

  if (scores.length === 0) return 0;
  scores.sort((a, b) => a - b);
  return scores[Math.floor(scores.length * 0.5)]; // Median
}

/**
 * Multi-scale template matching for small templates (sprites).
 *
 * Tries the template at 8-12 different sizes against the downscaled frame,
 * returning the best NCC score. This handles sprites that appear at an
 * unknown scale in the game capture. Matches Go's matchMultiScale logic.
 */
function matchMultiScale(
  frameGray: Float32Array, fw: number, fh: number,
  tmpl: TemplateData,
): number {
  const minDim = 12;
  const maxDim = Math.min(fw, fh);
  if (maxDim <= minDim) return 0;
  const step = Math.max(Math.floor((maxDim - minDim) / 12), 4);
  let best = 0;

  for (let targetDim = minDim; targetDim <= maxDim; targetDim += step) {
    const scaled = downscaleTemplate(tmpl, targetDim);
    if (scaled.width < 4 || scaled.height < 4) continue;
    const score = ncc(frameGray, fw, fh, scaled);
    if (score > best) best = score;
    // Early exit when score is high enough
    if (best >= 0.95) break;
  }

  return best;
}

/** Integral image pair (sum and sum-of-squares) for a grayscale frame. */
interface IntegralImages {
  ii: Float64Array;
  ii2: Float64Array;
  stride: number;
}

/** Build integral images (sum and sum-of-squares) for a grayscale frame. */
function buildIntegralImages(
  frame: Float32Array, fw: number, fh: number,
): IntegralImages {
  const stride = fw + 1;
  const ii = new Float64Array(stride * (fh + 1));
  const ii2 = new Float64Array(stride * (fh + 1));

  for (let y = 1; y <= fh; y++) {
    for (let x = 1; x <= fw; x++) {
      const v = frame[(y - 1) * fw + (x - 1)];
      ii[y * stride + x] =
        v + ii[(y - 1) * stride + x] + ii[y * stride + (x - 1)] - ii[(y - 1) * stride + (x - 1)];
      ii2[y * stride + x] =
        v * v +
        ii2[(y - 1) * stride + x] +
        ii2[y * stride + (x - 1)] -
        ii2[(y - 1) * stride + (x - 1)];
    }
  }

  return { ii, ii2, stride };
}

/** Compute cross-correlation between a frame patch and a template at position (fx, fy). */
function crossCorrelation(
  frame: Float32Array, fw: number,
  tmpl: NccTemplate,
  fx: number, fy: number,
  pMean: number,
): number {
  const { gray, width: tw, height: th, mean: tmplMean } = tmpl;
  let cc = 0;
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const fv = frame[(fy + ty) * fw + (fx + tx)] - pMean;
      const tv = gray[ty * tw + tx] - tmplMean;
      cc += fv * tv;
    }
  }
  return cc;
}

/** Grouped template parameters for NCC computation. */
interface NccTemplate {
  gray: Float32Array;
  width: number;
  height: number;
  mean: number;
  stdDev: number;
}

/**
 * Compute NCC between a frame and a template using integral images.
 *
 * Both frame and template are grayscale arrays in the 0-255 range.
 * Returns the best NCC score in [0, 1].
 */
function ncc(
  frame: Float32Array, fw: number, fh: number,
  tmpl: NccTemplate,
): number {
  const { width: tw, height: th, stdDev: tmplStd } = tmpl;
  if (tw > fw || th > fh || tw < 4 || th < 4) return 0;
  if (tmplStd < 1e-9) return 0;

  const n = tw * th;
  const { ii, ii2, stride } = buildIntegralImages(frame, fw, fh);

  let best = 0;

  for (let fy = 0; fy <= fh - th; fy++) {
    for (let fx = 0; fx <= fw - tw; fx++) {
      const x1 = fx;
      const y1 = fy;
      const x2 = fx + tw;
      const y2 = fy + th;

      const pSum =
        ii[y2 * stride + x2] - ii[y1 * stride + x2] - ii[y2 * stride + x1] + ii[y1 * stride + x1];
      const pSum2 =
        ii2[y2 * stride + x2] -
        ii2[y1 * stride + x2] -
        ii2[y2 * stride + x1] +
        ii2[y1 * stride + x1];

      const pMean = pSum / n;
      let pVar = pSum2 / n - pMean * pMean;
      if (pVar < 0) pVar = 0;
      const pStd = Math.sqrt(pVar);
      if (pStd < 1e-9) continue;

      const cc = crossCorrelation(frame, fw, tmpl, fx, fy, pMean);
      const val = cc / (n * pStd * tmplStd);
      if (val > best) best = val;
    }
  }

  return clamp01(best);
}

/**
 * Compute normalised pixel delta between two grayscale buffers.
 *
 * Samples up to 64x64 pixels for performance. Returns a value in [0, 1].
 */
function pixelDelta(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  // Sample at most 4096 pixels (64x64) for speed, stepping evenly
  const step = Math.max(1, Math.floor(len / 4096));
  let sum = 0;
  let count = 0;

  for (let i = 0; i < len; i += step) {
    sum += Math.abs(a[i] - b[i]);
    count++;
  }

  if (count === 0) return 0;
  // Normalise to [0, 1] (values are 0-255)
  return sum / (count * 255);
}

/**
 * Downscale a template to fit within maxDim.
 *
 * Uses bilinear interpolation for the grayscale data. If the template
 * already fits, returns it unchanged.
 */
function downscaleTemplate(
  tmpl: TemplateData,
  maxDim: number,
): GrayTemplate {
  const gray = tmpl.gray!;
  if (tmpl.width <= maxDim && tmpl.height <= maxDim) {
    return { gray, width: tmpl.width, height: tmpl.height, mean: tmpl.mean, stdDev: tmpl.stdDev };
  }

  const [dstW, dstH] = fitDimensions(tmpl.width, tmpl.height, maxDim);
  const scaleX = tmpl.width / dstW;
  const scaleY = tmpl.height / dstH;
  const n = dstW * dstH;
  const dstGray = new Float32Array(n);

  // Bilinear downscale
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const sx = (x + 0.5) * scaleX - 0.5;
      const sy = (y + 0.5) * scaleY - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;

      const sample = (px: number, py: number) => {
        const cx = Math.max(0, Math.min(px, tmpl.width - 1));
        const cy = Math.max(0, Math.min(py, tmpl.height - 1));
        return gray[cy * tmpl.width + cx];
      };

      const tl = sample(x0, y0);
      const tr = sample(x0 + 1, y0);
      const bl = sample(x0, y0 + 1);
      const br = sample(x0 + 1, y0 + 1);

      const top = tl + (tr - tl) * fx;
      const bottom = bl + (br - bl) * fx;
      dstGray[y * dstW + x] = top + (bottom - top) * fy;
    }
  }

  // Recompute mean and std for the downscaled template
  let s = 0;
  for (let i = 0; i < n; i++) s += dstGray[i];
  const mean = s / n;

  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = dstGray[i] - mean;
    varSum += d * d;
  }
  const stdDev = Math.sqrt(varSum / n);

  return { gray: dstGray, width: dstW, height: dstH, mean, stdDev };
}

/** Constrain v to [0, 1]. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Calculate dimensions fitting within maxDim while preserving aspect ratio. */
function fitDimensions(w: number, h: number, maxDim: number): [number, number] {
  if (w <= maxDim && h <= maxDim) return [w, h];
  const scale = maxDim / Math.max(w, h);
  return [Math.max(Math.round(w * scale), 1), Math.max(Math.round(h * scale), 1)];
}
