/**
 * Reusable WebGPU buffer pool.
 *
 * Split out of WebGPUDetector: the pool depends on nothing else in the
 * detector, only on a GPUDevice for allocation.
 */

/** Reusable GPU buffer pool to avoid per-frame allocation overhead. */
export class BufferPool {
  private readonly device: GPUDevice;
  private readonly pools = new Map<string, GPUBuffer[]>();

  constructor(device: GPUDevice) {
    this.device = device;
  }

  /** Round size up to next power-of-2 for better pool hit rate. */
  private roundSize(size: number): number {
    if (size <= 4) return 4;
    return 1 << (32 - Math.clz32(size - 1));
  }

  /** Acquire a buffer from the pool or create a new one. */
  acquire(size: number, usage: number, label?: string): GPUBuffer {
    const rounded = this.roundSize(size);
    const key = `${rounded}_${usage}`;
    const pool = this.pools.get(key);
    if (pool && pool.length > 0) {
      return pool.pop()!;
    }
    return this.device.createBuffer({ size: rounded, usage, label });
  }

  /** Return a buffer to the pool for reuse. */
  release(buffer: GPUBuffer): void {
    const key = `${buffer.size}_${buffer.usage}`;
    let pool = this.pools.get(key);
    if (!pool) {
      pool = [];
      this.pools.set(key, pool);
    }
    // Cap pool size to avoid memory leaks
    if (pool.length < 32) {
      pool.push(buffer);
    } else {
      buffer.destroy();
    }
  }

  /** Destroy all pooled buffers. */
  destroyAll(): void {
    for (const pool of this.pools.values()) {
      for (const buf of pool) buf.destroy();
    }
    this.pools.clear();
  }
}
