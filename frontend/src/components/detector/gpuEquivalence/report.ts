/**
 * report.ts -- JSON export of a finished equivalence run.
 *
 * Builds the archive report from the three result sets, copies it to the
 * clipboard and offers it as a download named after what it contains.
 */
import {
  computeParitySummaries,
  isHardCase,
  scanRowPasses,
  type FullScanResult,
  type SweepUiResult,
  type TestResult,
} from "./fixtures";

/**
 * Downloads the current results as a JSON report (and copies it to the
 * clipboard) so a run can be archived or shared without manual copy-paste.
 */
export function exportRunReport(
  results: TestResult[],
  fullScanResults: FullScanResult[],
  sweepResults: SweepUiResult[],
): void {
  const deltas = results.map((r) => r.delta);
  const exportParity = computeParitySummaries(fullScanResults);
  const fullScanSection =
    fullScanResults.length > 0
      ? {
          fullScan: {
            summary: {
              videos: new Set(fullScanResults.map((r) => r.videoName)).size,
              // Hard cases carry no pass/fail verdict; report them separately.
              passed: fullScanResults.filter((r) => !isHardCase(r) && scanRowPasses(r)).length,
              failed: fullScanResults.filter((r) => !isHardCase(r) && !scanRowPasses(r)).length,
              hardCases: fullScanResults.filter(isHardCase).length,
              totalEncountersExpected: fullScanResults.reduce(
                (sum, r) => sum + r.encountersExpected,
                0,
              ),
              totalEncountersFound: fullScanResults.reduce((sum, r) => sum + r.encountersFound, 0),
            },
            ...(exportParity.length > 0 ? { paritySummary: exportParity } : {}),
            results: fullScanResults,
          },
        }
      : {};
  const sweepSection =
    sweepResults.length > 0
      ? {
          stabilitySweep: {
            summary: {
              cases: sweepResults.length,
              passed: sweepResults.filter((r) => r.perfect).length,
              failed: sweepResults.filter((r) => !r.perfect).length,
            },
            results: sweepResults,
          },
        }
      : {};
  const report = {
    exportedAt: new Date().toISOString(),
    backend: "webgpu-vs-cpu",
    simulator: "adaptive-polling",
    summary: {
      total: results.length,
      passed: results.filter((r) => r.delta < 0.05).length,
      warned: results.filter((r) => r.delta >= 0.05 && r.delta < 0.1).length,
      failed: results.filter((r) => r.delta >= 0.1).length,
      avgDelta: deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0,
      maxDelta: deltas.length ? Math.max(...deltas) : 0,
    },
    results,
    ...fullScanSection,
    ...sweepSection,
  };
  const json = JSON.stringify(report, null, 2);
  navigator.clipboard?.writeText(json).catch(() => {
    // Clipboard may be blocked; the download below still works.
  });
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // Name the file after what it contains so multiple exports do not need
  // manual renaming (e.g. gpu-equivalence-2026-07-23-fullscan-gpu-auto.json).
  const parts = [`gpu-equivalence-${new Date().toISOString().slice(0, 10)}`];
  if (fullScanResults.length > 0) {
    // Accumulated results can mix backends/variants; name accordingly.
    const backends = new Set(fullScanResults.map((r) => r.backend));
    const variants = new Set(fullScanResults.map((r) => r.settingsVariant));
    const backendPart = backends.size === 1 ? [...backends][0] : "both";
    const variantPart = variants.size === 1 ? [...variants][0] : "mixed";
    parts.push(`fullscan-${backendPart}-${variantPart}`);
  }
  if (sweepResults.length > 0) parts.push(`sweep-${sweepResults[0].backend}`);
  a.download = `${parts.join("-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
