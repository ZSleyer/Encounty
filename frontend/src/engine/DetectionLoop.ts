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
import {
  DEFAULT_PRECISION, DEFAULT_HYSTERESIS_FACTOR, DEFAULT_CONSECUTIVE_HITS,
  DEFAULT_COOLDOWN_SEC, DEFAULT_POLL_MS, MIN_POLL_MS, MAX_POLL_MS,
  DEFAULT_HYSTERESIS_MODE,
} from "./detectorDefaults";
import {
  type CategoryState, newCategoryState, applyNoiseFloor, updateMatchState,
} from "./matchStateMachine";
import { extractRegionGrays, regionSetDelta, type RegionGray } from "./regionDelta";

// --- Types -------------------------------------------------------------------

/** Rectangular crop region in pixel coordinates. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Configuration for the detection loop. Every detection-threshold knob is a
 * per-template setting resolved via resolveTemplateSettings(); this only
 * carries the handful of settings that stay hunt-level. */
interface DetectionLoopConfig {
  /** Optional crop region applied before detection. */
  crop?: Rect;
  /** Minimum pixel-level change between frames to trigger detection (0.0–1.0). */
  changeThreshold: number;
}

/** Detection settings resolved from the template that won a category's score. */
interface ResolvedTemplateSettings {
  precision: number;
  hysteresisFactor: number;
  consecutiveHits: number;
  cooldownSec: number;
  minPollMs: number;
  maxPollMs: number;
  basePollMs: number;
  /** How the winning template's hysteresis phase exits ("score" or "region"). */
  hysteresisMode: "score" | "region";
  /** Index (into the loaded templates) of the template these settings came from. */
  winnerIndex: number;
}

/** Fast tick interval during cooldown/hysteresis (no GPU work, just timer updates). */
const COOLDOWN_TICK_MS = 100;

/**
 * Normalized mean-abs-diff above which region content counts as changed for
 * the region-based hysteresis exit. Unvalidated against real 3D noise yet,
 * tune here.
 */
const REGION_EXIT_DELTA = 0.12;

/**
 * Number of consecutive polls whose region delta must exceed REGION_EXIT_DELTA
 * before region-based hysteresis exits. Debounces against 3D rendering noise
 * (camera sway, particles) that can spike a single poll's delta.
 */
const REGION_EXIT_CONSECUTIVE = 2;

// --- EMA smoothing constant --------------------------------------------------

/** Weight for the newest score in the exponential moving average. */
const EMA_ALPHA = 0.3;

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
    changeThreshold: 0.01,
  };

  private running = false;
  private pollIntervalMs = DEFAULT_POLL_MS;
  /** Most recently resolved adaptive-polling bounds (from the leading category's template), exposed via getPerfSnapshot(). */
  private minPollMs = MIN_POLL_MS;
  private maxPollMs = MAX_POLL_MS;
  /**
   * Independent match state per counting category, keyed by category name.
   * The empty-string key is the default category used when no region defines
   * one, which keeps single-category hunts behaving exactly as before.
   */
  private readonly categoryStates = new Map<string, CategoryState>();
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  /** Last video.currentTime seen — used to skip detection when the frame hasn't changed. */
  private lastVideoTime = -1;

  /** Lazily created canvas reused for region pixel extraction (avoids a per-poll allocation). */
  private regionScratchCanvas: HTMLCanvasElement | null = null;

  /**
   * Frozen region snapshots per category, present only while that category's
   * region-mode hysteresis is active. templateIndex pins the template whose
   * regions were snapshotted so later polls re-extract the exact same rects.
   */
  private readonly regionSnapshots = new Map<string, { frozen: RegionGray[]; exitStreak: number; templateIndex: number }>();

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
  }

  /**
   * Start the detection loop.
   * @param getVideo - Callback that returns the current video element (may return null if capture stopped).
   */
  start(getVideo: () => HTMLVideoElement | null): void {
    if (this.running) return;
    this.running = true;
    this.categoryStates.clear();
    this.pollIntervalMs = DEFAULT_POLL_MS;
    this.minPollMs = MIN_POLL_MS;
    this.maxPollMs = MAX_POLL_MS;
    this.lastScoreCallbackTime = 0;
    this.lastCallbackState = "";
    this.lastVideoTime = -1;
    this.previousFrameBuffer = null;
    this.regionSnapshots.clear();
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
    this.regionSnapshots.clear();
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
   * Resolve all detection settings for a category from the template that
   * produced its winning score, falling back to hardcoded engine defaults
   * for templates that carry no explicit value of their own.
   */
  private resolveTemplateSettings(winnerIndex: number): ResolvedTemplateSettings {
    const winner = this.templates[winnerIndex];
    return {
      precision: winner?.precision ?? DEFAULT_PRECISION,
      hysteresisFactor: winner?.hysteresisFactor ?? DEFAULT_HYSTERESIS_FACTOR,
      consecutiveHits: winner?.consecutiveHits ?? DEFAULT_CONSECUTIVE_HITS,
      cooldownSec: winner?.cooldownSec ?? DEFAULT_COOLDOWN_SEC,
      minPollMs: winner?.minPollMs ?? MIN_POLL_MS,
      maxPollMs: winner?.maxPollMs ?? MAX_POLL_MS,
      basePollMs: winner?.pollIntervalMs ?? DEFAULT_POLL_MS,
      hysteresisMode: winner?.hysteresisMode ?? DEFAULT_HYSTERESIS_MODE,
      winnerIndex,
    };
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
    // Advance the cooldown timer of every category that is cooling down.
    // Precision/hysteresis/consecutiveHits are irrelevant here: every tracked
    // state is in the cooldown phase, which only reads state.cooldownSec
    // (captured from the winning template when the category entered cooldown).
    const zeroSettings = { precision: 0, hysteresisFactor: 0, consecutiveHits: 0, cooldownSec: 0 };
    const now = Date.now();
    for (const state of this.categoryStates.values()) {
      updateMatchState(state, 0, zeroSettings, now);
    }
    this.emitScoreCallback();
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
        // Coarse early-exit threshold only (stop scanning once a template
        // scores well) — the real per-template threshold is resolved below,
        // after detection, from the template that actually won each category.
        precision: DEFAULT_PRECISION,
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
    const categoryWinners = result.categoryWinners ?? { "": result.templateIndex };

    // The highest adjusted score across categories drives adaptive polling;
    // its own template's min/base/max poll settings govern the next interval.
    let maxAdjusted = 0;
    let leaderSettings = this.resolveTemplateSettings(0);
    let leaderRegionDelta: number | null = null;

    for (const [category, rawScore] of Object.entries(categoryScores)) {
      const { adjusted, settings, regionDelta } = this.processCategory(
        category, rawScore, categoryWinners[category] ?? 0, video, result.frameDelta,
      );
      if (adjusted > maxAdjusted) {
        maxAdjusted = adjusted;
        leaderSettings = settings;
        leaderRegionDelta = regionDelta;
      }
    }

    // Periodic score logging for debugging (every ~2s)
    if (Math.random() < 0.1) {
      console.log(`[Detection] best=${result.bestScore.toFixed(3)} maxAdj=${maxAdjusted.toFixed(3)} cats=${this.categoryStates.size} poll=${this.pollIntervalMs}ms`);
    }

    this.emitScoreCallback();

    // Region-mode leaders drive adaptive polling with the matched region's
    // delta: in 3D games the whole frame changes constantly, so the global
    // frame delta would never let polling slow down on a static match.
    const pollDelta = leaderSettings.hysteresisMode === "region" && leaderRegionDelta !== null
      ? leaderRegionDelta
      : result.frameDelta;

    // When every category just entered cooldown, switch to fast ticks instead
    // of the adaptive interval (which would be slow for low scores).
    this.minPollMs = leaderSettings.minPollMs;
    this.maxPollMs = leaderSettings.maxPollMs;
    this.pollIntervalMs = this.allCooldown()
      ? COOLDOWN_TICK_MS
      : this.computeNextInterval(maxAdjusted, pollDelta, leaderSettings.precision, leaderSettings.minPollMs, leaderSettings.maxPollMs);
  }

  /**
   * Score one category for the current frame: apply the noise floor and EMA,
   * run the region-based hysteresis check when active, advance the match
   * state machine, and manage the region snapshot lifecycle (freeze on
   * hysteresis entry, drop on exit).
   */
  private processCategory(
    category: string,
    rawScore: number,
    winnerIndex: number,
    video: HTMLVideoElement,
    frameDelta: number,
  ): { adjusted: number; settings: ResolvedTemplateSettings; regionDelta: number | null } {
    const state = this.getCategoryState(category);
    const settings = this.resolveTemplateSettings(winnerIndex);
    const adjusted = applyNoiseFloor(rawScore);
    state.smoothedScore = EMA_ALPHA * adjusted + (1 - EMA_ALPHA) * state.smoothedScore;

    const { exitOverride, regionDelta } = this.evaluateRegionHysteresis(category, state, video);

    const wasInHysteresis = state.inHysteresis;
    updateMatchState(state, adjusted, settings, Date.now(), exitOverride);

    if (state.inHysteresis && !wasInHysteresis) {
      // Each category notifies the backend on its own confirmed match, so every
      // gameplay increments the shared counter once per encounter.
      this.reportMatch(adjusted, frameDelta, category);
      this.snapshotRegionsOnEntry(category, settings, video);
    } else if (!state.inHysteresis && wasInHysteresis) {
      this.regionSnapshots.delete(category);
    }

    return { adjusted, settings, regionDelta };
  }

  /**
   * Compare the current region pixels of a category in region-mode hysteresis
   * against its frozen snapshot and advance the exit streak.
   *
   * Returns the exit decision for updateMatchState. exitOverride stays
   * undefined (score-based exit applies for this poll) when the category is
   * not in hysteresis, has no snapshot (score mode, or snapshot extraction
   * failed on entry), or the current extraction fails.
   */
  private evaluateRegionHysteresis(
    category: string,
    state: CategoryState,
    video: HTMLVideoElement,
  ): { exitOverride: boolean | undefined; regionDelta: number | null } {
    if (!state.inHysteresis) return { exitOverride: undefined, regionDelta: null };
    const snapshot = this.regionSnapshots.get(category);
    if (!snapshot) return { exitOverride: undefined, regionDelta: null };

    const current = this.extractCategoryRegionGrays(video, snapshot.templateIndex, category);
    if (!current) return { exitOverride: undefined, regionDelta: null };

    const delta = regionSetDelta(snapshot.frozen, current);
    // A single changed poll may be 3D rendering noise; require the change to
    // persist for REGION_EXIT_CONSECUTIVE polls before ending the hysteresis.
    snapshot.exitStreak = delta > REGION_EXIT_DELTA ? snapshot.exitStreak + 1 : 0;
    return { exitOverride: snapshot.exitStreak >= REGION_EXIT_CONSECUTIVE, regionDelta: delta };
  }

  /**
   * Freeze the winning template's region pixels when a category enters
   * hysteresis in region mode.
   *
   * The snapshot stays frozen for the whole hysteresis phase even if the
   * winning template changes mid-hysteresis: it captures what the screen
   * looked like when the match confirmed, which is the reference the exit
   * condition must compare against. Extraction failure stores nothing, so
   * the category falls back to the score-based exit.
   */
  private snapshotRegionsOnEntry(
    category: string,
    settings: ResolvedTemplateSettings,
    video: HTMLVideoElement,
  ): void {
    const winner = this.templates[settings.winnerIndex];
    // Region mode needs regions to watch; templates without any stay on the
    // legacy score-based exit even when configured as "region".
    if (settings.hysteresisMode !== "region" || !winner || winner.regions.length === 0) return;

    const frozen = this.extractCategoryRegionGrays(video, settings.winnerIndex, category);
    if (!frozen) return;
    this.regionSnapshots.set(category, { frozen, exitStreak: 0, templateIndex: settings.winnerIndex });
  }

  /**
   * Extract the grayscale pixels of a template's regions for one category
   * from the current video frame.
   *
   * Regions are filtered to the given category; a category without any
   * explicitly matching region watches all of the template's regions instead
   * (mirrors how the default category scores against every region).
   */
  private extractCategoryRegionGrays(
    video: HTMLVideoElement,
    templateIndex: number,
    category: string,
  ): RegionGray[] | null {
    const tmpl = this.templates[templateIndex];
    if (!tmpl || tmpl.regions.length === 0) return null;

    const matching = tmpl.regions.filter((region) => (region.category ?? "") === category);
    const rects = (matching.length > 0 ? matching : tmpl.regions).map((region) => region.rect);

    this.regionScratchCanvas ??= document.createElement("canvas");
    return extractRegionGrays(
      video,
      { width: tmpl.width, height: tmpl.height },
      rects,
      this.regionScratchCanvas,
    );
  }

  /**
   * Replace the previous frame buffer, recycling the old one.
   *
   * Prefers returning the old buffer to the detector's pool (so its largest
   * frame buffer is reused instead of destroyed and reallocated every frame);
   * falls back to buffer.destroy() for detectors without a pool. The old buffer
   * is fully consumed by the just-completed detect() cycle before this runs, so
   * recycling it here cannot race an in-flight read.
   */
  private recycleFrameBuffer(newBuffer: DetectorResult["frameBuffer"]): void {
    if (newBuffer === undefined) return;
    const old = this.previousFrameBuffer;
    if (old) {
      if (this.detector.recycleFrameBuffer) {
        this.detector.recycleFrameBuffer(old);
      } else if (typeof old === 'object' && 'destroy' in old && typeof (old as { destroy: unknown }).destroy === 'function') {
        (old as { destroy(): void }).destroy();
      }
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

  /** Throttled UI callback — fires at most 4 times/second unless the state changes. */
  private emitScoreCallback(): void {
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
        const remaining = Math.max(0, s.cooldownSec * 1000 - (Date.now() - s.cooldownStartedAt));
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
  private computeNextInterval(score: number, delta: number, precision: number, min: number, max: number): number {
    const { changeThreshold } = this.config;

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
