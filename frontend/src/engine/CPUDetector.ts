/**
 * CPUDetector — CPU fallback for NCC template matching.
 *
 * Used when WebGPU is unavailable. Implements the same detection interface
 * as WebGPUDetector using OffscreenCanvas for frame capture and a pure
 * TypeScript port of the Go NCC algorithm (integral-image based).
 */

import type { DetectResult, TemplateData } from "./WebGPUDetector";

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
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private previousGray: Float32Array | null = null;

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
    source: HTMLVideoElement,
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
    let frameDelta = 1.0;
    if (this.previousGray && this.previousGray.length === frameGray.gray.length) {
      frameDelta = pixelDelta(this.previousGray, frameGray.gray);
    }
    this.previousGray = frameGray.gray;

    // NCC against each template
    let bestScore = 0;
    let bestIndex = 0;

    for (let i = 0; i < templates.length; i++) {
      const tmpl = templates[i];
      if (!tmpl.gray) continue;

      const tmplGray = downscaleTemplate(tmpl, maxDim);
      const score = ncc(
        frameGray.gray,
        frameGray.width,
        frameGray.height,
        tmplGray.gray,
        tmplGray.width,
        tmplGray.height,
        tmplGray.mean,
        tmplGray.stdDev,
      );
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
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Capture a video frame, apply optional crop, downscale, and convert to
   * grayscale in 0-255 range (matching Go implementation).
   */
  private captureGrayscale(
    source: HTMLVideoElement,
    crop: { x: number; y: number; w: number; h: number } | undefined,
    maxDim: number,
  ): { gray: Float32Array; width: number; height: number } {
    const srcW = source.videoWidth;
    const srcH = source.videoHeight;
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

    const n = dstW * dstH;
    const gray = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const r = pixels[i * 4];
      const g = pixels[i * 4 + 1];
      const b = pixels[i * 4 + 2];
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    return { gray, width: dstW, height: dstH };
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

/**
 * Compute NCC between a frame and a template using integral images.
 *
 * Both frame and template are grayscale arrays in the 0-255 range.
 * Returns the best NCC score in [0, 1].
 */
function ncc(
  frame: Float32Array,
  fw: number,
  fh: number,
  tmpl: Float32Array,
  tw: number,
  th: number,
  tmplMean: number,
  tmplStd: number,
): number {
  if (tw > fw || th > fh || tw < 4 || th < 4) return 0;
  if (tmplStd < 1e-9) return 0;

  const n = tw * th;

  // Build integral images for the frame
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

  // Slide the template across all valid positions
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

      // Cross-correlation
      let cc = 0;
      for (let ty = 0; ty < th; ty++) {
        for (let tx = 0; tx < tw; tx++) {
          const fv = frame[(fy + ty) * fw + (fx + tx)] - pMean;
          const tv = tmpl[ty * tw + tx] - tmplMean;
          cc += fv * tv;
        }
      }

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
