/**
 * SweepTable.tsx -- Stability analysis and parameter sweep results table.
 */
import { Check, XCircle } from "lucide-react";
import type { JSX } from "react";
import { type SweepUiResult } from "./fixtures";

/** Renders one row per swept template with its recommended settings. */
export function SweepTable({
  sweepResults,
}: Readonly<{ sweepResults: SweepUiResult[] }>): JSX.Element {
  return (
    <section aria-label="Stability and sweep results">
      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
        Stability &amp; Parameter Sweep
      </h3>
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="text-left text-text-secondary border-b border-border-subtle">
            <th className="py-2 pr-3">Pokemon (ID)</th>
            <th className="py-2 pr-3">Backend</th>
            <th className="py-2 pr-3">Rating</th>
            <th className="py-2 pr-3 text-right">Precision</th>
            <th className="py-2 pr-3 text-right">Hysteresis</th>
            <th className="py-2 pr-3 text-right">Hits</th>
            <th className="py-2 pr-3 text-right">Poll (ms)</th>
            <th className="py-2 pr-3 text-right">Clean</th>
            <th className="py-2 pr-3 text-right">Margin</th>
            <th className="py-2 pr-3 text-right">Sweep (s)</th>
            <th className="py-2 pr-3 text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          {sweepResults.map((r, i) => (
            <tr
              key={`sweep-${r.templateId}-${r.backend}`}
              className={i % 2 === 0 ? "bg-transparent" : "bg-bg-hover/50"}
            >
              <td className="py-1.5 pr-3 text-text-primary">
                {r.pokemonName} ({r.templateId})
              </td>
              <td className="py-1.5 pr-3 text-text-secondary uppercase">{r.backend}</td>
              <td className="py-1.5 pr-3 text-text-secondary">{r.rating}</td>
              <td className="py-1.5 pr-3 text-right text-text-primary">{r.precision.toFixed(3)}</td>
              <td className="py-1.5 pr-3 text-right text-text-primary">
                {r.hysteresisFactor.toFixed(2)}
              </td>
              <td className="py-1.5 pr-3 text-right text-text-secondary">{r.consecutiveHits}</td>
              <td className="py-1.5 pr-3 text-right text-text-secondary">{r.pollIntervalMs}</td>
              <td className="py-1.5 pr-3 text-right text-text-primary">
                {r.cleanPhases}/{r.totalPhases}
              </td>
              <td className="py-1.5 pr-3 text-right text-text-primary">
                {r.robustnessMargin.toFixed(3)}
              </td>
              <td className="py-1.5 pr-3 text-right text-text-secondary">
                {r.sweepSeconds.toFixed(1)}
              </td>
              <td className="py-1.5 pr-3 text-center">
                {r.perfect ? (
                  <Check className="w-4 h-4 text-accent-green inline-block" aria-label="Pass" />
                ) : (
                  <XCircle className="w-4 h-4 text-accent-red inline-block" aria-label="Fail" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
