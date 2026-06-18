import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * Because api.ts reads window.electronAPI at module load time, we need to
 * configure the global before each dynamic import and reset the module cache.
 */

describe("apiUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete (globalThis as unknown as Record<string, unknown>).electronAPI;
  });

  it("returns path as-is when electronAPI is not present (Vite dev)", async () => {
    delete (globalThis as unknown as Record<string, unknown>).electronAPI;
    const { apiUrl } = await import("./api");

    expect(apiUrl("/api/state")).toBe("/api/state");
    expect(apiUrl("/api/pokemon")).toBe("/api/pokemon");
  });

  it("prepends API_BASE when electronAPI.apiBaseUrl is set", async () => {
    (globalThis as unknown as Record<string, unknown>).electronAPI = {
      apiBaseUrl: "http://localhost:8192",
    };
    const { apiUrl } = await import("./api");

    expect(apiUrl("/api/state")).toBe("http://localhost:8192/api/state");
  });

  it("handles empty path", async () => {
    delete (globalThis as unknown as Record<string, unknown>).electronAPI;
    const { apiUrl } = await import("./api");

    expect(apiUrl("")).toBe("");
  });
});

describe("reorderPokemon", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete (globalThis as unknown as Record<string, unknown>).electronAPI;
  });

  it("PUTs the ordered ids to the reorder endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const { reorderPokemon } = await import("./api");

    await reorderPokemon(["a", "b", "c"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/pokemon/reorder",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ order: ["a", "b", "c"] }),
      }),
    );
  });

  it("throws when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const { reorderPokemon } = await import("./api");

    await expect(reorderPokemon(["a"])).rejects.toThrow("404");
  });
});

describe("setPokemonGroup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete (globalThis as unknown as Record<string, unknown>).electronAPI;
  });

  it("PUTs only the group_id to the pokemon endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const { setPokemonGroup } = await import("./api");

    await setPokemonGroup("poke-1", "g9");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/pokemon/poke-1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ group_id: "g9" }),
      }),
    );
  });

  it("throws when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const { setPokemonGroup } = await import("./api");

    await expect(setPokemonGroup("poke-1", "")).rejects.toThrow("500");
  });
});

describe("wsUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete (globalThis as unknown as Record<string, unknown>).electronAPI;
  });

  it("converts http API_BASE to ws:// WebSocket URL", async () => {
    (globalThis as unknown as Record<string, unknown>).electronAPI = {
      apiBaseUrl: "http://localhost:8192",
    };
    const { wsUrl } = await import("./api");

    expect(wsUrl()).toBe("ws://localhost:8192/ws");
  });

  it("converts https API_BASE to wss:// WebSocket URL", async () => {
    (globalThis as unknown as Record<string, unknown>).electronAPI = {
      apiBaseUrl: "https://example.com",
    };
    const { wsUrl } = await import("./api");

    expect(wsUrl()).toBe("wss://example.com/ws");
  });

  it("constructs WS URL from location when no electronAPI", async () => {
    delete (globalThis as unknown as Record<string, unknown>).electronAPI;
    const { wsUrl } = await import("./api");

    // jsdom defaults: location.protocol = "http:", location.host = "localhost"
    const url = wsUrl();
    expect(url).toMatch(/^wss?:\/\/.+\/ws$/);
  });

  it("derives protocol from current page location (jsdom defaults to http)", async () => {
    delete (globalThis as unknown as Record<string, unknown>).electronAPI;
    const { wsUrl } = await import("./api");
    const url = wsUrl();

    // jsdom uses http: by default, so the WS URL should use ws:
    expect(url).toMatch(/^ws:/);
    expect(url).toContain("/ws");
  });
});
