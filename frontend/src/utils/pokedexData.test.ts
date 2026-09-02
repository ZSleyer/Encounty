// pokedexData.test.ts covers the sharing contract of the catalog loaders:
// one request for every caller, the same array back, and no memory of a failure.
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadGames, loadPokedex, resetPokedexCache } from "./pokedexData";

afterEach(() => {
  vi.unstubAllGlobals();
  resetPokedexCache();
});

/** Stubs fetch with one JSON payload and counts the calls. */
function stubFetch(payload: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("loadPokedex", () => {
  it("fetches once however many callers ask", async () => {
    const fetchMock = stubFetch([{ id: 1, canonical: "bulbasaur" }]);

    const [a, b, c] = await Promise.all([loadPokedex(), loadPokedex(), loadPokedex()]);
    const later = await loadPokedex();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Identity, not just equality: the useMemo chains downstream key on it.
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(later).toBe(a);
  });

  it("does not remember a failure, so the next caller retries", async () => {
    const failing = stubFetch(null, false);
    await expect(loadPokedex()).rejects.toThrow();
    expect(failing).toHaveBeenCalledTimes(1);

    const succeeding = stubFetch([{ id: 25, canonical: "pikachu" }]);
    await expect(loadPokedex()).resolves.toHaveLength(1);
    expect(succeeding).toHaveBeenCalledTimes(1);
  });

  it("rejects a payload that is not an array rather than handing it on", async () => {
    stubFetch({ error: "boom" });
    await expect(loadPokedex()).rejects.toThrow(/did not return an array/);
  });
});

describe("loadGames", () => {
  it("fetches once and is cached independently of the pokedex", async () => {
    const fetchMock = stubFetch([{ key: "red", generation: 1 }]);

    await Promise.all([loadGames(), loadGames()]);
    await loadPokedex();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const paths = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(paths).toContain("/api/games");
    expect(paths).toContain("/api/pokedex");
  });
});
