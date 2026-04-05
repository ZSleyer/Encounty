/**
 * useTemplateTest — CPU-based template testing against replay buffer frames.
 *
 * Provides batch scoring (sampled frames via requestIdleCallback chunking) and
 * synchronous single-frame scoring for responsive scrubbing. Used in the "Test"
 * step (step 4) of the template creation flow.
 */

import { useState, useRef, useCallback } from "react";
import type { MatchedRegion } from "../types";
import {
  scoreRegionHybrid,
  andLogicAcrossRegions,
  adaptiveBlockSizeForRegion,
} from "../engine/math";

// --- Types ---

/** Score result for a single frame. */
export interface TemplateTestResult {
  frameIndex: number;
  overallScore: number;
  regionScores: { index: number; score: number }[];
}

export interface UseTemplateTestResult {
  /** Run batch scoring on sampled frames from the buffer. */
  runBatch: (
    templateCanvas: HTMLCanvasElement,
    regions: MatchedRegion[],
    getFrame: (i: number) => ImageData | null,
    frameCount: number,
  ) => void;
  /** Score a single frame synchronously (for scrubbing). */
  scoreFrame: (
    templateCanvas: HTMLCanvasElement,
    regions: MatchedRegion[],
    frame: ImageData,
  ) => TemplateTestResult;
  /** All batch results keyed by frame index. */
  batchResults: Map<number, TemplateTestResult>;
  /** Whether batch scoring is running. */
  isRunning: boolean;
  /** Batch progress 0–1. */
  progress: number;
  /** Current single-frame result (from scrubbing). */
  currentResult: TemplateTestResult | null;
  /** Cancel a running batch. */
  cancel: () => void;
  /** Best overall score from batch results. */
  bestScore: number;
}

// --- Helpers ---

/** Convert RGBA ImageData to a grayscale Float32Array. */
function rgbaToGray(imageData: ImageData): Float32Array {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const ri = i * 4;
    gray[i] = 0.299 * data[ri] + 0.587 * data[ri + 1] + 0.114 * data[ri + 2];
  }
  return gray;
}

/** Read a canvas element into a grayscale Float32Array with dimensions. */
function canvasToGray(canvas: HTMLCanvasElement): {
  gray: Float32Array;
  width: number;
  height: number;
} {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { gray: new Float32Array(0), width: 0, height: 0 };
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { gray: rgbaToGray(imageData), width: canvas.width, height: canvas.height };
}

/** Crop a rectangular region from a grayscale buffer. */
function cropGray(
  gray: Float32Array,
  srcWidth: number,
  x: number,
  y: number,
  w: number,
  h: number,
): Float32Array {
  const crop = new Float32Array(w * h);
  for (let row = 0; row < h; row++) {
    const srcOffset = (y + row) * srcWidth + x;
    crop.set(gray.subarray(srcOffset, srcOffset + w), row * w);
  }
  return crop;
}

/** Score all regions of a single frame against the template. */
function scoreOneFrame(
  frameGray: Float32Array,
  frameWidth: number,
  tmplGray: Float32Array,
  tmplWidth: number,
  regions: MatchedRegion[],
  frameIndex: number,
): TemplateTestResult {
  const regionScores: { index: number; score: number }[] = [];

  for (let i = 0; i < regions.length; i++) {
    const { x, y, w, h } = regions[i].rect;
    const frameCrop = cropGray(frameGray, frameWidth, x, y, w, h);
    const tmplCrop = cropGray(tmplGray, tmplWidth, x, y, w, h);
    const blockSize = adaptiveBlockSizeForRegion(w, h);
    const score = scoreRegionHybrid(frameCrop, tmplCrop, w, h, blockSize);
    regionScores.push({ index: i, score });
  }

  const overallScore = andLogicAcrossRegions(regionScores.map((r) => r.score));
  return { frameIndex, overallScore, regionScores };
}

// --- Constants ---

/** Sample every Nth frame to keep batch scoring fast. */
const SAMPLE_INTERVAL = 5;

/** Number of frames to process per idle callback chunk. */
const CHUNK_SIZE = 4;

// --- Hook ---

/**
 * Hook for CPU-based template testing against replay buffer frames.
 *
 * Provides both batch scoring (sampled, chunked via requestIdleCallback) and
 * synchronous single-frame scoring for responsive scrubbing during template
 * creation.
 */
export function useTemplateTest(): UseTemplateTestResult {
  const [batchResults, setBatchResults] = useState<Map<number, TemplateTestResult>>(
    () => new Map(),
  );
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentResult, setCurrentResult] = useState<TemplateTestResult | null>(null);
  const [bestScore, setBestScore] = useState(0);

  // Cancellation flag for the current batch run
  const cancelledRef = useRef(false);

  // Cached template grayscale to avoid re-converting on every scoreFrame call
  const tmplCacheRef = useRef<{
    canvas: HTMLCanvasElement;
    gray: Float32Array;
    width: number;
    height: number;
  } | null>(null);

  /** Get or compute cached template grayscale data. */
  const getTemplateGray = useCallback(
    (canvas: HTMLCanvasElement): { gray: Float32Array; width: number; height: number } => {
      const cached = tmplCacheRef.current;
      if (cached?.canvas === canvas) {
        return { gray: cached.gray, width: cached.width, height: cached.height };
      }
      const result = canvasToGray(canvas);
      tmplCacheRef.current = { canvas, ...result };
      return result;
    },
    [],
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  const scoreFrame = useCallback(
    (
      templateCanvas: HTMLCanvasElement,
      regions: MatchedRegion[],
      frame: ImageData,
    ): TemplateTestResult => {
      const tmpl = getTemplateGray(templateCanvas);
      const frameGray = rgbaToGray(frame);
      const result = scoreOneFrame(frameGray, frame.width, tmpl.gray, tmpl.width, regions, 0);
      setCurrentResult(result);
      return result;
    },
    [getTemplateGray],
  );

  const runBatch = useCallback(
    (
      templateCanvas: HTMLCanvasElement,
      regions: MatchedRegion[],
      getFrame: (i: number) => ImageData | null,
      frameCount: number,
    ) => {
      // Reset state for a new batch
      cancelledRef.current = false;
      setIsRunning(true);
      setProgress(0);
      setBestScore(0);
      const results = new Map<number, TemplateTestResult>();
      setBatchResults(results);

      // Invalidate cache so a fresh template grayscale is computed.
      // The canvas ref stays the same even when its content changes (new frame).
      tmplCacheRef.current = null;
      const tmpl = getTemplateGray(templateCanvas);

      // Build the list of sampled frame indices
      const indices: number[] = [];
      for (let i = 0; i < frameCount; i += SAMPLE_INTERVAL) {
        indices.push(i);
      }

      const totalFrames = indices.length;
      if (totalFrames === 0) {
        setIsRunning(false);
        setProgress(1);
        return;
      }

      let cursor = 0;
      let runningBest = 0;

      /** Process a chunk of frames in one idle callback. */
      const processChunk = (_deadline?: IdleDeadline) => {
        if (cancelledRef.current) {
          setIsRunning(false);
          return;
        }

        const chunkEnd = Math.min(cursor + CHUNK_SIZE, totalFrames);

        for (let c = cursor; c < chunkEnd; c++) {
          if (cancelledRef.current) {
            setIsRunning(false);
            return;
          }

          const idx = indices[c];
          const frame = getFrame(idx);
          if (!frame) continue;

          const frameGray = rgbaToGray(frame);
          const result = scoreOneFrame(
            frameGray,
            frame.width,
            tmpl.gray,
            tmpl.width,
            regions,
            idx,
          );
          results.set(idx, result);

          if (result.overallScore > runningBest) {
            runningBest = result.overallScore;
          }
        }

        cursor = chunkEnd;
        const currentProgress = cursor / totalFrames;
        setProgress(currentProgress);
        setBatchResults(new Map(results));
        setBestScore(runningBest);

        if (cursor >= totalFrames) {
          setIsRunning(false);
          setProgress(1);
          return;
        }

        // Schedule the next chunk. Use deadline-aware scheduling when available,
        // otherwise fall back to a short timeout to keep the UI responsive.
        if (typeof requestIdleCallback === "undefined") {
          setTimeout(() => processChunk(), 0);
        } else {
          requestIdleCallback(processChunk);
        }
      };

      // Kick off the first chunk
      if (typeof requestIdleCallback === "undefined") {
        setTimeout(() => processChunk(), 0);
      } else {
        requestIdleCallback(processChunk);
      }
    },
    [getTemplateGray],
  );

  return {
    runBatch,
    scoreFrame,
    batchResults,
    isRunning,
    progress,
    currentResult,
    cancel,
    bestScore,
  };
}
