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
 * **Region-based 4-metric hybrid** (templates with regions):
 * 1. Upload video frame and crop each defined region via the preprocess pipeline
 * 2. Dispatch all 4 metric shaders in a single command encoder per region:
 *    Block-SSIM, Pearson NCC, MAD, histogram correlation
 * 3. Fuse scores on GPU: 0.333*SSIM + 0.278*Pearson + 0.222*MAD + 0.167*hist
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
import fuseScoresShader from "./shaders/fuse_scores.wgsl?raw";
import reduceMinShader from "./shaders/reduce_min.wgsl?raw";
import ssimMedianShader from "./shaders/ssim_median.wgsl?raw";
import {
  adaptiveBlockSizeForRegion,
  applyNegativePenalty,
  fitDimensions,
} from "./math";

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
  fuseScores: GPUComputePipeline;
  fuseScoresBGL: GPUBindGroupLayout;
  reduceMin: GPUComputePipeline;
  reduceMinBGL: GPUBindGroupLayout;
  ssimMedian: GPUComputePipeline;
  ssimMedianBGL: GPUBindGroupLayout;
}

// ---------------------------------------------------------------------------
// Buffer pool
// ---------------------------------------------------------------------------

/** Reusable GPU buffer pool to avoid per-frame allocation overhead. */
class BufferPool {
  private readonly device: GPUDevice;
  private readonly pools = new Map<string, GPUBuffer[]>();

  constructor(device: GPUDevice) {
    this.device = device;
  }

  /** Round size up to next power-of-2 for better pool hit rate. */
  private roundSize(size: number): number {
    if (size <= 4) return 4;
    return 1 << (32 - Math.clz32(size - 1));
  }

  /** Acquire a buffer from the pool or create a new one. */
  acquire(size: number, usage: number, label?: string): GPUBuffer {
    const rounded = this.roundSize(size);
    const key = `${rounded}_${usage}`;
    const pool = this.pools.get(key);
    if (pool && pool.length > 0) {
      return pool.pop()!;
    }
    return this.device.createBuffer({ size: rounded, usage, label });
  }

  /** Return a buffer to the pool for reuse. */
  release(buffer: GPUBuffer): void {
    const key = `${buffer.size}_${buffer.usage}`;
    let pool = this.pools.get(key);
    if (!pool) {
      pool = [];
      this.pools.set(key, pool);
    }
    // Cap pool size to avoid memory leaks
    if (pool.length < 32) {
      pool.push(buffer);
    } else {
      buffer.destroy();
    }
  }

  /** Destroy all pooled buffers. */
  destroyAll(): void {
    for (const pool of this.pools.values()) {
      for (const buf of pool) buf.destroy();
    }
    this.pools.clear();
  }
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
  private readonly fuseScoresPipeline: GPUComputePipeline;
  private readonly fuseScoresBGL: GPUBindGroupLayout;
  private readonly reduceMinPipeline: GPUComputePipeline;
  private readonly reduceMinBGL: GPUBindGroupLayout;
  private readonly ssimMedianPipeline: GPUComputePipeline;
  private readonly ssimMedianBGL: GPUBindGroupLayout;
  private destroyed = false;

  // Phase 0C: GPU buffer pool for per-frame allocation reuse
  private readonly pool: BufferPool;

  // Phase 0D: Persistent uniform buffers updated via queue.writeBuffer()
  private readonly preprocessParamsBuf: GPUBuffer;
  private readonly deltaResultBuf: GPUBuffer;

  // Phase 0F: Cached frame texture to avoid per-frame texture recreation
  private frameTexture: GPUTexture | null = null;
  private frameTextureW = 0;
  private frameTextureH = 0;

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
    this.fuseScoresPipeline = pipelines.fuseScores;
    this.fuseScoresBGL = pipelines.fuseScoresBGL;
    this.reduceMinPipeline = pipelines.reduceMin;
    this.reduceMinBGL = pipelines.reduceMinBGL;
    this.ssimMedianPipeline = pipelines.ssimMedian;
    this.ssimMedianBGL = pipelines.ssimMedianBGL;

    // Phase 0C: Initialize buffer pool
    this.pool = new BufferPool(device);

    // Phase 0D: Persistent uniform buffers (fixed size, updated each cycle)
    this.preprocessParamsBuf = device.createBuffer({
      label: "persistent_preprocess_params",
      size: 32, // 8 x u32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.deltaResultBuf = device.createBuffer({
      label: "persistent_delta_result",
      size: 4, // single u32
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });
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
   * Reuses the cached texture when the resolution is unchanged to avoid
   * per-frame texture recreation. Uses copyExternalImageToTexture for
   * zero-copy transfer when the browser supports it (Chrome/Edge).
   */
  uploadVideoFrame(
    source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap,
  ): GPUTexture {
    let width: number;
    let height: number;

    if (source instanceof HTMLVideoElement) {
      width = source.videoWidth;
      height = source.videoHeight;
    } else {
      width = source.width;
      height = source.height;
    }

    if (width === 0 || height === 0) {
      throw new Error("Source has zero dimensions");
    }

    // Phase 0F: Reuse cached texture when resolution is unchanged
    if (
      !this.frameTexture ||
      this.frameTextureW !== width ||
      this.frameTextureH !== height
    ) {
      if (this.frameTexture) {
        this.frameTexture.destroy();
      }
      this.frameTexture = this.device.createTexture({
        label: "frame_texture",
        size: { width, height },
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.frameTextureW = width;
      this.frameTextureH = height;
    }

    this.device.queue.copyExternalImageToTexture(
      { source },
      { texture: this.frameTexture },
      { width, height },
    );

    return this.frameTexture;
  }

  /**
   * Preprocess an RGBA texture into a grayscale f32 storage buffer.
   *
   * Applies optional crop and downscale (bilinear) to fit within maxDim while
   * preserving aspect ratio. Returns the output buffer and its dimensions.
   *
   * The output buffer is acquired from the buffer pool; callers are
   * responsible for releasing it via `this.pool.release()`.
   */
  preprocess(
    texture: GPUTexture,
    crop?: { x: number; y: number; w: number; h: number },
    maxDim = 320,
  ): { buffer: GPUBuffer; width: number; height: number } {
    const srcW = texture.width;
    const srcH = texture.height;
    const cropX = crop?.x ?? 0;
    const cropY = crop?.y ?? 0;
    const cropW = crop?.w ?? srcW;
    const cropH = crop?.h ?? srcH;

    const [dstW, dstH] = fitDimensions(cropW, cropH, maxDim);

    // Phase 0D: Update persistent preprocess params buffer via writeBuffer
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
    this.device.queue.writeBuffer(this.preprocessParamsBuf, 0, paramsData);

    // Phase 0C: Acquire output buffer from pool
    const outputSize = dstW * dstH * 4; // f32 = 4 bytes
    const outputBuf = this.pool.acquire(
      outputSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      "preprocess_output",
    );

    const bindGroup = this.device.createBindGroup({
      label: "preprocess_bg",
      layout: this.preprocessBGL,
      entries: [
        { binding: 0, resource: { buffer: this.preprocessParamsBuf } },
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

    return { buffer: outputBuf, width: dstW, height: dstH };
  }

  /**
   * Compute the normalised pixel delta between two 64x64 grayscale buffers.
   *
   * Returns a value in [0, 1] where 0 means identical and 1 means maximally
   * different. Used for frame deduplication to skip redundant NCC computations.
   */
  async pixelDelta(a: GPUBuffer, b: GPUBuffer): Promise<number> {
    // Phase 0D: Reuse persistent result buffer, zero-initialise each cycle
    this.device.queue.writeBuffer(
      this.deltaResultBuf,
      0,
      new Uint32Array([0]),
    );

    const bindGroup = this.device.createBindGroup({
      label: "delta_bg",
      layout: this.deltaBGL,
      entries: [
        { binding: 0, resource: { buffer: a } },
        { binding: 1, resource: { buffer: b } },
        { binding: 2, resource: { buffer: this.deltaResultBuf } },
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

    const raw = await this.readU32(encoder, this.deltaResultBuf);
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

    // Phase 0C: Pool the params buffer
    const paramsBuf = this.pool.acquire(
      32,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      "ncc_params",
    );
    this.device.queue.writeBuffer(paramsBuf, 0, new Uint8Array(paramsArray));

    // Phase 0C: Pool the scores buffer
    const scoresSize = totalPositions * 4;
    const scoresBuf = this.pool.acquire(
      scoresSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      "ncc_scores",
    );

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

    this.pool.release(paramsBuf);
    this.pool.release(scoresBuf);
    return result;
  }

  // -----------------------------------------------------------------------
  // Region-based hybrid matching (all 5 metrics on GPU)
  // -----------------------------------------------------------------------

  /**
   * Region-based 4-metric hybrid matching — fully GPU-accelerated.
   *
   * For each defined region, crops the corresponding area from the live frame,
   * dispatches all 4 metric shaders (Block-SSIM, Pearson, MAD, histogram),
   * copies scores and fuses them on GPU, and collects per-region scores.
   * The final result is the minimum across all regions (AND-logic:
   * every region must match).
   *
   * Only a single GPU readback occurs at the very end for the final score.
   * The SSIM median is computed on GPU via histogram binning, avoiding
   * the previous mid-pipeline CPU sync point.
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

    // Phase 0C: Pool the region scores buffer
    const regionScoresSize = Math.max(regionCount * 4, 4);
    const regionScoresBuf = this.pool.acquire(
      regionScoresSize,
      GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
      "region_scores",
    );

    const buffersToRelease: GPUBuffer[] = [regionScoresBuf];

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
      buffersToRelease.push(frameCropBuf);

      // Phase 0C: Pool the metric params buffer
      const metricParamsBuf = this.pool.acquire(
        8,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        `metric_params_${ri}`,
      );
      this.device.queue.writeBuffer(
        metricParamsBuf,
        0,
        new Uint32Array([rw, rh]),
      );
      buffersToRelease.push(metricParamsBuf);

      // --- Dispatch all 4 metric shaders in a single command encoder ---
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
      buffersToRelease.push(ssimResult.scoresBuf, ssimResult.paramsBuf);

      // 2. Pearson NCC
      const pearsonOutBuf = this.createScalarOutputBuffer(`pearson_out_${ri}`);
      buffersToRelease.push(pearsonOutBuf);
      this.encodeMetricPass(encoder, {
        pipeline: this.pearsonNccPipeline, bgl: this.pearsonNccBGL,
        frameBuf: frameCropBuf, tmplBuf, paramsBuf: metricParamsBuf,
        outBuf: pearsonOutBuf, label: `pearson_pass_${ri}`,
      });

      // 3. MAD
      const madOutBuf = this.createScalarOutputBuffer(`mad_out_${ri}`);
      buffersToRelease.push(madOutBuf);
      this.encodeMetricPass(encoder, {
        pipeline: this.madPipeline, bgl: this.madBGL,
        frameBuf: frameCropBuf, tmplBuf, paramsBuf: metricParamsBuf,
        outBuf: madOutBuf, label: `mad_pass_${ri}`,
      });

      // 4. Histogram correlation
      const histOutBuf = this.createScalarOutputBuffer(`hist_out_${ri}`);
      buffersToRelease.push(histOutBuf);
      this.encodeMetricPass(encoder, {
        pipeline: this.histogramPipeline, bgl: this.histogramBGL,
        frameBuf: frameCropBuf, tmplBuf, paramsBuf: metricParamsBuf,
        outBuf: histOutBuf, label: `hist_pass_${ri}`,
      });

      // Submit all 4 metric dispatches
      this.device.queue.submit([encoder.finish()]);

      // Block-SSIM median computed on GPU via histogram binning
      const ssimMedian = await this.computeSsimMedianGPU(
        ssimResult.scoresBuf,
        ssimResult.totalBlocks,
      );

      // Assemble the 4 scores into a buffer for the fuse shader.
      // GPU weights are hardcoded in fuse_scores.wgsl and must match HYBRID_WEIGHTS from math.ts.
      const scoresInputBuf = this.pool.acquire(
        16,
        GPUBufferUsage.STORAGE |
          GPUBufferUsage.COPY_SRC |
          GPUBufferUsage.COPY_DST,
        `fuse_input_${ri}`,
      );
      this.device.queue.writeBuffer(
        scoresInputBuf,
        0,
        new Float32Array([ssimMedian, 0, 0, 0]),
      );
      buffersToRelease.push(scoresInputBuf);

      // Phase 0E: Merge copy operations and fuse dispatch into a single encoder
      const fuseOutBuf = this.createScalarOutputBuffer(`fuse_out_${ri}`);
      buffersToRelease.push(fuseOutBuf);

      const fuseEncoder = this.device.createCommandEncoder({
        label: `copy_fuse_encoder_${ri}`,
      });

      // Copy the 3 GPU-produced scalar scores into the fuse input buffer
      fuseEncoder.copyBufferToBuffer(pearsonOutBuf, 0, scoresInputBuf, 4, 4);
      fuseEncoder.copyBufferToBuffer(madOutBuf, 0, scoresInputBuf, 8, 4);
      fuseEncoder.copyBufferToBuffer(histOutBuf, 0, scoresInputBuf, 12, 4);

      // Fuse the 4 scores into one hybrid score on GPU
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

    // Release all temporary buffers back to the pool
    for (const buf of buffersToRelease) {
      this.pool.release(buf);
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

    // Upload the current frame (texture is cached and reused across frames)
    const texture = this.uploadVideoFrame(source);
    const { buffer: frameBuf, width: frameW, height: frameH } =
      this.preprocess(texture, config.crop, config.maxDim);

    // Compute pixel delta for frame deduplication
    let frameDelta = 1;
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

      const score = await this.scoreTemplate(
        tmpl, { texture, buf: frameBuf, w: frameW, h: frameH },
        hasRegions, positiveRegionCrops, negativeRegionCrops,
      );

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

  /**
   * Score a single template against the current frame.
   *
   * Chooses the region-based hybrid pipeline when positive regions exist,
   * otherwise falls back to sliding-window NCC. Applies negative region
   * penalty when applicable.
   */
  private async scoreTemplate(
    tmpl: TemplateData,
    frame: { texture: GPUTexture; buf: GPUBuffer; w: number; h: number },
    hasRegions: boolean | undefined,
    positiveRegionCrops: TemplateData["regionCrops"],
    negativeRegionCrops: TemplateData["regionCrops"],
  ): Promise<number> {
    const { texture, buf: frameBuf, w: frameW, h: frameH } = frame;
    let score: number;
    if (hasRegions && positiveRegionCrops && positiveRegionCrops.length > 0) {
      const positiveTmpl = { ...tmpl, regionCrops: positiveRegionCrops };
      score = await this.regionHybridMatch(texture, positiveTmpl);
    } else {
      score = await this.nccMatch(frameBuf, tmpl, frameW, frameH);
    }

    // Apply negative region penalty: high match on negative region suppresses detection
    if (negativeRegionCrops && negativeRegionCrops.length > 0 && score > 0) {
      const negativeTmpl = { ...tmpl, regionCrops: negativeRegionCrops };
      const negScore = await this.regionHybridMatch(texture, negativeTmpl);
      score = applyNegativePenalty(score, negScore);
    }

    return score;
  }

  /** Release all GPU resources held by this detector. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pool.destroyAll();
    this.preprocessParamsBuf.destroy();
    this.deltaResultBuf.destroy();
    if (this.frameTexture) {
      this.frameTexture.destroy();
      this.frameTexture = null;
    }
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

    // --- SSIM median pipeline (histogram-based GPU median) -------------------
    const ssimMedianModule = device.createShaderModule({
      label: "ssim_median.wgsl",
      code: ssimMedianShader,
    });
    const ssimMedianBGL = device.createBindGroupLayout({
      label: "ssim_median_bgl",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
      ],
    });
    const ssimMedian = device.createComputePipeline({
      label: "ssim_median_pipeline",
      layout: device.createPipelineLayout({
        bindGroupLayouts: [ssimMedianBGL],
      }),
      compute: { module: ssimMedianModule, entryPoint: "main" },
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
      fuseScores,
      fuseScoresBGL,
      reduceMin,
      reduceMinBGL,
      ssimMedian,
      ssimMedianBGL,
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

      // Phase 0C: Pool the reduce params buffer
      const rpBuf = this.pool.acquire(
        8,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        "reduce_params",
      );
      this.device.queue.writeBuffer(
        rpBuf,
        0,
        new Uint32Array([remaining, 0]),
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

      this.pool.release(rpBuf);
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

      // Phase 0C: Pool the reduce params buffer
      const rpBuf = this.pool.acquire(
        8,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        "reduce_min_params",
      );
      this.device.queue.writeBuffer(
        rpBuf,
        0,
        new Uint32Array([remaining, 0]),
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

      this.pool.release(rpBuf);
      remaining = workgroups;
    }

    return this.readF32(buf);
  }

  // -----------------------------------------------------------------------
  // Private helpers — metric dispatch encoding
  // -----------------------------------------------------------------------

  /**
   * Acquire a single-f32 storage buffer for metric shader output from the pool.
   *
   * Includes COPY_SRC so the result can be copied into the fuse input buffer.
   * Callers are responsible for releasing the buffer via `this.pool.release()`.
   */
  private createScalarOutputBuffer(label: string): GPUBuffer {
    return this.pool.acquire(
      4,
      GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
      label,
    );
  }

  /**
   * Encode a single-workgroup metric compute pass into the given encoder.
   *
   * All metric shaders (Pearson, MAD, histogram) share the same
   * 4-binding layout: frame_crop, tmpl_crop, params (width/height), result.
   */
  private encodeMetricPass(
    encoder: GPUCommandEncoder,
    pass: {
      pipeline: GPUComputePipeline;
      bgl: GPUBindGroupLayout;
      frameBuf: GPUBuffer;
      tmplBuf: GPUBuffer;
      paramsBuf: GPUBuffer;
      outBuf: GPUBuffer;
      label: string;
    },
  ): void {
    const bindGroup = this.device.createBindGroup({
      label: `${pass.label}_bg`,
      layout: pass.bgl,
      entries: [
        { binding: 0, resource: { buffer: pass.frameBuf } },
        { binding: 1, resource: { buffer: pass.tmplBuf } },
        { binding: 2, resource: { buffer: pass.paramsBuf } },
        { binding: 3, resource: { buffer: pass.outBuf } },
      ],
    });

    const computePass = encoder.beginComputePass({ label: pass.label });
    computePass.setPipeline(pass.pipeline);
    computePass.setBindGroup(0, bindGroup);
    // Single workgroup of 256 threads for all metric shaders
    computePass.dispatchWorkgroups(1, 1, 1);
    computePass.end();
  }

  /**
   * Encode a Block-SSIM compute pass into the given encoder.
   *
   * Returns the scores buffer and total block count so the caller can
   * read back and compute the median. Both returned buffers are acquired
   * from the pool; the caller is responsible for releasing them.
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

    // Phase 0C: Pool the SSIM params buffer
    const paramsBuf = this.pool.acquire(
      16,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      "ssim_params",
    );
    this.device.queue.writeBuffer(
      paramsBuf,
      0,
      new Uint32Array([width, height, blockSize, 0]),
    );

    // Phase 0C: Pool the SSIM scores buffer
    const scoresSize = Math.max(totalBlocks * 4, 4);
    const scoresBuf = this.pool.acquire(
      scoresSize,
      GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
      "ssim_scores",
    );

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
   * Compute the approximate median of Block-SSIM scores entirely on the GPU.
   *
   * Uses a 64-bin histogram to avoid reading all per-block scores back to the
   * CPU. Only a single f32 (the bin-centre of the median bin) is read back,
   * eliminating the previous mid-pipeline CPU-GPU sync point.
   */
  private async computeSsimMedianGPU(
    scoresBuf: GPUBuffer,
    totalBlocks: number,
  ): Promise<number> {
    if (totalBlocks <= 0) return 0;

    // Params uniform: count
    const paramsData = new Uint32Array([totalBlocks]);
    const paramsBuf = this.pool.acquire(
      4,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      "ssim_median_params",
    );
    this.device.queue.writeBuffer(paramsBuf, 0, paramsData);

    // Result buffer: single f32
    const resultBuf = this.pool.acquire(
      4,
      GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
      "ssim_median_result",
    );
    // Zero-init result
    this.device.queue.writeBuffer(resultBuf, 0, new Float32Array([0]));

    const bindGroup = this.device.createBindGroup({
      layout: this.ssimMedianBGL,
      entries: [
        { binding: 0, resource: { buffer: scoresBuf } },
        { binding: 1, resource: { buffer: paramsBuf } },
        { binding: 2, resource: { buffer: resultBuf } },
      ],
    });

    const encoder = this.device.createCommandEncoder({
      label: "ssim_median_encoder",
    });
    const pass = encoder.beginComputePass({ label: "ssim_median_pass" });
    pass.setPipeline(this.ssimMedianPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1); // Single workgroup of 256 threads
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    const median = await this.readF32(resultBuf);

    this.pool.release(paramsBuf);
    this.pool.release(resultBuf);

    return median;
  }

  // -----------------------------------------------------------------------
  // Private helpers — GPU readback
  // -----------------------------------------------------------------------

  /** Copy the first f32 from a storage buffer to the CPU via a staging buffer. */
  private async readF32(src: GPUBuffer): Promise<number> {
    // Phase 0C: Pool the staging buffer
    const staging = this.pool.acquire(
      4,
      GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      "staging_f32",
    );

    const encoder = this.device.createCommandEncoder({
      label: "readback_encoder",
    });
    encoder.copyBufferToBuffer(src, 0, staging, 0, 4);
    this.device.queue.submit([encoder.finish()]);

    await staging.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(staging.getMappedRange());
    const result = data[0];
    staging.unmap();
    this.pool.release(staging);
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
    // Phase 0C: Pool the staging buffer
    const staging = this.pool.acquire(
      4,
      GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      "staging_u32",
    );

    encoder.copyBufferToBuffer(src, 0, staging, 0, 4);
    this.device.queue.submit([encoder.finish()]);

    await staging.mapAsync(GPUMapMode.READ);
    const data = new Uint32Array(staging.getMappedRange());
    const result = data[0];
    staging.unmap();
    this.pool.release(staging);
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
    const blockSize = adaptiveBlockSizeForRegion(w, h);
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

