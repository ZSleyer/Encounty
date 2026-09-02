/**
 * Staging-buffer readback tests.
 *
 * The readbacks only ever touch a device, a BufferPool and a command encoder,
 * so a fake device whose buffers hold real bytes is enough to pin both the
 * decoded values and the pooling of the staging buffers.
 */
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { BufferPool } from "./BufferPool";
import { readF32, readF32Array, readU32 } from "./readback";

// The readbacks reference the WebGPU flag namespaces at call time, and jsdom
// provides neither. The values match the WebGPU specification.
beforeAll(() => {
  Object.assign(globalThis, {
    GPUBufferUsage: { MAP_READ: 0x0001, COPY_DST: 0x0008 },
    GPUMapMode: { READ: 0x0001 },
  });
});

/** A fake GPUBuffer backed by a real ArrayBuffer so copies move real bytes. */
interface FakeBuffer {
  size: number;
  usage: number;
  label?: string;
  bytes: Uint8Array;
  destroyed: boolean;
  mapped: boolean;
  mapRejection?: Error;
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

/** A fake command encoder that performs its buffer copies eagerly. */
interface FakeEncoder {
  label?: string;
  copies: Array<{ size: number }>;
  finished: boolean;
  copyBufferToBuffer(
    src: FakeBuffer,
    srcOffset: number,
    dst: FakeBuffer,
    dstOffset: number,
    size: number,
  ): void;
  finish(): FakeEncoder;
}

/** Test harness: a fake device plus the buffers and submissions it produced. */
interface Harness {
  device: GPUDevice;
  pool: BufferPool;
  created: FakeBuffer[];
  encoders: FakeEncoder[];
  submitted: unknown[][];
  /** Build a source buffer already filled with the given bytes. */
  source(values: Float32Array | Uint32Array): GPUBuffer;
  /** Create an encoder the way the detector would, for readU32. */
  encoder(): GPUCommandEncoder;
}

/** Build the fake device and a real BufferPool on top of it. */
function makeHarness(): Harness {
  const created: FakeBuffer[] = [];
  const encoders: FakeEncoder[] = [];
  const submitted: unknown[][] = [];

  function newBuffer(size: number, usage: number, label?: string): FakeBuffer {
    const buffer: FakeBuffer = {
      size,
      usage,
      label,
      bytes: new Uint8Array(size),
      destroyed: false,
      mapped: false,
      async mapAsync() {
        if (buffer.mapRejection) throw buffer.mapRejection;
        buffer.mapped = true;
      },
      getMappedRange() {
        return buffer.bytes.buffer as ArrayBuffer;
      },
      unmap() {
        buffer.mapped = false;
      },
      destroy() {
        buffer.destroyed = true;
      },
    };
    return buffer;
  }

  const device = {
    createBuffer(desc: { size: number; usage: number; label?: string }) {
      const buffer = newBuffer(desc.size, desc.usage, desc.label);
      created.push(buffer);
      return buffer;
    },
    createCommandEncoder(desc?: { label?: string }) {
      const encoder: FakeEncoder = {
        label: desc?.label,
        copies: [],
        finished: false,
        copyBufferToBuffer(src, srcOffset, dst, dstOffset, size) {
          dst.bytes.set(src.bytes.subarray(srcOffset, srcOffset + size), dstOffset);
          encoder.copies.push({ size });
        },
        finish() {
          encoder.finished = true;
          return encoder;
        },
      };
      encoders.push(encoder);
      return encoder;
    },
    queue: {
      submit(commands: unknown[]) {
        submitted.push(commands);
      },
    },
  };

  const typedDevice = device as unknown as GPUDevice;
  return {
    device: typedDevice,
    pool: new BufferPool(typedDevice),
    created,
    encoders,
    submitted,
    source(values) {
      const buffer = newBuffer(values.byteLength, 0, "source");
      buffer.bytes.set(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
      return buffer as unknown as GPUBuffer;
    },
    encoder() {
      return typedDevice.createCommandEncoder({ label: "test_encoder" });
    },
  };
}

describe("readF32", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  it("decodes the first f32 of the source buffer", async () => {
    const src = h.source(new Float32Array([0.75, 9]));
    await expect(readF32(h.device, h.pool, src)).resolves.toBe(0.75);
  });

  it("stages through a 4-byte MAP_READ buffer and submits one encoder", async () => {
    await readF32(h.device, h.pool, h.source(new Float32Array([1])));
    expect(h.created).toHaveLength(1);
    expect(h.created[0].size).toBe(4);
    expect(h.created[0].usage).toBe(0x0001 | 0x0008);
    expect(h.encoders).toHaveLength(1);
    expect(h.encoders[0].copies).toEqual([{ size: 4 }]);
    expect(h.submitted).toEqual([[h.encoders[0]]]);
  });

  it("unmaps and pools the staging buffer so the next read reuses it", async () => {
    const src = h.source(new Float32Array([0.5]));
    await readF32(h.device, h.pool, src);
    await readF32(h.device, h.pool, src);
    expect(h.created).toHaveLength(1);
    expect(h.created[0].mapped).toBe(false);
  });

  it("destroys the staging buffer instead of pooling it when mapAsync rejects", async () => {
    const boom = new Error("device lost");
    const src = h.source(new Float32Array([0.5]));
    // The pool hands out the buffer created on first acquire, so arm it there.
    const staging = h.device.createBuffer({
      size: 4,
      usage: 0x0001 | 0x0008,
    }) as unknown as FakeBuffer;
    staging.mapRejection = boom;
    h.pool.release(staging as unknown as GPUBuffer);

    await expect(readF32(h.device, h.pool, src)).rejects.toBe(boom);
    expect(staging.destroyed).toBe(true);
    // A fresh acquire must allocate, proving the broken buffer was not pooled.
    h.pool.acquire(4, 0x0001 | 0x0008);
    expect(h.created).toHaveLength(2);
  });
});

describe("readF32Array", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  it("decodes exactly `count` values", async () => {
    const src = h.source(new Float32Array([0.25, 0.5, 0.75, 1]));
    await expect(readF32Array(h.device, h.pool, src, 3)).resolves.toEqual([0.25, 0.5, 0.75]);
  });

  it("rounds the staging buffer up but copies only the requested bytes", async () => {
    await readF32Array(h.device, h.pool, h.source(new Float32Array([1, 2, 3])), 3);
    expect(h.created[0].size).toBe(16);
    expect(h.encoders[0].copies).toEqual([{ size: 12 }]);
  });

  it("still stages at least 4 bytes for a zero-length read", async () => {
    await expect(
      readF32Array(h.device, h.pool, h.source(new Float32Array([1])), 0),
    ).resolves.toEqual([]);
    expect(h.created[0].size).toBe(4);
    expect(h.encoders[0].copies).toEqual([{ size: 0 }]);
  });

  it("destroys the staging buffer when mapAsync rejects", async () => {
    const boom = new Error("device lost");
    const staging = h.device.createBuffer({
      size: 16,
      usage: 0x0001 | 0x0008,
    }) as unknown as FakeBuffer;
    staging.mapRejection = boom;
    h.pool.release(staging as unknown as GPUBuffer);

    const src = h.source(new Float32Array([1, 2, 3]));
    await expect(readF32Array(h.device, h.pool, src, 3)).rejects.toBe(boom);
    expect(staging.destroyed).toBe(true);
  });
});

describe("readU32", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  it("decodes the first u32 of the source buffer", async () => {
    const src = h.source(new Uint32Array([4_042_322_160, 7]));
    const encoder = h.encoder();
    await expect(readU32(h.device, h.pool, encoder, src)).resolves.toBe(4_042_322_160);
  });

  it("appends its copy to the caller's encoder and submits that encoder", async () => {
    const encoder = h.encoder();
    await readU32(h.device, h.pool, encoder, h.source(new Uint32Array([1])));
    // Only the caller's encoder exists: readU32 must not create its own.
    expect(h.encoders).toHaveLength(1);
    expect(h.encoders[0].label).toBe("test_encoder");
    expect(h.encoders[0].copies).toEqual([{ size: 4 }]);
    expect(h.encoders[0].finished).toBe(true);
    expect(h.submitted).toEqual([[h.encoders[0]]]);
  });

  it("pools the staging buffer so a second read reuses it", async () => {
    const src = h.source(new Uint32Array([3]));
    await readU32(h.device, h.pool, h.encoder(), src);
    await readU32(h.device, h.pool, h.encoder(), src);
    expect(h.created).toHaveLength(1);
  });

  it("destroys the staging buffer when mapAsync rejects", async () => {
    const boom = new Error("device lost");
    const staging = h.device.createBuffer({
      size: 4,
      usage: 0x0001 | 0x0008,
    }) as unknown as FakeBuffer;
    staging.mapRejection = boom;
    h.pool.release(staging as unknown as GPUBuffer);

    const src = h.source(new Uint32Array([1]));
    await expect(readU32(h.device, h.pool, h.encoder(), src)).rejects.toBe(boom);
    expect(staging.destroyed).toBe(true);
  });
});
