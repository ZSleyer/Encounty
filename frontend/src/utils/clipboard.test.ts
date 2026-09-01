import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copyWithFlag, COPIED_FLAG_MS } from "./clipboard";

/** Replaces navigator.clipboard.writeText with a controllable stub. */
function stubClipboard(impl: () => Promise<void>) {
  const writeText = vi.fn(impl);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return writeText;
}

describe("copyWithFlag", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes the given text to the clipboard", async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    copyWithFlag("https://example.test/overlay", vi.fn());
    await vi.runAllTicks();
    expect(writeText).toHaveBeenCalledWith("https://example.test/overlay");
  });

  it("raises the flag on success and lowers it after the timeout", async () => {
    stubClipboard(() => Promise.resolve());
    const setCopied = vi.fn();
    copyWithFlag("x", setCopied);
    await Promise.resolve();
    expect(setCopied).toHaveBeenCalledWith(true);
    setCopied.mockClear();
    vi.advanceTimersByTime(COPIED_FLAG_MS);
    expect(setCopied).toHaveBeenCalledWith(false);
  });

  it("runs onSuccess before raising the flag", async () => {
    stubClipboard(() => Promise.resolve());
    const order: string[] = [];
    copyWithFlag("x", () => order.push("flag"), { onSuccess: () => order.push("success") });
    await Promise.resolve();
    expect(order).toEqual(["success", "flag"]);
  });

  it("runs onError and never raises the flag when the write is rejected", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    const setCopied = vi.fn();
    const onError = vi.fn();
    copyWithFlag("x", setCopied, { onError });
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledOnce();
    expect(setCopied).not.toHaveBeenCalled();
  });

  it("swallows a rejection when no onError is given", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    expect(() => copyWithFlag("x", vi.fn())).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });
});
