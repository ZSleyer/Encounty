import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

type CreateWorkerArgs = [
  lang: string,
  oem?: number,
  config?: { workerPath?: string; corePath?: string; langPath?: string },
];

const { mockRecognize, mockCreateWorker } = vi.hoisted(() => {
  const recognize = vi.fn();
  const worker = { recognize };
  return {
    mockRecognize: recognize,
    mockCreateWorker: vi.fn(
      (..._args: [string, number?, Record<string, unknown>?]) =>
        Promise.resolve(worker),
    ),
  };
});

vi.mock("tesseract.js", () => ({
  createWorker: mockCreateWorker,
}));

/* Import after mock so the module picks up the mocked createWorker. */
import { useOCR } from "./useOCR";

describe("useOCR", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecognize.mockReset();
  });

  it("starts with isRecognizing false and no error", () => {
    const { result } = renderHook(() => useOCR());
    expect(result.current.isRecognizing).toBe(false);
    expect(result.current.ocrError).toBeNull();
  });

  it("recognize returns trimmed text on success", async () => {
    mockRecognize.mockResolvedValue({ data: { text: "  Hello World  " } });

    const { result } = renderHook(() => useOCR());
    let text = "";

    await act(async () => {
      text = await result.current.recognize("http://example.com/image.png");
    });

    expect(text).toBe("Hello World");
    expect(result.current.isRecognizing).toBe(false);
    expect(result.current.ocrError).toBeNull();
  });

  it("sets ocrError and returns empty string on failure", async () => {
    mockRecognize.mockRejectedValue(new Error("Worker crashed"));

    const { result } = renderHook(() => useOCR());
    let text = "";

    await act(async () => {
      text = await result.current.recognize("bad-image");
    });

    expect(text).toBe("");
    expect(result.current.ocrError).toBe("Worker crashed");
    expect(result.current.isRecognizing).toBe(false);
  });

  it("clearError resets ocrError to null", async () => {
    mockRecognize.mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() => useOCR());

    await act(async () => {
      await result.current.recognize("x");
    });

    expect(result.current.ocrError).toBe("fail");

    act(() => result.current.clearError());
    expect(result.current.ocrError).toBeNull();
  });

  it("handles non-Error exceptions by converting to string", async () => {
    mockRecognize.mockRejectedValue("plain string error");

    const { result } = renderHook(() => useOCR());
    let text = "";

    await act(async () => {
      text = await result.current.recognize("bad-image");
    });

    expect(text).toBe("");
    expect(result.current.ocrError).toBe("plain string error");
  });

  it("passes custom language to the worker", async () => {
    mockRecognize.mockResolvedValue({ data: { text: "Bonjour" } });

    const { result } = renderHook(() => useOCR("fra"));
    let text = "";

    await act(async () => {
      text = await result.current.recognize("http://example.com/image.png");
    });

    expect(text).toBe("Bonjour");
  });

  it("allows overriding language per-call", async () => {
    mockRecognize.mockResolvedValue({ data: { text: "Hola" } });

    const { result } = renderHook(() => useOCR("eng"));
    let text = "";

    await act(async () => {
      text = await result.current.recognize("http://example.com/image.png", "spa");
    });

    expect(text).toBe("Hola");
  });

  it("sets isRecognizing to true during recognition", async () => {
    let resolveRecognize!: (v: { data: { text: string } }) => void;
    mockRecognize.mockImplementation(
      () => new Promise((resolve) => { resolveRecognize = resolve; }),
    );

    const { result } = renderHook(() => useOCR());

    let recognizePromise: Promise<string>;
    act(() => {
      recognizePromise = result.current.recognize("img");
    });

    // While the worker is busy, isRecognizing should be true
    await waitFor(() => expect(result.current.isRecognizing).toBe(true));

    await act(async () => {
      resolveRecognize({ data: { text: "done" } });
      await recognizePromise!;
    });

    expect(result.current.isRecognizing).toBe(false);
  });

  it("creates the tesseract worker with locally bundled worker/core paths", async () => {
    mockRecognize.mockResolvedValue({ data: { text: "x" } });

    // Use a unique language so the module-level worker cache does not hide the
    // createWorker call from earlier tests.
    const { result } = renderHook(() => useOCR("kor"));
    await act(async () => {
      await result.current.recognize("http://example.com/image.png");
    });

    const koreanCall = (mockCreateWorker.mock.calls as CreateWorkerArgs[]).find(
      (c) => c[0] === "kor",
    );
    expect(koreanCall).toBeDefined();
    const opts = koreanCall![2]!;
    expect(opts.workerPath).toMatch(/tesseract\/worker\.min\.js$/);
    expect(opts.corePath).toMatch(/\/tesseract$/);
    // kor is NOT bundled — langPath should be left unset so tesseract.js
    // falls back to its default per-language CDN.
    expect(opts.langPath).toBeUndefined();
  });

  it("sets local langPath only for bundled languages", async () => {
    mockRecognize.mockResolvedValue({ data: { text: "Hallo" } });

    const { result } = renderHook(() => useOCR("deu"));
    await act(async () => {
      await result.current.recognize("http://example.com/image.png");
    });

    const germanCall = (mockCreateWorker.mock.calls as CreateWorkerArgs[]).find(
      (c) => c[0] === "deu",
    );
    expect(germanCall).toBeDefined();
    expect(germanCall![2]!.langPath).toMatch(/\/tessdata$/);
  });

  it("rewrites opaque importScripts errors to a network-related hint", async () => {
    mockRecognize.mockRejectedValue(
      new Error(
        "Failed to execute 'importScripts' on 'WorkerGlobalScope': The script at 'blob:...' failed to load.",
      ),
    );

    const { result } = renderHook(() => useOCR("ita"));

    await act(async () => {
      await result.current.recognize("img");
    });

    expect(result.current.ocrError).toMatch(/network or firewall/i);
    expect(result.current.ocrError).toContain("importScripts");
  });
});
