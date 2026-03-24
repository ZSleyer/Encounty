// Perceptual difference hash (dHash) similarity compute shader.
//
// Resizes both images to 9x8 using nearest-neighbour sampling, computes
// a 64-bit hash per image by comparing adjacent horizontal pixels, XORs
// the two hashes, and counts the differing bits (Hamming distance).
//
// Output: 1.0 - f32(hamming) / 64.0
//
// Uses a single workgroup of 256 threads.  The first 64 threads each
// compute one bit of each hash.  Thread 0 then aggregates the results.

struct DHashParams {
    width:  u32,
    height: u32,
}

@group(0) @binding(0) var<storage, read> frame_crop: array<f32>;
@group(0) @binding(1) var<storage, read> tmpl_crop:  array<f32>;
@group(0) @binding(2) var<uniform>       params:     DHashParams;
@group(0) @binding(3) var<storage, read_write> result: array<f32>;

const WG_SIZE: u32 = 256u;

// Each of the first 64 threads stores its XOR bit (0 or 1).
var<workgroup> s_xor_bits: array<u32, 256>;

/// Popcount via Brian Kernighan's algorithm for a u32 value.
fn popcount_u32(v_in: u32) -> u32 {
    var v = v_in;
    var count: u32 = 0u;
    loop {
        if v == 0u { break; }
        v = v & (v - 1u);
        count += 1u;
    }
    return count;
}

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid: vec3<u32>) {
    let tid = lid.x;
    let w = params.width;
    let h = params.height;

    // Precompute scale factors for nearest-neighbour resize to 9x8.
    let scale_x = f32(w) / 9.0;
    let scale_y = f32(h) / 8.0;

    // First 64 threads each handle one bit position in the 64-bit hash.
    // Bit index: row = tid / 8, col = tid % 8
    // Hash bit is set when left pixel > right pixel (at col and col+1).
    var xor_bit: u32 = 0u;

    if tid < 64u {
        let row = tid / 8u;
        let col = tid % 8u;

        let sy = min(u32(f32(row) * scale_y), h - 1u);
        let sx_left  = min(u32(f32(col) * scale_x), w - 1u);
        let sx_right = min(u32(f32(col + 1u) * scale_x), w - 1u);

        let f_left  = frame_crop[sy * w + sx_left];
        let f_right = frame_crop[sy * w + sx_right];
        let f_bit = select(0u, 1u, f_left > f_right);

        let t_left  = tmpl_crop[sy * w + sx_left];
        let t_right = tmpl_crop[sy * w + sx_right];
        let t_bit = select(0u, 1u, t_left > t_right);

        xor_bit = f_bit ^ t_bit;
    }

    s_xor_bits[tid] = xor_bit;
    workgroupBarrier();

    // Tree reduction to count total differing bits (Hamming distance).
    for (var stride = WG_SIZE >> 1u; stride > 0u; stride >>= 1u) {
        if tid < stride {
            s_xor_bits[tid] += s_xor_bits[tid + stride];
        }
        workgroupBarrier();
    }

    // Thread 0 computes the final similarity score.
    if tid == 0u {
        let hamming = s_xor_bits[0];
        result[0] = 1.0 - f32(hamming) / 64.0;
    }
}
