import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Pokemon } from "../types";
import {
  createManualEntry,
  deleteManualEntry,
  saveManualEntry,
  updateManualEntry,
  type ManualEntryInput,
} from "./manualEntry";

function input(overrides: Partial<ManualEntryInput> = {}): ManualEntryInput {
  return {
    canonical_name: "vulpix",
    name: "Vulpix",
    game: "pokemon-scarlet",
    hunt_type: "encounter",
    completed_at: "2024-05-01T00:00:00.000Z",
    encounters: 400,
    timer_accumulated_ms: 0,
    ...overrides,
  };
}

/** Records every request so the call sequence itself can be asserted. */
function mockFetch(created: Partial<Pokemon> = { id: "new-id" }) {
  const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
      });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(created) });
    }),
  );
  return calls;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("manualEntry", () => {
  it("creates an entry in a single request carrying the marker", async () => {
    const calls = mockFetch({ id: "created" });

    const entry = await createManualEntry(input());

    expect(entry.id).toBe("created");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/api/pokemon");
    expect(calls[0].body).toMatchObject({
      entry_source: "manual",
      is_active: false,
      completed_at: "2024-05-01T00:00:00.000Z",
      encounters: 400,
    });
  });

  it("writes the endpoint-owned fields of an update through their own routes", async () => {
    const calls = mockFetch();
    const previous = {
      id: "e1",
      encounters: 100,
      timer_accumulated_ms: 0,
      completed_at: "2020-01-01T00:00:00.000Z",
    } as Pokemon;

    await updateManualEntry(
      { ...input({ id: "e1", encounters: 500, timer_accumulated_ms: 3_600_000 }), id: "e1" },
      previous,
    );

    const routes = calls.map((call) => `${call.method} ${call.url.replace(/^.*\/api/, "/api")}`);
    expect(routes).toEqual([
      "PUT /api/pokemon/e1",
      "POST /api/pokemon/e1/set_encounters",
      "POST /api/pokemon/e1/timer/set",
      "PUT /api/pokemon/e1/completed_at",
      "PUT /api/pokemon/e1/catch",
    ]);
  });

  it("skips the routes whose value did not change", async () => {
    const calls = mockFetch();
    const previous = {
      id: "e1",
      encounters: 400,
      timer_accumulated_ms: 0,
      completed_at: "2024-05-01T00:00:00.000Z",
    } as Pokemon;

    await updateManualEntry({ ...input({ id: "e1" }), id: "e1" }, previous);

    const routes = calls.map((call) => call.url.replace(/^.*\/api/, "/api"));
    expect(routes).toEqual(["/api/pokemon/e1", "/api/pokemon/e1/catch"]);
  });

  it("throws instead of continuing when a request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })),
    );

    await expect(createManualEntry(input())).rejects.toThrow();
  });

  it("routes save to create or update by the presence of an id", async () => {
    const created = mockFetch({ id: "fresh" });
    expect(await saveManualEntry(input())).toBe("fresh");
    expect(created).toHaveLength(1);

    const updated = mockFetch();
    expect(await saveManualEntry(input({ id: "e9" }))).toBe("e9");
    expect(updated[0].method).toBe("PUT");
  });

  it("deletes through the hunt endpoint", async () => {
    const calls = mockFetch();

    await deleteManualEntry("e1");

    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toContain("/api/pokemon/e1");
  });
});
