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

/**
 * Local paths to bundled tesseract.js worker, core, and language assets.
 *
 * These are emitted by the `bundleTesseractAssets` Vite plugin so OCR does
 * not need network access at runtime. Without local assets, tesseract.js
 * fetches worker.min.js / tesseract-core*.wasm / *.traineddata.gz from
 * public CDNs, which fails behind firewalls and produces an opaque
 * "Failed to execute 'importScripts' on WorkerGlobalScope" error.
 */
const TESSERACT_ASSET_PATH = `${import.meta.env.BASE_URL}tesseract`;
const TESSDATA_PATH = `${import.meta.env.BASE_URL}tessdata`;

/**
 * Tesseract languages whose traineddata files are bundled into the app.
 * Other languages still work — they fall back to the tesseract.js default
 * langPath (jsdelivr CDN). Keep in sync with `BUNDLED_TRAINEDDATA` in
 * vite.config.ts.
 */
export const BUNDLED_OCR_LANGS = new Set(["eng", "deu", "spa", "fra", "jpn"]);

/** Get or lazily create a cached Tesseract worker for the given language. */
async function getWorker(lang: string): Promise<TesseractWorker> {
  if (workerCache[lang]) return workerCache[lang];
  // Only set langPath for languages we actually bundle. For unbundled
  // languages (e.g. ita, kor, chi_sim) leave langPath unset so tesseract.js
  // uses its default per-language CDN resolution.
  const config: Parameters<typeof createWorker>[2] = {
    workerPath: `${TESSERACT_ASSET_PATH}/worker.min.js`,
    corePath: TESSERACT_ASSET_PATH,
  };
  if (BUNDLED_OCR_LANGS.has(lang)) {
    config.langPath = TESSDATA_PATH;
  }
  initPromise[lang] ??= createWorker(lang, undefined, config).then((w) => {
    workerCache[lang] = w;
    delete initPromise[lang];
    return w;
  });
  return initPromise[lang];
}

/**
 * Eagerly initialize a Tesseract worker for the given language so the first
 * recognize() call does not pay the load latency. Safe to call repeatedly —
 * subsequent calls reuse the cached worker.
 */
export function preloadOcrLang(lang: string): void {
  void getWorker(lang).catch(() => {
    // Swallow preload errors — they will resurface (with the proper UI
    // feedback) on the next user-triggered recognize() call.
  });
}

/**
 * Detect the opaque tesseract.js worker init failure that happens when the
 * worker or core assets cannot be loaded, and replace it with an actionable
 * message. Other errors are returned unchanged.
 */
function describeOcrError(raw: string): string {
  if (/importScripts|Failed to fetch|NetworkError|Loading .*failed/i.test(raw)) {
    return `OCR assets could not be loaded — check your network or firewall (${raw})`;
  }
  return raw;
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
        const raw = e instanceof Error ? e.message : String(e) || "OCR failed";
        if (mounted()) setOcrError(describeOcrError(raw));
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
