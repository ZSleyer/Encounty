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

// --- Detector singleton ------------------------------------------------------

/** Shared detector instance, persists across component remounts. */
let sharedDetector: Detector | null = null;
let sharedDetectorBackend: "gpu" | "cpu" | null = null;
let detectorInitPromise: Promise<void> | null = null;

/** When true, skip WebGPU and use CPU detector even if GPU is available. */
let forceCPUMode = false;

/**
 * Set forced CPU mode. Destroys the current detector so the next
 * ensureDetector() call re-initializes with the chosen backend.
 */
export function setForceCPU(force: boolean): void {
  if (force === forceCPUMode) return;
  forceCPUMode = force;
  // Invalidate current detector so next ensureDetector() re-creates it
  sharedDetector = null;
  sharedDetectorBackend = null;
  detectorInitPromise = null;
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
        sharedDetector = await WebGPUDetector.create();
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
    try {
      const imgResp = await fetch(apiUrl(`/api/detector/${pokemonId}/template/${index}`));
      if (!imgResp.ok) continue;
      const blob = await imgResp.blob();
      const bmp = await createImageBitmap(blob);
      const templateData = await detector.loadTemplate(bmp, tmpl.regions);
      bmp.close();
      if (templateData) loadedTemplates.push(templateData);
    } catch {
      // Skip templates that fail to load
    }
  }

  if (loadedTemplates.length === 0) return null;

  loop.loadTemplates(loadedTemplates);

  // Collect all regions from enabled templates for adaptive threshold
  const allRegions = templates
    .filter((tmpl) => tmpl.enabled !== false)
    .flatMap((tmpl) => (tmpl.regions || []).map((r) => ({ rect: r.rect })));

  loop.updateConfig({
    precision: config.precision,
    changeThreshold: config.change_threshold,
    consecutiveHits: config.consecutive_hits,
    adaptiveThreshold: config.adaptive_threshold,
    regions: allRegions,
    pollIntervalMs: config.poll_interval_ms,
    minPollMs: config.min_poll_ms,
    maxPollMs: config.max_poll_ms,
    hysteresisFactor: 0.7,
    cooldownSec: config.cooldown_sec,
    adaptiveCooldown: config.adaptive_cooldown ?? false,
    adaptiveCooldownMin: config.adaptive_cooldown_min ?? 3,
  });

  loop.onScore(onScore);
  loop.start(getVideoElement);
  registerLoop(pokemonId, loop);

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
    try {
      const imgResp = await fetch(apiUrl(`/api/detector/${pokemonId}/template/${index}`));
      if (!imgResp.ok) continue;
      const blob = await imgResp.blob();
      const bmp = await createImageBitmap(blob);
      const templateData = await detector.loadTemplate(bmp, tmpl.regions);
      bmp.close();
      if (templateData) loadedTemplates.push(templateData);
    } catch {
      // Skip templates that fail to load
    }
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
}
