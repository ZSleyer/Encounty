/**
 * useOCR.ts — In-browser OCR via tesseract.js (WASM, no external install required).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createWorker } from "tesseract.js";

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;

// Module-level cache: one worker per language.
const workerCache: Partial<Record<string, TesseractWorker>> = {};
const initPromise: Partial<Record<string, Promise<TesseractWorker>>> = {};

async function getWorker(lang: string): Promise<TesseractWorker> {
  if (workerCache[lang]) return workerCache[lang]!;
  if (!initPromise[lang]) {
    initPromise[lang] = createWorker(lang).then((w) => {
      workerCache[lang] = w;
      delete initPromise[lang];
      return w;
    });
  }
  return initPromise[lang]!;
}

export interface UseOCRResult {
  /** Run OCR on a canvas element or an image URL string. */
  recognize: (source: HTMLCanvasElement | string, lang?: string) => Promise<string>;
  /** Whether a recognition task is currently in progress. */
  isRecognizing: boolean;
  /** Error from the last recognition attempt, if any. */
  ocrError: string | null;
  /** Clear the last OCR error. */
  clearError: () => void;
}

/**
 * useOCR provides in-browser OCR via tesseract.js.
 * Language data is downloaded from CDN on first use (~4 MB) and cached.
 * @param defaultLang Tesseract language code, e.g. "eng", "deu", "fra".
 */
export function useOCR(defaultLang = "eng"): UseOCRResult {
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const recognize = useCallback(
    async (source: HTMLCanvasElement | string, lang = defaultLang): Promise<string> => {
      if (isMounted.current) setIsRecognizing(true);
      if (isMounted.current) setOcrError(null);
      try {
        const worker = await getWorker(lang);
        const { data } = await worker.recognize(source);
        return data.text.trim();
      } catch (e: any) {
        const msg = e?.message ?? String(e) ?? "OCR failed";
        if (isMounted.current) setOcrError(msg);
        return "";
      } finally {
        if (isMounted.current) setIsRecognizing(false);
      }
    },
    [defaultLang],
  );

  return {
    recognize,
    isRecognizing,
    ocrError,
    clearError: () => setOcrError(null),
  };
}
