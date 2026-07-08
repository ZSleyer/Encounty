/**
 * asyncMutex.ts — Minimal promise-chain mutex for serializing async work.
 *
 * Used by WebGPUDetector to serialize detect() calls from multiple
 * concurrently running detection loops, since the detector holds shared
 * mutable GPU state (frame texture, persistent delta buffer) that must
 * not be touched by two detect cycles at once.
 */

/** Serializes async functions: calls run one at a time in FIFO order. */
export class AsyncMutex {
  private chain: Promise<unknown> = Promise.resolve();

  /**
   * Run fn exclusively. Queued calls execute in FIFO order. A rejection
   * propagates to the caller of runExclusive but never poisons the chain,
   * so subsequent calls still run.
   */
  runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = this.chain.then(fn, fn);
    this.chain = result.catch(() => {});
    return result;
  }
}
