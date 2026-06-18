/**
 * api.ts — Centralized API URL construction.
 *
 * In Electron production, the preload exposes apiBaseUrl via contextBridge
 * (set dynamically from BACKEND_PORT) so API calls reach the Go backend.
 * In Vite dev mode, the proxy handles /api and /ws, so the base is empty.
 */

const API_BASE: string = globalThis.electronAPI?.apiBaseUrl ?? "";

/** Build a full URL for an API endpoint path (e.g. "/api/state"). */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

/**
 * Persist a manual Pokémon ordering. `order` is the full list of Pokémon ids
 * in their new sidebar sequence; the backend assigns each a zero-based
 * sort_order and broadcasts the updated state. Fire-and-forget; the incoming
 * state_update reconciles the view.
 */
export async function reorderPokemon(order: string[]): Promise<void> {
  const res = await fetch(apiUrl("/api/pokemon/reorder"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order }),
  });
  if (!res.ok) throw new Error(`reorderPokemon failed: ${res.status}`);
}

/**
 * Reassign a Pokémon to a different group (or to no group when `groupId` is
 * empty). Sends a minimal update; the backend merges non-zero fields and always
 * overwrites group_id, so other Pokémon fields are preserved. Fire-and-forget;
 * the incoming state_update reconciles the view.
 */
export async function setPokemonGroup(id: string, groupId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/pokemon/${id}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ group_id: groupId }),
  });
  if (!res.ok) throw new Error(`setPokemonGroup failed: ${res.status}`);
}

/** Build the WebSocket URL for the /ws endpoint. */
export function wsUrl(): string {
  if (API_BASE) {
    return API_BASE.replace(/^http/, "ws") + "/ws";
  }
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}
