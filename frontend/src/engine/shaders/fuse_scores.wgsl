// Weighted score fusion compute shader.
//
// Combines 5 individual metric scores into a single hybrid detection score
// using fixed weights:
//   0.30 * SSIM + 0.25 * Pearson + 0.20 * MAD + 0.15 * histogram + 0.10 * dHash
//
// Runs as a single thread since the input is only 5 values.

@group(0) @binding(0) var<storage, read> scores: array<f32>;
@group(0) @binding(1) var<storage, read_write> result: array<f32>;

@compute @workgroup_size(1)
fn main() {
    let ssim    = scores[0];
    let pearson = scores[1];
    let mad     = scores[2];
    let hist    = scores[3];
    let dhash   = scores[4];

    let fused = 0.30 * ssim + 0.25 * pearson + 0.20 * mad + 0.15 * hist + 0.10 * dhash;
    result[0] = clamp(fused, 0.0, 1.0);
}
