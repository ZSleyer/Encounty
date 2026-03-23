/**
 * WebGPUDetector — GPU-accelerated NCC template matching engine.
 *
 * Ports the Rust sidecar's wgpu compute pipeline to the browser using the
 * WebGPU API. The pipeline stages are:
 *
 * 1. Upload video frame to GPU texture (zero-copy via copyExternalImageToTexture)
 * 2. Preprocess: RGBA texture -> grayscale f32 buffer (crop + bilinear downscale)
 * 3. Pixel delta: compare two 64x64 grayscale buffers for frame deduplication
 * 4. NCC: brute-force normalized cross-correlation at all candidate positions
 * 5. Reduce-max: parallel tree reduction to find the best NCC score
 */

import preprocessShader from "./shaders/preprocess.wgsl?raw";
import nccShader from "./shaders/ncc.wgsl?raw";
import pixelDeltaShader from "./shaders/pixel_delta.wgsl?raw";
import reduceMaxShader from "./shaders/reduce_max.wgsl?raw";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result of a full detection cycle across all templates. */
export interface DetectResult {
  /** Best NCC score found (alias: score). */
  bestScore: number;
  /** Alias for bestScore, used by DetectionLoop. */
  score: number;
  /** Normalised pixel delta between consecutive frames (0=identical, 1=max). */
  frameDelta: number;
  /** Index of the template that produced the best score. */
  templateIndex: number;
}

/**
 * A grayscale template prepared for matching.
 *
 * GPU-specific fields (grayscaleBuffer) are present when loaded via
 * WebGPUDetector. CPU-specific fields (gray, stdDev) are present when
 * loaded via CPUDetector. Both detectors populate the shared fields.
 */
export interface TemplateData {
  /** GPU storage buffer containing f32 grayscale pixels (WebGPU only). */
  grayscaleBuffer?: GPUBuffer;
  /** CPU grayscale pixel data in 0-255 range (CPU fallback only). */
  gray?: Float32Array;
  width: number;
  height: number;
  mean: number;
  /** Standard deviation of the grayscale template. */
  stdDev: number;
  pixelCount: number;
  regions: Array<{
    type: string;
    rect: { x: number; y: number; w: number; h: number };
  }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Must match @workgroup_size in ncc.wgsl and reduce_max.wgsl. */
const NCC_WORKGROUP_SIZE = 256;

/** Must match @workgroup_size in preprocess.wgsl (16x16). */
const PREPROCESS_WG = 16;

/** Fixed grid size for pixel-delta comparison (matches shader). */
const DELTA_DIM = 64;

/** Normalisation denominator for pixel delta (64 * 64 * 255 * 1000). */
const DELTA_NORM = DELTA_DIM * DELTA_DIM * 255 * 1000;

// ---------------------------------------------------------------------------
// WebGPUDetector
// ---------------------------------------------------------------------------

/**
 * GPU-accelerated NCC template matching engine using WebGPU compute shaders.
 *
 * Usage:
 * ```ts
 * const detector = await WebGPUDetector.create();
 * const template = await detector.loadTemplate(imageData);
 * const result = await detector.detect(videoEl, [template], { precision: 0.9 });
 * detector.destroy();
 * ```
 */
export class WebGPUDetector {
  private device: GPUDevice;
  private preprocessPipeline: GPUComputePipeline;
  private preprocessBGL: GPUBindGroupLayout;
  private nccPipeline: GPUComputePipeline;
  private nccBGL: GPUBindGroupLayout;
  private deltaPipeline: GPUComputePipeline;
  private deltaBGL: GPUBindGroupLayout;
  private reducePipeline: GPUComputePipeline;
  private reduceBGL: GPUBindGroupLayout;
  private destroyed = false;

  private constructor(
    device: GPUDevice,
    pipelines: {
      preprocess: GPUComputePipeline;
      preprocessBGL: GPUBindGroupLayout;
      ncc: GPUComputePipeline;
      nccBGL: GPUBindGroupLayout;
      delta: GPUComputePipeline;
      deltaBGL: GPUBindGroupLayout;
      reduce: GPUComputePipeline;
      reduceBGL: GPUBindGroupLayout;
    },
  ) {
    this.device = device;
    this.preprocessPipeline = pipelines.preprocess;
    this.preprocessBGL = pipelines.preprocessBGL;
    this.nccPipeline = pipelines.ncc;
    this.nccBGL = pipelines.nccBGL;
    this.deltaPipeline = pipelines.delta;
    this.deltaBGL = pipelines.deltaBGL;
    this.reducePipeline = pipelines.reduce;
    this.reduceBGL = pipelines.reduceBGL;
  }

  /** Check whether WebGPU is available in the current browser. */
  static isAvailable(): boolean {
    return typeof navigator !== "undefined" && "gpu" in navigator;
  }

  /**
   * Request a GPU device and compile all compute pipelines.
   *
   * Throws if WebGPU is unavailable or the adapter cannot be obtained.
   */
  static async create(): Promise<WebGPUDetector> {
    if (!WebGPUDetector.isAvailable()) {
      throw new Error("WebGPU is not supported in this browser");
    }

    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    if (!adapter) {
      throw new Error("Failed to obtain WebGPU adapter");
    }

    const device = await adapter.requestDevice({
      label: "encounty-detector",
    });

    device.lost.then((info) => {
      console.error("[WebGPUDetector] device lost:", info.message);
    });

    const pipelines = WebGPUDetector.compilePipelines(device);
    return new WebGPUDetector(device, pipelines);
  }

  /**
   * Upload a video frame to a GPU texture for subsequent preprocessing.
   *
   * Uses copyExternalImageToTexture for zero-copy transfer when the browser
   * supports it (Chrome/Edge on most platforms).
   */
  uploadVideoFrame(
    source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap,
  ): GPUTexture {
    let width: number;
    let height: number;

    if (source instanceof HTMLVideoElement) {
      width = source.videoWidth;
      height = source.videoHeight;
    } else if (source instanceof HTMLCanvasElement) {
      width = source.width;
      height = source.height;
    } else {
      width = source.width;
      height = source.height;
    }

    if (width === 0 || height === 0) {
      throw new Error("Source has zero dimensions");
    }

    const texture = this.device.createTexture({
      label: "frame_texture",
      size: { width, height },
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.device.queue.copyExternalImageToTexture(
      { source },
      { texture },
      { width, height },
    );

    return texture;
  }

  /**
   * Preprocess an RGBA texture into a grayscale f32 storage buffer.
   *
   * Applies optional crop and downscale (bilinear) to fit within maxDim while
   * preserving aspect ratio. Returns the output buffer and its dimensions.
   */
  preprocess(
    texture: GPUTexture,
    crop?: { x: number; y: number; w: number; h: number },
    maxDim?: number,
  ): { buffer: GPUBuffer; width: number; height: number } {
    const srcW = texture.width;
    const srcH = texture.height;
    const cropX = crop?.x ?? 0;
    const cropY = crop?.y ?? 0;
    const cropW = crop?.w ?? srcW;
    const cropH = crop?.h ?? srcH;
    const md = maxDim ?? 320;

    const [dstW, dstH] = fitDimensions(cropW, cropH, md);

    // Uniform buffer: 8 u32 values = 32 bytes
    const paramsData = new Uint32Array([
      srcW,
      srcH,
      dstW,
      dstH,
      cropX,
      cropY,
      cropW,
      cropH,
    ]);
    const paramsBuf = this.createBufferWithData(
      paramsData,
      GPUBufferUsage.UNIFORM,
      "preprocess_params",
    );

    const outputSize = dstW * dstH * 4; // f32 = 4 bytes
    const outputBuf = this.device.createBuffer({
      label: "preprocess_output",
      size: outputSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const bindGroup = this.device.createBindGroup({
      label: "preprocess_bg",
      layout: this.preprocessBGL,
      entries: [
        { binding: 0, resource: { buffer: paramsBuf } },
        { binding: 1, resource: texture.createView() },
        { binding: 2, resource: { buffer: outputBuf } },
      ],
    });

    const encoder = this.device.createCommandEncoder({
      label: "preprocess_encoder",
    });
    const pass = encoder.beginComputePass({ label: "preprocess_pass" });
    pass.setPipeline(this.preprocessPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(
      divCeil(dstW, PREPROCESS_WG),
      divCeil(dstH, PREPROCESS_WG),
    );
    pass.end();

    this.device.queue.submit([encoder.finish()]);
    paramsBuf.destroy();

    return { buffer: outputBuf, width: dstW, height: dstH };
  }

  /**
   * Compute the normalised pixel delta between two 64x64 grayscale buffers.
   *
   * Returns a value in [0, 1] where 0 means identical and 1 means maximally
   * different. Used for frame deduplication to skip redundant NCC computations.
   */
  async pixelDelta(a: GPUBuffer, b: GPUBuffer): Promise<number> {
    // Result buffer: single u32, initialised to zero
    const resultBuf = this.device.createBuffer({
      label: "delta_result",
      size: 4,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });
    // Zero-initialise the atomic counter
    this.device.queue.writeBuffer(resultBuf, 0, new Uint32Array([0]));

    const bindGroup = this.device.createBindGroup({
      label: "delta_bg",
      layout: this.deltaBGL,
      entries: [
        { binding: 0, resource: { buffer: a } },
        { binding: 1, resource: { buffer: b } },
        { binding: 2, resource: { buffer: resultBuf } },
      ],
    });

    const encoder = this.device.createCommandEncoder({
      label: "delta_encoder",
    });
    const pass = encoder.beginComputePass({ label: "delta_pass" });
    pass.setPipeline(this.deltaPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(
      divCeil(DELTA_DIM, PREPROCESS_WG),
      divCeil(DELTA_DIM, PREPROCESS_WG),
    );
    pass.end();

    const raw = await this.readU32(encoder, resultBuf);
    resultBuf.destroy();
    return raw / DELTA_NORM;
  }

  /**
   * Run NCC template matching between a grayscale frame buffer and a template.
   *
   * Dispatches the NCC compute shader for all candidate positions, then
   * reduces to the maximum score via iterative parallel max-reduction.
   */
  async nccMatch(
    frameBuf: GPUBuffer,
    template: TemplateData,
    frameW: number,
    frameH: number,
  ): Promise<number> {
    const outW = frameW - template.width + 1;
    const outH = frameH - template.height + 1;
    const totalPositions = outW * outH;

    if (totalPositions <= 0) return 0;

    // NCC uniform params: 8 values (u32/f32 mix), 32 bytes
    const paramsArray = new ArrayBuffer(32);
    const paramsU32 = new Uint32Array(paramsArray);
    const paramsF32 = new Float32Array(paramsArray);
    paramsU32[0] = frameW;
    paramsU32[1] = frameH;
    paramsU32[2] = template.width;
    paramsU32[3] = template.height;
    paramsF32[4] = template.mean;
    paramsF32[5] = template.stdDev; // This is std_dev, not 1/std
    paramsF32[6] = template.pixelCount;
    paramsU32[7] = outW;

    const paramsBuf = this.createBufferWithData(
      new Uint8Array(paramsArray),
      GPUBufferUsage.UNIFORM,
      "ncc_params",
    );

    // Scores buffer: one f32 per candidate position
    const scoresBuf = this.device.createBuffer({
      label: "ncc_scores",
      size: totalPositions * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const nccBindGroup = this.device.createBindGroup({
      label: "ncc_bg",
      layout: this.nccBGL,
      entries: [
        { binding: 0, resource: { buffer: frameBuf } },
        { binding: 1, resource: { buffer: template.grayscaleBuffer! } },
        { binding: 2, resource: { buffer: paramsBuf } },
        { binding: 3, resource: { buffer: scoresBuf } },
      ],
    });

    const encoder = this.device.createCommandEncoder({ label: "ncc_encoder" });
    const pass = encoder.beginComputePass({ label: "ncc_pass" });
    pass.setPipeline(this.nccPipeline);
    pass.setBindGroup(0, nccBindGroup);
    pass.dispatchWorkgroups(divCeil(totalPositions, NCC_WORKGROUP_SIZE), 1, 1);
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    // Parallel max-reduction
    const result = await this.reduceMax(scoresBuf, totalPositions);

    paramsBuf.destroy();
    scoresBuf.destroy();
    return result;
  }

  /**
   * Load an image as a GPU-ready grayscale template.
   *
   * Converts the image to grayscale, computes mean and standard deviation,
   * and uploads the f32 data to a GPU storage buffer. Returns null if the
   * template has near-zero variance (flat colour).
   */
  async loadTemplate(
    imageSource: ImageData | ImageBitmap,
    regions?: Array<{
      type: string;
      rect: { x: number; y: number; w: number; h: number };
    }>,
  ): Promise<TemplateData | null> {
    let pixels: Uint8ClampedArray;
    let width: number;
    let height: number;

    if (imageSource instanceof ImageData) {
      pixels = imageSource.data;
      width = imageSource.width;
      height = imageSource.height;
    } else {
      // ImageBitmap: draw to an offscreen canvas to extract pixel data
      const canvas = new OffscreenCanvas(
        imageSource.width,
        imageSource.height,
      );
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to get 2d context for template");
      ctx.drawImage(imageSource, 0, 0);
      const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
      pixels = id.data;
      width = id.width;
      height = id.height;
    }

    const n = width * height;
    const gray = new Float32Array(n);

    // Convert RGBA to grayscale (BT.601 luminance, normalised to [0, 1])
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const r = pixels[i * 4] / 255;
      const g = pixels[i * 4 + 1] / 255;
      const b = pixels[i * 4 + 2] / 255;
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

    // Reject flat-colour templates that would cause division by zero
    if (stdDev < 1e-6) {
      return null;
    }

    const grayscaleBuffer = this.createBufferWithData(
      gray,
      GPUBufferUsage.STORAGE,
      "template_gray",
    );

    return {
      grayscaleBuffer,
      width,
      height,
      mean,
      stdDev,
      pixelCount: n,
      regions: regions ?? [],
    };
  }

  /**
   * Run a full detection cycle: upload frame, preprocess, compute pixel delta
   * against the previous frame, and NCC-match against all templates.
   *
   * Returns the best score, the pixel delta, and the index of the best template.
   */
  async detect(
    source: HTMLVideoElement,
    templates: TemplateData[],
    config: {
      precision: number;
      crop?: { x: number; y: number; w: number; h: number };
      maxDim?: number;
      changeThreshold?: number;
      previousFrame?: GPUBuffer;
    },
  ): Promise<DetectResult & { frameBuffer: GPUBuffer }> {
    if (templates.length === 0) {
      throw new Error("No templates provided");
    }

    // Upload and preprocess the current frame
    const texture = this.uploadVideoFrame(source);
    const { buffer: frameBuf, width: frameW, height: frameH } =
      this.preprocess(texture, config.crop, config.maxDim);
    texture.destroy();

    // Compute pixel delta for frame deduplication
    let frameDelta = 1.0;
    if (config.previousFrame) {
      frameDelta = await this.pixelDelta(config.previousFrame, frameBuf);
    }

    // NCC match against each template, track the best
    let bestScore = 0;
    let bestIndex = 0;

    for (let i = 0; i < templates.length; i++) {
      const score = await this.nccMatch(frameBuf, templates[i], frameW, frameH);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
      // Early exit if we already exceed precision
      if (bestScore >= config.precision) break;
    }

    return {
      bestScore,
      score: bestScore,
      frameDelta,
      templateIndex: bestIndex,
      frameBuffer: frameBuf,
    };
  }

  /** Release all GPU resources held by this detector. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.device.destroy();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Compile all four compute pipelines and their bind group layouts. */
  private static compilePipelines(device: GPUDevice) {
    // --- Preprocess pipeline -----------------------------------------------
    const preprocessModule = device.createShaderModule({
      label: "preprocess.wgsl",
      code: preprocessShader,
    });

    const preprocessBGL = device.createBindGroupLayout({
      label: "preprocess_bgl",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "float" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
      ],
    });

    const preprocess = device.createComputePipeline({
      label: "preprocess_pipeline",
      layout: device.createPipelineLayout({
        bindGroupLayouts: [preprocessBGL],
      }),
      compute: { module: preprocessModule, entryPoint: "main" },
    });

    // --- NCC pipeline ------------------------------------------------------
    const nccModule = device.createShaderModule({
      label: "ncc.wgsl",
      code: nccShader,
    });

    const nccBGL = device.createBindGroupLayout({
      label: "ncc_bgl",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
      ],
    });

    const ncc = device.createComputePipeline({
      label: "ncc_pipeline",
      layout: device.createPipelineLayout({ bindGroupLayouts: [nccBGL] }),
      compute: { module: nccModule, entryPoint: "main" },
    });

    // --- Pixel-delta pipeline ----------------------------------------------
    const deltaModule = device.createShaderModule({
      label: "pixel_delta.wgsl",
      code: pixelDeltaShader,
    });

    const deltaBGL = device.createBindGroupLayout({
      label: "delta_bgl",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
      ],
    });

    const delta = device.createComputePipeline({
      label: "delta_pipeline",
      layout: device.createPipelineLayout({ bindGroupLayouts: [deltaBGL] }),
      compute: { module: deltaModule, entryPoint: "main" },
    });

    // --- Reduce-max pipeline -----------------------------------------------
    const reduceModule = device.createShaderModule({
      label: "reduce_max.wgsl",
      code: reduceMaxShader,
    });

    const reduceBGL = device.createBindGroupLayout({
      label: "reduce_bgl",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
      ],
    });

    const reduce = device.createComputePipeline({
      label: "reduce_max_pipeline",
      layout: device.createPipelineLayout({ bindGroupLayouts: [reduceBGL] }),
      compute: { module: reduceModule, entryPoint: "main" },
    });

    return {
      preprocess,
      preprocessBGL,
      ncc,
      nccBGL,
      delta,
      deltaBGL,
      reduce,
      reduceBGL,
    };
  }

  /**
   * Iteratively reduce `count` f32 values in `buf` to a single maximum.
   *
   * Each pass reduces by a factor of 256 (the workgroup size). The reduction
   * happens in-place: each workgroup writes its local max to the first element
   * of its range.
   */
  private async reduceMax(buf: GPUBuffer, count: number): Promise<number> {
    let remaining = count;

    while (remaining > 1) {
      const workgroups = divCeil(remaining, NCC_WORKGROUP_SIZE);

      // Reduce params: count + padding = 8 bytes
      const rpData = new Uint32Array([remaining, 0]);
      const rpBuf = this.createBufferWithData(
        rpData,
        GPUBufferUsage.UNIFORM,
        "reduce_params",
      );

      const bindGroup = this.device.createBindGroup({
        label: "reduce_bg",
        layout: this.reduceBGL,
        entries: [
          { binding: 0, resource: { buffer: buf } },
          { binding: 1, resource: { buffer: rpBuf } },
        ],
      });

      const encoder = this.device.createCommandEncoder({
        label: "reduce_encoder",
      });
      const pass = encoder.beginComputePass({ label: "reduce_pass" });
      pass.setPipeline(this.reducePipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(workgroups, 1, 1);
      pass.end();
      this.device.queue.submit([encoder.finish()]);

      rpBuf.destroy();
      remaining = workgroups;
    }

    // Read back the single result from buf[0]
    return this.readF32(buf);
  }

  /** Copy the first f32 from a storage buffer to the CPU via a staging buffer. */
  private async readF32(src: GPUBuffer): Promise<number> {
    const staging = this.device.createBuffer({
      label: "staging_f32",
      size: 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const encoder = this.device.createCommandEncoder({
      label: "readback_encoder",
    });
    encoder.copyBufferToBuffer(src, 0, staging, 0, 4);
    this.device.queue.submit([encoder.finish()]);

    await staging.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(staging.getMappedRange());
    const result = data[0];
    staging.unmap();
    staging.destroy();
    return result;
  }

  /**
   * Read a single u32 from a storage buffer via a staging buffer.
   *
   * The encoder is provided by the caller so the copy can be batched with
   * the preceding compute pass.
   */
  private async readU32(
    encoder: GPUCommandEncoder,
    src: GPUBuffer,
  ): Promise<number> {
    const staging = this.device.createBuffer({
      label: "staging_u32",
      size: 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    encoder.copyBufferToBuffer(src, 0, staging, 0, 4);
    this.device.queue.submit([encoder.finish()]);

    await staging.mapAsync(GPUMapMode.READ);
    const data = new Uint32Array(staging.getMappedRange());
    const result = data[0];
    staging.unmap();
    staging.destroy();
    return result;
  }

  /** Create a GPU buffer initialised with the given typed array data. */
  private createBufferWithData(
    data: ArrayBufferView,
    usage: GPUBufferUsageFlags,
    label: string,
  ): GPUBuffer {
    const buffer = this.device.createBuffer({
      label,
      size: Math.max(data.byteLength, 4), // Minimum 4 bytes for WebGPU
      usage: usage | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });

    const dst = new Uint8Array(buffer.getMappedRange());
    dst.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    buffer.unmap();
    return buffer;
  }
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/** Integer division rounding up. */
function divCeil(a: number, b: number): number {
  return Math.ceil(a / b);
}

/**
 * Calculate output dimensions that fit within maxDim, preserving aspect ratio.
 * Matches the Rust sidecar's fit_dimensions logic.
 */
function fitDimensions(w: number, h: number, maxDim: number): [number, number] {
  if (w <= maxDim && h <= maxDim) {
    return [w, h];
  }
  const scale = maxDim / Math.max(w, h);
  const dstW = Math.max(Math.round(w * scale), 1);
  const dstH = Math.max(Math.round(h * scale), 1);
  return [dstW, dstH];
}
