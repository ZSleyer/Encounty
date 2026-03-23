/**
 * Detection engine barrel exports.
 *
 * Provides both WebGPU-accelerated and CPU fallback NCC template matching
 * engines with compatible interfaces for browser-based auto-detection.
 */

export { WebGPUDetector } from "./WebGPUDetector";
export { CPUDetector } from "./CPUDetector";
export type { DetectResult, TemplateData } from "./WebGPUDetector";

/** Common detection result returned by both GPU and CPU engines. */
export interface DetectorResult {
  bestScore: number;
  frameDelta: number;
  templateIndex: number;
}

/** Unified detector interface that both WebGPU and CPU detectors satisfy. */
export interface Detector {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detect(source: HTMLVideoElement, templates: any[], config: any): Promise<DetectorResult>;
  destroy(): void;
}
