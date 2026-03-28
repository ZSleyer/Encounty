/**
 * config.ts — Shared constants for the Electron main process.
 *
 * WARNING: Do NOT import this file from preload.ts — sandboxed preloads
 * can only require() built-in modules (electron, events, timers, url).
 * The port constant is inlined directly in preload.ts instead.
 */

/** Fixed backend port — 8192 = classic shiny odds (1/8192). */
export const BACKEND_PORT = 8192;
