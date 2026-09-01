/**
 * manualEntry.ts: writing a hand-entered catch through the hunt API.
 *
 * A catch entered after the fact is an ordinary completed hunt entry marked
 * with an entry source. Creating one is a single POST, because the add
 * endpoint takes the whole entry. Updating one is a sequence: the update
 * endpoint deliberately ignores the fields that have their own routes
 * (encounters, timer, catch metadata, completion date), so each of those is
 * written separately, exactly as the dashboard's own save does.
 */
import type { CatchMeta, Pokemon, PokemonGender, ShinyVariant } from "../types";
import { apiUrl } from "./api";

/** Everything the dex editor can record about a hand-entered catch. */
export interface ManualEntryInput {
  /** Set when an existing entry is being edited. */
  id?: string;
  canonical_name: string;
  name: string;
  base_name?: string;
  form_name?: string;
  gender?: PokemonGender;
  game: string;
  hunt_type: string;
  shiny_charm?: boolean;
  sparkling_power?: number;
  shiny_variant?: ShinyVariant;
  /** RFC3339 timestamp; required, a hand-entered catch is finished by definition. */
  completed_at: string;
  encounters: number;
  timer_accumulated_ms: number;
  /** True when the shiny was sighted but never caught. */
  failed?: boolean;
  catch?: CatchMeta;
  language?: string;
  pokedex_ids?: string[];
  /** Organisational fields the full hunt editor owns. */
  title?: string;
  tags?: string[];
  group_id?: string;
  sprite_url?: string;
  sprite_type?: string;
  sprite_style?: string;
  step?: number;
  /** Id of the entry this one is a phase of. */
  phase_of?: string;
  phase_number?: number;
}

async function send(path: string, method: string, body: unknown): Promise<Response> {
  const response = await fetch(apiUrl(path), {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path} failed`);
  return response;
}

/**
 * Creates a hand-entered catch and resolves with the persisted entry, so a
 * caller can attach phases to an entry it just created.
 */
export async function createManualEntry(input: ManualEntryInput): Promise<Pokemon> {
  const response = await send("/api/pokemon", "POST", {
    ...input,
    entry_source: "manual",
    sprite_type: "shiny",
    is_active: false,
  });
  return await response.json() as Pokemon;
}

/**
 * Applies every change of an existing hand-entered catch. The counters, the
 * catch metadata and the completion date each go through their own endpoint
 * because the update endpoint leaves them alone by design.
 */
export async function updateManualEntry(input: ManualEntryInput & { id: string }, previous?: Pokemon): Promise<void> {
  await send(`/api/pokemon/${input.id}`, "PUT", {
    ...previous,
    ...input,
    entry_source: "manual",
  });
  if (input.encounters !== previous?.encounters) {
    await send(`/api/pokemon/${input.id}/set_encounters`, "POST", { count: input.encounters });
  }
  if (input.timer_accumulated_ms !== (previous?.timer_accumulated_ms ?? 0)) {
    await send(`/api/pokemon/${input.id}/timer/set`, "POST", { ms: input.timer_accumulated_ms });
  }
  if (input.completed_at !== previous?.completed_at) {
    await send(`/api/pokemon/${input.id}/completed_at`, "PUT", { completed_at: input.completed_at });
  }
  await send(`/api/pokemon/${input.id}/catch`, "PUT", { ...(input.catch ?? {}), gender: input.gender });
}

/** Creates or updates in one call, resolving with the entry's id. */
export async function saveManualEntry(input: ManualEntryInput, previous?: Pokemon): Promise<string> {
  if (input.id) {
    await updateManualEntry({ ...input, id: input.id }, previous);
    return input.id;
  }
  const created = await createManualEntry(input);
  return created.id;
}

/** Removes a hand-entered catch. Its phases stay behind as orphans, like a deleted hunt's. */
export async function deleteManualEntry(id: string): Promise<void> {
  const response = await fetch(apiUrl(`/api/pokemon/${id}`), { method: "DELETE" });
  if (!response.ok) throw new Error("delete entry failed");
}

/**
 * Splits a stored timestamp into the two values the editor's date and time
 * inputs hold. An entry recorded at local midnight leaves the time empty, so
 * a date carried over from a date-only record does not claim a precision it
 * never had.
 */
export function splitTimestamp(value: string | undefined): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    // A bare date, which is what every record predating the time field holds.
    return { date: value.slice(0, 10), time: "" };
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  const midnight = parsed.getHours() === 0 && parsed.getMinutes() === 0;
  return { date, time: midnight ? "" : `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}` };
}

/**
 * Builds the stored timestamp from the two inputs. An untouched time means
 * local midnight, which is also what a migrated date-only record carries.
 * An empty date yields an empty string, so a caller can reject it.
 */
export function composeTimestamp(date: string, time: string): string {
  if (!date) return "";
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time ? time.split(":").map(Number) : [0, 0];
  return new Date(year, (month ?? 1) - 1, day ?? 1, hours ?? 0, minutes ?? 0).toISOString();
}
