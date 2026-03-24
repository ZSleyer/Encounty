/**
 * useOCR.ts — In-browser OCR with pluggable backend.
 *
 * Supports two backends:
 * - `"onnx"` (default): GPU-accelerated PP-OCRv4 via ONNX Runtime Web.
 *   Uses WebGPU when available, falls back to WASM. If models are missing
 *   or initialization fails, automatically degrades to the tesseract backend.
 * - `"tesseract"`: CPU WASM OCR via tesseract.js (legacy fallback).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createWorker } from "tesseract.js";
import type { OnnxOCR } from "../engine/OnnxOCR";

// --- Types -------------------------------------------------------------------

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;

/** Which OCR backend to use. */
export type OcrBackend = "onnx" | "tesseract";

export interface UseOCROptions {
  /** OCR backend to use. Defaults to "onnx". */
  backend?: OcrBackend;
  /** Tesseract language code, used when backend is "tesseract". */
  lang?: string;
}

export interface UseOCRResult {
  /** Run OCR on a canvas element or an image URL string. */
  recognize: (
    source: HTMLCanvasElement | string,
    lang?: string,
  ) => Promise<string>;
  /** Whether a recognition task is currently in progress. */
  isRecognizing: boolean;
  /** Error from the last recognition attempt, if any. */
  ocrError: string | null;
  /** Clear the last OCR error. */
  clearError: () => void;
  /** The active backend (may differ from requested if ONNX fell back). */
  activeBackend: OcrBackend;
}

// --- Tesseract worker cache --------------------------------------------------

const workerCache: Partial<Record<string, TesseractWorker>> = {};
const initPromise: Partial<Record<string, Promise<TesseractWorker>>> = {};

async function getWorker(lang: string): Promise<TesseractWorker> {
  if (workerCache[lang]) return workerCache[lang];
  initPromise[lang] ??= createWorker(lang).then((w) => {
    workerCache[lang] = w;
    delete initPromise[lang];
    return w;
  });
  return initPromise[lang];
}

// --- ONNX singleton ----------------------------------------------------------

let onnxInstance: OnnxOCR | null = null;
let onnxCreatePromise: Promise<OnnxOCR | null> | null = null;

/**
 * Get or create the shared OnnxOCR singleton.
 * Returns null if ONNX initialization fails (models missing, etc.).
 */
async function getOnnxInstance(): Promise<OnnxOCR | null> {
  if (onnxInstance) return onnxInstance;

  if (onnxCreatePromise) return onnxCreatePromise;

  onnxCreatePromise = (async () => {
    try {
      const { OnnxOCR } = await import("../engine/OnnxOCR");
      const instance = await OnnxOCR.create();
      // Probe that the models actually load by attempting a tiny recognition
      const probe = new ImageData(1, 1);
      await instance.recognizeCropped(probe);
      onnxInstance = instance;
      return instance;
    } catch (err) {
      console.warn(
        "[useOCR] ONNX backend unavailable, falling back to tesseract:",
        err,
      );
      return null;
    } finally {
      onnxCreatePromise = null;
    }
  })();

  return onnxCreatePromise;
}

// --- Hook --------------------------------------------------------------------

/**
 * useOCR provides in-browser OCR with configurable backend.
 *
 * @param optionsOrLang - Either a string (legacy tesseract lang code) or an
 *   options object with `backend` and `lang` fields.
 */
export function useOCR(
  optionsOrLang: string | UseOCROptions = {},
): UseOCRResult {
  const opts: UseOCROptions =
    typeof optionsOrLang === "string"
      ? { lang: optionsOrLang, backend: "tesseract" }
      : optionsOrLang;

  const { backend = "onnx", lang: defaultLang = "eng" } = opts;

  const [isRecognizing, setIsRecognizing] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [activeBackend, setActiveBackend] = useState<OcrBackend>(backend);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Sync activeBackend when backend prop changes
  useEffect(() => {
    setActiveBackend(backend);
  }, [backend]);

  const recognize = useCallback(
    async (
      source: HTMLCanvasElement | string,
      lang = defaultLang,
    ): Promise<string> => {
      if (isMounted.current) setIsRecognizing(true);
      if (isMounted.current) setOcrError(null);

      try {
        // Try ONNX backend first (if requested)
        if (backend === "onnx") {
          const onnx = await getOnnxInstance();
          if (onnx) {
            const imageData = sourceToImageData(source);
            const text = await onnx.recognizeCropped(imageData);
            if (isMounted.current) setActiveBackend("onnx");
            return text;
          }
          // ONNX unavailable — fall through to tesseract
          if (isMounted.current) setActiveBackend("tesseract");
        }

        // Tesseract fallback
        const worker = await getWorker(lang);
        const { data } = await worker.recognize(source);
        return data.text.trim();
      } catch (e: unknown) {
        const msg =
          e instanceof Error ? e.message : String(e) || "OCR failed";
        if (isMounted.current) setOcrError(msg);
        return "";
      } finally {
        if (isMounted.current) setIsRecognizing(false);
      }
    },
    [backend, defaultLang],
  );

  return {
    recognize,
    isRecognizing,
    ocrError,
    clearError: () => setOcrError(null),
    activeBackend,
  };
}

// --- Helpers -----------------------------------------------------------------

/**
 * Convert a canvas element or image URL to ImageData for the ONNX pipeline.
 * For URL sources, creates a temporary canvas.
 */
function sourceToImageData(source: HTMLCanvasElement | string): ImageData {
  if (source instanceof HTMLCanvasElement) {
    const ctx = source.getContext("2d");
    if (!ctx) throw new Error("Cannot get 2d context from canvas");
    return ctx.getImageData(0, 0, source.width, source.height);
  }

  // String source (data URL or regular URL) — draw onto offscreen canvas
  // Note: For synchronous use, the caller should prefer passing a canvas.
  // This path works for data URLs which are already loaded.
  const img = new Image();
  img.src = source;

  const canvas = new OffscreenCanvas(img.naturalWidth || 1, img.naturalHeight || 1);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
