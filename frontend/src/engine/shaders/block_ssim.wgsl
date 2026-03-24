// Block-SSIM (Structural Similarity Index) compute shader.
//
// Computes SSIM between two grayscale f32 buffers (a frame region crop and
// a template region crop of identical dimensions) by dividing the image into
// non-overlapping blocks and computing one SSIM score per block.
//
// Each workgroup handles exactly one block.  Threads within the workgroup
// cooperatively accumulate partial sums over the block pixels, then perform
// a parallel reduction in shared memory.  Thread 0 finalises the SSIM
// calculation and writes the per-block score.

struct SSIMParams {
    width:      u32,
    height:     u32,
    block_size: u32,  // 8, 16, or 32 — adaptive based on region size
    _pad:       u32,
}

@group(0) @binding(0) var<storage, read> frame_crop: array<f32>;
@group(0) @binding(1) var<storage, read> tmpl_crop:  array<f32>;
@group(0) @binding(2) var<uniform>       params:     SSIMParams;
@group(0) @binding(3) var<storage, read_write> scores: array<f32>;

// SSIM constants derived from dynamic range L = 1.0 (grayscale normalised to [0, 1]).
// c1 = (0.01 * 1)^2 = 0.0001
// c2 = (0.03 * 1)^2 = 0.0009
const C1: f32 = 0.0001;
const C2: f32 = 0.0009;

const WG_SIZE: u32 = 256u;

// Shared memory for parallel reduction — one slot per thread, five accumulators.
var<workgroup> s_f_sum:  array<f32, 256>;
var<workgroup> s_t_sum:  array<f32, 256>;
var<workgroup> s_f2_sum: array<f32, 256>;
var<workgroup> s_t2_sum: array<f32, 256>;
var<workgroup> s_ft_sum: array<f32, 256>;

@compute @workgroup_size(256)
fn main(
    @builtin(workgroup_id)         wg_id: vec3<u32>,
    @builtin(local_invocation_id)  lid:    vec3<u32>,
) {
    let block_index = wg_id.x;
    let tid         = lid.x;

    let blocks_x = params.width  / params.block_size;
    let blocks_y = params.height / params.block_size;
    let total_blocks = blocks_x * blocks_y;

    // Guard against over-dispatch.
    if block_index >= total_blocks {
        return;
    }

    // Top-left corner of this block in pixel coordinates.
    let bx = block_index % blocks_x;
    let by = block_index / blocks_x;
    let origin_x = bx * params.block_size;
    let origin_y = by * params.block_size;

    let block_pixels = params.block_size * params.block_size;

    // Each thread accumulates partial sums over its assigned subset of pixels.
    var f_acc:  f32 = 0.0;
    var t_acc:  f32 = 0.0;
    var f2_acc: f32 = 0.0;
    var t2_acc: f32 = 0.0;
    var ft_acc: f32 = 0.0;

    // Stride across pixels so that consecutive threads read consecutive memory.
    for (var p = tid; p < block_pixels; p += WG_SIZE) {
        let lx = p % params.block_size;
        let ly = p / params.block_size;
        let px = origin_x + lx;
        let py = origin_y + ly;
        let idx = py * params.width + px;

        let fv = frame_crop[idx];
        let tv = tmpl_crop[idx];

        f_acc  += fv;
        t_acc  += tv;
        f2_acc += fv * fv;
        t2_acc += tv * tv;
        ft_acc += fv * tv;
    }

    // Store partial sums into shared memory for reduction.
    s_f_sum[tid]  = f_acc;
    s_t_sum[tid]  = t_acc;
    s_f2_sum[tid] = f2_acc;
    s_t2_sum[tid] = t2_acc;
    s_ft_sum[tid] = ft_acc;
    workgroupBarrier();

    // Tree reduction — halve active threads each iteration.
    for (var stride = WG_SIZE >> 1u; stride > 0u; stride >>= 1u) {
        if tid < stride {
            s_f_sum[tid]  += s_f_sum[tid + stride];
            s_t_sum[tid]  += s_t_sum[tid + stride];
            s_f2_sum[tid] += s_f2_sum[tid + stride];
            s_t2_sum[tid] += s_t2_sum[tid + stride];
            s_ft_sum[tid] += s_ft_sum[tid + stride];
        }
        workgroupBarrier();
    }

    // Thread 0 computes the final SSIM score for this block.
    if tid == 0u {
        let n = f32(block_pixels);

        let mean_f = s_f_sum[0] / n;
        let mean_t = s_t_sum[0] / n;

        // Variance and covariance (population, not sample).
        let var_f  = s_f2_sum[0] / n - mean_f * mean_f;
        let var_t  = s_t2_sum[0] / n - mean_t * mean_t;
        let cov_ft = s_ft_sum[0] / n - mean_f * mean_t;

        let sigma_f = sqrt(max(var_f, 0.0));
        let sigma_t = sqrt(max(var_t, 0.0));

        // Three-component SSIM: luminance * contrast * structure.
        let luminance = (2.0 * mean_f * mean_t + C1) / (mean_f * mean_f + mean_t * mean_t + C1);
        let contrast  = (2.0 * sigma_f * sigma_t + C2) / (var_f + var_t + C2);
        let structure = (cov_ft + C2 / 2.0) / (sigma_f * sigma_t + C2 / 2.0);

        scores[block_index] = max(0.0, luminance * contrast * structure);
    }
}
