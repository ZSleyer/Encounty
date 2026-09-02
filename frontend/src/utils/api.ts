/**
 * api.ts: Centralized API URL construction.
 *
 * In Electron production, the preload exposes apiBaseUrl via contextBridge
 * (set dynamically from BACKEND_PORT) so API calls reach the Go backend.
 * In Vite dev mode, the proxy handles /api and /ws, so the base is empty.
 */

const API_BASE: string = globalThis.electronAPI?.apiBaseUrl ?? "";

/**
 * Base URL for links handed to the user rather than fetched by the app, above
 * all the overlay URL that goes into an OBS browser source.
 *
 * This is deliberately not the API base. The API may run over the backend's TLS
 * port, whose certificate is self-signed and pinned by Electron; an OBS browser
 * source has no way to click through the resulting warning, so anything a user
 * copies has to stay on plain http.
 */
export function overlayBaseUrl(): string {
  return globalThis.electronAPI?.overlayBaseUrl || globalThis.location.origin;
}

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
 * empty). Sends a minimal update: the backend merges non-zero fields, applies
 * the group_id it was given and carries every field the body omits over from
 * the stored entry, so nothing else changes. Fire-and-forget; the incoming
 * state_update reconciles the view.
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
