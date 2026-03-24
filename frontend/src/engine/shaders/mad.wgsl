// Mean Absolute Difference (MAD) similarity compute shader.
//
// Computes MAD between two same-sized grayscale f32 buffers and converts
// the result to a similarity score.  Each thread accumulates absolute
// differences over its stride, then a tree reduction sums them.
// Thread 0 converts to similarity: max(0, 1 - sum / (n * 0.5)).
//
// WebGPU grayscale values are in [0, 1] range, so max meaningful
// difference is ~0.5 for normalisation.

struct MADParams {
    width:  u32,
    height: u32,
}

@group(0) @binding(0) var<storage, read> frame_crop: array<f32>;
@group(0) @binding(1) var<storage, read> tmpl_crop:  array<f32>;
@group(0) @binding(2) var<uniform>       params:     MADParams;
@group(0) @binding(3) var<storage, read_write> result: array<f32>;

const WG_SIZE: u32 = 256u;

var<workgroup> s_sum: array<f32, 256>;

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid: vec3<u32>) {
    let tid = lid.x;
    let n = params.width * params.height;

    // Each thread accumulates absolute differences over its stride.
    var acc: f32 = 0.0;
    for (var i = tid; i < n; i += WG_SIZE) {
        acc += abs(frame_crop[i] - tmpl_crop[i]);
    }

    s_sum[tid] = acc;
    workgroupBarrier();

    // Tree reduction to get total sum.
    for (var stride = WG_SIZE >> 1u; stride > 0u; stride >>= 1u) {
        if tid < stride {
            s_sum[tid] += s_sum[tid + stride];
        }
        workgroupBarrier();
    }

    // Thread 0 computes the final similarity score.
    if tid == 0u {
        let total = s_sum[0];
        let count = f32(n);
        // Similarity: 1 - (MAD / 0.5), clamped to [0, 1]
        result[0] = max(0.0, 1.0 - total / (count * 0.5));
    }
}
