import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockRecognize = vi.fn();
const mockWorker = { recognize: mockRecognize };

vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(() => Promise.resolve(mockWorker)),
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
});
