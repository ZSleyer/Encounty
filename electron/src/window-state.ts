/**
 * window-state.ts persists the window geometry and owns the UI zoom.
 *
 * Both concerns share one file on disk: the zoom factor is stored alongside the
 * bounds, so restoring a session is a single read.
 */

import { app, type BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs";
import { getMainWindow } from "./main-window";

/** Window geometry plus the extras restored with it. */
export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
  zoom?: number;
}

// Resolved by initWindowState rather than at import time, and neither eagerly
// nor lazily by accident. Electron freezes userData on the first getPath call,
// and this module is imported before app.setName runs, so resolving here would
// pin the whole Chromium profile to the package.json name. Resolving on first
// use is equally wrong: by then main.ts has re-pointed userData at the
// "electron" subdirectory, and the bounds belong one level above it.
let boundsFile = "";

/**
 * Resolves where the window geometry is stored. Call once, after app.setName
 * and before userData is re-pointed at the "electron" subdirectory.
 */
export function initWindowState(): void {
  boundsFile = path.join(app.getPath("userData"), "window-bounds.json");
}

/** Reads the stored geometry, falling back to the default window size. */
export function loadBounds(): WindowBounds {
  try {
    const raw = fs.readFileSync(boundsFile, "utf-8");
    return JSON.parse(raw) as WindowBounds;
  } catch {
    return { width: 1280, height: 720 };
  }
}

/** Writes the window's current geometry and zoom to disk. */
export function saveBounds(): void {
  const win = getMainWindow();
  if (!win) return;
  const maximized = win.isMaximized();
  // Store the restored (non-maximized) bounds so the window doesn't
  // permanently stick to full-screen dimensions after a restart.
  const bounds = maximized ? win.getNormalBounds() : win.getBounds();
  const data: WindowBounds = { ...bounds, maximized, zoom: getZoom() };
  try {
    fs.writeFileSync(boundsFile, JSON.stringify(data));
  } catch {
    /* ignore write errors */
  }
}

// --- UI zoom ------------------------------------------------------------------
//
// Windows display scaling shrinks the CSS pixel viewport: a maximised 1080p
// window reports roughly 960x533 CSS pixels at 200%. Users on such machines
// cannot make the OS scaling smaller without shrinking every other app, so the
// UI offers its own zoom on top of it.

/** Zoom factors the shortcuts step through, so the steps stay predictable. */
const ZOOM_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

const MIN_ZOOM = ZOOM_STEPS[0];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
const DEFAULT_ZOOM = 1;

/** Current zoom factor, or the default when there is no window yet. */
export function getZoom(): number {
  return getMainWindow()?.webContents.getZoomFactor() ?? DEFAULT_ZOOM;
}

/** Applies a zoom factor, clamped to the supported range, and persists it. */
export function setZoom(factor: number): number {
  const win = getMainWindow();
  if (!win) return DEFAULT_ZOOM;
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor));
  win.webContents.setZoomFactor(clamped);
  saveBounds();
  win.webContents.send("window:zoom-change", clamped);
  return clamped;
}

/** Steps to the next zoom factor in the given direction. */
function stepZoom(direction: 1 | -1): void {
  const current = getZoom();
  // Nearest step rather than exact match: the settings slider can set values
  // that are not in the list.
  const idx = ZOOM_STEPS.reduce(
    (best, step, i) => (Math.abs(step - current) < Math.abs(ZOOM_STEPS[best] - current) ? i : best),
    0,
  );
  const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, idx + direction))];
  setZoom(next);
}

/**
 * Registers Ctrl/Cmd +, - and 0 on the window.
 *
 * The application menu only exists on macOS, so the menu's zoom roles would
 * leave Windows and Linux, the platforms that actually need this, without any
 * shortcut. A before-input-event handler works everywhere.
 */
export function setupZoomShortcuts(win: BrowserWindow, saved: WindowBounds): void {
  if (saved.zoom && saved.zoom !== DEFAULT_ZOOM) {
    // The factor only sticks once the frame has committed a document.
    win.webContents.once("did-finish-load", () => {
      win.webContents.setZoomFactor(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, saved.zoom as number)));
    });
  }

  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const modifier = process.platform === "darwin" ? input.meta : input.control;
    if (!modifier || input.alt) return;

    // "+" needs both spellings: the main row reports "=" unshifted, the numpad
    // and shifted main row report "+".
    if (input.key === "+" || input.key === "=") {
      stepZoom(1);
    } else if (input.key === "-" || input.key === "_") {
      stepZoom(-1);
    } else if (input.key === "0") {
      setZoom(DEFAULT_ZOOM);
    } else {
      return;
    }
    event.preventDefault();
  });
}
