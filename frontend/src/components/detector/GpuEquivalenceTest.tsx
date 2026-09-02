/**
 * GpuEquivalenceTest -- dev-only modal that runs detection tests using both
 * CPU (math.ts) and GPU (WebGPUDetector) backends in the browser, comparing
 * their scores on identical video frames from the test fixture suite.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { X, Play, Loader2, Download } from "lucide-react";
import { useModalDialog } from "../../hooks/useModalDialog";
import { WebGPUDetector } from "../../engine/WebGPUDetector";
import {
  computeParitySummaries,
  countTotalFrames,
  groupByVideo,
  isHardCase,
  scanRowPasses,
  type FullScanResult,
  type ScanBackend,
  type SettingsVariant,
  type SweepUiResult,
  type TestResult,
} from "./gpuEquivalence/fixtures";
import {
  fullScanVideoGroup,
  initTestEnvironment,
  processVideoGroup,
  runSweepCases,
  type FullScanRunContext,
  type ScanOptions,
} from "./gpuEquivalence/scan";
import { exportRunReport } from "./gpuEquivalence/report";
import { FrameEquivalenceTable } from "./gpuEquivalence/FrameEquivalenceTable";
import { FullScanTable } from "./gpuEquivalence/FullScanTable";
import { SweepTable } from "./gpuEquivalence/SweepTable";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GpuEquivalenceTestProps {
  onClose: () => void;
}

/** Dev-only modal for GPU/CPU equivalence testing. */
export default function GpuEquivalenceTest({
  onClose,
}: Readonly<GpuEquivalenceTestProps>): JSX.Element {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<TestResult[]>([]);
  const [fullScanResults, setFullScanResults] = useState<FullScanResult[]>([]);
  const [sweepResults, setSweepResults] = useState<SweepUiResult[]>([]);
  const [backend, setBackend] = useState<ScanBackend>("gpu");
  const [settingsVariant, setSettingsVariant] = useState<SettingsVariant>("recommended");
  const [progress, setProgress] = useState<string>("");
  const [progressPct, setProgressPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [gpuAvailable] = useState(() => WebGPUDetector.isAvailable());

  const abortRef = useRef<AbortController | null>(null);
  // showModal() on mount, backdrop click and the CRT close transition all come
  // from the shared modal lifecycle; the close button carries data-autofocus so
  // it keeps the initial focus it had before.
  const { dialogRef, requestClose } = useModalDialog({ onClose });

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
      const { groundTruth, regionMap, detector } = await initTestEnvironment(setProgress);
      if (!detector) throw new Error("WebGPU is not available.");
      gpuDetector = detector;

      const totalFrames = countTotalFrames(groundTruth);
      let completedFrames = 0;
      const allResults: TestResult[] = [];

      const updateProgress = (frames: number) => {
        completedFrames += frames;
        setProgressPct((completedFrames / totalFrames) * 100);
      };

      const publishResults = () => {
        setResults([...allResults]);
      };

      const ctx = { signal, allResults, setProgress, updateProgress, publishResults };

      for (const [videoName, gtEntries] of groupByVideo(groundTruth)) {
        if (signal.aborted) break;
        await processVideoGroup(videoName, gtEntries, regionMap, detector, ctx);
      }

      setProgress(signal.aborted ? "Cancelled." : "Complete.");
      if (!signal.aborted) setProgressPct(100);
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

  /**
   * Runs the full-video scan on the selected backend and settings variant:
   * samples a dense 0.1s grid and replays it through the loop-faithful
   * adaptive polling simulator (encounters counted as hysteresis entries).
   * Results accumulate across runs keyed by backend, settings variant and
   * template; re-running a combination replaces only its own rows, so GPU
   * and CPU runs can be compared side by side for parity.
   */
  const runFullScan = useCallback(async () => {
    setRunning(true);
    setError(null);
    setProgress("Initializing...");
    setProgressPct(0);

    const abort = new AbortController();
    abortRef.current = abort;
    const { signal } = abort;

    let gpuDetector: WebGPUDetector | null = null;

    try {
      const { groundTruth, regionMap, detector } = await initTestEnvironment(
        setProgress,
        backend === "gpu",
      );
      if (backend === "gpu" && !detector) throw new Error("WebGPU is not available.");
      gpuDetector = detector;

      const totalTemplates = groundTruth.length;
      let templatesDone = 0;

      const ctx: FullScanRunContext = {
        signal,
        setProgress,
        reportFraction: (fraction: number) => {
          setProgressPct(((templatesDone + fraction) / totalTemplates) * 100);
        },
        advanceTemplate: () => {
          templatesDone += 1;
          setProgressPct((templatesDone / totalTemplates) * 100);
        },
        // Upsert by (backend, settingsVariant, templateId) so results
        // accumulate across runs and only same-combination rows get replaced.
        publish: (result: FullScanResult) => {
          setFullScanResults((prev) => [
            ...prev.filter(
              (r) =>
                r.backend !== result.backend ||
                r.settingsVariant !== result.settingsVariant ||
                r.templateId !== result.templateId,
            ),
            result,
          ]);
        },
      };

      const opts: ScanOptions = { backend, settingsVariant };
      for (const [videoName, gtEntries] of groupByVideo(groundTruth)) {
        if (signal.aborted) break;
        await fullScanVideoGroup(videoName, gtEntries, regionMap, gpuDetector, opts, ctx);
      }

      setProgress(signal.aborted ? "Cancelled." : "Complete.");
      if (!signal.aborted) setProgressPct(100);
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
  }, [backend, settingsVariant]);

  /**
   * Runs the stability analysis and parameter sweep for the fixture entries
   * that declare a sweepCase on the selected backend (mirrors the node
   * suite's "Parameter Sweep on Real Captures").
   */
  const runSweep = useCallback(async () => {
    setRunning(true);
    setSweepResults([]);
    setError(null);
    setProgress("Initializing...");
    setProgressPct(0);

    const abort = new AbortController();
    abortRef.current = abort;
    const { signal } = abort;

    let gpuDetector: WebGPUDetector | null = null;

    try {
      const { groundTruth, regionMap, detector } = await initTestEnvironment(
        setProgress,
        backend === "gpu",
      );
      if (backend === "gpu" && !detector) throw new Error("WebGPU is not available.");
      gpuDetector = detector;

      const rows: SweepUiResult[] = [];
      await runSweepCases(
        groundTruth,
        regionMap,
        gpuDetector,
        backend,
        signal,
        setProgress,
        (fraction) => setProgressPct(fraction * 100),
        (row) => {
          rows.push(row);
          setSweepResults([...rows]);
        },
      );

      setProgress(signal.aborted ? "Cancelled." : "Complete.");
      if (!signal.aborted) setProgressPct(100);
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
  }, [backend]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const exportResults = useCallback(() => {
    exportRunReport(results, fullScanResults, sweepResults);
  }, [results, fullScanResults, sweepResults]);

  // Dev console access: __gpuEquivalence.run() / .runFullScan() / .runSweep()
  // / .export() while the modal is open, so runs can be scripted from
  // DevTools. Full scan and sweep honor the backend/settings toggles.
  useEffect(() => {
    const g = globalThis as unknown as { __gpuEquivalence?: unknown };
    g.__gpuEquivalence = { run: runTests, runFullScan, runSweep, export: exportResults };
    return () => {
      delete g.__gpuEquivalence;
    };
  }, [runTests, runFullScan, runSweep, exportResults]);

  // --- Summary stats ---
  const totalTests = results.length;
  const passed = results.filter((r) => r.delta < 0.05).length;
  const warned = results.filter((r) => r.delta >= 0.05 && r.delta < 0.1).length;
  const failed = results.filter((r) => r.delta >= 0.1).length;
  const avgDelta = totalTests > 0 ? results.reduce((sum, r) => sum + r.delta, 0) / totalTests : 0;
  const maxDelta = totalTests > 0 ? Math.max(...results.map((r) => r.delta)) : 0;

  // --- Full-scan summary stats ---
  // Hard cases (loopTestable === false) get no pass/fail verdict; they are
  // shown with a badge and only count toward the GPU==CPU parity check.
  const scanTotal = fullScanResults.length;
  const scanVideos = new Set(fullScanResults.map((r) => r.videoName)).size;
  const scanVerdictRows = fullScanResults.filter((r) => !isHardCase(r));
  const scanHardCases = scanTotal - scanVerdictRows.length;
  const scanPassed = scanVerdictRows.filter(scanRowPasses).length;
  const scanFailed = scanVerdictRows.length - scanPassed;
  const paritySummaries = computeParitySummaries(fullScanResults);
  // Stable ordering with GPU/CPU rows of the same template adjacent, so the
  // accumulated table stays readable across runs.
  const sortedScanResults = [...fullScanResults].sort(
    (a, b) =>
      a.videoName.localeCompare(b.videoName) ||
      a.templateId - b.templateId ||
      a.settingsVariant.localeCompare(b.settingsVariant) ||
      a.backend.localeCompare(b.backend),
  );
  const scanExpectedTotal = fullScanResults.reduce((sum, r) => sum + r.encountersExpected, 0);
  const scanFoundTotal = fullScanResults.reduce((sum, r) => sum + r.encountersFound, 0);

  return (
    <dialog
      ref={dialogRef}
      onCancel={requestClose}
      className="fixed inset-0 z-50 bg-black/60 flex items-center-safe justify-center-safe m-0 p-0 border-none max-w-none max-h-none w-full h-full"
      aria-label="GPU Equivalence Test"
    >
      <div className="bg-bg-card rounded-none border border-border-subtle shadow-xl max-w-4xl w-full max-h-[85vh] flex flex-col">
        {/* --- Header --- */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-primary">GPU / CPU Equivalence Test</h2>
          <button
            data-autofocus
            onClick={requestClose}
            className="p-1.5 rounded-none hover:bg-bg-hover text-text-secondary focus-visible:outline-2 focus-visible:outline-accent-blue"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* --- Controls --- */}
        <div className="px-6 py-3 border-b border-border-subtle space-y-3">
          {/* Options for full scan and sweep runs */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-text-secondary">
            <span className="font-semibold uppercase tracking-wider">Backend</span>
            <div className="flex border border-border-subtle rounded-none overflow-hidden">
              {(["gpu", "cpu"] as const).map((b) => (
                <button
                  key={b}
                  onClick={() => setBackend(b)}
                  disabled={running}
                  className={`px-3 py-1 font-medium uppercase ${
                    backend === b
                      ? "bg-accent-blue/15 text-accent-blue"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  {b.toUpperCase()}
                </button>
              ))}
            </div>
            <span className="font-semibold uppercase tracking-wider">Settings</span>
            <div className="flex border border-border-subtle rounded-none overflow-hidden">
              {(["recommended", "auto"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setSettingsVariant(v)}
                  disabled={running}
                  className={`px-3 py-1 font-medium capitalize ${
                    settingsVariant === v
                      ? "bg-accent-blue/15 text-accent-blue"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  {v === "auto" ? "Auto (sweep)" : "Recommended"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {running ? (
              <button
                onClick={handleCancel}
                className="flex items-center gap-2 px-4 py-2 rounded-none bg-accent-red text-bg-primary font-medium hover:bg-accent-red/80 focus-visible:outline-2 focus-visible:outline-accent-blue"
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
            ) : (
              <>
                <button
                  onClick={runTests}
                  disabled={!gpuAvailable || running}
                  className="flex items-center gap-2 px-4 py-2 rounded-none bg-accent-blue text-bg-primary font-medium hover:bg-accent-blue/80 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent-blue"
                >
                  <Play className="w-4 h-4" />
                  Run Test
                </button>
                <button
                  onClick={runFullScan}
                  disabled={(backend === "gpu" && !gpuAvailable) || running}
                  className="flex items-center gap-2 px-4 py-2 rounded-none border border-accent-blue text-accent-blue font-medium hover:bg-accent-blue/10 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent-blue"
                >
                  <Play className="w-4 h-4" />
                  Full Scan
                </button>
                <button
                  onClick={runSweep}
                  disabled={(backend === "gpu" && !gpuAvailable) || running}
                  className="flex items-center gap-2 px-4 py-2 rounded-none border border-accent-blue text-accent-blue font-medium hover:bg-accent-blue/10 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent-blue"
                >
                  <Play className="w-4 h-4" />
                  Stability &amp; Sweep
                </button>
              </>
            )}

            {running && (
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{progress}</span>
              </div>
            )}

            {!running && !gpuAvailable && (
              <span className="text-sm text-accent-red">
                WebGPU is not available in this browser.
              </span>
            )}

            {!running && error && <span className="text-sm text-accent-red">{error}</span>}

            {!running && (totalTests > 0 || scanTotal > 0 || sweepResults.length > 0) && (
              <button
                onClick={exportResults}
                className="flex items-center gap-2 px-4 py-2 rounded-none border border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent-blue focus-visible:outline-2 focus-visible:outline-accent-blue"
              >
                <Download className="w-4 h-4" />
                Export JSON
              </button>
            )}

            {!running && scanTotal > 0 && (
              <button
                onClick={() => setFullScanResults([])}
                className="flex items-center gap-2 px-4 py-2 rounded-none border border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent-red focus-visible:outline-2 focus-visible:outline-accent-blue"
              >
                <X className="w-4 h-4" />
                Clear results
              </button>
            )}

            {!running && !error && (totalTests > 0 || scanTotal > 0 || sweepResults.length > 0) && (
              <span className="text-sm text-text-secondary">{progress}</span>
            )}
          </div>

          {/* Progress bar */}
          {running && (
            <div className="w-full h-2 rounded-none bg-bg-hover overflow-hidden">
              <div
                className="h-full bg-accent-blue rounded-none transition-all duration-200"
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
                Passed: <strong className="text-accent-green">{passed}</strong>
              </span>
              <span>
                Warned: <strong className="text-accent-yellow">{warned}</strong>
              </span>
              <span>
                Failed: <strong className="text-accent-red">{failed}</strong>
              </span>
              <span>
                Avg delta:{" "}
                <strong className="text-text-primary">{(avgDelta * 100).toFixed(2)}%</strong>
              </span>
              <span>
                Max delta:{" "}
                <strong className="text-text-primary">{(maxDelta * 100).toFixed(2)}%</strong>
              </span>
            </div>
          )}

          {/* Full-scan summary bar */}
          {scanTotal > 0 && (
            <div className="flex flex-wrap gap-4 text-xs font-mono text-text-secondary">
              <span>
                Scan videos: <strong className="text-text-primary">{scanVideos}</strong>
              </span>
              <span>
                Scan passed: <strong className="text-accent-green">{scanPassed}</strong>
              </span>
              <span>
                Scan failed: <strong className="text-accent-red">{scanFailed}</strong>
              </span>
              {scanHardCases > 0 && (
                <span>
                  Hard cases: <strong className="text-accent-yellow">{scanHardCases}</strong>
                </span>
              )}
              <span>
                Encounters:{" "}
                <strong className="text-text-primary">
                  {scanFoundTotal}/{scanExpectedTotal}
                </strong>
              </span>
            </div>
          )}
        </div>

        {/* --- Results tables --- */}
        <div className="flex-1 overflow-auto px-6 py-3">
          {totalTests === 0 && scanTotal === 0 && sweepResults.length === 0 && !running ? (
            <div className="flex items-center justify-center h-40 text-text-faint text-sm">
              Press &quot;Run Test&quot; for the frame equivalence test, &quot;Full Scan&quot; for
              the full-video encounter scan, or &quot;Stability &amp; Sweep&quot; for the
              calibration check. Fixture files must be served at /test-fixtures/.
            </div>
          ) : (
            <div className="space-y-6">
              {totalTests > 0 && (
                <FrameEquivalenceTable results={results} showHeading={scanTotal > 0} />
              )}

              {scanTotal > 0 && (
                <FullScanTable
                  paritySummaries={paritySummaries}
                  sortedScanResults={sortedScanResults}
                />
              )}

              {sweepResults.length > 0 && <SweepTable sweepResults={sweepResults} />}
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
