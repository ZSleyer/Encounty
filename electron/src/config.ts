/**
 * config.ts holds shared constants and environment flags for the Electron main
 * process.
 *
 * WARNING: Do NOT import this file from preload.ts, sandboxed preloads
 * can only require() built-in modules (electron, events, timers, url).
 * The port constant is inlined directly in preload.ts instead.
 */

/** Fixed backend port: 8192 = classic shiny odds (1/8192). */
export const BACKEND_PORT = 8192;

/** True when the app was started with --dev, which loads the Vite dev server. */
export const isDev = process.argv.includes("--dev");

/** True on a Linux Wayland session, which needs its own capture and Chromium flags. */
export const isWayland =
  process.platform === "linux" &&
  (!!process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === "wayland");
