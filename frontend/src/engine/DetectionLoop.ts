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
  /** Base polling interval in ms (default: DEFAULT_POLL_MS). */
  pollIntervalMs?: number;
  /** Fastest adaptive polling interval in ms (default: MIN_POLL_MS). */
  minPollMs?: number;
  /** Slowest adaptive polling interval in ms (default: MAX_POLL_MS). */
  maxPollMs?: number;
  /** Multiplier for hysteresis exit threshold (default: 0.7). */
  hysteresisFactor?: number;
  /** Minimum seconds before hysteresis can exit (default: 0). */
  cooldownSec?: number;
}

// --- Adaptive polling constants ----------------------------------------------

/** Fastest polling interval in ms (when score is near threshold). */
const MIN_POLL_MS = 150;
/** Slowest polling interval in ms (when scene is static). */
const MAX_POLL_MS = 500;
/** Default starting interval in ms. */
const DEFAULT_POLL_MS = 100;

// --- EMA smoothing constant --------------------------------------------------

/** Weight for the newest score in the exponential moving average. */
const EMA_ALPHA = 0.3;

/** Scores below this floor are mapped to zero to suppress metric noise. */
const NOISE_FLOOR = 0.15;

// --- DetectionLoop -----------------------------------------------------------

/** Per-pokemon detection loop that runs WebGPU/CPU template matching in the browser. */
export class DetectionLoop {
  private readonly pokemonId: string;
  private readonly detector: Detector;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private templates: any[] = [];
  private config: DetectionLoopConfig = {
    precision: 0.85,
    changeThreshold: 0.01,
    consecutiveHits: 3,
  };

  private running = false;
  private pollIntervalMs = DEFAULT_POLL_MS;
  private minPollMs = MIN_POLL_MS;
  private maxPollMs = MAX_POLL_MS;
  private hysteresisFactor = 0.7;
  private cooldownSec = 0;
  private hysteresisEnteredAt = 0;
  /** When true, score has dropped but we're waiting for the cooldown timer. */
  private inCooldown = false;
  private cooldownStartedAt = 0;
  private consecutiveCount = 0;
  private missCount = 0;
  private lastScore = 0;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  /** Last video.currentTime seen — used to skip detection when the frame hasn't changed. */
  private lastVideoTime = -1;

  /** Opaque frame buffer from the previous detection cycle (for GPU-level deduplication). */
  private previousFrameBuffer: unknown = null;

  /** Pending template replacement — picked up at the start of the next loop iteration. */
  private pendingTemplates: TemplateData[] | null = null;

  /** Smoothed score (EMA) used for live confidence display. */
  private smoothedScore = 0;

  /** When true, a match was just confirmed and we wait for the score to drop before re-triggering. */
  private inHysteresis = false;

  /** Optional callback for live score reporting. */
  private scoreCallback: ((score: number, state: string, cooldownRemainingMs?: number) => void) | null = null;

  // --- Throttle state for scoreCallback (UI store updates) -----------------
  private lastScoreCallbackTime = 0;
  private lastCallbackState = "";

  constructor(pokemonId: string, detector: Detector) {
    this.pokemonId = pokemonId;
    this.detector = detector;
  }

  /** Load or replace templates for matching. Safe to call while the loop is running. */
  loadTemplates(templates: TemplateData[]): void {
    if (this.running) {
      this.pendingTemplates = templates;
    } else {
      this.templates = templates;
    }
  }

  /** Register a callback for live score updates. */
  onScore(cb: (score: number, state: string, cooldownRemainingMs?: number) => void): void {
    this.scoreCallback = cb;
  }

  /** Update detection configuration (partial merge). */
  updateConfig(config: Partial<DetectionLoopConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.pollIntervalMs !== undefined) this.pollIntervalMs = config.pollIntervalMs;
    if (config.minPollMs !== undefined) this.minPollMs = config.minPollMs;
    if (config.maxPollMs !== undefined) this.maxPollMs = config.maxPollMs;
    if (config.hysteresisFactor !== undefined) this.hysteresisFactor = config.hysteresisFactor;
    if (config.cooldownSec !== undefined) this.cooldownSec = config.cooldownSec;
  }

  /**
   * Start the detection loop.
   * @param getVideo - Callback that returns the current video element (may return null if capture stopped).
   */
  start(getVideo: () => HTMLVideoElement | null): void {
    if (this.running) return;
    this.running = true;
    this.consecutiveCount = 0;
    this.missCount = 0;
    this.lastScore = 0;
    this.smoothedScore = 0;
    this.inHysteresis = false;
    this.hysteresisEnteredAt = 0;
    this.inCooldown = false;
    this.cooldownStartedAt = 0;
    this.pollIntervalMs = this.config.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.lastScoreCallbackTime = 0;
    this.lastCallbackState = "";
    this.lastVideoTime = -1;
    this.previousFrameBuffer = null;
    this.runLoop(getVideo);
  }

  /** Stop the detection loop. */
  stop(): void {
    this.running = false;
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    // Release GPU frame buffer if applicable
    if (this.previousFrameBuffer) {
      const buf = this.previousFrameBuffer;
      if (buf && typeof buf === 'object' && 'destroy' in buf && typeof (buf as { destroy: unknown }).destroy === 'function') {
        (buf as { destroy(): void }).destroy();
      }
      this.previousFrameBuffer = null;
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

    // Apply pending template swap at a safe point (between iterations)
    if (this.pendingTemplates) {
      this.templates = this.pendingTemplates;
      this.pendingTemplates = null;
    }

    const video = getVideo();
    const hasVideo = video && video.videoWidth > 0 && video.videoHeight > 0;
    const hasValidInput = hasVideo && this.templates.length > 0;

    // Auto-stop when the video source disappears (user disconnected capture)
    if (!hasVideo && this.templates.length > 0) {
      console.log("[Detection] Video source lost — stopping detection loop");
      this.stop();
      this.scoreCallback?.(0, "idle", undefined);
      return;
    }

    if (hasValidInput) {
      // Skip detection if the video frame hasn't changed since the last iteration
      if (video.currentTime === this.lastVideoTime) {
        if (!this.running) return;
        this.timeoutId = setTimeout(() => {
          if (!this.running) return;
          this.runLoop(getVideo);
        }, this.pollIntervalMs);
        return;
      }
      this.lastVideoTime = video.currentTime;

      try {
        const result: DetectorResult = await this.detector.detect(
          video,
          this.templates,
          {
            precision: this.config.precision,
            crop: this.config.crop,
            changeThreshold: this.config.changeThreshold,
            previousFrame: this.previousFrameBuffer,
          },
        );

        // Store frame buffer for next cycle's deduplication
        if (result.frameBuffer !== undefined) {
          const old = this.previousFrameBuffer;
          if (old && typeof old === 'object' && 'destroy' in old && typeof (old as { destroy: unknown }).destroy === 'function') {
            (old as { destroy(): void }).destroy();
          }
          this.previousFrameBuffer = result.frameBuffer;
        }

        const adjusted = this.applyNoiseFloor(result.bestScore);
        this.lastScore = adjusted;
        this.smoothedScore = EMA_ALPHA * adjusted + (1 - EMA_ALPHA) * this.smoothedScore;

        // Periodic score logging for debugging (every ~2s)
        if (Math.random() < 0.1) {
          console.log(`[Detection] raw=${result.bestScore.toFixed(3)} adj=${adjusted.toFixed(3)} smooth=${this.smoothedScore.toFixed(3)} poll=${this.pollIntervalMs}ms`);
        }

        const effectivePrecision = this.computeEffectivePrecision();
        const wasInHysteresis = this.inHysteresis;
        this.updateMatchState(adjusted, effectivePrecision);

        // Only notify the backend when a match is confirmed (hysteresis just entered)
        if (this.inHysteresis && !wasInHysteresis) {
          this.reportMatch(adjusted, result.frameDelta);
        }

        this.emitScoreCallback(adjusted, effectivePrecision);
        this.pollIntervalMs = this.computeNextInterval(adjusted, result.frameDelta);
      } catch (err) {
        console.error("[Detection] Error:", err);
        // Detection error — back off to avoid tight error loops
        this.pollIntervalMs = this.maxPollMs;
      }
    }

    if (!this.running) return;

    // Schedule next iteration via setTimeout only — no requestAnimationFrame
    // needed since detection doesn't require frame sync and rAF callbacks
    // block the browser's rendering pipeline while the async detect() runs.
    this.timeoutId = setTimeout(() => {
      if (!this.running) return;
      this.runLoop(getVideo);
    }, this.pollIntervalMs);
  }

  /**
   * Suppress metric noise by remapping low scores to zero.
   *
   * The hybrid metric fusion (SSIM+Pearson+MAD+Histogram) produces
   * 0.15-0.30 even for unrelated frames due to coarse histogram bins and
   * MAD normalization. This linear remap eliminates that visual noise.
   */
  private applyNoiseFloor(raw: number): number {
    if (raw <= NOISE_FLOOR) return 0;
    return (raw - NOISE_FLOOR) / (1 - NOISE_FLOOR);
  }

  /**
   * Update hysteresis and consecutive-hit state after scoring a frame.
   *
   * After a confirmed match, hysteresis blocks re-triggering until the
   * score drops well below the threshold (70% of precision).
   *
   * Uses a "near-consecutive" approach: a single below-threshold frame
   * between match frames is tolerated (miss counter) because short
   * encounter animations can produce intermittent low scores between
   * high-score frames at typical polling rates.
   */
  private updateMatchState(adjusted: number, effectivePrecision: number): void {
    // Phase 1: Hysteresis — wait for score to drop after a confirmed match
    if (this.inHysteresis) {
      const belowThreshold = adjusted < this.config.precision * this.hysteresisFactor;
      if (belowThreshold) {
        // Score dropped — transition to cooldown phase
        this.inHysteresis = false;
        this.inCooldown = true;
        this.cooldownStartedAt = Date.now();
      }
      this.consecutiveCount = 0;
      this.missCount = 0;
      return;
    }

    // Phase 2: Cooldown — wait for timer to elapse after hysteresis ended
    if (this.inCooldown) {
      const cooldownElapsed = Date.now() - this.cooldownStartedAt >= this.cooldownSec * 1000;
      if (cooldownElapsed) {
        this.inCooldown = false;
      }
      this.consecutiveCount = 0;
      this.missCount = 0;
      return;
    }

    // Phase 3: Normal detection — count consecutive matches
    if (adjusted >= effectivePrecision) {
      this.consecutiveCount += 1;
      this.missCount = 0;
    } else if (this.consecutiveCount > 0 && this.missCount < 1) {
      // Tolerate a single below-threshold frame between match frames
      this.missCount += 1;
    } else {
      this.consecutiveCount = 0;
      this.missCount = 0;
    }

    if (this.consecutiveCount >= this.config.consecutiveHits) {
      this.consecutiveCount = 0;
      this.missCount = 0;
      this.inHysteresis = true;
      this.hysteresisEnteredAt = Date.now();
    }
  }

  /** Throttled UI callback — fires at most 4 times/second unless the state changes. */
  private emitScoreCallback(adjusted: number, effectivePrecision: number): void {
    if (!this.scoreCallback) return;

    let state: string;
    if (this.inHysteresis) {
      state = "match";
    } else if (this.inCooldown) {
      state = "cooldown";
    } else if (adjusted >= effectivePrecision) {
      state = "match";
    } else {
      state = "idle";
    }

    const now = performance.now();
    const stateChanged = state !== this.lastCallbackState;
    // Fire immediately on state change or during cooldown (for countdown),
    // otherwise throttle to every 250ms to avoid excessive React re-renders.
    if (!stateChanged && state !== "cooldown" && now - this.lastScoreCallbackTime < 250) return;

    this.lastScoreCallbackTime = now;
    this.lastCallbackState = state;

    let cooldownRemainingMs: number | undefined;
    if (this.inCooldown) {
      const elapsed = Date.now() - this.cooldownStartedAt;
      cooldownRemainingMs = Math.max(0, this.cooldownSec * 1000 - elapsed);
    }

    this.scoreCallback(this.smoothedScore, state, cooldownRemainingMs);
  }

  /**
   * Compute the next polling interval based on the latest score and detection time.
   *
   * When the score is close to the threshold, poll faster to catch transitions.
   * When the scene is static (low score), slow down to save CPU/GPU.
   */
  private computeNextInterval(score: number, delta: number): number {
    const { precision, changeThreshold } = this.config;
    const min = this.minPollMs;
    const max = this.maxPollMs;

    // Static scene — slow down to max interval
    if (delta < (changeThreshold ?? 0.01)) {
      return max;
    }

    // How close the score is to the threshold (0 = far, 1 = at/above threshold)
    const proximity = Math.min(score / Math.max(precision, 0.01), 1);

    // Exponential interpolation: fast when close to match, slow when far
    const t = proximity * proximity;
    const interval = max - t * (max - min);

    return Math.round(Math.max(min, Math.min(max, interval)));
  }

  /**
   * Increment the encounter counter when a match is confirmed.
   *
   * Calls the REST increment endpoint directly instead of the detector
   * score endpoint, because the frontend already confirmed the match
   * via its own consecutive-hits + hysteresis logic.
   */
  private reportMatch(score: number, frameDelta: number): void {
    console.log(`[Detection] Match confirmed for ${this.pokemonId} — reporting to backend`);
    fetch(apiUrl(`/api/detector/${this.pokemonId}/match`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score, frame_delta: frameDelta }),
    }).catch(() => {
      // Non-critical — backend may be temporarily unreachable
    });
  }
}

// --- Global loop registry ----------------------------------------------------

/**
 * Module-level registry of active detection loops, keyed by pokemon ID.
 *
 * Survives React component unmount/remount cycles so loops persist across
 * tab switches and page navigation. Components use getActiveLoop / stopLoop
 * to interact with running loops without needing a component-level ref.
 */
const activeLoops = new Map<string, DetectionLoop>();

/** Register a loop in the global registry (replaces any existing loop for the same pokemon). */
export function registerLoop(pokemonId: string, loop: DetectionLoop): void {
  const existing = activeLoops.get(pokemonId);
  if (existing) existing.stop();
  activeLoops.set(pokemonId, loop);
}

/** Get the active loop for a pokemon, or null if none is running. */
export function getActiveLoop(pokemonId: string): DetectionLoop | null {
  return activeLoops.get(pokemonId) ?? null;
}

/** Stop and remove the loop for a pokemon. */
export function stopLoop(pokemonId: string): void {
  const loop = activeLoops.get(pokemonId);
  if (loop) {
    loop.stop();
    activeLoops.delete(pokemonId);
  }
}

/** Check if a detection loop is running for a pokemon. */
export function isLoopRunning(pokemonId: string): boolean {
  return activeLoops.has(pokemonId);
}
