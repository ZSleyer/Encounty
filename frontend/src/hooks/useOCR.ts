/**
 * useOCR.ts — In-browser OCR using tesseract.js.
 *
 * Provides a React hook for text recognition from canvas elements or image URLs
 * using a cached Tesseract.js worker per language code.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createWorker } from "tesseract.js";

// --- Types -------------------------------------------------------------------

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;

export interface UseOCROptions {
  /** Tesseract language code (default "eng"). */
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
}

// --- Tesseract worker cache --------------------------------------------------

const workerCache: Partial<Record<string, TesseractWorker>> = {};
const initPromise: Partial<Record<string, Promise<TesseractWorker>>> = {};

/** Get or lazily create a cached Tesseract worker for the given language. */
async function getWorker(lang: string): Promise<TesseractWorker> {
  if (workerCache[lang]) return workerCache[lang];
  initPromise[lang] ??= createWorker(lang).then((w) => {
    workerCache[lang] = w;
    delete initPromise[lang];
    return w;
  });
  return initPromise[lang];
}

// --- Hook --------------------------------------------------------------------

/**
 * useOCR provides in-browser OCR via tesseract.js.
 *
 * @param optionsOrLang - Either a string (tesseract lang code) or an
 *   options object with a `lang` field.
 */
export function useOCR(
  optionsOrLang: string | UseOCROptions = {},
): UseOCRResult {
  const opts: UseOCROptions =
    typeof optionsOrLang === "string"
      ? { lang: optionsOrLang }
      : optionsOrLang;

  const { lang: defaultLang = "eng" } = opts;

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
    async (
      source: HTMLCanvasElement | string,
      lang = defaultLang,
    ): Promise<string> => {
      const mounted = () => isMounted.current;
      if (mounted()) setIsRecognizing(true);
      if (mounted()) setOcrError(null);

      try {
        const worker = await getWorker(lang);
        const { data } = await worker.recognize(source);
        return data.text.trim();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e) || "OCR failed";
        if (mounted()) setOcrError(msg);
        return "";
      } finally {
        if (mounted()) setIsRecognizing(false);
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
