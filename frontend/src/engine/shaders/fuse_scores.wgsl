// Weighted score fusion compute shader.
//
// Combines 4 individual metric scores into a single hybrid detection score
// using fixed weights:
//   0.333 * SSIM + 0.278 * Pearson + 0.222 * MAD + 0.167 * histogram
//
// Runs as a single thread since the input is only 4 values.

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
