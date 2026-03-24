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
 *
 * Includes temporal coherence features:
 * - Exponential Moving Average (EMA) for smoothed confidence display
 * - Hysteresis to prevent double-counting near the threshold
 * - Adaptive threshold that adjusts precision based on region size
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

/** Region definition for adaptive threshold computation. */
interface Region {
  rect: Rect;
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
  /** Whether to adjust precision based on region size (default: true). */
  adaptiveThreshold?: boolean;
  /** Template regions used for adaptive threshold computation. */
  regions?: Region[];
}

// --- Adaptive polling constants ----------------------------------------------

/** Fastest polling interval in ms (when score is near threshold). */
const MIN_POLL_MS = 30;
/** Slowest polling interval in ms (when scene is static). */
const MAX_POLL_MS = 500;
/** Default starting interval in ms. */
const DEFAULT_POLL_MS = 100;

// --- EMA smoothing constant --------------------------------------------------

/** Weight for the newest score in the exponential moving average. */
const EMA_ALPHA = 0.3;

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

  /** Smoothed score (EMA) used for live confidence display. */
  private smoothedScore = 0;

  /** When true, a match was just confirmed and we wait for the score to drop before re-triggering. */
  private inHysteresis = false;

  /** Optional callback for live score reporting. */
  private scoreCallback: ((score: number, state: string) => void) | null = null;

  constructor(pokemonId: string, detector: Detector) {
    this.pokemonId = pokemonId;
    this.detector = detector;
  }

  /** Load or replace templates for matching. */
  loadTemplates(templates: TemplateData[]): void {
    this.templates = templates;
  }

  /** Register a callback for live score updates. */
  onScore(cb: (score: number, state: string) => void): void {
    this.scoreCallback = cb;
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
    this.smoothedScore = 0;
    this.inHysteresis = false;
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

  /**
   * Compute the effective precision, optionally adjusted for region size.
   *
   * Larger regions tend to produce slightly lower NCC scores due to more
   * background noise, so we reduce the threshold proportionally (capped).
   */
  private computeEffectivePrecision(): number {
    const { precision, adaptiveThreshold, regions } = this.config;

    // Adaptive threshold is enabled by default unless explicitly disabled
    if (adaptiveThreshold === false || !regions || regions.length === 0) {
      return precision;
    }

    const regionArea = regions.reduce((sum, r) => sum + r.rect.w * r.rect.h, 0);
    const adjustment = 0.05 * Math.min(regionArea / 500_000, 0.2);
    return precision - adjustment;
  }

  private async runLoop(getVideo: () => HTMLVideoElement | null): Promise<void> {
    if (!this.running) return;

    const video = getVideo();

    if (video && video.videoWidth > 0 && video.videoHeight > 0 && this.templates.length > 0) {
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

        const rawScore = result.bestScore;
        this.lastScore = rawScore;

        // Update the smoothed score (EMA) for live confidence display
        this.smoothedScore = EMA_ALPHA * rawScore + (1 - EMA_ALPHA) * this.smoothedScore;

        const effectivePrecision = this.computeEffectivePrecision();

        // Hysteresis: after a confirmed match, require the score to drop
        // well below the threshold before allowing a new match sequence
        if (this.inHysteresis) {
          if (rawScore < this.config.precision * 0.7) {
            this.inHysteresis = false;
          }
          // Reset consecutive counter while in hysteresis to avoid double-counting
          this.consecutiveCount = 0;
        } else if (rawScore >= effectivePrecision) {
          this.consecutiveCount += 1;
        } else {
          this.consecutiveCount = 0;
        }

        // Confirmed match — reset counter and enter hysteresis
        if (this.consecutiveCount >= this.config.consecutiveHits) {
          this.consecutiveCount = 0;
          this.inHysteresis = true;
        }

        // Report the smoothed score for live confidence display,
        // but the backend uses the raw score for state machine decisions.
        this.reportScore(this.smoothedScore, result.frameDelta);

        // Notify live score callback for UI updates
        const state = this.inHysteresis ? "cooldown" : rawScore >= effectivePrecision ? "match" : "idle";
        this.scoreCallback?.(this.smoothedScore, state);

        this.pollIntervalMs = this.computeNextInterval(rawScore, result.frameDelta);
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
