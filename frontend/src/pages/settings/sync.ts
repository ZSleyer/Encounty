/**
 * sync.ts: Unified Pokémon and Games sync flow driven from the settings page.
 */

import { apiUrl, wsUrl } from "../../utils/api";

/** Pokédex sync result delivered in the system_ready event. */
export interface SyncResultPayload {
  total: number;
  added: number;
  namesUpdated: number;
}

/** Aggregate sync state surfaced by `runUnifiedSync`. */
export interface SyncState {
  running: boolean;
  phase: string;
  step: string;
  error: string | null;
  done: boolean;
  result: SyncResultPayload | null;
}

/** Neutral sync state, also used to clear the "done" badge again. */
export const SYNC_IDLE: SyncState = {
  running: false,
  phase: "",
  step: "",
  error: null,
  done: false,
  result: null,
};

/**
 * Run the unified Pokémon + Games sync flow.
 *
 * Reuses the first-start `POST /api/setup/online` endpoint, which already
 * chains both syncs and broadcasts `sync_progress` / `system_ready` events
 * over the WebSocket. A short-lived dedicated socket is opened for the
 * duration of the run so that the Settings UI does not need to share
 * messages with the global app store.
 */
export function runUnifiedSync(setState: (updater: (s: SyncState) => SyncState) => void): void {
  setState(() => ({ ...SYNC_IDLE, running: true }));

  let ws: WebSocket | null = null;
  let closed = false;
  const finish = (errorMsg: string | null) => {
    if (closed) return;
    closed = true;
    if (ws) ws.close();
    setState((s) => ({ ...s, running: false, error: errorMsg, done: errorMsg === null }));
  };

  try {
    ws = new WebSocket(wsUrl());
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { type: string; payload: unknown };
        if (msg.type === "sync_progress") {
          const p = msg.payload as { phase: string; step: string; error?: string };
          if (p.step === "error" && p.error) {
            finish(p.error);
            return;
          }
          setState((s) => ({ ...s, phase: p.phase, step: p.step }));
        } else if (msg.type === "system_ready") {
          const p = msg.payload as {
            sync_result?: { total: number; added: number; namesUpdated: number };
          };
          const result = p.sync_result
            ? {
                total: p.sync_result.total,
                added: p.sync_result.added,
                namesUpdated: p.sync_result.namesUpdated,
              }
            : null;
          setState((s) => ({ ...s, running: false, error: null, done: true, result }));
          if (ws) ws.close();
        }
      } catch {
        // Ignore unparseable frames
      }
    };
    ws.onerror = () => finish("websocket error");
  } catch {
    finish("websocket failed");
    return;
  }

  fetch(apiUrl("/api/setup/online"), { method: "POST" }).catch(() => {
    finish("request failed");
  });
}
