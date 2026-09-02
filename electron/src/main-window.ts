/**
 * main-window.ts holds the reference to the application's single window.
 *
 * main.ts creates the window, but window state, metrics and the IPC handlers
 * all need to reach it. Keeping the reference here avoids threading it through
 * every caller and keeps a single place that knows whether a window exists.
 */

import type { BrowserWindow } from "electron";

let mainWindow: BrowserWindow | null = null;

/** Returns the application window, or null while there is none. */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/** Stores the application window, or null once it has been closed. */
export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}
