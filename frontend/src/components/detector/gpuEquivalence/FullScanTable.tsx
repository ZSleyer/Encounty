/**
 * FullScanTable.tsx -- Full video scan results and GPU/CPU parity summary.
 */
import { Check, XCircle } from "lucide-react";
import type { JSX } from "react";
import { isHardCase, scanRowPasses, type FullScanResult, type ParitySummary } from "./fixtures";

/** Text color for the encounters cell of a full-scan row. */
function encounterCellColor(hardCase: boolean, pass: boolean): string {
  if (hardCase) return "text-accent-yellow";
  return pass ? "text-accent-green" : "text-accent-red";
}

/**
 * Status cell of a full-scan row: hard cases get a badge instead of a
 * pass/fail verdict (they only count toward the GPU==CPU parity check).
 */
function ScanRowStatus({
  hardCase,
  pass,
}: Readonly<{ hardCase: boolean; pass: boolean }>): JSX.Element {
  if (hardCase) {
    return (
      <span
        className="inline-block px-1.5 py-0.5 rounded-none text-[10px] font-semibold bg-accent-yellow/20 text-accent-yellow"
        title="Deliberate hard case: excluded from pass/fail, still compared for GPU==CPU parity"
      >
        hard case
      </span>
    );
  }
  if (pass) {
    return <Check className="w-4 h-4 text-accent-green inline-block" aria-label="Pass" />;
  }
  return <XCircle className="w-4 h-4 text-accent-red inline-block" aria-label="Fail" />;
}

/** Renders the full-scan parity lines and one row per scanned template. */
export function FullScanTable({
  paritySummaries,
  sortedScanResults,
}: Readonly<{
  paritySummaries: ParitySummary[];
  /** Scan rows already ordered so GPU and CPU rows of a template are adjacent. */
  sortedScanResults: FullScanResult[];
}>): JSX.Element {
  return (
    <section aria-label="Full video scan results">
      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
        Full Video Scan
      </h3>
      {/* Parity is the primary verdict: same encounter counts on
          both backends. Ground-truth pass/fail stays as the
          secondary per-row status. */}
      {paritySummaries.length > 0 && (
        <div className="mb-2 space-y-1">
          {paritySummaries.map((p) => (
            <p
              key={`parity-${p.settingsVariant}`}
              className={`text-sm font-mono font-semibold ${
                p.identical === p.total ? "text-accent-green" : "text-accent-red"
              }`}
            >
              Parity GPU==CPU ({p.settingsVariant}): {p.identical}/{p.total} identical
            </p>
          ))}
        </div>
      )}
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="text-left text-text-secondary border-b border-border-subtle">
            <th className="py-2 pr-3">Pokemon (ID)</th>
            <th className="py-2 pr-3">Video</th>
            <th className="py-2 pr-3">Backend</th>
            <th className="py-2 pr-3">Settings</th>
            <th className="py-2 pr-3 text-right">Encounters</th>
            <th className="py-2 pr-3 text-right">Match Frames</th>
            <th className="py-2 pr-3 text-right">Sampled</th>
            <th className="py-2 pr-3 text-right">Polled</th>
            <th className="py-2 pr-3 text-right">Max Score</th>
            <th className="py-2 pr-3 text-right">Scan (s)</th>
            <th className="py-2 pr-3 text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          {sortedScanResults.map((r, i) => {
            const hardCase = isHardCase(r);
            const pass = scanRowPasses(r);
            return (
              <tr
                key={`scan-${r.videoName}-${r.templateId}-${r.backend}-${r.settingsVariant}`}
                className={i % 2 === 0 ? "bg-transparent" : "bg-bg-hover/50"}
              >
                <td className="py-1.5 pr-3 text-text-primary">
                  {r.pokemonName} ({r.templateId})
                </td>
                <td className="py-1.5 pr-3 text-text-secondary">{r.videoName}</td>
                <td className="py-1.5 pr-3 text-text-secondary uppercase">{r.backend}</td>
                <td className="py-1.5 pr-3 text-text-secondary">{r.settingsVariant}</td>
                <td
                  className={`py-1.5 pr-3 text-right ${encounterCellColor(hardCase, pass)}`}
                  title={r.encounterSpans
                    .map(
                      (span, i) =>
                        `${i + 1}: ${span.startFrame}f-${span.endFrame}f (peak ${(span.peakScore * 100).toFixed(1)}%)`,
                    )
                    .join("\n")}
                >
                  {r.encountersFound}/{r.encountersExpected}
                </td>
                <td className="py-1.5 pr-3 text-right text-text-primary">{r.matchFrames}</td>
                <td className="py-1.5 pr-3 text-right text-text-secondary">{r.sampledFrames}</td>
                <td className="py-1.5 pr-3 text-right text-text-secondary">{r.polledSamples}</td>
                <td className="py-1.5 pr-3 text-right text-text-primary">
                  {(r.maxScore * 100).toFixed(2)}%
                </td>
                <td className="py-1.5 pr-3 text-right text-text-secondary">
                  {r.scanSeconds.toFixed(1)}
                </td>
                <td className="py-1.5 pr-3 text-center">
                  <ScanRowStatus hardCase={hardCase} pass={pass} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
