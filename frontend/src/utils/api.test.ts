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
      apiBaseUrl: "http://localhost:8080",
    };
    const { apiUrl } = await import("./api");

    expect(apiUrl("/api/state")).toBe("http://localhost:8080/api/state");
  });

  it("handles empty path", async () => {
    delete (globalThis as unknown as Record<string, unknown>).electronAPI;
    const { apiUrl } = await import("./api");

    expect(apiUrl("")).toBe("");
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
      apiBaseUrl: "http://localhost:8080",
    };
    const { wsUrl } = await import("./api");

    expect(wsUrl()).toBe("ws://localhost:8080/ws");
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
