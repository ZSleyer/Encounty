/**
 * GpuEquivalenceTest -- dev-only modal that runs detection tests using both
 * CPU (math.ts) and GPU (WebGPUDetector) backends in the browser, comparing
 * their scores on identical video frames from the test fixture suite.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
} from "react";
import {
  X,
  Play,
  Check,
  AlertTriangle,
  XCircle,
  Loader2,
} from "lucide-react";
import {
  WebGPUDetector,
  type TemplateData,
} from "../../engine/WebGPUDetector";
import {
  fitDimensions,
  adaptiveBlockSizeForRegion,
  scoreRegionHybrid,
  andLogicAcrossRegions,
} from "../../engine/math";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GpuEquivalenceTestProps {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Ground-truth data (matches ncc-detection.test.ts exactly)
// ---------------------------------------------------------------------------

const FPS = 60;

interface EncounterGT {
  matchFrame: number;
  windowStart: number;
  windowEnd: number;
}

interface TemplateGT {
  videoName: string;
  templateId: number;
  pokemonName: string;
  encounters: EncounterGT[];
  negativeFrames: number[];
}

const GROUND_TRUTH: TemplateGT[] = [
  {
    videoName: "Dual_SoftReset", templateId: 29, pokemonName: "Kyurem",
    encounters: [
      { matchFrame: 613, windowStart: 613, windowEnd: 613 },
      { matchFrame: 2800, windowStart: 2800, windowEnd: 2800 },
      { matchFrame: 4854, windowStart: 4854, windowEnd: 4854 },
    ],
    negativeFrames: [1, 300, 1500, 3500],
  },
  {
    videoName: "Dual_SoftReset", templateId: 30, pokemonName: "Giratina",
    encounters: [
      { matchFrame: 627, windowStart: 627, windowEnd: 627 },
      { matchFrame: 2436, windowStart: 2436, windowEnd: 2436 },
      { matchFrame: 4124, windowStart: 4124, windowEnd: 4124 },
    ],
    negativeFrames: [1, 300, 1500, 3500],
  },
  {
    videoName: "FRLG_Fishing", templateId: 28, pokemonName: "Goldini",
    encounters: [
      { matchFrame: 658, windowStart: 658, windowEnd: 658 },
      { matchFrame: 2376, windowStart: 2376, windowEnd: 2376 },
    ],
    negativeFrames: [1, 300, 1500],
  },
  {
    videoName: "FRLG_Runaway", templateId: 26, pokemonName: "Bluzuk",
    encounters: [{ matchFrame: 359, windowStart: 359, windowEnd: 359 }],
    negativeFrames: [1, 180, 800, 1400],
  },
  {
    videoName: "FRLG_Runaway", templateId: 27, pokemonName: "Chaneira",
    encounters: [{ matchFrame: 1187, windowStart: 1187, windowEnd: 1187 }],
    negativeFrames: [1, 60, 800, 1500],
  },
  {
    videoName: "FRLG_SoftReset", templateId: 23, pokemonName: "Mewtu",
    encounters: [
      { matchFrame: 151, windowStart: 111, windowEnd: 308 },
      { matchFrame: 1599, windowStart: 1511, windowEnd: 2158 },
    ],
    negativeFrames: [1, 60, 500, 1000],
  },
  {
    videoName: "FRLG_SoftReset", templateId: 24, pokemonName: "Mewtu",
    encounters: [
      { matchFrame: 417, windowStart: 400, windowEnd: 550 },
      { matchFrame: 2266, windowStart: 2250, windowEnd: 2300 },
    ],
    negativeFrames: [1, 60, 800, 1500],
  },
  {
    videoName: "FRLG_SoftReset", templateId: 25, pokemonName: "Mewtu",
    encounters: [
      { matchFrame: 626, windowStart: 613, windowEnd: 767 },
      { matchFrame: 2330, windowStart: 2313, windowEnd: 2469 },
    ],
    negativeFrames: [1, 60, 900, 1500],
  },
  {
    videoName: "FRLG_Starter", templateId: 21, pokemonName: "Bisasam",
    encounters: [{ matchFrame: 3521, windowStart: 3508, windowEnd: 3643 }],
    negativeFrames: [1, 1000, 2000, 4000, 5000],
  },
  {
    videoName: "FRLG_Starter", templateId: 22, pokemonName: "Glumanda",
    encounters: [{ matchFrame: 5474, windowStart: 5468, windowEnd: 5576 }],
    negativeFrames: [1, 1000, 2000, 3000, 4000],
  },
  {
    videoName: "FRLG_Starter", templateId: 20, pokemonName: "Schiggy",
    encounters: [{ matchFrame: 1240, windowStart: 1199, windowEnd: 1319 }],
    negativeFrames: [1, 500, 2000, 3000, 5000],
  },
  {
    videoName: "SwSh_Breeding", templateId: 16, pokemonName: "Relicanth",
    encounters: [{ matchFrame: 1149, windowStart: 1149, windowEnd: 1149 }],
    negativeFrames: [1, 300, 600, 1500],
  },
  {
    videoName: "SwSh_Runaway", templateId: 15, pokemonName: "Picochilla",
    encounters: [
      { matchFrame: 229, windowStart: 229, windowEnd: 229 },
      { matchFrame: 1338, windowStart: 1338, windowEnd: 1338 },
    ],
    negativeFrames: [1, 100, 600, 1800],
  },
];

// ---------------------------------------------------------------------------
// Test config entry (from test-config.json)
// ---------------------------------------------------------------------------

interface TestConfigEntry {
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

// ---------------------------------------------------------------------------
// Result row
// ---------------------------------------------------------------------------

interface TestResult {
  pokemonName: string;
  templateId: number;
  frame: number;
  type: "match" | "negative";
  cpuScore: number;
  gpuScore: number;
  delta: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** BT.601 grayscale conversion (0-255 range) from RGBA pixel data. */
function toGrayscale(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
): Float32Array {
  const n = w * h;
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    gray[i] =
      0.299 * pixels[i * 4] +
      0.587 * pixels[i * 4 + 1] +
      0.114 * pixels[i * 4 + 2];
  }
  return gray;
}

/** CPU region scoring matching the vitest approach. */
function cpuScoreRegion(
  frameGray: Float32Array,
  frameW: number,
  frameH: number,
  tmplGray: Float32Array,
  tmplW: number,
  tmplH: number,
  region: { x: number; y: number; w: number; h: number },
): number {
  const scaleX = frameW / tmplW;
  const scaleY = frameH / tmplH;
  const baseX = Math.round(region.x * scaleX);
  const baseY = Math.round(region.y * scaleY);
  const frw = Math.max(4, Math.round(region.w * scaleX));
  const frh = Math.max(4, Math.round(region.h * scaleY));

  const [dw, dh] = fitDimensions(region.w, region.h, 512);
  const bs = adaptiveBlockSizeForRegion(dw, dh);

  // Pre-crop template
  const tmplCrop = new Float32Array(dw * dh);
  const tsx = region.w / dw;
  const tsy = region.h / dh;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const ti =
        Math.min(Math.floor(y * tsy) + region.y, tmplH - 1) * tmplW +
        Math.min(Math.floor(x * tsx) + region.x, tmplW - 1);
      tmplCrop[y * dw + x] = tmplGray[ti];
    }
  }

  // Sliding window: try small offsets around region center, keep best
  let bestScore = 0;
  const step = 4;
  const maxOffset = 4;

  for (let dy = -maxOffset; dy <= maxOffset; dy += step) {
    for (let dx = -maxOffset; dx <= maxOffset; dx += step) {
      const frx = Math.max(0, Math.min(baseX + dx, frameW - frw));
      const fry = Math.max(0, Math.min(baseY + dy, frameH - frh));

      const frameCrop = new Float32Array(dw * dh);
      const fsx = frw / dw;
      const fsy = frh / dh;
      for (let y = 0; y < dh; y++) {
        for (let x = 0; x < dw; x++) {
          const fi =
            Math.min(Math.floor(y * fsy) + fry, frameH - 1) * frameW +
            Math.min(Math.floor(x * fsx) + frx, frameW - 1);
          frameCrop[y * dw + x] = frameGray[fi];
        }
      }

      const hybrid = scoreRegionHybrid(frameCrop, tmplCrop, dw, dh, bs);
      if (hybrid > bestScore) bestScore = hybrid;
    }
  }

  return bestScore;
}

/** CPU score across all regions (AND-logic: minimum). */
function cpuScoreFrame(
  frameGray: Float32Array,
  frameW: number,
  frameH: number,
  tmplGray: Float32Array,
  tmplW: number,
  tmplH: number,
  regions: Array<{ x: number; y: number; w: number; h: number }>,
): number {
  const scores = regions.map((region) =>
    cpuScoreRegion(
      frameGray, frameW, frameH,
      tmplGray, tmplW, tmplH,
      region,
    ),
  );
  return andLogicAcrossRegions(scores);
}

/** Seek a video element to a specific time, with timeout. */
function seekVideo(
  video: HTMLVideoElement,
  timeSec: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Seek timeout at ${timeSec.toFixed(3)}s`));
    }, 5000);

    const onSeeked = () => {
      cleanup();
      resolve();
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener("seeked", onSeeked);
      signal.removeEventListener("abort", onAbort);
    };

    video.addEventListener("seeked", onSeeked, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
    video.currentTime = timeSec;
  });
}

/** Wait for a video element to have loaded metadata and data. */
function waitForVideoReady(
  video: HTMLVideoElement,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Video load timeout"));
    }, 30000);

    const onReady = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error(`Video load error: ${video.error?.message ?? "unknown"}`));
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };

    video.addEventListener("loadeddata", onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Capture a frame from a video element as RGBA pixel data. */
function captureFrame(video: HTMLVideoElement): {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const w = video.videoWidth;
  const h = video.videoHeight;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(video, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  return { pixels: imageData.data, width: w, height: h };
}

/** Group test-config entries by template, returning region rects. */
function buildRegionMap(
  config: TestConfigEntry[],
): Map<number, Array<{ x: number; y: number; w: number; h: number }>> {
  const map = new Map<
    number,
    Array<{ x: number; y: number; w: number; h: number }>
  >();
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

// ---------------------------------------------------------------------------
// Status icon component
// ---------------------------------------------------------------------------

function StatusIcon({ delta }: { delta: number }): JSX.Element {
  if (delta < 0.05) {
    return <Check className="w-4 h-4 text-green-400" aria-label="Pass" />;
  }
  if (delta < 0.10) {
    return (
      <AlertTriangle
        className="w-4 h-4 text-yellow-400"
        aria-label="Warning"
      />
    );
  }
  return <XCircle className="w-4 h-4 text-red-400" aria-label="Fail" />;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Dev-only modal for GPU/CPU equivalence testing. */
export default function GpuEquivalenceTest({
  onClose,
}: GpuEquivalenceTestProps): JSX.Element {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<TestResult[]>([]);
  const [progress, setProgress] = useState<string>("");
  const [progressPct, setProgressPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [gpuAvailable] = useState(() => WebGPUDetector.isAvailable());

  const abortRef = useRef<AbortController | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Auto-focus close button on mount
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const runTests = useCallback(async () => {
    setRunning(true);
    setResults([]);
    setError(null);
    setProgress("Initializing...");
    setProgressPct(0);

    const abort = new AbortController();
    abortRef.current = abort;
    const { signal } = abort;

    let gpuDetector: WebGPUDetector | null = null;

    try {
      // --- Load test config ---
      setProgress("Loading test-config.json...");
      const configResp = await fetch("/test-fixtures/test-config.json");
      if (!configResp.ok) {
        throw new Error(
          "Could not load /test-fixtures/test-config.json. " +
          "Make sure test fixture files are served (e.g. via Vite public dir or dev server).",
        );
      }
      const testConfig: TestConfigEntry[] = await configResp.json();
      const regionMap = buildRegionMap(testConfig);

      // --- Create GPU detector ---
      setProgress("Creating WebGPU detector...");
      gpuDetector = await WebGPUDetector.create();

      // --- Count total frames to process ---
      let totalFrames = 0;
      for (const gt of GROUND_TRUTH) {
        // Match frames: each encounter tests offsets [-5, -2, 0, 2, 5] but we report 1 result
        totalFrames += gt.encounters.length;
        totalFrames += gt.negativeFrames.length;
      }

      let completedFrames = 0;
      const allResults: TestResult[] = [];

      // --- Group GROUND_TRUTH by video to reuse video elements ---
      const byVideo = new Map<string, TemplateGT[]>();
      for (const gt of GROUND_TRUTH) {
        const list = byVideo.get(gt.videoName) ?? [];
        list.push(gt);
        byVideo.set(gt.videoName, list);
      }

      for (const [videoName, gtEntries] of byVideo) {
        if (signal.aborted) break;

        // --- Load video ---
        setProgress(`Loading video: ${videoName}.mp4...`);
        const video = document.createElement("video");
        video.preload = "auto";
        video.muted = true;
        video.crossOrigin = "anonymous";
        video.src = `/test-fixtures/${videoName}.mp4`;

        try {
          await waitForVideoReady(video, signal);
        } catch (e) {
          if (signal.aborted) break;
          // Skip this video if unavailable
          const msg = e instanceof Error ? e.message : String(e);
          setProgress(`Skipping ${videoName}: ${msg}`);
          for (const gt of gtEntries) {
            completedFrames +=
              gt.encounters.length + gt.negativeFrames.length;
          }
          setProgressPct((completedFrames / totalFrames) * 100);
          continue;
        }

        for (const gt of gtEntries) {
          if (signal.aborted) break;

          const regions = regionMap.get(gt.templateId);
          if (!regions || regions.length === 0) {
            completedFrames +=
              gt.encounters.length + gt.negativeFrames.length;
            setProgressPct((completedFrames / totalFrames) * 100);
            continue;
          }

          // --- Load template PNG ---
          const tmplUrl = `/test-fixtures/${gt.videoName}_${gt.pokemonName}_${gt.templateId}.png`;
          const tmplResp = await fetch(tmplUrl);
          if (!tmplResp.ok) {
            completedFrames +=
              gt.encounters.length + gt.negativeFrames.length;
            setProgressPct((completedFrames / totalFrames) * 100);
            continue;
          }
          const tmplBlob = await tmplResp.blob();
          const tmplBitmap = await createImageBitmap(tmplBlob);

          // Extract template grayscale for CPU scoring
          const tmplCanvas = new OffscreenCanvas(
            tmplBitmap.width,
            tmplBitmap.height,
          );
          const tmplCtx = tmplCanvas.getContext("2d")!;
          tmplCtx.drawImage(tmplBitmap, 0, 0);
          const tmplImageData = tmplCtx.getImageData(
            0, 0, tmplBitmap.width, tmplBitmap.height,
          );
          const tmplGray = toGrayscale(
            tmplImageData.data,
            tmplBitmap.width,
            tmplBitmap.height,
          );

          // Load template into GPU detector
          const gpuRegions = regions.map((r) => ({
            type: "image" as const,
            rect: r,
          }));
          const gpuTemplate = await gpuDetector.loadTemplate(
            tmplBitmap,
            gpuRegions,
          );
          if (!gpuTemplate) {
            completedFrames +=
              gt.encounters.length + gt.negativeFrames.length;
            setProgressPct((completedFrames / totalFrames) * 100);
            tmplBitmap.close();
            continue;
          }

          // --- Process match frames (with offsets) ---
          for (const enc of gt.encounters) {
            if (signal.aborted) break;

            setProgress(
              `${gt.pokemonName} (${gt.templateId}) -- Frame ${enc.matchFrame}`,
            );

            let bestCpu = 0;
            let bestGpu = 0;

            for (const offset of [-5, -2, 0, 2, 5]) {
              if (signal.aborted) break;

              const frame = enc.matchFrame + offset;
              const timeSec = frame / FPS;

              try {
                await seekVideo(video, timeSec, signal);
              } catch {
                continue;
              }

              // CPU scoring
              const captured = captureFrame(video);
              const frameGray = toGrayscale(
                captured.pixels,
                captured.width,
                captured.height,
              );
              const cpuScore = cpuScoreFrame(
                frameGray, captured.width, captured.height,
                tmplGray, tmplBitmap.width, tmplBitmap.height,
                regions,
              );

              // GPU scoring
              const gpuResult = await gpuDetector.detect(
                video,
                [gpuTemplate],
                { precision: 0 },
              );
              const gpuScore = gpuResult.bestScore;

              if (cpuScore > bestCpu) bestCpu = cpuScore;
              if (gpuScore > bestGpu) bestGpu = gpuScore;
            }

            allResults.push({
              pokemonName: gt.pokemonName,
              templateId: gt.templateId,
              frame: enc.matchFrame,
              type: "match",
              cpuScore: bestCpu,
              gpuScore: bestGpu,
              delta: Math.abs(bestCpu - bestGpu),
            });
            completedFrames++;
            setProgressPct((completedFrames / totalFrames) * 100);
            setResults([...allResults]);
          }

          // --- Process negative frames ---
          for (const negFrame of gt.negativeFrames) {
            if (signal.aborted) break;

            setProgress(
              `${gt.pokemonName} (${gt.templateId}) -- Neg frame ${negFrame}`,
            );

            const timeSec = negFrame / FPS;
            try {
              await seekVideo(video, timeSec, signal);
            } catch {
              completedFrames++;
              setProgressPct((completedFrames / totalFrames) * 100);
              continue;
            }

            // CPU scoring
            const captured = captureFrame(video);
            const frameGray = toGrayscale(
              captured.pixels,
              captured.width,
              captured.height,
            );
            const cpuScore = cpuScoreFrame(
              frameGray, captured.width, captured.height,
              tmplGray, tmplBitmap.width, tmplBitmap.height,
              regions,
            );

            // GPU scoring
            const gpuResult = await gpuDetector.detect(
              video,
              [gpuTemplate],
              { precision: 0 },
            );
            const gpuScore = gpuResult.bestScore;

            allResults.push({
              pokemonName: gt.pokemonName,
              templateId: gt.templateId,
              frame: negFrame,
              type: "negative",
              cpuScore,
              gpuScore,
              delta: Math.abs(cpuScore - gpuScore),
            });
            completedFrames++;
            setProgressPct((completedFrames / totalFrames) * 100);
            setResults([...allResults]);
          }

          tmplBitmap.close();
        }

        // Cleanup video element
        video.pause();
        video.removeAttribute("src");
        video.load();
      }

      if (signal.aborted) {
        setProgress("Cancelled.");
      } else {
        setProgress("Complete.");
        setProgressPct(100);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setProgress("Cancelled.");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setProgress("Failed.");
      }
    } finally {
      gpuDetector?.destroy();
      setRunning(false);
    }
  }, []);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // --- Summary stats ---
  const totalTests = results.length;
  const passed = results.filter((r) => r.delta < 0.05).length;
  const warned = results.filter(
    (r) => r.delta >= 0.05 && r.delta < 0.10,
  ).length;
  const failed = results.filter((r) => r.delta >= 0.10).length;
  const avgDelta =
    totalTests > 0
      ? results.reduce((sum, r) => sum + r.delta, 0) / totalTests
      : 0;
  const maxDelta =
    totalTests > 0 ? Math.max(...results.map((r) => r.delta)) : 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="GPU Equivalence Test"
    >
      <div className="bg-bg-card rounded-xl border border-border-subtle shadow-xl max-w-4xl w-full max-h-[85vh] flex flex-col">
        {/* --- Header --- */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-primary">
            GPU / CPU Equivalence Test
          </h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg-hover text-text-secondary focus-visible:outline-2 focus-visible:outline-accent"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* --- Controls --- */}
        <div className="px-6 py-3 border-b border-border-subtle space-y-3">
          <div className="flex items-center gap-3">
            {!running ? (
              <button
                onClick={runTests}
                disabled={!gpuAvailable || running}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent"
              >
                <Play className="w-4 h-4" />
                Run Test
              </button>
            ) : (
              <button
                onClick={handleCancel}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-accent"
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
            )}

            {running && (
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{progress}</span>
              </div>
            )}

            {!running && !gpuAvailable && (
              <span className="text-sm text-red-400">
                WebGPU is not available in this browser.
              </span>
            )}

            {!running && error && (
              <span className="text-sm text-red-400">{error}</span>
            )}

            {!running && !error && totalTests > 0 && (
              <span className="text-sm text-text-secondary">
                {progress}
              </span>
            )}
          </div>

          {/* Progress bar */}
          {running && (
            <div className="w-full h-2 rounded-full bg-bg-hover overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-200"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}

          {/* Summary bar */}
          {totalTests > 0 && (
            <div className="flex flex-wrap gap-4 text-xs font-mono text-text-secondary">
              <span>
                Total: <strong className="text-text-primary">{totalTests}</strong>
              </span>
              <span>
                Passed:{" "}
                <strong className="text-green-400">{passed}</strong>
              </span>
              <span>
                Warned:{" "}
                <strong className="text-yellow-400">{warned}</strong>
              </span>
              <span>
                Failed:{" "}
                <strong className="text-red-400">{failed}</strong>
              </span>
              <span>
                Avg delta:{" "}
                <strong className="text-text-primary">
                  {(avgDelta * 100).toFixed(2)}%
                </strong>
              </span>
              <span>
                Max delta:{" "}
                <strong className="text-text-primary">
                  {(maxDelta * 100).toFixed(2)}%
                </strong>
              </span>
            </div>
          )}
        </div>

        {/* --- Results table --- */}
        <div className="flex-1 overflow-auto px-6 py-3">
          {totalTests === 0 && !running ? (
            <div className="flex items-center justify-center h-40 text-text-faint text-sm">
              Press &quot;Run Test&quot; to start the equivalence test.
              Fixture files must be served at /test-fixtures/.
            </div>
          ) : (
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-left text-text-secondary border-b border-border-subtle">
                  <th className="py-2 pr-3">Pokemon (ID)</th>
                  <th className="py-2 pr-3">Frame #</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3 text-right">CPU Score</th>
                  <th className="py-2 pr-3 text-right">GPU Score</th>
                  <th className="py-2 pr-3 text-right">Delta</th>
                  <th className="py-2 pr-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr
                    key={`${r.templateId}-${r.frame}-${r.type}`}
                    className={
                      i % 2 === 0 ? "bg-transparent" : "bg-bg-hover/50"
                    }
                  >
                    <td className="py-1.5 pr-3 text-text-primary">
                      {r.pokemonName} ({r.templateId})
                    </td>
                    <td className="py-1.5 pr-3 text-text-secondary">
                      {r.frame}
                    </td>
                    <td className="py-1.5 pr-3">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          r.type === "match"
                            ? "bg-green-500/20 text-green-400"
                            : "bg-neutral-500/20 text-neutral-400"
                        }`}
                      >
                        {r.type}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-right text-text-primary">
                      {(r.cpuScore * 100).toFixed(2)}%
                    </td>
                    <td className="py-1.5 pr-3 text-right text-text-primary">
                      {(r.gpuScore * 100).toFixed(2)}%
                    </td>
                    <td
                      className={`py-1.5 pr-3 text-right ${
                        r.delta < 0.05
                          ? "text-green-400"
                          : r.delta < 0.10
                            ? "text-yellow-400"
                            : "text-red-400"
                      }`}
                    >
                      {(r.delta * 100).toFixed(2)}%
                    </td>
                    <td className="py-1.5 pr-3 text-center">
                      <StatusIcon delta={r.delta} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
