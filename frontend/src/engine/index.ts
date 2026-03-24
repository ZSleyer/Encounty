/**
 * Detection engine barrel exports.
 *
 * Provides both WebGPU-accelerated and CPU fallback NCC template matching
 * engines with compatible interfaces for browser-based auto-detection.
 */

export { WebGPUDetector } from "./WebGPUDetector";
export { CPUDetector } from "./CPUDetector";
export { OnnxOCR } from "./OnnxOCR";
export type { DetectResult, TemplateData } from "./WebGPUDetector";

import type { TemplateData as _TemplateData } from "./WebGPUDetector";

/** Common detection result returned by both GPU and CPU engines. */
export interface DetectorResult {
  bestScore: number;
  frameDelta: number;
  templateIndex: number;
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
  destroy(): void;
}
