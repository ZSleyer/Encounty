/**
 * Staging-buffer readbacks for the WebGPU detector.
 *
 * Split out of WebGPUDetector so the decoding can be tested without a GPU:
 * the device and the buffer pool are parameters rather than captured state.
 */
import type { BufferPool } from "./BufferPool";

/**
 * Copy the first f32 from a storage buffer to the CPU via a staging buffer.
 *
 * `device` and `pool` are passed in because the readbacks are shared by the
 * detector's several passes rather than owned by any one of them.
 */
export async function readF32(
  device: GPUDevice,
  pool: BufferPool,
  src: GPUBuffer,
): Promise<number> {
  // Phase 0C: Pool the staging buffer
  const staging = pool.acquire(4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, "staging_f32");

  const encoder = device.createCommandEncoder({
    label: "readback_encoder",
  });
  encoder.copyBufferToBuffer(src, 0, staging, 0, 4);
  device.queue.submit([encoder.finish()]);

  try {
    await staging.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(staging.getMappedRange());
    const result = data[0];
    staging.unmap();
    pool.release(staging);
    return result;
  } catch (err) {
    // mapAsync rejected (e.g. device loss): the buffer's mapped state is
    // unknown, so destroy it instead of returning it to the pool.
    staging.destroy();
    throw err;
  }
}

/**
 * Copy `count` f32 values from a storage buffer to the CPU as a number array.
 *
 * The staging buffer comes from `pool` and is returned to it on success.
 */
export async function readF32Array(
  device: GPUDevice,
  pool: BufferPool,
  src: GPUBuffer,
  count: number,
): Promise<number[]> {
  const byteLength = Math.max(count * 4, 4);
  const staging = pool.acquire(
    byteLength,
    GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    "staging_f32_array",
  );

  const encoder = device.createCommandEncoder({
    label: "readback_array_encoder",
  });
  encoder.copyBufferToBuffer(src, 0, staging, 0, count * 4);
  device.queue.submit([encoder.finish()]);

  try {
    await staging.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(staging.getMappedRange());
    const result: number[] = [];
    for (let i = 0; i < count; i++) result.push(data[i]);
    staging.unmap();
    pool.release(staging);
    return result;
  } catch (err) {
    // Unknown mapped state after a rejected mapAsync, do not pool it.
    staging.destroy();
    throw err;
  }
}

/**
 * Read a single u32 from a storage buffer via a staging buffer.
 *
 * The encoder is provided by the caller so the copy can be batched with
 * the preceding compute pass. `device` is only used to submit it.
 */
export async function readU32(
  device: GPUDevice,
  pool: BufferPool,
  encoder: GPUCommandEncoder,
  src: GPUBuffer,
): Promise<number> {
  // Phase 0C: Pool the staging buffer
  const staging = pool.acquire(4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, "staging_u32");

  encoder.copyBufferToBuffer(src, 0, staging, 0, 4);
  device.queue.submit([encoder.finish()]);

  try {
    await staging.mapAsync(GPUMapMode.READ);
    const data = new Uint32Array(staging.getMappedRange());
    const result = data[0];
    staging.unmap();
    pool.release(staging);
    return result;
  } catch (err) {
    // Unknown mapped state after a rejected mapAsync, do not pool it.
    staging.destroy();
    throw err;
  }
}
