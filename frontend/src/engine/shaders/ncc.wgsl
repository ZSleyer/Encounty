// NCC (Normalized Cross-Correlation) compute shader.
//
// Each invocation computes the NCC score at one candidate position (fx, fy)
// by iterating over the template window.  The brute-force per-thread approach
// is O(tw*th) per thread but thousands of threads run in parallel, making it
// faster than a CPU integral-image approach for typical template sizes.

struct NccParams {
    frame_w:   u32,
    frame_h:   u32,
    tmpl_w:    u32,
    tmpl_h:    u32,
    tmpl_mean: f32,
    tmpl_std:  f32,
    tmpl_n:    f32,
    out_w:     u32,  // = frame_w - tmpl_w + 1
}

@group(0) @binding(0) var<storage, read> frame: array<f32>;
@group(0) @binding(1) var<storage, read> tmpl: array<f32>;
@group(0) @binding(2) var<uniform> params: NccParams;
@group(0) @binding(3) var<storage, read_write> scores: array<f32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    let out_h = params.frame_h - params.tmpl_h + 1u;
    let max_positions = params.out_w * out_h;
    if idx >= max_positions {
        return;
    }

    let fx = idx % params.out_w;
    let fy = idx / params.out_w;

    // First pass: compute patch mean
    var p_sum: f32 = 0.0;
    for (var ty: u32 = 0u; ty < params.tmpl_h; ty++) {
        for (var tx: u32 = 0u; tx < params.tmpl_w; tx++) {
            p_sum += frame[(fy + ty) * params.frame_w + (fx + tx)];
        }
    }
    let p_mean = p_sum / params.tmpl_n;

    // Second pass: patch variance and cross-correlation
    var p_var_sum: f32 = 0.0;
    var cc: f32 = 0.0;
    for (var ty: u32 = 0u; ty < params.tmpl_h; ty++) {
        for (var tx: u32 = 0u; tx < params.tmpl_w; tx++) {
            let fv = frame[(fy + ty) * params.frame_w + (fx + tx)] - p_mean;
            let tv = tmpl[ty * params.tmpl_w + tx] - params.tmpl_mean;
            p_var_sum += fv * fv;
            cc += fv * tv;
        }
    }

    let p_std = sqrt(p_var_sum / params.tmpl_n);

    var ncc_val: f32 = 0.0;
    if p_std > 1e-6 && params.tmpl_std > 1e-6 {
        ncc_val = cc / (params.tmpl_n * p_std * params.tmpl_std);
    }

    scores[idx] = clamp(ncc_val, 0.0, 1.0);
}
