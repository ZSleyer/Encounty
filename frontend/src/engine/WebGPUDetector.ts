/**
 * WebGPUDetector — GPU-accelerated template matching engine.
 *
 * Implements a wgpu-style compute pipeline in the browser using the
 * WebGPU API. Two matching strategies are supported:
 *
 * **Sliding-window NCC** (templates without regions):
 * 1. Upload video frame to GPU texture (zero-copy via copyExternalImageToTexture)
 * 2. Preprocess: RGBA texture -> grayscale f32 buffer (crop + bilinear downscale)
 * 3. Pixel delta: compare two 64x64 grayscale buffers for frame deduplication
 * 4. NCC: brute-force normalized cross-correlation at all candidate positions
 * 5. Reduce-max: parallel tree reduction to find the best NCC score
 *
 * **Region-based 5-metric hybrid** (templates with regions):
 * 1. Upload video frame and crop each defined region via the preprocess pipeline
 * 2. Dispatch all 5 metric shaders in a single command encoder per region:
 *    Block-SSIM, Pearson NCC, MAD, histogram correlation, dHash
 * 3. Fuse scores on GPU: 0.30*SSIM + 0.25*Pearson + 0.20*MAD + 0.15*hist + 0.10*dHash
 * 4. Reduce-min across regions (AND-logic: every region must match)
 * 5. Single readback of the final fused score
 */

import preprocessShader from "./shaders/preprocess.wgsl?raw";
import nccShader from "./shaders/ncc.wgsl?raw";
import pixelDeltaShader from "./shaders/pixel_delta.wgsl?raw";
import reduceMaxShader from "./shaders/reduce_max.wgsl?raw";
import blockSsimShader from "./shaders/block_ssim.wgsl?raw";
import pearsonNccShader from "./shaders/pearson_ncc.wgsl?raw";
import madShader from "./shaders/mad.wgsl?raw";
import histogramShader from "./shaders/histogram.wgsl?raw";
import dhashShader from "./shaders/dhash.wgsl?raw";
import fuseScoresShader from "./shaders/fuse_scores.wgsl?raw";
import reduceMinShader from "./shaders/reduce_min.wgsl?raw";

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
    polarity?: "positive" | "negative";
  }>;
  /** Pre-cropped region buffers for hybrid matching (WebGPU only). */
  regionCrops?: Array<{
    buffer: GPUBuffer;
    width: number;
    height: number;
    rect: { x: number; y: number; w: number; h: number };
    blockSize: number;
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
// Pipeline type definition
// ---------------------------------------------------------------------------

/** All compiled compute pipelines and their bind group layouts. */
interface CompiledPipelines {
  preprocess: GPUComputePipeline;
  preprocessBGL: GPUBindGroupLayout;
  ncc: GPUComputePipeline;
  nccBGL: GPUBindGroupLayout;
  delta: GPUComputePipeline;
  deltaBGL: GPUBindGroupLayout;
  reduce: GPUComputePipeline;
  reduceBGL: GPUBindGroupLayout;
  blockSsim: GPUComputePipeline;
  blockSsimBGL: GPUBindGroupLayout;
  pearsonNcc: GPUComputePipeline;
  pearsonNccBGL: GPUBindGroupLayout;
  mad: GPUComputePipeline;
  madBGL: GPUBindGroupLayout;
  histogram: GPUComputePipeline;
  histogramBGL: GPUBindGroupLayout;
  dhash: GPUComputePipeline;
  dhashBGL: GPUBindGroupLayout;
  fuseScores: GPUComputePipeline;
  fuseScoresBGL: GPUBindGroupLayout;
  reduceMin: GPUComputePipeline;
  reduceMinBGL: GPUBindGroupLayout;
}

// ---------------------------------------------------------------------------
// WebGPUDetector
// ---------------------------------------------------------------------------

/**
 * GPU-accelerated template matching engine using WebGPU compute shaders.
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
  private readonly device: GPUDevice;
  private readonly preprocessPipeline: GPUComputePipeline;
  private readonly preprocessBGL: GPUBindGroupLayout;
  private readonly nccPipeline: GPUComputePipeline;
  private readonly nccBGL: GPUBindGroupLayout;
  private readonly deltaPipeline: GPUComputePipeline;
  private readonly deltaBGL: GPUBindGroupLayout;
  private readonly reducePipeline: GPUComputePipeline;
  private readonly reduceBGL: GPUBindGroupLayout;
  private readonly blockSsimPipeline: GPUComputePipeline;
  private readonly blockSsimBGL: GPUBindGroupLayout;
  private readonly pearsonNccPipeline: GPUComputePipeline;
  private readonly pearsonNccBGL: GPUBindGroupLayout;
  private readonly madPipeline: GPUComputePipeline;
  private readonly madBGL: GPUBindGroupLayout;
  private readonly histogramPipeline: GPUComputePipeline;
  private readonly histogramBGL: GPUBindGroupLayout;
  private readonly dhashPipeline: GPUComputePipeline;
  private readonly dhashBGL: GPUBindGroupLayout;
  private readonly fuseScoresPipeline: GPUComputePipeline;
  private readonly fuseScoresBGL: GPUBindGroupLayout;
  private readonly reduceMinPipeline: GPUComputePipeline;
  private readonly reduceMinBGL: GPUBindGroupLayout;
  private destroyed = false;

  private constructor(device: GPUDevice, pipelines: CompiledPipelines) {
    this.device = device;
    this.preprocessPipeline = pipelines.preprocess;
    this.preprocessBGL = pipelines.preprocessBGL;
    this.nccPipeline = pipelines.ncc;
    this.nccBGL = pipelines.nccBGL;
    this.deltaPipeline = pipelines.delta;
    this.deltaBGL = pipelines.deltaBGL;
    this.reducePipeline = pipelines.reduce;
    this.reduceBGL = pipelines.reduceBGL;
    this.blockSsimPipeline = pipelines.blockSsim;
    this.blockSsimBGL = pipelines.blockSsimBGL;
    this.pearsonNccPipeline = pipelines.pearsonNcc;
    this.pearsonNccBGL = pipelines.pearsonNccBGL;
    this.madPipeline = pipelines.mad;
    this.madBGL = pipelines.madBGL;
    this.histogramPipeline = pipelines.histogram;
    this.histogramBGL = pipelines.histogramBGL;
    this.dhashPipeline = pipelines.dhash;
    this.dhashBGL = pipelines.dhashBGL;
    this.fuseScoresPipeline = pipelines.fuseScores;
    this.fuseScoresBGL = pipelines.fuseScoresBGL;
    this.reduceMinPipeline = pipelines.reduceMin;
    this.reduceMinBGL = pipelines.reduceMinBGL;
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

  // -----------------------------------------------------------------------
  // Region-based hybrid matching (all 5 metrics on GPU)
  // -----------------------------------------------------------------------

  /**
   * Region-based 5-metric hybrid matching — fully GPU-accelerated.
   *
   * For each defined region, crops the corresponding area from the live frame,
   * dispatches all 5 metric shaders (Block-SSIM, Pearson, MAD, histogram,
   * dHash) in a single command encoder, fuses them on GPU, and collects
   * per-region scores. The final result is the minimum across all regions
   * (AND-logic: every region must match).
   *
   * Only a single GPU readback occurs at the very end for the final score.
   */
  private async regionHybridMatch(
    frameTexture: GPUTexture,
    template: TemplateData,
  ): Promise<number> {
    const regionCrops = template.regionCrops!;
    const regionCount = regionCrops.length;

    // Scale region coordinates from template space to frame (video) space
    const frameW = frameTexture.width;
    const frameH = frameTexture.height;
    const scaleX = frameW / template.width;
    const scaleY = frameH / template.height;

    // Buffer to hold per-region fused scores for final min-reduction
    const regionScoresBuf = this.device.createBuffer({
      label: "region_scores",
      size: Math.max(regionCount * 4, 4),
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });

    const buffersToDestroy: GPUBuffer[] = [regionScoresBuf];

    for (let ri = 0; ri < regionCount; ri++) {
      const { rect, width: rw, height: rh, blockSize, buffer: tmplBuf } =
        regionCrops[ri];

      // Map template-space rect to frame-space crop coordinates
      const frameCrop = {
        x: Math.round(rect.x * scaleX),
        y: Math.round(rect.y * scaleY),
        w: Math.max(4, Math.round(rect.w * scaleX)),
        h: Math.max(4, Math.round(rect.h * scaleY)),
      };

      // Crop the frame region and downscale to match template crop dimensions
      const { buffer: frameCropBuf } = this.preprocess(
        frameTexture,
        frameCrop,
        Math.max(rw, rh),
      );
      buffersToDestroy.push(frameCropBuf);

      // Uniform params shared by Pearson, MAD, histogram, and dHash (width, height)
      const metricParamsBuf = this.createBufferWithData(
        new Uint32Array([rw, rh]),
        GPUBufferUsage.UNIFORM,
        `metric_params_${ri}`,
      );
      buffersToDestroy.push(metricParamsBuf);

      // --- Dispatch all 5 metric shaders in a single command encoder ---
      const encoder = this.device.createCommandEncoder({
        label: `hybrid_encoder_${ri}`,
      });

      // 1. Block-SSIM: produces per-block scores, needs separate handling
      const ssimResult = this.encodeBlockSsim(
        encoder,
        frameCropBuf,
        tmplBuf,
        rw,
        rh,
        blockSize,
      );
      buffersToDestroy.push(ssimResult.scoresBuf, ssimResult.paramsBuf);

      // 2. Pearson NCC
      const pearsonOutBuf = this.createScalarOutputBuffer(`pearson_out_${ri}`);
      buffersToDestroy.push(pearsonOutBuf);
      this.encodeMetricPass(
        encoder,
        this.pearsonNccPipeline,
        this.pearsonNccBGL,
        frameCropBuf,
        tmplBuf,
        metricParamsBuf,
        pearsonOutBuf,
        `pearson_pass_${ri}`,
      );

      // 3. MAD
      const madOutBuf = this.createScalarOutputBuffer(`mad_out_${ri}`);
      buffersToDestroy.push(madOutBuf);
      this.encodeMetricPass(
        encoder,
        this.madPipeline,
        this.madBGL,
        frameCropBuf,
        tmplBuf,
        metricParamsBuf,
        madOutBuf,
        `mad_pass_${ri}`,
      );

      // 4. Histogram correlation
      const histOutBuf = this.createScalarOutputBuffer(`hist_out_${ri}`);
      buffersToDestroy.push(histOutBuf);
      this.encodeMetricPass(
        encoder,
        this.histogramPipeline,
        this.histogramBGL,
        frameCropBuf,
        tmplBuf,
        metricParamsBuf,
        histOutBuf,
        `hist_pass_${ri}`,
      );

      // 5. dHash
      const dhashOutBuf = this.createScalarOutputBuffer(`dhash_out_${ri}`);
      buffersToDestroy.push(dhashOutBuf);
      this.encodeMetricPass(
        encoder,
        this.dhashPipeline,
        this.dhashBGL,
        frameCropBuf,
        tmplBuf,
        metricParamsBuf,
        dhashOutBuf,
        `dhash_pass_${ri}`,
      );

      // Submit all 5 metric dispatches
      this.device.queue.submit([encoder.finish()]);

      // Block-SSIM requires CPU median — read back and compute
      const ssimMedian = await this.computeSsimMedian(
        ssimResult.scoresBuf,
        ssimResult.totalBlocks,
      );

      // Assemble the 5 scores into a buffer for the fuse shader
      const scoresInputBuf = this.createBufferWithData(
        new Float32Array([ssimMedian, 0, 0, 0, 0]),
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        `fuse_input_${ri}`,
      );
      buffersToDestroy.push(scoresInputBuf);

      // Copy the 4 GPU-produced scalar scores into the fuse input buffer
      const copyEncoder = this.device.createCommandEncoder({
        label: `copy_scores_${ri}`,
      });
      copyEncoder.copyBufferToBuffer(pearsonOutBuf, 0, scoresInputBuf, 4, 4);
      copyEncoder.copyBufferToBuffer(madOutBuf, 0, scoresInputBuf, 8, 4);
      copyEncoder.copyBufferToBuffer(histOutBuf, 0, scoresInputBuf, 12, 4);
      copyEncoder.copyBufferToBuffer(dhashOutBuf, 0, scoresInputBuf, 16, 4);
      this.device.queue.submit([copyEncoder.finish()]);

      // Fuse the 5 scores into one hybrid score on GPU
      const fuseOutBuf = this.createScalarOutputBuffer(`fuse_out_${ri}`);
      buffersToDestroy.push(fuseOutBuf);

      const fuseEncoder = this.device.createCommandEncoder({
        label: `fuse_encoder_${ri}`,
      });
      const fuseBindGroup = this.device.createBindGroup({
        label: `fuse_bg_${ri}`,
        layout: this.fuseScoresBGL,
        entries: [
          { binding: 0, resource: { buffer: scoresInputBuf } },
          { binding: 1, resource: { buffer: fuseOutBuf } },
        ],
      });
      const fusePass = fuseEncoder.beginComputePass({
        label: `fuse_pass_${ri}`,
      });
      fusePass.setPipeline(this.fuseScoresPipeline);
      fusePass.setBindGroup(0, fuseBindGroup);
      fusePass.dispatchWorkgroups(1, 1, 1);
      fusePass.end();

      // Copy the fused result into the region scores buffer at the right offset
      fuseEncoder.copyBufferToBuffer(
        fuseOutBuf,
        0,
        regionScoresBuf,
        ri * 4,
        4,
      );
      this.device.queue.submit([fuseEncoder.finish()]);
    }

    // Min-reduce across all region scores to get the final hybrid score
    let finalScore: number;
    if (regionCount === 1) {
      finalScore = await this.readF32(regionScoresBuf);
    } else {
      finalScore = await this.reduceMin(regionScoresBuf, regionCount);
    }

    // Clean up all temporary buffers
    for (const buf of buffersToDestroy) {
      buf.destroy();
    }

    return finalScore;
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
      polarity?: "positive" | "negative";
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

    // Pre-crop each region from the template for hybrid matching
    const regionList = regions ?? [];
    let regionCrops: TemplateData["regionCrops"];

    if (regionList.length > 0) {
      regionCrops = regionList.map((region) =>
        this.cropRegionToGpu(gray, width, region.rect),
      );
    }

    return {
      grayscaleBuffer,
      gray,
      width,
      height,
      mean,
      stdDev,
      pixelCount: n,
      regions: regionList,
      regionCrops,
    };
  }

  /**
   * Run a full detection cycle: upload frame, preprocess, compute pixel delta
   * against the previous frame, and match against all templates.
   *
   * Templates with regions use the GPU-accelerated 5-metric hybrid pipeline.
   * Templates without regions use sliding-window NCC.
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

    // Check whether any template uses region-based matching
    const needsRegionMatch = templates.some(
      (t) => t.regions.length > 0 && t.regionCrops && t.regionCrops.length > 0,
    );

    // Upload the current frame; keep the texture alive for region crop passes
    const texture = this.uploadVideoFrame(source);
    const { buffer: frameBuf, width: frameW, height: frameH } =
      this.preprocess(texture, config.crop, config.maxDim);

    if (!needsRegionMatch) {
      texture.destroy();
    }

    // Compute pixel delta for frame deduplication
    let frameDelta = 1.0;
    if (config.previousFrame) {
      frameDelta = await this.pixelDelta(config.previousFrame, frameBuf);
    }

    // Match against each template, using region-based hybrid or sliding-window NCC
    let bestScore = 0;
    let bestIndex = 0;

    for (let i = 0; i < templates.length; i++) {
      const tmpl = templates[i];
      const hasRegions =
        tmpl.regions.length > 0 &&
        tmpl.regionCrops &&
        tmpl.regionCrops.length > 0;

      // Only score positive regions; negative regions apply as penalty
      const positiveRegionCrops = tmpl.regionCrops?.filter(
        (_, idx) => tmpl.regions[idx]?.polarity !== "negative",
      );
      const negativeRegionCrops = tmpl.regionCrops?.filter(
        (_, idx) => tmpl.regions[idx]?.polarity === "negative",
      );

      let score: number;
      if (hasRegions && positiveRegionCrops && positiveRegionCrops.length > 0) {
        const positiveTmpl = { ...tmpl, regionCrops: positiveRegionCrops };
        score = await this.regionHybridMatch(texture, positiveTmpl);
      } else if (hasRegions) {
        // All regions are negative — use NCC as base score
        score = await this.nccMatch(frameBuf, tmpl, frameW, frameH);
      } else {
        score = await this.nccMatch(frameBuf, tmpl, frameW, frameH);
      }

      // Apply negative region penalty: high match on negative region suppresses detection
      if (negativeRegionCrops && negativeRegionCrops.length > 0 && score > 0) {
        const negativeTmpl = { ...tmpl, regionCrops: negativeRegionCrops };
        const negScore = await this.regionHybridMatch(texture, negativeTmpl);
        score = score * Math.max(0, 1 - negScore);
      }

      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
      // Early exit if we already exceed precision
      if (bestScore >= config.precision) break;
    }

    if (needsRegionMatch) {
      texture.destroy();
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
  // Private helpers — pipeline compilation
  // -----------------------------------------------------------------------

  /** Compile all compute pipelines and their bind group layouts. */
  private static compilePipelines(device: GPUDevice): CompiledPipelines {
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

    // --- Block-SSIM pipeline ------------------------------------------------
    const blockSsimModule = device.createShaderModule({
      label: "block_ssim.wgsl",
      code: blockSsimShader,
    });

    const blockSsimBGL = device.createBindGroupLayout({
      label: "block_ssim_bgl",
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

    const blockSsim = device.createComputePipeline({
      label: "block_ssim_pipeline",
      layout: device.createPipelineLayout({
        bindGroupLayouts: [blockSsimBGL],
      }),
      compute: { module: blockSsimModule, entryPoint: "main" },
    });

    // --- Metric pipeline helper: 4-binding layout (read, read, uniform, storage) ---
    const metricBGL = (label: string) =>
      device.createBindGroupLayout({
        label,
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

    // --- Pearson NCC pipeline -----------------------------------------------
    const pearsonNccModule = device.createShaderModule({
      label: "pearson_ncc.wgsl",
      code: pearsonNccShader,
    });
    const pearsonNccBGL = metricBGL("pearson_ncc_bgl");
    const pearsonNcc = device.createComputePipeline({
      label: "pearson_ncc_pipeline",
      layout: device.createPipelineLayout({
        bindGroupLayouts: [pearsonNccBGL],
      }),
      compute: { module: pearsonNccModule, entryPoint: "main" },
    });

    // --- MAD pipeline -------------------------------------------------------
    const madModule = device.createShaderModule({
      label: "mad.wgsl",
      code: madShader,
    });
    const madBGL = metricBGL("mad_bgl");
    const mad = device.createComputePipeline({
      label: "mad_pipeline",
      layout: device.createPipelineLayout({ bindGroupLayouts: [madBGL] }),
      compute: { module: madModule, entryPoint: "main" },
    });

    // --- Histogram correlation pipeline ------------------------------------
    const histogramModule = device.createShaderModule({
      label: "histogram.wgsl",
      code: histogramShader,
    });
    const histogramBGL = metricBGL("histogram_bgl");
    const histogram = device.createComputePipeline({
      label: "histogram_pipeline",
      layout: device.createPipelineLayout({
        bindGroupLayouts: [histogramBGL],
      }),
      compute: { module: histogramModule, entryPoint: "main" },
    });

    // --- dHash pipeline ----------------------------------------------------
    const dhashModule = device.createShaderModule({
      label: "dhash.wgsl",
      code: dhashShader,
    });
    const dhashBGL = metricBGL("dhash_bgl");
    const dhash = device.createComputePipeline({
      label: "dhash_pipeline",
      layout: device.createPipelineLayout({ bindGroupLayouts: [dhashBGL] }),
      compute: { module: dhashModule, entryPoint: "main" },
    });

    // --- Fuse scores pipeline -----------------------------------------------
    const fuseScoresModule = device.createShaderModule({
      label: "fuse_scores.wgsl",
      code: fuseScoresShader,
    });
    const fuseScoresBGL = device.createBindGroupLayout({
      label: "fuse_scores_bgl",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
      ],
    });
    const fuseScores = device.createComputePipeline({
      label: "fuse_scores_pipeline",
      layout: device.createPipelineLayout({
        bindGroupLayouts: [fuseScoresBGL],
      }),
      compute: { module: fuseScoresModule, entryPoint: "main" },
    });

    // --- Reduce-min pipeline -----------------------------------------------
    const reduceMinModule = device.createShaderModule({
      label: "reduce_min.wgsl",
      code: reduceMinShader,
    });
    const reduceMinBGL = device.createBindGroupLayout({
      label: "reduce_min_bgl",
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
    const reduceMin = device.createComputePipeline({
      label: "reduce_min_pipeline",
      layout: device.createPipelineLayout({
        bindGroupLayouts: [reduceMinBGL],
      }),
      compute: { module: reduceMinModule, entryPoint: "main" },
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
      blockSsim,
      blockSsimBGL,
      pearsonNcc,
      pearsonNccBGL,
      mad,
      madBGL,
      histogram,
      histogramBGL,
      dhash,
      dhashBGL,
      fuseScores,
      fuseScoresBGL,
      reduceMin,
      reduceMinBGL,
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers — reduction
  // -----------------------------------------------------------------------

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

  /**
   * Iteratively reduce `count` f32 values in `buf` to a single minimum.
   *
   * Same structure as reduceMax but uses the reduce_min shader (neutral
   * element is 1.0 for out-of-bounds slots).
   */
  private async reduceMin(buf: GPUBuffer, count: number): Promise<number> {
    let remaining = count;

    while (remaining > 1) {
      const workgroups = divCeil(remaining, NCC_WORKGROUP_SIZE);

      const rpData = new Uint32Array([remaining, 0]);
      const rpBuf = this.createBufferWithData(
        rpData,
        GPUBufferUsage.UNIFORM,
        "reduce_min_params",
      );

      const bindGroup = this.device.createBindGroup({
        label: "reduce_min_bg",
        layout: this.reduceMinBGL,
        entries: [
          { binding: 0, resource: { buffer: buf } },
          { binding: 1, resource: { buffer: rpBuf } },
        ],
      });

      const encoder = this.device.createCommandEncoder({
        label: "reduce_min_encoder",
      });
      const pass = encoder.beginComputePass({ label: "reduce_min_pass" });
      pass.setPipeline(this.reduceMinPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(workgroups, 1, 1);
      pass.end();
      this.device.queue.submit([encoder.finish()]);

      rpBuf.destroy();
      remaining = workgroups;
    }

    return this.readF32(buf);
  }

  // -----------------------------------------------------------------------
  // Private helpers — metric dispatch encoding
  // -----------------------------------------------------------------------

  /**
   * Create a single-f32 storage buffer for metric shader output.
   *
   * Includes COPY_SRC so the result can be copied into the fuse input buffer.
   */
  private createScalarOutputBuffer(label: string): GPUBuffer {
    return this.device.createBuffer({
      label,
      size: 4,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * Encode a single-workgroup metric compute pass into the given encoder.
   *
   * All metric shaders (Pearson, MAD, histogram, dHash) share the same
   * 4-binding layout: frame_crop, tmpl_crop, params (width/height), result.
   */
  private encodeMetricPass(
    encoder: GPUCommandEncoder,
    pipeline: GPUComputePipeline,
    bgl: GPUBindGroupLayout,
    frameBuf: GPUBuffer,
    tmplBuf: GPUBuffer,
    paramsBuf: GPUBuffer,
    outBuf: GPUBuffer,
    label: string,
  ): void {
    const bindGroup = this.device.createBindGroup({
      label: `${label}_bg`,
      layout: bgl,
      entries: [
        { binding: 0, resource: { buffer: frameBuf } },
        { binding: 1, resource: { buffer: tmplBuf } },
        { binding: 2, resource: { buffer: paramsBuf } },
        { binding: 3, resource: { buffer: outBuf } },
      ],
    });

    const pass = encoder.beginComputePass({ label });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    // Single workgroup of 256 threads for all metric shaders
    pass.dispatchWorkgroups(1, 1, 1);
    pass.end();
  }

  /**
   * Encode a Block-SSIM compute pass into the given encoder.
   *
   * Returns the scores buffer and total block count so the caller can
   * read back and compute the median.
   */
  private encodeBlockSsim(
    encoder: GPUCommandEncoder,
    frameCropBuf: GPUBuffer,
    tmplCropBuf: GPUBuffer,
    width: number,
    height: number,
    blockSize: number,
  ): { scoresBuf: GPUBuffer; paramsBuf: GPUBuffer; totalBlocks: number } {
    const blocksX = Math.floor(width / blockSize);
    const blocksY = Math.floor(height / blockSize);
    const totalBlocks = blocksX * blocksY;

    const paramsBuf = this.createBufferWithData(
      new Uint32Array([width, height, blockSize, 0]),
      GPUBufferUsage.UNIFORM,
      "ssim_params",
    );

    const scoresBuf = this.device.createBuffer({
      label: "ssim_scores",
      size: Math.max(totalBlocks * 4, 4),
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });

    const bindGroup = this.device.createBindGroup({
      label: "block_ssim_bg",
      layout: this.blockSsimBGL,
      entries: [
        { binding: 0, resource: { buffer: frameCropBuf } },
        { binding: 1, resource: { buffer: tmplCropBuf } },
        { binding: 2, resource: { buffer: paramsBuf } },
        { binding: 3, resource: { buffer: scoresBuf } },
      ],
    });

    const pass = encoder.beginComputePass({ label: "ssim_pass" });
    pass.setPipeline(this.blockSsimPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.max(totalBlocks, 1), 1, 1);
    pass.end();

    return { scoresBuf, paramsBuf, totalBlocks };
  }

  /**
   * Read Block-SSIM per-block scores from GPU and compute the median.
   *
   * The median is more robust than the mean as it ignores outlier blocks
   * (e.g. partially transparent regions at borders).
   */
  private async computeSsimMedian(
    scoresBuf: GPUBuffer,
    totalBlocks: number,
  ): Promise<number> {
    if (totalBlocks <= 0) return 0;

    const scoresData = await this.readBufferF32(scoresBuf, totalBlocks);
    const sorted = Array.from(scoresData).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  // -----------------------------------------------------------------------
  // Private helpers — GPU readback
  // -----------------------------------------------------------------------

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

  /** Read `count` f32 values from a storage buffer back to the CPU. */
  private async readBufferF32(
    src: GPUBuffer,
    count: number,
  ): Promise<Float32Array> {
    const byteSize = count * 4;
    const staging = this.device.createBuffer({
      label: "staging_f32_array",
      size: byteSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const encoder = this.device.createCommandEncoder({
      label: "readback_f32_array",
    });
    encoder.copyBufferToBuffer(src, 0, staging, 0, byteSize);
    this.device.queue.submit([encoder.finish()]);

    await staging.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(staging.getMappedRange()).slice();
    staging.unmap();
    staging.destroy();
    return result;
  }

  // -----------------------------------------------------------------------
  // Private helpers — template preparation
  // -----------------------------------------------------------------------

  /**
   * Crop a rectangular region from the full grayscale template and upload it
   * to a GPU storage buffer for hybrid matching.
   */
  private cropRegionToGpu(
    gray: Float32Array,
    templateWidth: number,
    rect: { x: number; y: number; w: number; h: number },
  ): NonNullable<TemplateData["regionCrops"]>[number] {
    const { x, y, w, h } = rect;
    const cropGray = new Float32Array(w * h);
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        cropGray[row * w + col] = gray[(y + row) * templateWidth + (x + col)];
      }
    }
    const buffer = this.createBufferWithData(
      cropGray,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      `template_region_${x}_${y}`,
    );
    const minSide = Math.min(w, h);
    const blockSize = adaptiveBlockSize(minSide);
    return { buffer, width: w, height: h, rect: { x, y, w, h }, blockSize };
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

/** Choose SSIM block size based on the smaller region dimension. */
function adaptiveBlockSize(minSide: number): number {
  if (minSide >= 64) return 16;
  if (minSide >= 32) return 8;
  return 4;
}

/**
 * Calculate output dimensions that fit within maxDim, preserving aspect ratio.
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
