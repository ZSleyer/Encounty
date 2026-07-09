/**
 * startDetection.ts — Shared detection loop lifecycle management.
 *
 * Provides a singleton detector instance (WebGPU or CPU fallback) and
 * functions to start/stop per-pokemon detection loops. Used by both
 * DetectorPanel (when manually starting detection) and Dashboard
 * (when starting hunts that include detection).
 */
import { WebGPUDetector, CPUDetector, WorkerDetector } from "../engine";
import type { Detector, TemplateData } from "../engine";
import { DetectionLoop, registerLoop, stopLoop, getActiveLoop } from "./DetectionLoop";
import { apiUrl } from "../utils/api";
import type { DetectorConfig, DetectorTemplate } from "../types";

/**
 * Notify the backend that a detection loop is now running (or stopped)
 * for a Pokémon. The backend uses this to let the hunt-toggle hotkey
 * stop detector-only hunts where no timer was ever involved.
 */
function postDetectionState(pokemonId: string, detecting: boolean): void {
  try {
    void fetch(apiUrl("/api/detection/state"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pokemon_id: pokemonId, detecting }),
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

// --- Detector singleton ------------------------------------------------------

/** Shared detector instance, persists across component remounts. */
let sharedDetector: Detector | null = null;
let sharedDetectorBackend: "gpu" | "cpu" | null = null;
let detectorInitPromise: Promise<void> | null = null;

/** When true, skip WebGPU and use CPU detector even if GPU is available. */
let forceCPUMode = false;

/**
 * Start options of every currently running detection loop, keyed by pokemon
 * ID. Used to restart detection after a GPU device loss.
 */
const activeStartOptions = new Map<string, StartDetectionOptions>();

/** Guards against overlapping device-loss recoveries. */
let recoveringFromDeviceLoss = false;

/**
 * Set forced CPU mode. Destroys the current detector so the next
 * ensureDetector() call re-initializes with the chosen backend.
 */
export function setForceCPU(force: boolean): void {
  if (force === forceCPUMode) return;
  forceCPUMode = force;
  // Destroy and invalidate the current detector so next ensureDetector()
  // re-creates it. An intentional destroy() reports device loss with
  // reason "destroyed", which handleDeviceLost ignores.
  sharedDetector?.destroy();
  sharedDetector = null;
  sharedDetectorBackend = null;
  detectorInitPromise = null;
}

/**
 * Recover from an unexpected GPU device loss: invalidate the dead detector
 * and restart every active detection loop. startDetectionForPokemon()
 * re-creates the detector (falling back to Worker/CPU when WebGPU stays
 * unavailable), re-fetches templates and re-registers the loops.
 */
async function handleDeviceLost(info: GPUDeviceLostInfo): Promise<void> {
  if (info.reason === "destroyed") return; // intentional teardown
  if (recoveringFromDeviceLoss) return;
  recoveringFromDeviceLoss = true;
  console.error("[Detector] GPU device lost, restarting detection:", info.message);

  sharedDetector = null;
  sharedDetectorBackend = null;
  detectorInitPromise = null;

  // Give the browser a moment to reinitialize the GPU process.
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    for (const options of [...activeStartOptions.values()]) {
      try {
        const loop = await startDetectionForPokemon(options);
        if (loop) {
          console.log(`[Detector] Recovered detection for ${options.pokemonId}`);
        } else {
          console.warn(`[Detector] Could not recover detection for ${options.pokemonId}`);
        }
      } catch (err) {
        console.error(`[Detector] Recovery failed for ${options.pokemonId}:`, err);
      }
    }
  } finally {
    recoveringFromDeviceLoss = false;
  }
}

/** Return whether force-CPU mode is active. */
export function isForceCPU(): boolean {
  return forceCPUMode;
}

/** Initialize the detector once (idempotent). Resolves when ready. */
export function ensureDetector(): Promise<void> {
  if (sharedDetector) return Promise.resolve();
  if (detectorInitPromise) return detectorInitPromise;

  detectorInitPromise = (async () => {
    // Attempt WebGPU unless force-CPU mode is active
    if (!forceCPUMode) {
      try {
        sharedDetector = await WebGPUDetector.create(handleDeviceLost);
        sharedDetectorBackend = "gpu";
        console.log("[Detector] Using WebGPU backend");
      } catch (gpuErr) {
        console.warn("[Detector] WebGPU unavailable:", gpuErr);
      }
    }

    // CPU fallback if WebGPU was skipped or failed
    if (!sharedDetector) {
      try {
        if (WorkerDetector.isAvailable()) {
          sharedDetector = await WorkerDetector.create();
          console.log("[Detector] Using Worker backend (CPU offloaded)");
        } else if (CPUDetector.isAvailable()) {
          sharedDetector = new CPUDetector();
          console.log("[Detector] Using main-thread CPU backend");
        }
        sharedDetectorBackend = "cpu";
      } catch (cpuErr) {
        if (CPUDetector.isAvailable()) {
          sharedDetector = new CPUDetector();
          sharedDetectorBackend = "cpu";
        }
        console.warn("[Detector] Worker failed, main-thread fallback:", cpuErr);
      }
    }
  })();

  return detectorInitPromise;
}

/** Return the current detector backend type ("gpu", "cpu", or null). */
export function getDetectorBackend(): "gpu" | "cpu" | null {
  return sharedDetectorBackend;
}

/**
 * Fetch and load a template's image from the backend, attaching its own
 * detection settings (or undefined to fall back to the engine's hardcoded
 * defaults).
 */
async function loadOneTemplate(
  detector: Detector,
  pokemonId: string,
  tmpl: DetectorTemplate,
  index: number,
): Promise<TemplateData | null> {
  try {
    const imgResp = await fetch(apiUrl(`/api/detector/${pokemonId}/template/${index}`));
    if (!imgResp.ok) return null;
    const blob = await imgResp.blob();
    const bmp = await createImageBitmap(blob);
    const templateData = await detector.loadTemplate(bmp, tmpl.regions);
    bmp.close();
    if (!templateData) return null;
    templateData.precision = tmpl.precision;
    templateData.hysteresisFactor = tmpl.hysteresis_factor;
    templateData.consecutiveHits = tmpl.consecutive_hits;
    templateData.cooldownSec = tmpl.cooldown_sec;
    templateData.pollIntervalMs = tmpl.poll_interval_ms;
    templateData.minPollMs = tmpl.min_poll_ms;
    templateData.maxPollMs = tmpl.max_poll_ms;
    return templateData;
  } catch {
    return null;
  }
}

// --- Start / Stop helpers ----------------------------------------------------

/** Options for starting a detection loop. */
export interface StartDetectionOptions {
  pokemonId: string;
  templates: DetectorTemplate[];
  config: DetectorConfig;
  getVideoElement: () => HTMLVideoElement | null;
  onScore: (score: number, state: string, cooldownRemainingMs?: number) => void;
}

/**
 * Start a browser-side detection loop for a pokemon.
 *
 * Loads template images from the backend, initializes the shared detector,
 * and starts the polling loop. Returns the DetectionLoop on success, or
 * null if initialization fails (no detector, no templates loaded).
 */
export async function startDetectionForPokemon({
  pokemonId,
  templates,
  config,
  getVideoElement,
  onScore,
}: StartDetectionOptions): Promise<DetectionLoop | null> {
  // Stop any existing loop for this pokemon
  stopLoop(pokemonId);

  await ensureDetector();
  const detector = sharedDetector;
  if (!detector) return null;

  const loop = new DetectionLoop(pokemonId, detector);

  // Load template images from the backend
  const enabledTemplates = templates
    .map((t, i) => ({ template: t, index: i }))
    .filter(({ template: tmpl }) => tmpl.enabled !== false);

  const loadedTemplates: TemplateData[] = [];
  for (const { template: tmpl, index } of enabledTemplates) {
    const templateData = await loadOneTemplate(detector, pokemonId, tmpl, index);
    if (templateData) loadedTemplates.push(templateData);
  }

  if (loadedTemplates.length === 0) return null;

  loop.loadTemplates(loadedTemplates);

  loop.updateConfig({
    changeThreshold: config.change_threshold,
  });

  loop.onScore(onScore);
  loop.start(getVideoElement);
  registerLoop(pokemonId, loop);
  // Remember how this hunt was started so it can be restarted after a
  // GPU device loss.
  activeStartOptions.set(pokemonId, {
    pokemonId,
    templates,
    config,
    getVideoElement,
    onScore,
  });
  postDetectionState(pokemonId, true);

  return loop;
}

/**
 * Reload templates into a running detection loop without stopping it.
 *
 * Fetches enabled template images from the backend and injects them
 * into the loop via the safe pendingTemplates swap. Returns the number
 * of templates loaded, or -1 if no loop is running.
 */
export async function reloadDetectionTemplates(
  pokemonId: string,
  templates: DetectorTemplate[],
): Promise<number> {
  const loop = getActiveLoop(pokemonId);
  if (!loop) return -1;

  await ensureDetector();
  const detector = sharedDetector;
  if (!detector) return -1;

  const enabledTemplates = templates
    .map((t, i) => ({ template: t, index: i }))
    .filter(({ template: tmpl }) => tmpl.enabled !== false);

  const loadedTemplates: TemplateData[] = [];
  for (const { template: tmpl, index } of enabledTemplates) {
    const templateData = await loadOneTemplate(detector, pokemonId, tmpl, index);
    if (templateData) loadedTemplates.push(templateData);
  }

  loop.loadTemplates(loadedTemplates);
  return loadedTemplates.length;
}

/**
 * Stop the browser-side detection loop for a pokemon.
 * Detection runs purely client-side; the backend only receives match results.
 */
export function stopDetectionForPokemon(pokemonId: string): void {
  stopLoop(pokemonId);
  activeStartOptions.delete(pokemonId);
  postDetectionState(pokemonId, false);
}

// --- Dev-only debug hooks ------------------------------------------------------

if (import.meta.env.DEV && typeof window !== "undefined") {
  // E2E hook to exercise the device-loss recovery path from the console.
  (window as unknown as Record<string, unknown>).__encountyDetectorDebug = {
    simulateDeviceLoss: () =>
      void handleDeviceLost({
        reason: "unknown",
        message: "simulated device loss",
      } as GPUDeviceLostInfo),
  };
}
