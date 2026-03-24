/**
 * DetectionLoop.ts — Per-pokemon detection loop running in the browser.
 *
 * Grabs frames from a CaptureService video element and runs them through
 * a WebGPU (or CPU fallback) detector. When a match exceeds the precision
 * threshold for enough consecutive frames, it POSTs a match notification
 * to the Go backend.
 *
 * Polling is adaptive: fast near a potential match, slow when the scene
 * is static.
 */
import type { Detector, DetectorResult, TemplateData } from "../engine";
import { apiUrl } from "../utils/api";

// --- Types -------------------------------------------------------------------

/** Rectangular crop region in pixel coordinates. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Configuration for the detection loop. */
interface DetectionLoopConfig {
  /** NCC score threshold for a positive match (0.0–1.0). */
  precision: number;
  /** Optional crop region applied before detection. */
  crop?: Rect;
  /** Minimum pixel-level change between frames to trigger detection (0.0–1.0). */
  changeThreshold: number;
  /** Number of consecutive frames above precision to confirm a match. */
  consecutiveHits: number;
}

// --- Adaptive polling constants ----------------------------------------------

/** Fastest polling interval in ms (when score is near threshold). */
const MIN_POLL_MS = 30;
/** Slowest polling interval in ms (when scene is static). */
const MAX_POLL_MS = 500;
/** Default starting interval in ms. */
const DEFAULT_POLL_MS = 100;

// --- DetectionLoop -----------------------------------------------------------

/** Per-pokemon detection loop that runs WebGPU/CPU template matching in the browser. */
export class DetectionLoop {
  private pokemonId: string;
  private detector: Detector;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private templates: any[] = [];
  private config: DetectionLoopConfig = {
    precision: 0.85,
    changeThreshold: 0.01,
    consecutiveHits: 3,
  };

  private running = false;
  private pollIntervalMs = DEFAULT_POLL_MS;
  private consecutiveCount = 0;
  private lastScore = 0;
  private rafId: number | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private onScoreCallback: ((score: number, state: string) => void) | null = null;

  constructor(pokemonId: string, detector: Detector) {
    this.pokemonId = pokemonId;
    this.detector = detector;
  }

  /** Register a callback for live score updates (called every detection cycle). */
  onScore(cb: (score: number, state: string) => void): void {
    this.onScoreCallback = cb;
  }

  /** Load or replace templates for matching. */
  loadTemplates(templates: TemplateData[]): void {
    this.templates = templates;
  }

  /** Update detection configuration (partial merge). */
  updateConfig(config: Partial<DetectionLoopConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Start the detection loop.
   * @param getVideo - Callback that returns the current video element (may return null if capture stopped).
   */
  start(getVideo: () => HTMLVideoElement | null): void {
    if (this.running) return;
    this.running = true;
    this.consecutiveCount = 0;
    this.lastScore = 0;
    this.pollIntervalMs = DEFAULT_POLL_MS;
    this.runLoop(getVideo);
  }

  /** Stop the detection loop. */
  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  // --- Internal loop ---------------------------------------------------------

  private async runLoop(getVideo: () => HTMLVideoElement | null): Promise<void> {
    if (!this.running) return;

    const video = getVideo();

    // Auto-stop when the video element disappears (stream ended or capture stopped)
    if (!video) {
      this.stop();
      return;
    }

    const loopStart = performance.now();

    if (video.videoWidth > 0 && video.videoHeight > 0 && this.templates.length > 0) {
      try {
        const result: DetectorResult = await this.detector.detect(
          video,
          this.templates,
          {
            precision: this.config.precision,
            crop: this.config.crop,
            changeThreshold: this.config.changeThreshold,
          },
        );

        const delta = performance.now() - loopStart;
        this.lastScore = result.bestScore;

        if (result.bestScore >= this.config.precision) {
          this.consecutiveCount += 1;
        } else {
          this.consecutiveCount = 0;
        }

        // Confirmed match — notify backend only when consecutive threshold is met
        if (this.consecutiveCount >= this.config.consecutiveHits) {
          this.consecutiveCount = 0;
          this.reportScore(result.bestScore, result.frameDelta);
        }

        // Report live score to the frontend for confidence badge display
        const state = this.consecutiveCount > 0 ? "match_active" : "idle";
        this.onScoreCallback?.(result.bestScore, state);

        this.pollIntervalMs = this.computeNextInterval(result.bestScore, result.frameDelta);
      } catch {
        // Detection error — back off to avoid tight error loops
        this.pollIntervalMs = MAX_POLL_MS;
      }
    }

    if (!this.running) return;

    // Schedule next iteration: use rAF for frame sync, then setTimeout for interval timing
    this.timeoutId = setTimeout(() => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(() => {
        this.runLoop(getVideo);
      });
    }, this.pollIntervalMs);
  }

  /**
   * Compute the next polling interval based on the latest score and detection time.
   *
   * When the score is close to the threshold, poll faster to catch transitions.
   * When the scene is static (low score), slow down to save CPU/GPU.
   */
  private computeNextInterval(score: number, _delta: number): number {
    const { precision } = this.config;

    // How close the score is to the threshold (0 = far, 1 = at/above threshold)
    const proximity = Math.min(score / Math.max(precision, 0.01), 1);

    // Exponential interpolation: fast when close to match, slow when far
    const t = proximity * proximity;
    const interval = MAX_POLL_MS - t * (MAX_POLL_MS - MIN_POLL_MS);

    return Math.round(Math.max(MIN_POLL_MS, Math.min(MAX_POLL_MS, interval)));
  }

  /** POST the current detection score to the backend for state machine processing. */
  private reportScore(score: number, frameDelta: number): void {
    fetch(apiUrl(`/api/detector/${this.pokemonId}/match`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score, frame_delta: frameDelta }),
    }).catch(() => {
      // Non-critical — backend may be temporarily unreachable
    });
  }
}
