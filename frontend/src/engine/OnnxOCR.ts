/**
 * OnnxOCR — GPU-accelerated OCR engine using ONNX Runtime Web with PP-OCRv4 Mobile.
 *
 * Replaces tesseract.js for text region detection. Uses the WebGPU execution
 * provider when available, falling back to WASM. PP-OCRv4 Mobile models are
 * loaded lazily on first use (~9.6 MB total).
 *
 * The engine provides two recognition paths:
 * - `recognize(imageData)` — full pipeline: detection + recognition
 * - `recognizeCropped(imageData)` — skips detection, runs recognition only
 *   (optimized for pre-cropped text regions from the region picker)
 */

import * as ort from "onnxruntime-web";

// --- Constants ---------------------------------------------------------------

/** ImageNet normalization means (RGB). */
const NORM_MEAN = [0.485, 0.456, 0.406] as const;

/** ImageNet normalization standard deviations (RGB). */
const NORM_STD = [0.229, 0.224, 0.225] as const;

/** Maximum side length for detection input (padded to multiple of 32). */
const DET_MAX_SIDE = 960;

/** Fixed height for recognition input. */
const REC_HEIGHT = 48;

/** Maximum width for recognition input. */
const REC_MAX_WIDTH = 320;

/** Detection probability threshold for text regions. */
const DET_THRESHOLD = 0.3;

/** Minimum area in pixels for a detected text box. */
const DET_MIN_AREA = 50;

/** Base path for PP-OCRv4 model files served from the public directory. */
const MODEL_BASE = "/models/ppocr";

// --- Types -------------------------------------------------------------------

/** Bounding box for a detected text region. */
interface TextBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// --- OnnxOCR -----------------------------------------------------------------

/** GPU-accelerated OCR engine wrapping ONNX Runtime Web with PP-OCRv4 Mobile. */
export class OnnxOCR {
  private detSession: ort.InferenceSession | null = null;
  private recSession: ort.InferenceSession | null = null;
  private dictionary: string[] = [];
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private readonly useWebGPU: boolean;

  private constructor(useWebGPU: boolean) {
    this.useWebGPU = useWebGPU;
  }

  /** Whether this instance uses the WebGPU execution provider. */
  get isWebGPU(): boolean {
    return this.useWebGPU;
  }

  /**
   * Create an OnnxOCR instance, probing for WebGPU adapter availability.
   * Does not load models — initialization is deferred until first use.
   */
  static async create(): Promise<OnnxOCR> {
    let useWebGPU = false;
    if (typeof navigator !== "undefined" && "gpu" in navigator) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        useWebGPU = adapter !== null;
      } catch {
        useWebGPU = false;
      }
    }
    return new OnnxOCR(useWebGPU);
  }

  /**
   * Initialize ONNX inference sessions lazily on first use.
   *
   * Downloads detection model, recognition model, and character dictionary
   * from the public models directory. Throws if any model file is missing.
   */
  private async init(): Promise<void> {
    if (this.initialized) return;

    // Coalesce concurrent init calls into a single promise
    if (this.initializing) {
      await this.initializing;
      return;
    }

    this.initializing = this.doInit();
    try {
      await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  /** Actual initialization logic, called once. */
  private async doInit(): Promise<void> {
    const executionProviders: ort.InferenceSession.ExecutionProviderConfig[] =
      this.useWebGPU ? ["webgpu", "wasm"] : ["wasm"];

    const sessionOptions: ort.InferenceSession.SessionOptions = {
      executionProviders,
    };

    // Load detection and recognition models in parallel
    const [detSession, recSession, dictText] = await Promise.all([
      ort.InferenceSession.create(
        `${MODEL_BASE}/det_mobile.onnx`,
        sessionOptions,
      ),
      ort.InferenceSession.create(
        `${MODEL_BASE}/rec_mobile.onnx`,
        sessionOptions,
      ),
      fetch(`${MODEL_BASE}/ppocr_keys.txt`).then((r) => {
        if (!r.ok) throw new Error(`Failed to load dictionary: ${r.status}`);
        return r.text();
      }),
    ]);

    this.detSession = detSession;
    this.recSession = recSession;

    // Dictionary: index 0 = blank (CTC), then one char per line, then space
    this.dictionary = [
      "blank",
      ...dictText.split("\n").filter((l) => l.length > 0),
      " ",
    ];

    this.initialized = true;
  }

  // --- Public API ------------------------------------------------------------

  /**
   * Recognize text using the full pipeline: detection + recognition.
   *
   * First runs the detection model to locate text boxes, then crops each
   * box and feeds it through the recognition model. Results are concatenated.
   *
   * @param imageData - The image to process (from canvas getImageData).
   * @returns Recognized text, or empty string on failure.
   */
  async recognize(imageData: ImageData): Promise<string> {
    await this.init();
    if (!this.detSession || !this.recSession) return "";

    // Run detection to find text boxes
    const boxes = await this.detectTextBoxes(imageData);
    if (boxes.length === 0) {
      // No boxes found — try the whole image as a single text region
      return this.recognizeSingle(imageData);
    }

    // Sort boxes top-to-bottom, left-to-right for reading order
    boxes.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));

    // Recognize each box
    const parts: string[] = [];
    for (const box of boxes) {
      const cropped = cropImageData(imageData, box);
      const text = await this.recognizeSingle(cropped);
      if (text) parts.push(text);
    }

    return parts.join(" ");
  }

  /**
   * Recognize text from a pre-cropped image region (skips detection).
   *
   * Optimized for the region picker workflow where the user has already
   * defined the text bounding box. Runs only the recognition model.
   *
   * @param imageData - Pre-cropped image data containing text.
   * @returns Recognized text, or empty string on failure.
   */
  async recognizeCropped(imageData: ImageData): Promise<string> {
    await this.init();
    if (!this.recSession) return "";
    return this.recognizeSingle(imageData);
  }

  /** Release all ONNX sessions and free GPU/WASM memory. */
  destroy(): void {
    this.detSession?.release();
    this.recSession?.release();
    this.detSession = null;
    this.recSession = null;
    this.dictionary = [];
    this.initialized = false;
    this.initializing = null;
  }

  // --- Detection pipeline ----------------------------------------------------

  /**
   * Run the detection model to find text bounding boxes in an image.
   *
   * Preprocesses the image (resize + normalize), runs inference, and
   * extracts bounding boxes from the probability map via connected components.
   */
  private async detectTextBoxes(imageData: ImageData): Promise<TextBox[]> {
    if (!this.detSession) return [];

    const { tensor, scaleX, scaleY } = preprocessForDetection(imageData);

    const feeds: Record<string, ort.Tensor> = {
      x: tensor,
    };
    const results = await this.detSession.run(feeds);

    // Output is a probability map of shape [1, 1, H, W]
    const outputName = this.detSession.outputNames[0];
    const output = results[outputName];
    const outputData = output.data as Float32Array;
    const [, , outH, outW] = output.dims as [number, number, number, number];

    return extractBoxesFromProbMap(
      outputData,
      outW,
      outH,
      scaleX,
      scaleY,
      imageData.width,
      imageData.height,
    );
  }

  // --- Recognition pipeline --------------------------------------------------

  /**
   * Run the recognition model on a single image region.
   *
   * Preprocesses the region (resize to fixed height, normalize), runs
   * inference, and CTC-decodes the output logits.
   */
  private async recognizeSingle(imageData: ImageData): Promise<string> {
    if (!this.recSession) return "";

    const tensor = preprocessForRecognition(imageData);

    const feeds: Record<string, ort.Tensor> = {
      x: tensor,
    };
    const results = await this.recSession.run(feeds);

    const outputName = this.recSession.outputNames[0];
    const output = results[outputName];

    return this.ctcDecode(output);
  }

  /**
   * CTC greedy decode: argmax per timestep, remove blanks and deduplicate.
   *
   * The recognition model outputs shape [1, T, num_classes] where T is the
   * number of timesteps (proportional to image width / 4).
   */
  private ctcDecode(output: ort.Tensor): string {
    const data = output.data as Float32Array;
    const dims = output.dims;
    const timesteps = dims[1];
    const numClasses = dims[2];

    let prevIdx = -1;
    const chars: string[] = [];

    for (let t = 0; t < timesteps; t++) {
      // Find argmax for this timestep
      let maxVal = -Infinity;
      let maxIdx = 0;
      const offset = t * numClasses;
      for (let c = 0; c < numClasses; c++) {
        if (data[offset + c] > maxVal) {
          maxVal = data[offset + c];
          maxIdx = c;
        }
      }

      // Skip blank (index 0) and deduplicate consecutive identical indices
      if (maxIdx !== 0 && maxIdx !== prevIdx) {
        const char = this.dictionary[maxIdx];
        if (char !== undefined) {
          chars.push(char);
        }
      }
      prevIdx = maxIdx;
    }

    return chars.join("").trim();
  }
}

// --- Image preprocessing helpers ---------------------------------------------

/**
 * Preprocess an image for the PP-OCRv4 detection model.
 *
 * Resizes to fit within DET_MAX_SIDE while keeping aspect ratio, pads to
 * a multiple of 32, and normalizes with ImageNet statistics.
 *
 * @returns The input tensor and scale factors for mapping output coordinates
 *          back to original image space.
 */
function preprocessForDetection(imageData: ImageData): {
  tensor: ort.Tensor;
  scaleX: number;
  scaleY: number;
} {
  const { width: origW, height: origH } = imageData;

  // Compute resize dimensions (max side = DET_MAX_SIDE)
  const ratio = Math.min(DET_MAX_SIDE / origW, DET_MAX_SIDE / origH, 1);
  let resW = Math.round(origW * ratio);
  let resH = Math.round(origH * ratio);

  // Pad to multiple of 32
  resW = Math.ceil(resW / 32) * 32;
  resH = Math.ceil(resH / 32) * 32;

  const scaleX = origW / resW;
  const scaleY = origH / resH;

  // Resize via offscreen canvas
  const resized = resizeImageData(imageData, resW, resH);

  // Normalize to NCHW Float32
  const tensor = imageDataToNchwTensor(resized, resW, resH);

  return { tensor, scaleX, scaleY };
}

/**
 * Preprocess an image for the PP-OCRv4 recognition model.
 *
 * Resizes to fixed height (REC_HEIGHT) with proportional width (max REC_MAX_WIDTH),
 * then normalizes with ImageNet statistics.
 */
function preprocessForRecognition(imageData: ImageData): ort.Tensor {
  const { width: origW, height: origH } = imageData;

  const targetH = REC_HEIGHT;
  let targetW = Math.round((origW / origH) * targetH);
  targetW = Math.min(targetW, REC_MAX_WIDTH);
  targetW = Math.max(targetW, 1);

  const resized = resizeImageData(imageData, targetW, targetH);
  return imageDataToNchwTensor(resized, targetW, targetH);
}

/**
 * Convert ImageData pixels to a normalized NCHW Float32 tensor.
 *
 * Applies ImageNet normalization: (pixel / 255 - mean) / std per channel.
 */
function imageDataToNchwTensor(
  imageData: ImageData,
  w: number,
  h: number,
): ort.Tensor {
  const pixels = imageData.data;
  const size = w * h;
  const float32 = new Float32Array(3 * size);

  for (let i = 0; i < size; i++) {
    const pixIdx = i * 4;
    // Channel order: R, G, B → planes 0, 1, 2
    float32[i] = (pixels[pixIdx] / 255 - NORM_MEAN[0]) / NORM_STD[0];
    float32[size + i] =
      (pixels[pixIdx + 1] / 255 - NORM_MEAN[1]) / NORM_STD[1];
    float32[2 * size + i] =
      (pixels[pixIdx + 2] / 255 - NORM_MEAN[2]) / NORM_STD[2];
  }

  return new ort.Tensor("float32", float32, [1, 3, h, w]);
}

/**
 * Resize ImageData using an OffscreenCanvas for high-quality bilinear interpolation.
 */
function resizeImageData(
  imageData: ImageData,
  targetW: number,
  targetH: number,
): ImageData {
  // Source canvas
  const srcCanvas = new OffscreenCanvas(imageData.width, imageData.height);
  const srcCtx = srcCanvas.getContext("2d")!;
  srcCtx.putImageData(imageData, 0, 0);

  // Destination canvas
  const dstCanvas = new OffscreenCanvas(targetW, targetH);
  const dstCtx = dstCanvas.getContext("2d")!;
  dstCtx.drawImage(srcCanvas, 0, 0, targetW, targetH);

  return dstCtx.getImageData(0, 0, targetW, targetH);
}

/**
 * Crop a rectangular region from ImageData.
 */
function cropImageData(imageData: ImageData, box: TextBox): ImageData {
  const { x, y, w, h } = box;
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(imageData, 0, 0);
  return ctx.getImageData(x, y, w, h);
}

// --- Connected-components box extraction -------------------------------------

/**
 * Extract text bounding boxes from a detection probability map.
 *
 * Thresholds the probability map, runs a simple flood-fill connected
 * components analysis, and returns bounding boxes scaled to original
 * image coordinates.
 */
function extractBoxesFromProbMap(
  probMap: Float32Array,
  mapW: number,
  mapH: number,
  scaleX: number,
  scaleY: number,
  origW: number,
  origH: number,
): TextBox[] {
  // Binarize probability map
  const binary = new Uint8Array(mapW * mapH);
  for (let i = 0; i < probMap.length; i++) {
    binary[i] = probMap[i] > DET_THRESHOLD ? 1 : 0;
  }

  // Connected component labeling via flood fill
  const labels = new Int32Array(mapW * mapH);
  let nextLabel = 1;
  const componentBounds = new Map<
    number,
    { minX: number; minY: number; maxX: number; maxY: number }
  >();

  const grid: FloodFillGrid = { binary, labels, w: mapW, h: mapH };

  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const idx = y * mapW + x;
      if (binary[idx] === 1 && labels[idx] === 0) {
        const label = nextLabel++;
        const bounds = { minX: x, minY: y, maxX: x, maxY: y };
        floodFill(grid, x, y, label, bounds);
        componentBounds.set(label, bounds);
      }
    }
  }

  // Convert component bounds to TextBox in original coordinates
  const boxes: TextBox[] = [];
  for (const bounds of componentBounds.values()) {
    const bx = Math.max(0, Math.floor(bounds.minX * scaleX));
    const by = Math.max(0, Math.floor(bounds.minY * scaleY));
    const bw = Math.min(
      origW - bx,
      Math.ceil((bounds.maxX - bounds.minX + 1) * scaleX),
    );
    const bh = Math.min(
      origH - by,
      Math.ceil((bounds.maxY - bounds.minY + 1) * scaleY),
    );

    if (bw * bh >= DET_MIN_AREA) {
      boxes.push({ x: bx, y: by, w: bw, h: bh });
    }
  }

  return boxes;
}

/** Grid data used by the flood-fill algorithm. */
interface FloodFillGrid {
  binary: Uint8Array;
  labels: Int32Array;
  w: number;
  h: number;
}

/**
 * Iterative flood fill using a stack to avoid call-stack overflow on large regions.
 */
function floodFill(
  grid: FloodFillGrid,
  startX: number,
  startY: number,
  label: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): void {
  const { binary, labels, w, h } = grid;
  const stack: Array<[number, number]> = [[startX, startY]];

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const idx = y * w + x;

    if (x < 0 || x >= w || y < 0 || y >= h) continue;
    if (binary[idx] !== 1 || labels[idx] !== 0) continue;

    labels[idx] = label;
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);

    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
}
