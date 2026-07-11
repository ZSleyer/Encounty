/**
 * ocrPreprocess.ts: Image preprocessing for tesseract.js region OCR.
 *
 * Game fonts are small, stylized, and often rendered as light text on dark
 * backgrounds, all of which hurt tesseract accuracy. This module upscales a
 * region crop, converts it to grayscale, picks a global threshold via Otsu's
 * method, and binarizes to dark text on a white background (the input
 * tesseract's legacy and LSTM engines are trained on).
 */

/**
 * otsuThreshold computes the classic Otsu threshold over a 256-bin histogram
 * of grayscale values.
 *
 * Otsu picks the threshold that maximizes the between-class variance of the
 * two resulting pixel classes, which works well for the bimodal
 * text-vs-background histograms produced by game UI regions.
 *
 * @param gray - Grayscale intensities, one byte per pixel (0-255).
 * @returns The threshold in the range 0-255. Values at or below it belong to
 *   the background class, values above it to the foreground class.
 */
export function otsuThreshold(gray: Uint8ClampedArray): number {
  const histogram = new Array<number>(256).fill(0);
  for (const value of gray) histogram[value]++;

  const total = gray.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * histogram[i];

  let sumBackground = 0;
  let weightBackground = 0;
  let maxVariance = -1;
  let threshold = 0;

  for (let t = 0; t < 256; t++) {
    weightBackground += histogram[t];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += t * histogram[t];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sumAll - sumBackground) / weightForeground;
    const diff = meanBackground - meanForeground;
    const variance = weightBackground * weightForeground * diff * diff;

    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }

  return threshold;
}

/**
 * shouldInvert reports whether a binarized image should be inverted so the
 * text ends up dark on a white background.
 *
 * When the majority of pixels fall at or below the threshold, the background
 * is dark, which means the text is light. Tesseract is trained on dark text
 * on white, so such crops should be inverted.
 *
 * @param gray - Grayscale intensities, one byte per pixel (0-255).
 * @param threshold - Otsu threshold separating the two pixel classes.
 * @returns True when the crop is majority-dark and should be inverted.
 */
export function shouldInvert(
  gray: Uint8ClampedArray,
  threshold: number,
): boolean {
  let darkCount = 0;
  for (const value of gray) {
    if (value <= threshold) darkCount++;
  }
  return darkCount > gray.length / 2;
}

/**
 * binarize maps grayscale values to pure black (0) or white (255) using the
 * given threshold, optionally inverting the result.
 *
 * @param gray - Grayscale intensities, one byte per pixel (0-255).
 * @param threshold - Values above this become white (before inversion),
 *   matching the class boundary otsuThreshold returns.
 * @param invert - When true, swaps black and white in the output.
 * @returns A new array containing only 0 or 255 values.
 */
export function binarize(
  gray: Uint8ClampedArray,
  threshold: number,
  invert: boolean,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i++) {
    const white = gray[i] > threshold;
    out[i] = white !== invert ? 255 : 0;
  }
  return out;
}

/**
 * preprocessForOCR prepares a region crop for tesseract.js: upscale,
 * grayscale, Otsu threshold, auto-invert to dark-on-white, binarize.
 *
 * Upscaling with smoothing enabled matters because game fonts in region
 * crops are often only 10-20 px tall, well below the glyph size tesseract
 * was trained on; smooth interpolation gives the binarizer cleaner edges
 * than nearest-neighbor.
 *
 * @param source - Canvas holding the raw region crop.
 * @param scale - Upscale factor applied to both dimensions (default 3).
 * @returns A new preprocessed canvas, or the source unchanged when a 2d
 *   context is unavailable (e.g. in jsdom test environments).
 */
export function preprocessForOCR(
  source: HTMLCanvasElement,
  scale = 3,
): HTMLCanvasElement {
  const target = document.createElement("canvas");
  target.width = source.width * scale;
  target.height = source.height * scale;

  const ctx = target.getContext("2d");
  if (!ctx) return source;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, target.width, target.height);

  const imageData = ctx.getImageData(0, 0, target.width, target.height);
  const { data } = imageData;
  const pixelCount = target.width * target.height;

  // BT.601 luma weights, the standard choice for SDR video-derived frames.
  const gray = new Uint8ClampedArray(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    gray[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }

  const threshold = otsuThreshold(gray);
  const invert = shouldInvert(gray, threshold);
  const binary = binarize(gray, threshold, invert);

  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    data[o] = binary[i];
    data[o + 1] = binary[i];
    data[o + 2] = binary[i];
    data[o + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

  return target;
}
