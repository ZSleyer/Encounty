/**
 * BufferPool tests.
 *
 * The pool is the one piece of the WebGPU detector that needs no GPU: its only
 * dependency is `device.createBuffer`, so a fake device is enough to pin the
 * size rounding, the reuse keying and the destruction behavior.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { BufferPool } from "./BufferPool";

/** A minimal stand-in for a GPUBuffer that records whether it was destroyed. */
interface FakeBuffer {
  size: number;
  usage: number;
  label?: string;
  destroyed: boolean;
  destroy(): void;
}

/** Records every createBuffer call so tests can assert on rounding and reuse. */
interface FakeDevice {
  created: FakeBuffer[];
  createBuffer(desc: { size: number; usage: number; label?: string }): FakeBuffer;
}

/** Build a fake GPUDevice whose createBuffer hands out inspectable buffers. */
function makeDevice(): { device: GPUDevice; fake: FakeDevice } {
  const fake: FakeDevice = {
    created: [],
    createBuffer(desc) {
      const buffer: FakeBuffer = {
        size: desc.size,
        usage: desc.usage,
        label: desc.label,
        destroyed: false,
        destroy() {
          this.destroyed = true;
        },
      };
      fake.created.push(buffer);
      return buffer;
    },
  };
  return { device: fake as unknown as GPUDevice, fake };
}

const STORAGE = 0x0080;
const UNIFORM = 0x0040;

describe("BufferPool", () => {
  let device: GPUDevice;
  let fake: FakeDevice;
  let pool: BufferPool;

  beforeEach(() => {
    ({ device, fake } = makeDevice());
    pool = new BufferPool(device);
  });

  describe("size rounding", () => {
    it.each([
      [0, 4],
      [1, 4],
      [4, 4],
      [5, 8],
      [8, 8],
      [9, 16],
      [1000, 1024],
      [1024, 1024],
      [1025, 2048],
    ])("acquire(%i) allocates %i bytes", (requested, expected) => {
      pool.acquire(requested, STORAGE);
      expect(fake.created).toHaveLength(1);
      expect(fake.created[0].size).toBe(expected);
    });

    it("passes usage and label straight through to createBuffer", () => {
      pool.acquire(12, STORAGE, "scores");
      expect(fake.created[0].usage).toBe(STORAGE);
      expect(fake.created[0].label).toBe("scores");
    });
  });

  describe("reuse", () => {
    it("hands back a released buffer instead of creating a new one", () => {
      const first = pool.acquire(1000, STORAGE);
      pool.release(first);
      const second = pool.acquire(1000, STORAGE);
      expect(second).toBe(first);
      expect(fake.created).toHaveLength(1);
    });

    it("reuses a rounded buffer for any request that rounds to the same bucket", () => {
      const first = pool.acquire(1024, STORAGE);
      pool.release(first);
      // 700 rounds up to 1024, so it lands in the same bucket.
      expect(pool.acquire(700, STORAGE)).toBe(first);
      expect(fake.created).toHaveLength(1);
    });

    it("does not reuse a buffer that is too small", () => {
      const small = pool.acquire(512, STORAGE);
      pool.release(small);
      const large = pool.acquire(1000, STORAGE);
      expect(large).not.toBe(small);
      expect(fake.created).toHaveLength(2);
      expect(fake.created[1].size).toBe(1024);
    });

    it("does not reuse a buffer with a different usage", () => {
      const storage = pool.acquire(64, STORAGE);
      pool.release(storage);
      const uniform = pool.acquire(64, UNIFORM);
      expect(uniform).not.toBe(storage);
      expect(fake.created).toHaveLength(2);
    });

    it("hands buffers back in the order the pool pops them", () => {
      const a = pool.acquire(64, STORAGE);
      const b = pool.acquire(64, STORAGE);
      pool.release(a);
      pool.release(b);
      // The pool is a stack: the last release is the first reuse.
      expect(pool.acquire(64, STORAGE)).toBe(b);
      expect(pool.acquire(64, STORAGE)).toBe(a);
      expect(fake.created).toHaveLength(2);
    });

    it("destroys a released buffer once the bucket holds 32 of them", () => {
      const buffers: GPUBuffer[] = [];
      for (let i = 0; i < 33; i++) buffers.push(pool.acquire(64, STORAGE));
      for (const buffer of buffers) pool.release(buffer);
      const created = fake.created;
      expect(created.slice(0, 32).some((b) => b.destroyed)).toBe(false);
      expect(created[32].destroyed).toBe(true);
    });
  });

  describe("destroyAll", () => {
    it("destroys every pooled buffer", () => {
      const a = pool.acquire(64, STORAGE);
      const b = pool.acquire(1000, UNIFORM);
      pool.release(a);
      pool.release(b);
      pool.destroyAll();
      expect(fake.created.every((buffer) => buffer.destroyed)).toBe(true);
    });

    it("empties the pools so the next acquire allocates again", () => {
      const a = pool.acquire(64, STORAGE);
      pool.release(a);
      pool.destroyAll();
      const b = pool.acquire(64, STORAGE);
      expect(b).not.toBe(a);
      expect(fake.created).toHaveLength(2);
    });

    it("leaves buffers that were never released untouched", () => {
      // Only pooled buffers are destroyed; an outstanding buffer stays alive
      // because the pool has no reference to it.
      const outstanding = pool.acquire(64, STORAGE) as unknown as FakeBuffer;
      pool.destroyAll();
      expect(outstanding.destroyed).toBe(false);
    });
  });
});
