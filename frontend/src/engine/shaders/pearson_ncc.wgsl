// pearson_ncc.wgsl: global Pearson correlation between two image crops.
//
// Metric 2 of the 4-metric region hybrid (weights in fuse_scores.wgsl).
// Computes the Pearson correlation coefficient between two same-sized
// grayscale f32 buffers. Uses the same 5-accumulator pattern as
// block_ssim.wgsl but operates over the ENTIRE buffer rather than
// per-block, producing a single scalar in [0, 1] (negative correlation
// clamps to 0; a flat input scores 0 via the denominator guard).
//
// Each thread accumulates partial sums over its stride of the buffer,
// then a tree reduction in shared memory combines them. Thread 0
// computes the final coefficient.
//
// Bindings:
//   @binding(0) frame_crop: grayscale f32 frame region, width * height
//   @binding(1) tmpl_crop:  grayscale f32 template region, same size
//   @binding(2) params:     PearsonParams uniform (crop dimensions)
//   @binding(3) result:     output, single f32 at index 0
//
// Dispatch: exactly ONE workgroup of 256 threads.
// Host: WebGPUDetector.regionHybridMatch() via encodeMetricPass().

struct PearsonParams {
    width:  u32,
    height: u32,
}

@group(0) @binding(0) var<storage, read> frame_crop: array<f32>;
@group(0) @binding(1) var<storage, read> tmpl_crop:  array<f32>;
@group(0) @binding(2) var<uniform>       params:     PearsonParams;
@group(0) @binding(3) var<storage, read_write> result: array<f32>;

const WG_SIZE: u32 = 256u;

// Shared memory for parallel reduction, five accumulators per thread.
var<workgroup> s_a_sum:  array<f32, 256>;
var<workgroup> s_b_sum:  array<f32, 256>;
var<workgroup> s_a2_sum: array<f32, 256>;
var<workgroup> s_b2_sum: array<f32, 256>;
var<workgroup> s_ab_sum: array<f32, 256>;

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid: vec3<u32>) {
    let tid = lid.x;
    let n = params.width * params.height;

    // Each thread accumulates partial sums over its stride of the buffer.
    var a_acc:  f32 = 0.0;
    var b_acc:  f32 = 0.0;
    var a2_acc: f32 = 0.0;
    var b2_acc: f32 = 0.0;
    var ab_acc: f32 = 0.0;

    for (var i = tid; i < n; i += WG_SIZE) {
        let av = frame_crop[i];
        let bv = tmpl_crop[i];
        a_acc  += av;
        b_acc  += bv;
        a2_acc += av * av;
        b2_acc += bv * bv;
        ab_acc += av * bv;
    }

    // Store partial sums into shared memory for reduction.
    s_a_sum[tid]  = a_acc;
    s_b_sum[tid]  = b_acc;
    s_a2_sum[tid] = a2_acc;
    s_b2_sum[tid] = b2_acc;
    s_ab_sum[tid] = ab_acc;
    workgroupBarrier();

    // Tree reduction, halve active threads each iteration.
    for (var stride = WG_SIZE >> 1u; stride > 0u; stride >>= 1u) {
        if tid < stride {
            s_a_sum[tid]  += s_a_sum[tid + stride];
            s_b_sum[tid]  += s_b_sum[tid + stride];
            s_a2_sum[tid] += s_a2_sum[tid + stride];
            s_b2_sum[tid] += s_b2_sum[tid + stride];
            s_ab_sum[tid] += s_ab_sum[tid + stride];
        }
        workgroupBarrier();
    }

    // Thread 0 computes the final Pearson correlation coefficient.
    if tid == 0u {
        let count = f32(n);
        let mean_a = s_a_sum[0] / count;
        let mean_b = s_b_sum[0] / count;

        let var_a = s_a2_sum[0] / count - mean_a * mean_a;
        let var_b = s_b2_sum[0] / count - mean_b * mean_b;
        let cov   = s_ab_sum[0] / count - mean_a * mean_b;

        let denom = sqrt(max(var_a, 0.0)) * sqrt(max(var_b, 0.0));

        var score: f32 = 0.0;
        if denom > 1e-6 {
            score = clamp(cov / denom, 0.0, 1.0);
        }
        result[0] = score;
    }
}
