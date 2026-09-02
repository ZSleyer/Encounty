/**
 * FlowLegend.tsx -- Legend row under the template editor flow timeline.
 */
import { type MatchStateSettings } from "../../engine/matchStateMachine";
import { formatPercent } from "../../utils/format";
import { flowStateColor, simulateDetectionFlow } from "./TemplateEditor.flow";

/** Legend row for the flow timeline: state colors, match count, precision. */
export function FlowLegend({
  batchResults,
  settings,
  t,
}: Readonly<{
  batchResults: Map<number, { overallScore: number }>;
  /** Draft per-template settings driving the flow preview. */
  settings: MatchStateSettings;
  t: (k: string) => string;
}>) {
  if (batchResults.size === 0) return null;
  const entries = Array.from(batchResults.entries()).sort(([a], [b]) => a - b) as [
    number,
    { overallScore: number },
  ][];
  const { states, zones } = simulateDetectionFlow(entries, settings);
  const matchCount = Array.from(states.values()).filter((s) => s === "match").length;
  const hasHysteresis = zones.some((z) => z.type === "hysteresis");
  const hasCooldown = zones.some((z) => z.type === "cooldown");

  return (
    <div className="flex items-center justify-between text-[10px] 2xl:text-xs px-1">
      <div className="flex items-center gap-3 text-text-muted">
        <span className="flex items-center gap-1.5">
          <span
            className="w-2.5 h-2.5 rounded-none inline-block"
            style={{ backgroundColor: flowStateColor("searching") }}
          />
          {t("detector.stateIdle")}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="w-2.5 h-2.5 rounded-none inline-block"
            style={{ backgroundColor: flowStateColor("match") }}
          />
          {t("detector.stateMatch")}
        </span>
        {hasHysteresis && (
          <span className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-none inline-block"
              style={{
                backgroundColor: flowStateColor("hysteresis"),
                backgroundImage:
                  "repeating-linear-gradient(135deg, transparent 0 1.5px, color-mix(in srgb, var(--bg-primary) 55%, transparent) 1.5px 2px)",
              }}
            />
            {t("detector.stateHysteresis")}
          </span>
        )}
        {hasCooldown && (
          <span className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-none inline-block"
              style={{ backgroundColor: flowStateColor("cooldown") }}
            />
            {t("detector.stateCooldown")}
          </span>
        )}
      </div>
      <span className="text-text-muted font-mono">
        {matchCount}× {t("detector.stateMatch")} · {t("detector.precision")}{" "}
        {formatPercent(settings.precision, 0)}%
      </span>
    </div>
  );
}
