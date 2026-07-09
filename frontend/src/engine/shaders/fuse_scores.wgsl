// fuse_scores.wgsl: weighted fusion of the 4 region-hybrid metric scores.
//
// Combines the 4 individual metric scores into a single hybrid detection
// score using fixed weights:
//   0.333 * SSIM-median + 0.278 * Pearson + 0.222 * MAD + 0.167 * histogram
//
// IMPORTANT: These weights must match HYBRID_WEIGHTS in math.ts.
//
// The input buffer is filled entirely by GPU-to-GPU copies (see
// WebGPUDetector.regionHybridMatch): slot 0 from ssim_median.wgsl, slots
// 1 to 3 from the scalar outputs of pearson_ncc, mad and histogram.
//
// Bindings:
//   @binding(0) scores: input, 4 f32 values in the order listed above
//   @binding(1) result: output, single f32 at index 0, clamped to [0, 1]
//
// Dispatch: a single 1-thread workgroup; the input is only 4 values.
// Host: WebGPUDetector.regionHybridMatch().

@group(0) @binding(0) var<storage, read> scores: array<f32>;
@group(0) @binding(1) var<storage, read_write> result: array<f32>;

@compute @workgroup_size(1)
fn main() {
    let ssim    = scores[0];
    let pearson = scores[1];
    let mad     = scores[2];
    let hist    = scores[3];

    let fused = 0.333 * ssim + 0.278 * pearson + 0.222 * mad + 0.167 * hist;
    result[0] = clamp(fused, 0.0, 1.0);
}
