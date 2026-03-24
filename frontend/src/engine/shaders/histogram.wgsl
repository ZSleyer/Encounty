// 64-bin histogram correlation compute shader.
//
// Builds two 64-bin grayscale histograms using atomicAdd on workgroup
// shared memory, normalises them, then computes the Pearson correlation
// coefficient between the two histogram vectors.
//
// The shader runs in a single workgroup of 256 threads.  Each thread
// processes a stride of the input buffers to build per-image histograms,
// then participates in computing the correlation.

struct HistParams {
    width:  u32,
    height: u32,
}

@group(0) @binding(0) var<storage, read> frame_crop: array<f32>;
@group(0) @binding(1) var<storage, read> tmpl_crop:  array<f32>;
@group(0) @binding(2) var<uniform>       params:     HistParams;
@group(0) @binding(3) var<storage, read_write> result: array<f32>;

const WG_SIZE: u32 = 256u;
const BINS: u32 = 64u;

// Atomic histogram bins in shared memory.
var<workgroup> hist_a: array<atomic<u32>, 64>;
var<workgroup> hist_b: array<atomic<u32>, 64>;

// Shared memory for correlation reduction (reused after histogram build).
var<workgroup> s_cov:  array<f32, 256>;
var<workgroup> s_varA: array<f32, 256>;
var<workgroup> s_varB: array<f32, 256>;

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid: vec3<u32>) {
    let tid = lid.x;
    let n = params.width * params.height;

    // Zero-initialise histogram bins (first 64 threads handle one bin each).
    if tid < BINS {
        atomicStore(&hist_a[tid], 0u);
        atomicStore(&hist_b[tid], 0u);
    }
    workgroupBarrier();

    // Build histograms: each thread processes a stride of the input.
    for (var i = tid; i < n; i += WG_SIZE) {
        // Match CPU binning: scale = 64/256, so for [0,1] range: bin = floor(v * 255 * 64/256)
        let bin_a = min(u32(frame_crop[i] * 63.75), BINS - 1u);
        let bin_b = min(u32(tmpl_crop[i] * 63.75), BINS - 1u);
        atomicAdd(&hist_a[bin_a], 1u);
        atomicAdd(&hist_b[bin_b], 1u);
    }
    workgroupBarrier();

    // Compute means of normalised histograms.
    // Each of the first 64 threads loads one bin.
    // Mean of a normalised histogram with BINS entries that sum to 1.0
    // is always 1/BINS, but we compute explicitly for robustness.

    // Normalise: histA[i] = count_a[i] / n, histB[i] = count_b[i] / n
    // meanA = sum(histA) / BINS = 1.0 / BINS (since sum of normalised hist = 1)
    let inv_n = 1.0 / f32(n);
    let mean_h = 1.0 / f32(BINS); // = inv_n * n / BINS

    // Compute correlation components — first 64 threads each handle one bin.
    var cov_acc:  f32 = 0.0;
    var varA_acc: f32 = 0.0;
    var varB_acc: f32 = 0.0;

    if tid < BINS {
        let ha = f32(atomicLoad(&hist_a[tid])) * inv_n;
        let hb = f32(atomicLoad(&hist_b[tid])) * inv_n;
        let da = ha - mean_h;
        let db = hb - mean_h;
        cov_acc  = da * db;
        varA_acc = da * da;
        varB_acc = db * db;
    }

    s_cov[tid]  = cov_acc;
    s_varA[tid] = varA_acc;
    s_varB[tid] = varB_acc;
    workgroupBarrier();

    // Tree reduction over all 256 slots (non-bin slots are zero).
    for (var stride = WG_SIZE >> 1u; stride > 0u; stride >>= 1u) {
        if tid < stride {
            s_cov[tid]  += s_cov[tid + stride];
            s_varA[tid] += s_varA[tid + stride];
            s_varB[tid] += s_varB[tid + stride];
        }
        workgroupBarrier();
    }

    // Thread 0 computes the final correlation coefficient.
    if tid == 0u {
        let denom = sqrt(s_varA[0] * s_varB[0]);
        var score: f32 = 0.0;
        if denom > 1e-12 {
            score = max(0.0, s_cov[0] / denom);
        }
        result[0] = score;
    }
}
