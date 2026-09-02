/**
 * TemplateEditor.flow.ts -- Detection flow simulation for the editor sparkline.
 *
 * Replays the batch-test score timeline through the shared match state
 * machine and turns the resulting states into gradient segments, so the
 * preview can never diverge from the runtime detection loop.
 */
import {
  applyNoiseFloor,
  newCategoryState,
  updateMatchState,
  type MatchStateSettings,
} from "../../engine/matchStateMachine";

/** Detection flow state for each frame. */
export type FlowState = "searching" | "match" | "hysteresis" | "cooldown";

/** Zone span in the sparkline. */
export interface FlowZone {
  startIdx: number;
  endIdx: number;
  type: "hysteresis" | "cooldown";
}

/** Milliseconds per replay-buffer frame (~60fps capture), drives the virtual flow clock. */
const FLOW_FRAME_MS = 1000 / 60;

/**
 * Simulate the runtime detection flow (Searching → Match → Hysteresis →
 * Cooldown → Searching) over the batch-test score timeline.
 *
 * Every transition is delegated to the shared matchStateMachine so the
 * sparkline preview can never diverge from the real detection loop: scores
 * pass through the same noise floor, hysteresis exits use the per-template
 * factor, consecutive hits are honored, and the cooldown timer runs on a
 * virtual clock derived from the ~60fps replay buffer.
 *
 * Exported for direct unit testing (TemplateEditor.flow.test.ts).
 */
export function simulateDetectionFlow(
  entries: [number, { overallScore: number }][],
  settings: MatchStateSettings,
): { states: Map<number, FlowState>; zones: FlowZone[] } {
  const states = new Map<number, FlowState>();
  const zones: FlowZone[] = [];
  const state = newCategoryState();
  let zoneStart = -1;

  for (const [idx, r] of entries) {
    const wasInHysteresis = state.inHysteresis;
    const wasInCooldown = state.inCooldown;
    updateMatchState(state, applyNoiseFloor(r.overallScore), settings, idx * FLOW_FRAME_MS);

    if (!wasInHysteresis && state.inHysteresis) {
      // Confirmation frame: the machine just entered hysteresis.
      states.set(idx, "match");
      zoneStart = idx;
    } else if (state.inHysteresis) {
      states.set(idx, "hysteresis");
    } else if (wasInHysteresis && state.inCooldown) {
      // Hysteresis exit: close the hysteresis zone, open the cooldown zone.
      zones.push({ startIdx: zoneStart, endIdx: idx, type: "hysteresis" });
      states.set(idx, "cooldown");
      zoneStart = idx;
    } else if (state.inCooldown) {
      states.set(idx, "cooldown");
    } else if (wasInCooldown) {
      // Cooldown expiry frame: the runtime machine skips hit counting on this
      // tick, so the frame renders as searching even at a high score.
      zones.push({ startIdx: zoneStart, endIdx: idx, type: "cooldown" });
      states.set(idx, "searching");
      zoneStart = -1;
    } else {
      states.set(idx, "searching");
    }
  }

  // Close the trailing zone when the timeline ends mid-hysteresis/cooldown.
  if ((state.inHysteresis || state.inCooldown) && zoneStart >= 0 && entries.length > 0) {
    const lastIdx = entries[entries.length - 1][0];
    zones.push({
      startIdx: zoneStart,
      endIdx: lastIdx,
      type: state.inHysteresis ? "hysteresis" : "cooldown",
    });
  }

  return { states, zones };
}

/** CSS color for a flow state, matching the DetectorPanel runtime dot palette. */
export function flowStateColor(state: FlowState): string {
  switch (state) {
    case "match":
      return "var(--accent-green)";
    // A visibly more yellow-green than match (still unmistakably "green
    // family") — the diagonal hatch overlay carries the rest of the
    // distinction so the two never rely on hue alone.
    case "hysteresis":
      return "color-mix(in srgb, var(--accent-green) 45%, #d9f560)";
    case "cooldown":
      return "#a855f7";
    default:
      return "color-mix(in srgb, var(--accent-blue) 40%, transparent)";
  }
}

/** Segments narrower than this (in %) get widened so brief hits stay visible. */
const MIN_SEGMENT_PCT = 1.5;

/**
 * Widens narrow non-"searching" segments (a single-frame match spike can be
 * under a pixel wide) by pushing their shared boundary with a neighboring
 * "searching" run, so a brief hit still reads as a visible band instead of
 * vanishing into a hairline. Boundaries stay monotonic — segments share
 * edges by construction, so growing one side always shrinks its neighbor's,
 * never creating a gap or overlap.
 */
function widenNarrowSegments(bounds: number[], states: FlowState[]): number[] {
  const widened = [...bounds];
  for (let i = 0; i < states.length; i++) {
    if (states[i] === "searching") continue;
    const width = widened[i + 1] - widened[i];
    if (width >= MIN_SEGMENT_PCT) continue;
    const grow = (MIN_SEGMENT_PCT - width) / 2;
    if (i > 0 && states[i - 1] === "searching") {
      widened[i] = Math.max(widened[i - 1], widened[i] - grow);
    }
    if (i + 1 < states.length && states[i + 1] === "searching") {
      widened[i + 1] = Math.min(widened[i + 2] ?? 100, widened[i + 1] + grow);
    }
  }
  return widened;
}

/**
 * Builds a hard-stop CSS gradient of contiguous same-state runs, so the
 * timeline reads as unbroken colored segments instead of a per-frame bar
 * grid. Returns null when there's nothing to visualize yet.
 */
export function buildFlowGradient(
  entries: [number, { overallScore: number }][],
  settings: MatchStateSettings,
  maxFrame: number,
): {
  gradient: string;
  matchCount: number;
  hasHysteresis: boolean;
  hasCooldown: boolean;
  /** Percent ranges of "hysteresis" segments, for the hatch overlay. */
  hysteresisRanges: { x1: number; x2: number }[];
} | null {
  if (entries.length === 0) return null;
  const { states } = simulateDetectionFlow(entries, settings);
  const sorted = Array.from(states.entries()).sort(([a], [b]) => a - b);
  if (sorted.length === 0) return null;

  // Merge consecutive same-state frames into segments first.
  const segStates: FlowState[] = [];
  const segBoundsFrame: number[] = [sorted[0][0]];
  let segState = sorted[0][1];
  for (let i = 1; i < sorted.length; i++) {
    const [, state] = sorted[i];
    if (state !== segState) {
      segStates.push(segState);
      segBoundsFrame.push(sorted[i - 1][0]);
      segState = state;
    }
  }
  segStates.push(segState);
  segBoundsFrame.push(sorted[sorted.length - 1][0]);

  // segBoundsFrame has one more entry than segStates (shared edges); convert
  // to percent boundaries, then widen any too-narrow non-searching segment.
  const boundsPct = segBoundsFrame.map((f) => (f / maxFrame) * 100);
  boundsPct[0] = 0;
  boundsPct[boundsPct.length - 1] = 100;
  const widened = widenNarrowSegments(boundsPct, segStates);

  const stops: string[] = [];
  const hysteresisRanges: { x1: number; x2: number }[] = [];
  for (let i = 0; i < segStates.length; i++) {
    // Hysteresis segments are fully transparent in the gradient itself —
    // the hatch overlay underneath (painted first, same range) supplies the
    // actual opaque color *and* the stripe pattern, so it renders pixel-for-
    // pixel like the legend swatch instead of a washed-out transparent mix.
    // No z-index/notch tricks needed either: the native thumb (part of the
    // input's own top layer) is never at risk of being covered.
    const color = segStates[i] === "hysteresis" ? "transparent" : flowStateColor(segStates[i]);
    stops.push(`${color} ${widened[i]}%`, `${color} ${widened[i + 1]}%`);
    if (segStates[i] === "hysteresis") {
      hysteresisRanges.push({ x1: widened[i], x2: widened[i + 1] });
    }
  }

  const stateValues = Array.from(states.values());
  return {
    gradient: `linear-gradient(to right, ${stops.join(", ")})`,
    matchCount: stateValues.filter((s) => s === "match").length,
    hasHysteresis: stateValues.includes("hysteresis"),
    hasCooldown: stateValues.includes("cooldown"),
    hysteresisRanges,
  };
}
