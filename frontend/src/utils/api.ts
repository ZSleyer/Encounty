/**
 * api.ts — Centralized API URL construction.
 *
 * In Electron, the preload script sets __ENCOUNTY_API_BASE__ to
 * "http://localhost:8080" so API calls reach the Go backend.
 * In Vite dev mode, the proxy handles /api and /ws, so the base is empty.
 */

declare global {
  var __ENCOUNTY_API_BASE__: string | undefined;
}

const API_BASE: string = globalThis.__ENCOUNTY_API_BASE__ ?? "";

/** Build a full URL for an API endpoint path (e.g. "/api/state"). */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

/** Build the WebSocket URL for the /ws endpoint. */
export function wsUrl(): string {
  if (API_BASE) {
    return API_BASE.replace(/^http/, "ws") + "/ws";
  }
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}
