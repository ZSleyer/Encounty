// Parallel min-reduction shader.
//
// Each workgroup of 256 threads loads one element each into shared memory,
// performs a tree reduction to find the local minimum, and writes the result
// back to the first element of its workgroup range.  The host dispatches
// this shader iteratively until a single value remains.

struct ReduceParams {
    count: u32,
    _pad: u32,
}

@group(0) @binding(0) var<storage, read_write> data: array<f32>;
@group(0) @binding(1) var<uniform> params: ReduceParams;

var<workgroup> shmem: array<f32, 256>;

@compute @workgroup_size(256)
fn main(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(local_invocation_id) lid: vec3<u32>,
    @builtin(workgroup_id) wid: vec3<u32>,
) {
    let i = gid.x;

    if i < params.count {
        shmem[lid.x] = data[i];
    } else {
        // Initialise out-of-bounds slots to 1.0 (neutral element for min).
        shmem[lid.x] = 1.0;
    }
    workgroupBarrier();

    // Tree reduction within the workgroup
    for (var stride: u32 = 128u; stride > 0u; stride >>= 1u) {
        if lid.x < stride {
            shmem[lid.x] = min(shmem[lid.x], shmem[lid.x + stride]);
        }
        workgroupBarrier();
    }

    // Workgroup leader writes result back
    if lid.x == 0u {
        data[wid.x] = shmem[0];
    }
}
