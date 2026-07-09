// ssim_median.wgsl: approximate median of Block-SSIM scores on the GPU.
//
// Reduces the per-block scores from block_ssim.wgsl to their median without
// a CPU readback. Divides [0, 1] into 64 bins, counts scores per bin via
// atomicAdd in shared memory, then thread 0 scans the bins cumulatively to
// find the one containing the 50th percentile. Output is that bin's centre,
// so the result is quantised to 1/64 steps, which is accurate enough for a
// fused similarity metric.
//
// The result stays in a GPU buffer and is copied into the fuse input
// (fuse_scores.wgsl slot 0) via copyBufferToBuffer; it never visits the CPU.
//
// Bindings:
//   @binding(0) scores: per-block SSIM scores from block_ssim.wgsl
//   @binding(1) params: Params uniform (score count, must be > 0)
//   @binding(2) result: output, single f32 (median bin centre)
//
// Dispatch: exactly ONE workgroup of 256 threads.
// Host: WebGPUDetector.regionHybridMatch() via encodeSsimMedian().

struct Params {
  count: u32,
}

@group(0) @binding(0) var<storage, read> scores: array<f32>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read_write> result: f32;

const BINS: u32 = 64u;

var<workgroup> bins: array<atomic<u32>, 64>;

@compute @workgroup_size(256)
fn main(
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(num_workgroups) nwg: vec3u,
) {
  let count = params.count;

  // Zero-initialize histogram bins (first 64 threads)
  if (lid.x < BINS) {
    atomicStore(&bins[lid.x], 0u);
  }
  workgroupBarrier();

  // Phase 1: Each thread bins its stride of scores
  let total_threads = 256u;
  var i = lid.x;
  while (i < count) {
    let v = clamp(scores[i], 0.0, 1.0);
    let bin = min(u32(v * f32(BINS - 1u) + 0.5), BINS - 1u);
    atomicAdd(&bins[bin], 1u);
    i += total_threads;
  }
  workgroupBarrier();

  // Phase 2: Thread 0 scans bins to find the median
  if (lid.x == 0u) {
    let half = (count + 1u) / 2u;
    var cumulative = 0u;
    var median_bin = 0u;
    for (var b = 0u; b < BINS; b++) {
      cumulative += atomicLoad(&bins[b]);
      if (cumulative >= half) {
        median_bin = b;
        break;
      }
    }
    // Return bin centre as the approximate median
    result = (f32(median_bin) + 0.5) / f32(BINS);
  }
}
