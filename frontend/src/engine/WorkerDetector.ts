/**
 * WorkerDetector — Main-thread wrapper that delegates CPUDetector to a Web Worker.
 *
 * Implements the same Detector interface as CPUDetector but runs all heavy
 * computation in a dedicated worker thread. Video frames are captured via
 * a hidden video element (separate from the displayed preview) to avoid
 * interfering with the rendering pipeline.
 */
import type { DetectorResult } from "./index";
import type { TemplateData } from "./WebGPUDetector";
import { AsyncMutex } from "../utils/asyncMutex";

// --- WorkerDetector ----------------------------------------------------------

/** Worker-based CPU detection that offloads matching to a background thread. */
export class WorkerDetector {
  private readonly worker: Worker;
  private ready = false;
  private nextTemplateId = 0;
  private pendingDetect: {
    resolve: (r: DetectorResult) => void;
    reject: (e: Error) => void;
  } | null = null;

  /**
   * Serializes detect() calls. The worker protocol correlates exactly one
   * in-flight detect with its response, so concurrent detection loops
   * would otherwise supersede each other's requests on every frame.
   */
  private readonly detectMutex = new AsyncMutex();

  /** EMA-smoothed time detect() callers spend waiting on the mutex (ms). */
  private queueWaitMsEMA = 0;

  /**
   * Hidden video elements used exclusively for frame capture, isolated from
   * the preview. Keyed by source element, since every hunt has its own
   * capture stream and a single shared element would keep serving the
   * first hunt's stream to all others.
   */
  private readonly captureVideos = new Map<HTMLVideoElement, HTMLVideoElement>();

  private constructor(worker: Worker) {
    this.worker = worker;

    this.worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.cmd === "detect") {
        if (msg.error) {
          this.pendingDetect?.reject(new Error(msg.error));
        } else {
          // The worker returns the full DetectResult, including the optional
          // per-category scores; forward it as the DetectorResult.
          const result = msg.result as DetectorResult;
          this.pendingDetect?.resolve({
            bestScore: result.bestScore,
            frameDelta: result.frameDelta,
            templateIndex: result.templateIndex,
            categoryScores: result.categoryScores,
          });
        }
        this.pendingDetect = null;
      }
    };
  }

  /**
   * Create and initialize a WorkerDetector.
   *
   * Spawns the Web Worker, sends an init command, and waits for confirmation
   * before resolving. Throws if the worker fails to start.
   */
  static async create(): Promise<WorkerDetector> {
    const worker = new Worker(
      new URL("./detection.worker.ts", import.meta.url),
      { type: "module" },
    );

    const detector = new WorkerDetector(worker);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Worker init timed out")), 5000);
      const origHandler = detector.worker.onmessage;
      detector.worker.onmessage = (e: MessageEvent) => {
        if (e.data.cmd === "init" && e.data.ok) {
          clearTimeout(timeout);
          detector.ready = true;
          detector.worker.onmessage = origHandler;
          resolve();
        }
      };
      detector.worker.onerror = (err) => {
        clearTimeout(timeout);
        reject(new Error(err.message || "Worker initialization failed"));
      };
      worker.postMessage({ cmd: "init" });
    });

    return detector;
  }

  /** Check if Web Workers and OffscreenCanvas are available. */
  static isAvailable(): boolean {
    return typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
  }

  /**
   * Load a template image for matching.
   *
   * The image data is serialized and sent to the worker where the real
   * CPUDetector.loadTemplate runs. Returns a stub TemplateData with the
   * correct dimensions so DetectionLoop can track templates.
   */
  loadTemplate(
    imageSource: ImageData | ImageBitmap,
    regions?: Array<{
      type: string;
      rect: { x: number; y: number; w: number; h: number };
      category?: string;
    }>,
  ): TemplateData | null {
    // Convert ImageBitmap to ImageData for structured-clone transfer
    let imageData: ImageData;
    if (imageSource instanceof ImageData) {
      imageData = imageSource;
    } else {
      const c = new OffscreenCanvas(imageSource.width, imageSource.height);
      const cx = c.getContext("2d");
      if (!cx) return null;
      cx.drawImage(imageSource, 0, 0);
      imageData = cx.getImageData(0, 0, c.width, c.height);
    }

    const id = this.nextTemplateId++;
    this.worker.postMessage({ cmd: "loadTemplate", id, imageData, regions });

    // Return a stub TemplateData, the real one lives in the worker.
    // The stub carries the minimum fields needed by DetectionLoop plus the
    // worker-side id so detect() can select and releaseTemplate() can free it.
    return {
      gray: new Float32Array(0),
      width: imageData.width,
      height: imageData.height,
      mean: 0,
      stdDev: 1,
      pixelCount: imageData.width * imageData.height,
      regions: regions ?? [],
      workerId: id,
    } as TemplateData;
  }

  /**
   * Free a template in the worker. Without this, templates from stopped or
   * reloaded hunts accumulate in the worker and keep being matched.
   */
  releaseTemplate(template: TemplateData): void {
    if (template.workerId !== undefined) {
      this.worker.postMessage({ cmd: "releaseTemplate", id: template.workerId });
    }
  }

  /** Detector statistics for diagnostics (consumed by the dev perf modal). */
  getStats(): { queueWaitMsEMA: number } {
    return { queueWaitMsEMA: this.queueWaitMsEMA };
  }

  /**
   * Run detection against the current video frame.
   *
   * Uses a hidden video element that mirrors the source stream to avoid
   * interfering with the preview <video> element's rendering. Captures
   * the frame as ImageBitmap and transfers it to the worker. Calls are
   * serialized via detectMutex because the worker protocol supports only
   * one in-flight detect at a time.
   */
  async detect(
    source: HTMLVideoElement,
    templates: TemplateData[],
    config: {
      precision: number;
      crop?: { x: number; y: number; w: number; h: number };
      changeThreshold?: number;
    },
  ): Promise<DetectorResult> {
    const waitStart = performance.now();
    return this.detectMutex.runExclusive(() => {
      const waited = performance.now() - waitStart;
      this.queueWaitMsEMA =
        this.queueWaitMsEMA === 0 ? waited : 0.2 * waited + 0.8 * this.queueWaitMsEMA;
      return this.detectInternal(source, templates, config);
    });
  }

  /** Detection body; must only run under detectMutex. */
  private async detectInternal(
    source: HTMLVideoElement,
    templates: TemplateData[],
    config: {
      precision: number;
      crop?: { x: number; y: number; w: number; h: number };
      changeThreshold?: number;
    },
  ): Promise<DetectorResult> {
    if (!this.ready) throw new Error("WorkerDetector not initialized");

    const captureEl = this.getOrCreateCaptureVideo(source);
    const w = captureEl.videoWidth;
    const h = captureEl.videoHeight;
    if (w === 0 || h === 0) {
      return { bestScore: 0, frameDelta: 0, templateIndex: 0 };
    }

    const bitmap = await createImageBitmap(captureEl);

    // Reject any previous pending detect that was never resolved (e.g. worker stall)
    if (this.pendingDetect) {
      this.pendingDetect.reject(new Error("Superseded by new detect call"));
      this.pendingDetect = null;
    }

    // Restrict matching to this call's templates: the worker holds templates
    // of every hunt, and matching all of them would cross-count encounters.
    const templateIds = templates
      .map((t) => t.workerId)
      .filter((id): id is number => id !== undefined);

    return new Promise<DetectorResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingDetect?.reject === reject) {
          this.pendingDetect = null;
          reject(new Error("detect() timed out after 5 s"));
        }
      }, 5000);

      this.pendingDetect = {
        resolve: (r) => { clearTimeout(timeout); resolve(r); },
        reject: (e) => { clearTimeout(timeout); reject(e); },
      };
      this.worker.postMessage(
        { cmd: "detect", frame: bitmap, config, templateIds },
        [bitmap],
      );
    });
  }

  /** Shut down the worker and release resources. */
  destroy(): void {
    this.worker.postMessage({ cmd: "destroy" });
    this.worker.terminate();
    this.ready = false;

    for (const el of this.captureVideos.values()) {
      el.pause();
      el.srcObject = null;
      el.removeAttribute("src");
    }
    this.captureVideos.clear();
  }

  // --- Private helpers -------------------------------------------------------

  /**
   * Get or create the hidden video element that mirrors the source's stream.
   *
   * One capture element exists per source element, so hunts with different
   * capture streams never read each other's frames. For MediaStream sources
   * (screen capture, camera), the stream is cloned so the preview and
   * detection pipelines are fully independent. For file sources
   * (development mode), the same src URL is shared since file playback is
   * frame-buffered and not affected by concurrent reads.
   */
  private getOrCreateCaptureVideo(source: HTMLVideoElement): HTMLVideoElement {
    let el = this.captureVideos.get(source);
    if (!el) {
      el = document.createElement("video");
      el.autoplay = true;
      el.muted = true;
      el.playsInline = true;
      // Keep hidden, do not append to DOM
      this.captureVideos.set(source, el);
    }
    this.syncCaptureSource(source, el);
    return el;
  }

  /** Ensure the hidden capture video mirrors the source's current stream or file. */
  private syncCaptureSource(source: HTMLVideoElement, el: HTMLVideoElement): void {
    const stream = source.srcObject as MediaStream | null;

    if (stream) {
      // MediaStream: clone to isolate from the preview element
      if (el.srcObject !== stream && !(el.srcObject instanceof MediaStream)) {
        el.srcObject = stream.clone();
      }
    } else if (source.src) {
      if (el.src !== source.src) {
        // File source (dev mode): share the URL
        el.src = source.src;
      }
      // Keep playback position synced with the displayed video
      if (Math.abs(el.currentTime - source.currentTime) > 0.5) {
        el.currentTime = source.currentTime;
      }
    }
  }
}
