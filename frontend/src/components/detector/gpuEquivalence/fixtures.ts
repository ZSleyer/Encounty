/**
 * fixtures.ts -- Ground-truth fixture shapes and result-row types.
 *
 * Describes the generated ground-truth.json and test-config.json entries the
 * GPU/CPU equivalence run reads, the result rows it produces, and the small
 * pure helpers that summarize them.
 */
import { applyNoiseFloor } from "../../../engine/matchStateMachine";
import { type StabilityRating } from "../../../engine/templateStability";

/** Frame rate of the fixture videos; frame indices are 60 fps based. */
export const FPS = 60;

/** One expected encounter window in a fixture video (60 fps frame indices). */
interface EncounterWindow {
  start: number;
  end: number;
  /** Extended window end for entries whose match lingers past `end`. */
  maxEnd?: number;
}

/** Scan range and reference frame for entries that join the parameter sweep. */
export interface SweepCase {
  scanStart: number;
  scanEnd: number;
  matchFrame: number;
}

/** One entry of the generated ground-truth fixture (ground-truth.json). */
export interface GroundTruthEntry {
  videoName: string;
  templateId: number;
  pokemonName: string;
  label: string;
  difficulty: string;
  loopTestable: boolean;
  expectedEncounters: number;
  encounters: EncounterWindow[];
  negativeFrames: number[];
  sweepCase?: SweepCase;
}

/** Center of an encounter window, used as the canonical match frame. */
export function encounterMatchFrame(enc: EncounterWindow): number {
  return Math.round((enc.start + enc.end) / 2);
}

/** Raw-score match threshold used by the node suite's full scan. */
export const SCAN_THRESHOLD = 0.55;

/** Sampling interval in seconds (10 fps grid the adaptive simulator polls from). */
export const SCAN_INTERVAL = 0.1;

/** Edge length of the downsampled grayscale used for frame deltas. */
export const DELTA_GRAY_SIZE = 64;

/** One region entry of the generated test-config.json fixture. */
export interface TestConfigEntry {
  video_name: string;
  pokemon_name: string;
  template_id: number;
  region_type: string;
  expected_text: string;
  rect_x: number;
  rect_y: number;
  rect_w: number;
  rect_h: number;
}

/** One row of the per-frame CPU vs GPU comparison. */
export interface TestResult {
  pokemonName: string;
  templateId: number;
  frame: number;
  type: "match" | "negative";
  cpuScore: number;
  gpuScore: number;
  delta: number;
}

/** Scoring backend used by the full scan and the stability sweep. */
export type ScanBackend = "gpu" | "cpu";

/** State-machine settings variant used by the full scan. */
export type SettingsVariant = "recommended" | "auto";

/** State-machine settings fed into the adaptive scan simulator. */
export interface MatchSettings {
  precision: number;
  hysteresisFactor: number;
  consecutiveHits: number;
  cooldownSec: number;
}

/** The node suite's default full-scan settings (noise-floor adjusted scale). */
export function defaultScanSettings(): MatchSettings {
  return {
    precision: applyNoiseFloor(SCAN_THRESHOLD),
    hysteresisFactor: 0.7,
    consecutiveHits: 1,
    cooldownSec: 5,
  };
}

/** One row of the full-video scan results (one template scanned end to end). */
export interface FullScanResult {
  pokemonName: string;
  templateId: number;
  videoName: string;
  backend: ScanBackend;
  settingsVariant: SettingsVariant;
  difficulty: string;
  /** False marks a deliberate hard case that gets no pass/fail verdict. */
  loopTestable: boolean;
  encountersFound: number;
  encountersExpected: number;
  matchFrames: number;
  sampledFrames: number;
  /** Samples the simulated adaptive loop actually scored. */
  polledSamples: number;
  /** Frame spans of each simulated encounter, for triaging miscounts. */
  encounterSpans: Array<{ startFrame: number; endFrame: number; peakScore: number }>;
  maxScore: number;
  scanSeconds: number;
}

/**
 * Whether a full-scan row is a deliberate hard case (loopTestable === false).
 * Hard cases are excluded from the passed/failed verdict but still count
 * toward the GPU==CPU parity comparison.
 */
export function isHardCase(r: FullScanResult): boolean {
  return !r.loopTestable;
}

/** Whether a full-scan row's found count matches the expected count exactly. */
export function scanRowPasses(r: FullScanResult): boolean {
  return r.encountersFound === r.encountersExpected;
}

/** GPU vs CPU parity for one settings variant of the full scan. */
export interface ParitySummary {
  settingsVariant: SettingsVariant;
  /** Templates where both backends found exactly the same encounter count. */
  identical: number;
  /** Templates with results from both backends. */
  total: number;
}

/**
 * Computes GPU vs CPU parity per settings variant: for every template with
 * full-scan results from both backends, the encounter counts must be exactly
 * equal. Tolerance ranges never soften parity, it is a strict comparison.
 */
export function computeParitySummaries(rows: FullScanResult[]): ParitySummary[] {
  const summaries: ParitySummary[] = [];
  for (const variant of ["recommended", "auto"] as const) {
    const byBackend = (backend: ScanBackend) =>
      new Map(
        rows
          .filter((r) => r.backend === backend && r.settingsVariant === variant)
          .map((r) => [r.templateId, r.encountersFound]),
      );
    const gpu = byBackend("gpu");
    const cpu = byBackend("cpu");
    let identical = 0;
    let total = 0;
    for (const [templateId, found] of gpu) {
      const other = cpu.get(templateId);
      if (other === undefined) continue;
      total++;
      if (other === found) identical++;
    }
    if (total > 0) summaries.push({ settingsVariant: variant, identical, total });
  }
  return summaries;
}

/** One row of the stability/sweep results. */
export interface SweepUiResult {
  pokemonName: string;
  templateId: number;
  backend: ScanBackend;
  rating: StabilityRating;
  precision: number;
  hysteresisFactor: number;
  consecutiveHits: number;
  pollIntervalMs: number;
  cleanPhases: number;
  totalPhases: number;
  robustnessMargin: number;
  perfect: boolean;
  sweepSeconds: number;
}

/** Count total frames across all ground-truth entries. */
export function countTotalFrames(groundTruth: GroundTruthEntry[]): number {
  let total = 0;
  for (const gt of groundTruth) {
    total += gt.encounters.length + gt.negativeFrames.length;
  }
  return total;
}

/** Group ground-truth entries by video name. */
export function groupByVideo(groundTruth: GroundTruthEntry[]): Map<string, GroundTruthEntry[]> {
  const byVideo = new Map<string, GroundTruthEntry[]>();
  for (const gt of groundTruth) {
    const list = byVideo.get(gt.videoName) ?? [];
    list.push(gt);
    byVideo.set(gt.videoName, list);
  }
  return byVideo;
}

/** Group test-config entries by template, returning region rects. */
export function buildRegionMap(
  config: TestConfigEntry[],
): Map<number, Array<{ x: number; y: number; w: number; h: number }>> {
  const map = new Map<number, Array<{ x: number; y: number; w: number; h: number }>>();
  for (const entry of config) {
    if (entry.region_type !== "image") continue;
    const existing = map.get(entry.template_id) ?? [];
    existing.push({
      x: entry.rect_x,
      y: entry.rect_y,
      w: entry.rect_w,
      h: entry.rect_h,
    });
    map.set(entry.template_id, existing);
  }
  return map;
}
