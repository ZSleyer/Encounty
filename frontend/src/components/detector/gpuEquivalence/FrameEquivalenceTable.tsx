/**
 * FrameEquivalenceTable.tsx -- Per-frame CPU vs GPU score comparison table.
 */
import { AlertTriangle, Check, XCircle } from "lucide-react";
import type { JSX } from "react";
import { type TestResult } from "./fixtures";

/** Return a Tailwind text color class based on the delta magnitude. */
function deltaColor(delta: number): string {
  if (delta < 0.05) return "text-accent-green";
  if (delta < 0.1) return "text-accent-yellow";
  return "text-accent-red";
}

/** Pass/warn/fail icon for one frame-equivalence delta. */
function StatusIcon({ delta }: Readonly<{ delta: number }>): JSX.Element {
  if (delta < 0.05) {
    return <Check className="w-4 h-4 text-accent-green" aria-label="Pass" />;
  }
  if (delta < 0.1) {
    return <AlertTriangle className="w-4 h-4 text-accent-yellow" aria-label="Warning" />;
  }
  return <XCircle className="w-4 h-4 text-accent-red" aria-label="Fail" />;
}

/** Renders one row per scored frame with the CPU, GPU and delta scores. */
export function FrameEquivalenceTable({
  results,
  showHeading,
}: Readonly<{
  results: TestResult[];
  /** Adds the section heading, shown only when other result tables follow. */
  showHeading: boolean;
}>): JSX.Element {
  return (
    <section aria-label="Frame equivalence results">
      {showHeading && (
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
          Frame Equivalence (CPU vs GPU)
        </h3>
      )}
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
              className={i % 2 === 0 ? "bg-transparent" : "bg-bg-hover/50"}
            >
              <td className="py-1.5 pr-3 text-text-primary">
                {r.pokemonName} ({r.templateId})
              </td>
              <td className="py-1.5 pr-3 text-text-secondary">{r.frame}</td>
              <td className="py-1.5 pr-3">
                <span
                  className={`inline-block px-1.5 py-0.5 rounded-none text-[10px] font-semibold ${
                    r.type === "match"
                      ? "bg-accent-green/20 text-accent-green"
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
              <td className={`py-1.5 pr-3 text-right ${deltaColor(r.delta)}`}>
                {(r.delta * 100).toFixed(2)}%
              </td>
              <td className="py-1.5 pr-3 text-center">
                <StatusIcon delta={r.delta} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
