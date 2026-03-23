// Fused crop + downscale + grayscale conversion compute shader.
//
// Reads an RGBA texture via textureLoad, applies a crop region,
// bilinear-downscales to the target resolution, and converts to
// f32 grayscale using ITU-R BT.601 luminance weights.
//
// WebGPU variant: reads from a texture2D<f32> instead of a packed u32
// storage buffer, allowing zero-copy upload from video frames via
// copyExternalImageToTexture.

struct Params {
    src_w:  u32,
    src_h:  u32,
    dst_w:  u32,
    dst_h:  u32,
    crop_x: u32,
    crop_y: u32,
    crop_w: u32,
    crop_h: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src_texture: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> output: array<f32>;

/// Sample a pixel from the source texture at integer coordinates, clamped to bounds.
fn sample_pixel(x: i32, y: i32) -> vec3<f32> {
    let cx = clamp(x, 0i, i32(params.src_w) - 1i);
    let cy = clamp(y, 0i, i32(params.src_h) - 1i);
    let texel = textureLoad(src_texture, vec2<i32>(cx, cy), 0);
    return texel.rgb;
}

/// Bilinear interpolation at fractional source coordinates.
fn bilinear_sample(sx: f32, sy: f32) -> vec3<f32> {
    let x0 = i32(floor(sx));
    let y0 = i32(floor(sy));
    let fx = sx - floor(sx);
    let fy = sy - floor(sy);

    let tl = sample_pixel(x0,      y0);
    let tr = sample_pixel(x0 + 1i, y0);
    let bl = sample_pixel(x0,      y0 + 1i);
    let br = sample_pixel(x0 + 1i, y0 + 1i);

    let top    = mix(tl, tr, fx);
    let bottom = mix(bl, br, fx);
    return mix(top, bottom, fy);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if gid.x >= params.dst_w || gid.y >= params.dst_h {
        return;
    }

    // Map output pixel to source coordinates inside the crop region.
    let sx = f32(params.crop_x) + (f32(gid.x) + 0.5) * f32(params.crop_w) / f32(params.dst_w) - 0.5;
    let sy = f32(params.crop_y) + (f32(gid.y) + 0.5) * f32(params.crop_h) / f32(params.dst_h) - 0.5;

    let rgb = bilinear_sample(sx, sy);

    // ITU-R BT.601 luminance
    let gray = 0.299 * rgb.x + 0.587 * rgb.y + 0.114 * rgb.z;

    let out_idx = gid.y * params.dst_w + gid.x;
    output[out_idx] = gray;
}
