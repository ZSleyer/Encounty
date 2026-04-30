/**
 * groupsApi.ts — Thin fetch wrappers for the /api/groups REST endpoints.
 *
 * All mutations trigger a backend state_update broadcast which refreshes
 * the Zustand store, so these helpers only need to return the primary
 * resource (or void) and surface errors to the caller.
 */
import type { Group } from "../types";
import { apiUrl } from "./api";

/** Fetches all groups. Returns an empty array on failure. */
export async function listGroups(): Promise<Group[]> {
  const res = await fetch(apiUrl("/api/groups"));
  if (!res.ok) throw new Error(`listGroups failed: ${res.status}`);
  const data = (await res.json()) as { groups?: Group[] };
  return data.groups ?? [];
}

/** Creates a new group with the given name and optional color. */
export async function createGroup(name: string, color?: string): Promise<Group> {
  const res = await fetch(apiUrl("/api/groups"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color }),
  });
  if (!res.ok) throw new Error(`createGroup failed: ${res.status}`);
  return (await res.json()) as Group;
}

/** Partial-update payload accepted by PUT /api/groups/{id}. */
export interface GroupPatch {
  name?: string;
  color?: string;
  sort_order?: number;
  collapsed?: boolean;
}

/** Updates an existing group. Only the provided fields are changed server-side. */
export async function updateGroup(id: string, patch: GroupPatch): Promise<Group> {
  const res = await fetch(apiUrl(`/api/groups/${id}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`updateGroup failed: ${res.status}`);
  return (await res.json()) as Group;
}

/** Deletes a group. Pokémon in it are moved to "ungrouped" by the backend. */
export async function deleteGroup(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/groups/${id}`), { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error(`deleteGroup failed: ${res.status}`);
}

/** One entry in the start-/stop-hunt response array. */
export interface GroupHuntMember {
  id: string;
  started?: boolean;
  stopped?: boolean;
  reason?: string;
}

/** Starts hunts for every Pokémon in the group. Returns the per-member status array. */
export async function startGroupHunt(id: string): Promise<GroupHuntMember[]> {
  const res = await fetch(apiUrl(`/api/groups/${id}/start-hunt`), { method: "POST" });
  if (!res.ok) throw new Error(`startGroupHunt failed: ${res.status}`);
  const data = (await res.json()) as { members?: GroupHuntMember[] };
  return data.members ?? [];
}

/** Stops hunts for every Pokémon in the group. Returns the per-member status array. */
export async function stopGroupHunt(id: string): Promise<GroupHuntMember[]> {
  const res = await fetch(apiUrl(`/api/groups/${id}/stop-hunt`), { method: "POST" });
  if (!res.ok) throw new Error(`stopGroupHunt failed: ${res.status}`);
  const data = (await res.json()) as { members?: GroupHuntMember[] };
  return data.members ?? [];
}
