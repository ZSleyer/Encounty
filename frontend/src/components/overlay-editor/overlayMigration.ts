/**
 * Migration of stored overlay settings: fills in the elements a saved overlay
 * predates and pulls a filled-in element back inside the stored canvas. Both
 * rules mirror their Go counterparts in backend/internal/state/persist.go.
 */
import { OverlaySettings, OverlayElementBase } from "../../types";
import { buildDefaultOverlaySettings, type Translate } from "./overlayTemplates";

/** Elements that were added after the first release and may be absent in stored settings. */
const MIGRATABLE_ELEMENT_KEYS = [
  "title",
  "timer",
  "odds",
  "phase",
  "total_counter",
  "total_timer",
] as const;

/**
 * fillMissingElements substitutes the default element for every overlay
 * element that predates the stored settings. A zero-sized element counts as
 * missing because that is how older backends persisted an unknown element.
 * Without it the layer list and the canvas would read `undefined.visible`.
 *
 * The substitute is always hidden, mirroring the Go copy of this rule in
 * backend/internal/state/persist.go: a layer the user never had must not
 * switch itself on just because a newer default ships it visible.
 *
 * It takes the translator because the substitute carries a caption, and a
 * caption is stored text: filling a missing layer in must write it in the
 * language the user is running.
 *
 * Exported for its own test: driving it through the component would only show
 * that a filled layer appears in the layer list, not where it was placed.
 */
export function fillMissingElements(settings: OverlaySettings, t: Translate): OverlaySettings {
  const filled = { ...settings };
  let defaults: OverlaySettings | null = null;
  for (const key of MIGRATABLE_ELEMENT_KEYS) {
    const el = filled[key];
    if (!el || (el.width === 0 && el.height === 0)) {
      defaults ??= buildDefaultOverlaySettings(t);
      // Structural assignment across a union of element shapes; the key always
      // picks the default of its own element type.
      const substitute = { ...defaults[key], visible: false } as OverlayElementBase;
      clampIntoCanvas(substitute, settings);
      (filled as Record<string, unknown>)[key] = substitute;
    }
  }
  return filled;
}

/**
 * Pulls a substituted element back inside the stored canvas. The defaults are
 * laid out for the current default canvas, which is taller than the one an
 * older overlay was saved with, so a filled-in layer would otherwise sit below
 * the panel and show up outside it the moment the user switches it on.
 *
 * Mirrors clampIntoCanvas in backend/internal/state/persist.go. The backend
 * normally clamps before the editor ever sees the state, so this is the safety
 * net for any path that does not go through it.
 */
function clampIntoCanvas(el: OverlayElementBase, canvas: OverlaySettings): void {
  if (canvas.canvas_width > 0 && el.x + el.width > canvas.canvas_width) {
    el.x = Math.max(0, canvas.canvas_width - el.width);
  }
  if (canvas.canvas_height > 0 && el.y + el.height > canvas.canvas_height) {
    el.y = Math.max(0, canvas.canvas_height - el.height);
  }
}
