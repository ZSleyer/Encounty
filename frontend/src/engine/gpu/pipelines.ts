/**
 * Compute pipeline compilation for the WebGPU detector.
 *
 * Holds the WGSL sources, the constants that mirror their @workgroup_size
 * declarations, and the one-shot compilation of every pipeline and bind group
 * layout the detector uses. It is a plain (device) => pipelines function with
 * no detector state of its own.
 */

import preprocessShader from "../shaders/preprocess.wgsl?raw";
import nccShader from "../shaders/ncc.wgsl?raw";
import pixelDeltaShader from "../shaders/pixel_delta.wgsl?raw";
import reduceMaxShader from "../shaders/reduce_max.wgsl?raw";
import blockSsimShader from "../shaders/block_ssim.wgsl?raw";
import pearsonNccShader from "../shaders/pearson_ncc.wgsl?raw";
import madShader from "../shaders/mad.wgsl?raw";
import histogramShader from "../shaders/histogram.wgsl?raw";
import fuseScoresShader from "../shaders/fuse_scores.wgsl?raw";
import ssimMedianShader from "../shaders/ssim_median.wgsl?raw";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Must match @workgroup_size in ncc.wgsl and reduce_max.wgsl. */
export const NCC_WORKGROUP_SIZE = 256;

/** Must match @workgroup_size in preprocess.wgsl (16x16). */
export const PREPROCESS_WG = 16;

/** Fixed grid size for pixel-delta comparison (matches shader). */
export const DELTA_DIM = 64;

/** Normalisation denominator for pixel delta (64 * 64 * 255 * 1000). */
export const DELTA_NORM = DELTA_DIM * DELTA_DIM * 255 * 1000;

// ---------------------------------------------------------------------------
// Pipeline type definition
// ---------------------------------------------------------------------------

/** All compiled compute pipelines and their bind group layouts. */
export interface CompiledPipelines {
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
  ssimMedian: GPUComputePipeline;
  ssimMedianBGL: GPUBindGroupLayout;
}
// ---------------------------------------------------------------------------
// Pipeline compilation
// ---------------------------------------------------------------------------

/** Compile all compute pipelines and their bind group layouts. */
export function compilePipelines(device: GPUDevice): CompiledPipelines {
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
    ssimMedian,
    ssimMedianBGL,
  };
}
