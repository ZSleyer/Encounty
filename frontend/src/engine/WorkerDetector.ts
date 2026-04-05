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

  /** Hidden video element used exclusively for frame capture, isolated from the preview. */
  private captureVideo: HTMLVideoElement | null = null;

  private constructor(worker: Worker) {
    this.worker = worker;

    this.worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.cmd === "detect") {
        if (msg.error) {
          this.pendingDetect?.reject(new Error(msg.error));
        } else {
          this.pendingDetect?.resolve(msg.result);
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

    // Return a stub TemplateData — the real one lives in the worker.
    // The stub carries the minimum fields needed by DetectionLoop.
    return {
      gray: new Float32Array(0),
      width: imageData.width,
      height: imageData.height,
      mean: 0,
      stdDev: 1,
      pixelCount: imageData.width * imageData.height,
      regions: regions ?? [],
    } as TemplateData;
  }

  /**
   * Run detection against the current video frame.
   *
   * Uses a hidden video element that mirrors the source stream to avoid
   * interfering with the preview <video> element's rendering. Captures
   * the frame as ImageBitmap and transfers it to the worker.
   */
  async detect(
    source: HTMLVideoElement,
    _templates: TemplateData[],
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
        { cmd: "detect", frame: bitmap, config },
        [bitmap],
      );
    });
  }

  /** Shut down the worker and release resources. */
  destroy(): void {
    this.worker.postMessage({ cmd: "destroy" });
    this.worker.terminate();
    this.ready = false;

    if (this.captureVideo) {
      this.captureVideo.pause();
      this.captureVideo.srcObject = null;
      this.captureVideo.removeAttribute("src");
      this.captureVideo = null;
    }
  }

  // --- Private helpers -------------------------------------------------------

  /**
   * Get or create a hidden video element that mirrors the source's stream.
   *
   * For MediaStream sources (screen capture, camera), the stream is cloned
   * so the preview and detection pipelines are fully independent. For file
   * sources (development mode), the same src URL is shared since file
   * playback is frame-buffered and not affected by concurrent reads.
   */
  private getOrCreateCaptureVideo(source: HTMLVideoElement): HTMLVideoElement {
    if (this.captureVideo) {
      this.syncCaptureSource(source);
      return this.captureVideo;
    }

    const el = document.createElement("video");
    el.autoplay = true;
    el.muted = true;
    el.playsInline = true;
    // Keep hidden — do not append to DOM
    this.captureVideo = el;
    this.syncCaptureSource(source);
    return el;
  }

  /** Ensure the hidden capture video mirrors the source's current stream or file. */
  private syncCaptureSource(source: HTMLVideoElement): void {
    const el = this.captureVideo!;
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
