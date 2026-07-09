// pixel_delta.wgsl: frame-change measurement for adaptive polling.
//
// Compares two 64x64 f32 grayscale thumbnails (the current and previous
// frame) and accumulates the sum of absolute differences into a single
// atomic u32. The host divides the result by (64 * 64 * 255 * 1000) to
// obtain a normalised [0, 1] delta, which drives the adaptive poll interval
// and the hysteresis exit in DetectionLoop.
//
// The absolute difference is scaled by 255 * 1000 before atomic addition to
// preserve fractional precision in the integer accumulator. All threads add
// to one atomic; at 4096 pixels the contention is negligible.
//
// Bindings:
//   @binding(0) frame_a: grayscale f32 thumbnail, 64 * 64
//   @binding(1) frame_b: grayscale f32 thumbnail, 64 * 64
//   @binding(2) result:  atomic u32 accumulator, zeroed by the host per call
//
// Dispatch: 4 x 4 workgroups of 16x16 threads (fixed 64x64 grid).
// Host: WebGPUDetector.pixelDelta().

@group(0) @binding(0) var<storage, read> frame_a: array<f32>;
@group(0) @binding(1) var<storage, read> frame_b: array<f32>;
@group(0) @binding(2) var<storage, read_write> result: atomic<u32>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    // Fixed 64x64 grid.
    if gid.x >= 64u || gid.y >= 64u {
        return;
    }

    let idx = gid.y * 64u + gid.x;
    let diff = abs(frame_a[idx] - frame_b[idx]);

    // Scale to integer: diff is [0, 1], multiply by 255*1000 for precision.
    let scaled = u32(diff * 255.0 * 1000.0);
    atomicAdd(&result, scaled);
}
