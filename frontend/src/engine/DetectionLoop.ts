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
  /**
   * Measured precision recommendation from template stability calibration
   * (min across loaded templates). When present it replaces the region-size
   * heuristic; the configured precision remains the upper bound.
   */
  calibratedPrecision?: number;
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

/**
 * Per-category match state.
 *
 * Each counting category (see MatchedRegion.category) advances its own
 * consecutive-hit, hysteresis and cooldown phases independently, so two
 * gameplays captured in one video source can each confirm a match without
 * blocking one another. The default category (empty-string key) reproduces
 * the legacy single-counter behavior.
 */
interface CategoryState {
  consecutiveCount: number;
  missCount: number;
  inHysteresis: boolean;
  inCooldown: boolean;
  cooldownStartedAt: number;
  /** Smoothed score (EMA) used for live confidence display. */
  smoothedScore: number;
}

/** Create a fresh, idle category state. */
function newCategoryState(): CategoryState {
  return {
    consecutiveCount: 0,
    missCount: 0,
    inHysteresis: false,
    inCooldown: false,
    cooldownStartedAt: 0,
    smoothedScore: 0,
  };
}

// --- Adaptive polling constants ----------------------------------------------

/** Fastest polling interval in ms (when score is near threshold). */
const MIN_POLL_MS = 150;
/** Slowest polling interval in ms (when scene is static). */
const MAX_POLL_MS = 500;
/** Default starting interval in ms. */
const DEFAULT_POLL_MS = 100;
/** Fast tick interval during cooldown/hysteresis (no GPU work, just timer updates). */
const COOLDOWN_TICK_MS = 100;

// --- EMA smoothing constant --------------------------------------------------

/** Weight for the newest score in the exponential moving average. */
const EMA_ALPHA = 0.3;

/** Scores below this floor are mapped to zero to suppress metric noise. */
const NOISE_FLOOR = 0.15;

/** Maximum number of attempts to deliver a confirmed match to the backend. */
const MATCH_RETRY_ATTEMPTS = 3;

/** Resolve after the given number of milliseconds (timer-friendly for tests). */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- DetectionLoop -----------------------------------------------------------

/** Per-pokemon detection loop that runs WebGPU/CPU template matching in the browser. */
export class DetectionLoop {
  private readonly pokemonId: string;
  private readonly detector: Detector;
  private templates: TemplateData[] = [];
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
  /**
   * Independent match state per counting category, keyed by category name.
   * The empty-string key is the default category used when no region defines
   * one, which keeps single-category hunts behaving exactly as before.
   */
  private readonly categoryStates = new Map<string, CategoryState>();
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  /** Last video.currentTime seen — used to skip detection when the frame hasn't changed. */
  private lastVideoTime = -1;

  /** Opaque frame buffer from the previous detection cycle (for GPU-level deduplication). */
  private previousFrameBuffer: unknown = null;

  /** Pending template replacement — picked up at the start of the next loop iteration. */
  private pendingTemplates: TemplateData[] | null = null;

  /** Optional callback for live score reporting. */
  private scoreCallback: ((score: number, state: string, cooldownRemainingMs?: number) => void) | null = null;

  // --- Throttle state for scoreCallback (UI store updates) -----------------
  private lastScoreCallbackTime = 0;
  private lastCallbackState = "";

  // --- Performance metrics (consumed by the dev perf modal) ---------------
  /** Wall-clock duration of the most recent detect() call in milliseconds. */
  private lastDetectMs = 0;
  /** EMA-smoothed detect() duration in milliseconds (alpha = 0.2). */
  private detectMsEMA = 0;
  /** Approximate p95 of recent detect() durations in milliseconds. */
  private detectMsP95 = 0;
  /** Ring buffer of recent detect() durations used to compute p95. */
  private readonly detectMsHistory: number[] = [];
  /** Wall-clock timestamp of the previous processFrame entry, used for effective FPS. */
  private lastFrameWallclock = 0;
  /** EMA-smoothed effective FPS observed in processFrame (alpha = 0.2). */
  private effectiveFpsEMA = 0;
  /** Total number of processFrame iterations since the loop started. */
  private framesProcessed = 0;

  constructor(pokemonId: string, detector: Detector) {
    this.pokemonId = pokemonId;
    this.detector = detector;
  }

  /**
   * Load or replace templates for matching. Safe to call while the loop is
   * running. The loop takes ownership: replaced templates have their GPU
   * resources released and must not be reused by the caller.
   */
  loadTemplates(templates: TemplateData[]): void {
    if (this.running) {
      if (this.pendingTemplates) this.releaseTemplates(this.pendingTemplates);
      this.pendingTemplates = templates;
    } else {
      this.releaseTemplates(this.templates);
      this.templates = templates;
    }
  }

  /** Release detector-side resources (GPU buffers) of the given templates. */
  private releaseTemplates(templates: TemplateData[]): void {
    for (const tmpl of templates) {
      this.detector.releaseTemplate?.(tmpl);
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
    this.categoryStates.clear();
    this.pollIntervalMs = this.config.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.lastScoreCallbackTime = 0;
    this.lastCallbackState = "";
    this.lastVideoTime = -1;
    this.previousFrameBuffer = null;
    this.runLoop(getVideo);
  }

  /**
   * Stop the detection loop and release template GPU resources.
   * The loop cannot be restarted afterwards; create a new one instead.
   */
  stop(): void {
    this.running = false;
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    // Release template GPU buffers (the loop owns loaded templates)
    this.releaseTemplates(this.templates);
    this.templates = [];
    if (this.pendingTemplates) {
      this.releaseTemplates(this.pendingTemplates);
      this.pendingTemplates = null;
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

  // --- Category state helpers ------------------------------------------------

  /** Return the state for a category, creating an idle one on first use. */
  private getCategoryState(category: string): CategoryState {
    let state = this.categoryStates.get(category);
    if (!state) {
      state = newCategoryState();
      this.categoryStates.set(category, state);
    }
    return state;
  }

  /** True when at least one category currently holds a confirmed match (hysteresis). */
  private anyHysteresis(): boolean {
    for (const s of this.categoryStates.values()) {
      if (s.inHysteresis) return true;
    }
    return false;
  }

  /**
   * True when every tracked category is in cooldown (and at least one exists).
   * Detection can be skipped only then, otherwise a cooling category would
   * starve a sibling category that still needs real scoring.
   */
  private allCooldown(): boolean {
    if (this.categoryStates.size === 0) return false;
    for (const s of this.categoryStates.values()) {
      if (!s.inCooldown) return false;
    }
    return true;
  }

  /** Highest smoothed score across categories, for live confidence display. */
  private maxSmoothedScore(): number {
    let max = 0;
    for (const s of this.categoryStates.values()) {
      if (s.smoothedScore > max) max = s.smoothedScore;
    }
    return max;
  }

  // --- Internal loop ---------------------------------------------------------

  /**
   * Compute the effective precision, optionally adjusted for region size.
   *
   * Larger regions tend to produce slightly lower NCC scores due to more
   * background noise, so we reduce the threshold proportionally (capped).
   */
  private computeEffectivePrecision(): number {
    const { precision, adaptiveThreshold, regions, calibratedPrecision } = this.config;

    // Adaptive threshold is enabled by default unless explicitly disabled
    if (adaptiveThreshold === false) {
      return precision;
    }

    // Measured calibration beats the region-size heuristic. It reflects how
    // detectable the template's match window really is under polling; the
    // user-configured precision stays as an upper bound.
    if (calibratedPrecision !== undefined) {
      return Math.min(precision, calibratedPrecision);
    }

    if (!regions || regions.length === 0) {
      return precision;
    }

    const regionArea = regions.reduce((sum, r) => sum + r.rect.w * r.rect.h, 0);
    const adjustment = 0.05 * Math.min(regionArea / 500_000, 0.2);
    return precision - adjustment;
  }

  private async runLoop(getVideo: () => HTMLVideoElement | null): Promise<void> {
    if (!this.running) return;

    // When every category is in cooldown, skip expensive GPU detection — just
    // tick the timers and update the UI at a fast interval. If any category is
    // still active, real detection must run so its hysteresis can resolve and
    // the cooling categories do not starve it.
    if (this.allCooldown()) {
      this.tickCooldownPhase();
      this.pollIntervalMs = COOLDOWN_TICK_MS;
      this.scheduleNext(getVideo);
      return;
    }

    // Apply pending template swap at a safe point (between iterations)
    if (this.pendingTemplates) {
      this.releaseTemplates(this.templates);
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
        this.scheduleNext(getVideo);
        return;
      }
      this.lastVideoTime = video.currentTime;

      try {
        await this.processFrame(video);
      } catch (err) {
        console.error("[Detection] Error:", err);
        // Detection error — back off to avoid tight error loops
        this.pollIntervalMs = this.maxPollMs;
      }
    }

    this.scheduleNext(getVideo);
  }

  /**
   * Lightweight tick for the cooldown phase only.
   *
   * Advances the cooldown timer and emits UI callbacks without running
   * GPU detection. Hysteresis is intentionally excluded — it needs real
   * detection scores to know when the match leaves the screen.
   */
  private tickCooldownPhase(): void {
    const effectivePrecision = this.computeEffectivePrecision();
    // Advance the cooldown timer of every category that is cooling down.
    for (const state of this.categoryStates.values()) {
      this.updateMatchState(state, 0, effectivePrecision);
    }
    this.emitScoreCallback(0, effectivePrecision);
  }

  /** Run detection on a single video frame and update scores/match state. */
  private async processFrame(video: HTMLVideoElement): Promise<void> {
    const frameWallclock = performance.now();
    if (this.lastFrameWallclock > 0) {
      const dt = frameWallclock - this.lastFrameWallclock;
      if (dt > 0) {
        const fps = 1000 / dt;
        this.effectiveFpsEMA = this.effectiveFpsEMA === 0 ? fps : 0.2 * fps + 0.8 * this.effectiveFpsEMA;
      }
    }
    this.lastFrameWallclock = frameWallclock;

    const detectStart = performance.now();
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
    this.recordDetectDuration(performance.now() - detectStart);
    this.framesProcessed += 1;

    this.recycleFrameBuffer(result.frameBuffer);

    // Fall back to a single default category so legacy single-counter hunts
    // (and detectors that do not report categories) behave exactly as before.
    const categoryScores = result.categoryScores ?? { "": result.bestScore };
    const effectivePrecision = this.computeEffectivePrecision();

    // The highest adjusted score across categories drives adaptive polling.
    let maxAdjusted = 0;

    for (const [category, rawScore] of Object.entries(categoryScores)) {
      const state = this.getCategoryState(category);
      const adjusted = this.applyNoiseFloor(rawScore);
      state.smoothedScore = EMA_ALPHA * adjusted + (1 - EMA_ALPHA) * state.smoothedScore;
      if (adjusted > maxAdjusted) maxAdjusted = adjusted;

      const wasInHysteresis = state.inHysteresis;
      this.updateMatchState(state, adjusted, effectivePrecision);

      // Each category notifies the backend on its own confirmed match, so every
      // gameplay increments the shared counter once per encounter.
      if (state.inHysteresis && !wasInHysteresis) {
        this.reportMatch(adjusted, result.frameDelta, category);
      }
    }

    // Periodic score logging for debugging (every ~2s)
    if (Math.random() < 0.1) {
      console.log(`[Detection] best=${result.bestScore.toFixed(3)} maxAdj=${maxAdjusted.toFixed(3)} cats=${this.categoryStates.size} poll=${this.pollIntervalMs}ms`);
    }

    this.emitScoreCallback(maxAdjusted, effectivePrecision);

    // When every category just entered cooldown, switch to fast ticks instead
    // of the adaptive interval (which would be slow for low scores).
    this.pollIntervalMs = this.allCooldown()
      ? COOLDOWN_TICK_MS
      : this.computeNextInterval(maxAdjusted, result.frameDelta);
  }

  /** Replace the previous frame buffer, destroying the old one if applicable. */
  private recycleFrameBuffer(newBuffer: DetectorResult["frameBuffer"]): void {
    if (newBuffer === undefined) return;
    const old = this.previousFrameBuffer;
    if (old && typeof old === 'object' && 'destroy' in old && typeof (old as { destroy: unknown }).destroy === 'function') {
      (old as { destroy(): void }).destroy();
    }
    this.previousFrameBuffer = newBuffer;
  }

  /** Schedule the next detection iteration, guarding against stopped state. */
  private scheduleNext(getVideo: () => HTMLVideoElement | null): void {
    if (!this.running) return;

    // Use setTimeout only — no requestAnimationFrame needed since detection
    // doesn't require frame sync and rAF callbacks block the browser's
    // rendering pipeline while the async detect() runs.
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
  private updateMatchState(state: CategoryState, adjusted: number, effectivePrecision: number): void {
    // Phase 1: Hysteresis — wait for score to drop after a confirmed match
    if (state.inHysteresis) {
      const belowThreshold = adjusted < this.config.precision * this.hysteresisFactor;
      if (belowThreshold) {
        // Score dropped — transition to cooldown phase
        state.inHysteresis = false;
        state.inCooldown = true;
        state.cooldownStartedAt = Date.now();
      }
      state.consecutiveCount = 0;
      state.missCount = 0;
      return;
    }

    // Phase 2: Cooldown — wait for timer to elapse after hysteresis ended
    if (state.inCooldown) {
      const cooldownElapsed = Date.now() - state.cooldownStartedAt >= this.cooldownSec * 1000;
      if (cooldownElapsed) {
        state.inCooldown = false;
      }
      state.consecutiveCount = 0;
      state.missCount = 0;
      return;
    }

    // Phase 3: Normal detection — count consecutive matches
    if (adjusted >= effectivePrecision) {
      state.consecutiveCount += 1;
      state.missCount = 0;
    } else if (state.consecutiveCount > 0 && state.missCount < 1) {
      // Tolerate a single below-threshold frame between match frames
      state.missCount += 1;
    } else {
      state.consecutiveCount = 0;
      state.missCount = 0;
    }

    if (state.consecutiveCount >= this.config.consecutiveHits) {
      state.consecutiveCount = 0;
      state.missCount = 0;
      state.inHysteresis = true;
    }
  }

  /** Throttled UI callback — fires at most 4 times/second unless the state changes. */
  private emitScoreCallback(_adjusted: number, _effectivePrecision: number): void {
    if (!this.scoreCallback) return;

    // Aggregate the per-category states into one indicator: a confirmed match
    // in any category wins, otherwise show cooldown while any category cools,
    // otherwise idle. Individual above-threshold frames during consecutive-hit
    // buildup stay "idle" to prevent Bereit->Treffer->Bereit flicker.
    let anyCooldown = false;
    let maxCooldownRemainingMs = 0;
    for (const s of this.categoryStates.values()) {
      if (s.inCooldown) {
        anyCooldown = true;
        const remaining = Math.max(0, this.cooldownSec * 1000 - (Date.now() - s.cooldownStartedAt));
        if (remaining > maxCooldownRemainingMs) maxCooldownRemainingMs = remaining;
      }
    }

    let state: string;
    if (this.anyHysteresis()) {
      state = "match";
    } else if (anyCooldown) {
      state = "cooldown";
    } else {
      state = "idle";
    }

    const now = performance.now();
    const stateChanged = state !== this.lastCallbackState;
    // Fire immediately on state change; during cooldown throttle to 200ms
    // for responsive countdown display; otherwise throttle to 250ms.
    const throttleMs = state === "cooldown" ? 200 : 250;
    if (!stateChanged && now - this.lastScoreCallbackTime < throttleMs) return;

    this.lastScoreCallbackTime = now;
    this.lastCallbackState = state;

    const cooldownRemainingMs = state === "cooldown" ? maxCooldownRemainingMs : undefined;

    this.scoreCallback(this.maxSmoothedScore(), state, cooldownRemainingMs);
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
   * Record a single detect() wall-clock duration sample and update
   * the smoothed average + approximate p95 used by the dev perf modal.
   */
  private recordDetectDuration(ms: number): void {
    this.lastDetectMs = ms;
    this.detectMsEMA = this.detectMsEMA === 0 ? ms : 0.2 * ms + 0.8 * this.detectMsEMA;
    this.detectMsHistory.push(ms);
    if (this.detectMsHistory.length > 120) {
      this.detectMsHistory.shift();
    }
    if (this.detectMsHistory.length > 0) {
      const sorted = [...this.detectMsHistory].sort((a, b) => a - b);
      const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
      this.detectMsP95 = sorted[idx];
    }
  }

  /**
   * Read-only snapshot of detector loop performance metrics for diagnostics.
   * Consumed by the dev-only DetectorPerfModal; safe to call at any time.
   */
  getPerfSnapshot(): {
    running: boolean;
    framesProcessed: number;
    lastDetectMs: number;
    detectMsEMA: number;
    detectMsP95: number;
    effectiveFps: number;
    pollIntervalMs: number;
    minPollMs: number;
    maxPollMs: number;
    smoothedScore: number;
    inHysteresis: boolean;
    inCooldown: boolean;
    /** EMA of time spent waiting for the shared GPU detector (ms), 0 if unsupported. */
    gpuQueueWaitMs: number;
  } {
    return {
      running: this.running,
      framesProcessed: this.framesProcessed,
      lastDetectMs: this.lastDetectMs,
      detectMsEMA: this.detectMsEMA,
      detectMsP95: this.detectMsP95,
      effectiveFps: this.effectiveFpsEMA,
      pollIntervalMs: this.pollIntervalMs,
      minPollMs: this.minPollMs,
      maxPollMs: this.maxPollMs,
      smoothedScore: this.maxSmoothedScore(),
      inHysteresis: this.anyHysteresis(),
      inCooldown: this.allCooldown(),
      gpuQueueWaitMs: this.detector.getStats?.().queueWaitMsEMA ?? 0,
    };
  }

  /**
   * Increment the encounter counter when a match is confirmed.
   *
   * Calls the REST increment endpoint directly instead of the detector
   * score endpoint, because the frontend already confirmed the match
   * via its own consecutive-hits + hysteresis logic.
   */
  private reportMatch(score: number, frameDelta: number, category: string): void {
    console.log(`[Detection] Match confirmed for ${this.pokemonId} (category="${category}"), reporting to backend`);
    // Fire-and-forget from the caller's perspective: the loop must not block on
    // network I/O. The helper retries internally so a transient failure does not
    // silently drop a confirmed encounter (which is worse when many detectors run).
    void this.sendMatchWithRetry(score, frameDelta, category);
  }

  /**
   * POST a confirmed match to the backend, retrying on transient failures.
   *
   * Retries only on a network error (fetch rejects) or a 5xx response. A 2xx
   * means the encounter was already counted, and a 4xx will not improve on
   * retry (e.g. the pokemon was deleted), so both stop immediately. After all
   * attempts are exhausted a warning is logged so the loss stays visible.
   */
  private async sendMatchWithRetry(score: number, frameDelta: number, category: string): Promise<void> {
    const url = apiUrl(`/api/detector/${this.pokemonId}/match`);
    const backoffsMs = [150, 400, 800];

    for (let attempt = 0; attempt < MATCH_RETRY_ATTEMPTS; attempt += 1) {
      const transient = await this.attemptMatchPost(url, score, frameDelta, category);
      if (!transient) return;
      const isLastAttempt = attempt === MATCH_RETRY_ATTEMPTS - 1;
      if (isLastAttempt) break;
      await delay(backoffsMs[attempt]);
    }

    console.warn(`[Detection] Failed to report match for ${this.pokemonId} after ${MATCH_RETRY_ATTEMPTS} attempts, encounter not recorded`);
  }

  /**
   * Perform a single match POST.
   *
   * Returns true when the failure is transient and the caller should retry
   * (network rejection or 5xx), false when the outcome is final (2xx success or
   * a 4xx that will not be fixed by retrying).
   */
  private async attemptMatchPost(url: string, score: number, frameDelta: number, category: string): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, frame_delta: frameDelta, category }),
      });
      return response.status >= 500;
    } catch {
      // Network-level failure (fetch rejected): worth retrying.
      return true;
    }
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
