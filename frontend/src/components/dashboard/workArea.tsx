/**
 * workArea.tsx: Layout and content routing of the scrollable work area.
 *
 * The right-hand panel hosts four very differently shaped tabs; this module
 * owns the wrapper classes each one needs and picks the content to render.
 */

import { DetectorConfig, Pokemon } from "../../types";
import { isLoopRunning } from "../../engine/DetectionLoop";
import { DetectorPanel } from "../detector/DetectorPanel";
import { StatisticsPanel } from "../shared/StatisticsPanel";

/** Returns CSS classes for the scrollable work area based on the active tab. */
function getWorkAreaClasses(tab: string): {
  innerMaxWidth: string;
  outerOverflow: string;
  outerJustify: string;
  innerHeight: string;
} {
  const innerMaxWidthMap: Record<string, string> = {
    counter: "max-w-3xl mt-0",
    overlay: "max-w-full mt-0",
    statistics: "max-w-full mt-0",
    detector: "max-w-full mt-0",
  };
  const isFullBleed = tab === "overlay" || tab === "detector";
  const needsFullHeight = isFullBleed || tab === "statistics";
  return {
    innerMaxWidth: innerMaxWidthMap[tab] ?? "max-w-2xl mt-0 pb-16",
    outerOverflow: isFullBleed ? "overflow-hidden p-0" : "overflow-y-auto p-4 md:p-8",
    outerJustify: tab === "counter" ? "justify-center" : "justify-start",
    innerHeight: needsFullHeight ? "h-full" : "",
  };
}

/** Renders the scrollable work area with tab content. */
export function renderWorkArea(tab: string, content: React.ReactNode): React.ReactNode {
  const { innerMaxWidth, outerOverflow, outerJustify, innerHeight } = getWorkAreaClasses(tab);
  return (
    <div
      className={`flex-1 flex flex-col items-center relative z-10 w-full ${outerOverflow} ${outerJustify}`}
    >
      <div className={`flex flex-col items-center w-full ${innerHeight} ${innerMaxWidth}`}>
        {content}
      </div>
    </div>
  );
}

/** Resolves the content to render for the active tab. */
export function resolveTabContent(
  tab: string,
  pokemon: Pokemon,
  renderCounterTab: (p: Pokemon) => React.ReactNode,
  renderOverlayTab: (p: Pokemon) => React.ReactNode,
  handleDetectorConfigChange: (id: string, cfg: DetectorConfig | null) => void,
  detectorStatus: Record<string, { state?: string; confidence?: number }>,
  onStopHunt?: (pokemonId: string) => void,
  isActiveRoute = true,
): React.ReactNode {
  if (tab === "counter") return renderCounterTab(pokemon);
  if (tab === "overlay") return renderOverlayTab(pokemon);
  if (tab === "detector") {
    return (
      <div className="w-full h-full">
        <DetectorPanel
          key={pokemon.id}
          pokemon={pokemon}
          onConfigChange={(cfg) => handleDetectorConfigChange(pokemon.id, cfg)}
          isRunning={
            !!pokemon.timer_started_at ||
            detectorStatus[pokemon.id] !== undefined ||
            isLoopRunning(pokemon.id)
          }
          confidence={detectorStatus[pokemon.id]?.confidence ?? 0}
          detectorState={detectorStatus[pokemon.id]?.state ?? "idle"}
          onStopHunt={() => onStopHunt?.(pokemon.id)}
        />
      </div>
    );
  }
  if (tab === "statistics") {
    // Dashboard stays mounted but display:none on other routes; an unmeasurable
    // recharts container there logs "width(0) height(0)". Drop the charts while
    // hidden, they remount at full size on return.
    if (!isActiveRoute) return null;
    return (
      <div className="w-full h-full">
        <StatisticsPanel pokemonId={pokemon.id} />
      </div>
    );
  }
  return null;
}
