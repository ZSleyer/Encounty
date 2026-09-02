/**
 * types.ts: Shared union types of the Dashboard page.
 *
 * The Dashboard and its extracted panels, sidebars and helpers all speak in
 * the same handful of string unions; keeping them in one module avoids a
 * cycle between the page and the parts it renders.
 */

/** Tab identifiers for the right content panel. */
export type PanelTab = "counter" | "detector" | "overlay" | "statistics";

/** Which pool the sidebar list shows: running hunts or the archive. */
export type SidebarTab = "active" | "caught";

/** Order the sidebar list is sorted by. */
export type SortMode = "recent" | "name" | "encounters" | "game" | "manual";

/** Direction a sort mode is applied in. */
export type SortDir = "asc" | "desc";

/** How a hunt counts: timer only, detector only, or both together. */
export type HuntMode = "both" | "timer" | "detector";
