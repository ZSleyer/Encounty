/**
 * asyncMutex.test.ts — Tests for the promise-chain mutex used to
 * serialize detector access across detection loops.
 */
import { describe, it, expect } from "vitest";
import { AsyncMutex } from "./asyncMutex";

describe("AsyncMutex", () => {
  it("serializes concurrent calls (no overlap)", async () => {
    const mutex = new AsyncMutex();
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];

    const job = (id: number) =>
      mutex.runExclusive(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push(id);
        // Yield twice so an unserialized second job could interleave
        await Promise.resolve();
        await Promise.resolve();
        active -= 1;
        return id;
      });

    const results = await Promise.all([job(1), job(2), job(3)]);

    expect(maxActive).toBe(1);
    expect(order).toEqual([1, 2, 3]);
    expect(results).toEqual([1, 2, 3]);
  });

  it("does not start the second call before the first resolves", async () => {
    const mutex = new AsyncMutex();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let secondStarted = false;

    const first = mutex.runExclusive(() => gate);
    const second = mutex.runExclusive(() => {
      secondStarted = true;
    });

    // Give the microtask queue plenty of chances to (incorrectly) run job 2
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(secondStarted).toBe(false);

    release();
    await first;
    await second;
    expect(secondStarted).toBe(true);
  });

  it("propagates rejections without poisoning the chain", async () => {
    const mutex = new AsyncMutex();

    await expect(
      mutex.runExclusive(() => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");

    // A subsequent call must still run
    const result = await mutex.runExclusive(() => 42);
    expect(result).toBe(42);
  });

  it("supports synchronous functions", async () => {
    const mutex = new AsyncMutex();
    const result = await mutex.runExclusive(() => "sync");
    expect(result).toBe("sync");
  });
});
