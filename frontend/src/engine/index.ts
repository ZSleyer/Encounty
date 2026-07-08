/**
 * Detection engine barrel exports.
 *
 * Provides both WebGPU-accelerated and CPU fallback NCC template matching
 * engines with compatible interfaces for browser-based auto-detection.
 */

export { WebGPUDetector } from "./WebGPUDetector";
export { CPUDetector } from "./CPUDetector";
export { WorkerDetector } from "./WorkerDetector";
export type { DetectResult, TemplateData } from "./WebGPUDetector";

import type { TemplateData as _TemplateData } from "./WebGPUDetector";

/** Common detection result returned by both GPU and CPU engines. */
export interface DetectorResult {
  bestScore: number;
  frameDelta: number;
  templateIndex: number;
  /**
   * Per-category scores, keyed by category name. A category's score is the
   * best (max) across templates of the AND-combined (min) scores of that
   * category's regions. The default category uses the empty-string key and,
   * when it is the only category, equals bestScore (legacy behavior).
   */
  categoryScores?: Record<string, number>;
  /** Opaque frame buffer for deduplication — pass back as previousFrame on next cycle. */
  frameBuffer?: unknown;
}

/** Unified detector interface that both WebGPU and CPU detectors satisfy. */
export interface Detector {
  /** Load an image as a detection-ready template. Returns null if the template has near-zero variance. */
  loadTemplate(
    imageSource: ImageData | ImageBitmap,
    regions?: Array<{ type: string; rect: { x: number; y: number; w: number; h: number } }>,
  ): _TemplateData | null | Promise<_TemplateData | null>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detect(source: HTMLVideoElement, templates: any[], config: any): Promise<DetectorResult>;
  /**
   * Release the resources held by a loaded template. Only detectors whose
   * templates hold GPU buffers implement this; CPU-based detectors rely on
   * garbage collection. Ownership of loaded templates passes to
   * DetectionLoop.loadTemplates(), which calls this on replace and stop.
   */
  releaseTemplate?(template: _TemplateData): void;
  /** Detector-level diagnostics for the dev perf modal. */
  getStats?(): { queueWaitMsEMA: number };
  destroy(): void;
}
