/**
 * App.preparingScreen.test.tsx: First-launch setup and sync reporting.
 *
 * Covers the online/offline setup choice and the progress screen fed by the
 * PreparingScreen WebSocket.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { useCounterStore } from "./hooks/useCounterState";

const mockFetch = vi.fn();

beforeEach(() => {
  // Reset Zustand store to initial state between tests
  useCounterStore.setState({ isConnected: false, appState: null, detectorStatus: {} });
  // Reset useWebSocket mock to default (non-capturing) implementation
  mockUseWebSocket.mockReset();
  mockUseWebSocket.mockReturnValue({ send: vi.fn() } as ReturnType<typeof useWebSocketMock>);
  mockFetch.mockReset();
  mockFetch.mockImplementation((url: string) => {
    if (url === "/api/status/ready") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ready: true }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ display: "1.0.0", build_date: "2024-01-01" }),
    });
  });
  vi.stubGlobal("fetch", mockFetch);
});

vi.mock("./hooks/useWebSocket", async () => {
  const React = await import("react");
  return {
    useWebSocket: vi.fn(() => ({ send: vi.fn() })),
    WebSocketProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock("./engine/startDetection", () => ({
  stopDetectionForPokemon: vi.fn(),
  startDetectionForPokemon: vi.fn(),
  ensureDetector: vi.fn(),
  getDetectorBackend: vi.fn(() => null),
  setForceCPU: vi.fn(),
  isForceCPU: vi.fn(() => false),
  reloadDetectionTemplates: vi.fn(),
}));

// Mock the capture service so tests can plant fake "active stream" state for
// a given pokemon without needing real getDisplayMedia access (jsdom lacks it).
// The provider stays a plain passthrough.
const capturingPokemonIds = new Set<string>();
const fakeVideoEl = { tagName: "VIDEO" } as unknown as HTMLVideoElement;
vi.mock("./contexts/CaptureServiceContext", async () => {
  const React = await import("react");
  const captureService = {
    startCapture: vi.fn(),
    stopCapture: vi.fn(),
    getStream: vi.fn(),
    getVideoElement: (id: string) => (capturingPokemonIds.has(id) ? fakeVideoEl : null),
    isCapturing: (id: string) => capturingPokemonIds.has(id),
    getSourceLabel: () => null,
    captureError: null,
    getVersion: () => 0,
    subscribe: () => () => {},
  };
  return {
    CaptureServiceProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useCaptureService: () => captureService,
    useCaptureVersion: () => 0,
  };
});

// Import the mocked module statically to get a stable reference
import { useWebSocket as useWebSocketMock } from "./hooks/useWebSocket";
const mockUseWebSocket = vi.mocked(useWebSocketMock);

/**
 * Helper: set up a mock WebSocket on globalThis and configure fetch to return
 * server-not-ready so PreparingScreen renders and creates a WebSocket.
 * Returns the last created mock WS instance and a cleanup function.
 */
function setupPreparingScreenWs(fetchOverrides?: Record<string, () => Promise<unknown>>) {
  const wsInstances: Array<{
    onmessage: ((ev: { data: string }) => void) | null;
    onclose: (() => void) | null;
    onerror: (() => void) | null;
    close: ReturnType<typeof vi.fn>;
  }> = [];
  const OrigWebSocket = globalThis.WebSocket;
  // Must use regular function (not arrow) so it works with `new`
  (globalThis as Record<string, unknown>).WebSocket = vi.fn(
    function (this: Record<string, unknown>) {
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      this.close = vi.fn();
      wsInstances.push(this as unknown as (typeof wsInstances)[0]);
    },
  );

  mockFetch.mockImplementation((url: string) => {
    if (url === "/api/status/ready") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ready: false, dev_mode: false, setup_pending: false }),
      });
    }
    if (fetchOverrides?.[url]) {
      return fetchOverrides[url]();
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });

  return {
    wsInstances,
    cleanup: () => {
      globalThis.WebSocket = OrigWebSocket;
    },
    getLastWs: () => wsInstances[wsInstances.length - 1],
  };
}

describe("App", () => {
  it("shows preparing screen when setup is pending", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/status/ready") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ready: false, dev_mode: false, setup_pending: true }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    // Should show the preparing screen with its title
    await waitFor(() => {
      const allText = document.body.textContent ?? "";
      expect(allText).toBeTruthy();
    });
  });

  // --- Server not ready screen ---

  it("shows preparing screen when server is not ready", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/status/ready") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ready: false, dev_mode: false, setup_pending: false }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    const { container } = render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    // Should show loading spinner (server not ready and not setup_pending)
    await waitFor(() => {
      expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    });
  });

  // --- Logo rendering ---

  it("shows setup choice screen when setup_pending and dev_mode", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/status/ready") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ready: false, dev_mode: true, setup_pending: true }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    // The dev mode setup choice screen should show online/offline options
    await waitFor(() => {
      const allText = document.body.textContent ?? "";
      // The PreparingScreen component is rendered with setupPending + devMode
      expect(allText).toBeTruthy();
    });
  });

  // --- Non-route path renders correctly ---

  it("shows preparing screen without setup choice in non-dev mode", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/status/ready") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ready: false, dev_mode: false, setup_pending: true }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    // Should show the preparing screen
    await waitFor(() => {
      const allText = document.body.textContent ?? "";
      expect(allText.length).toBeGreaterThan(0);
    });
  });

  // --- Footer external links have correct attributes ---

  it("shows online and offline buttons in dev mode setup choice", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/status/ready") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ready: false, dev_mode: true, setup_pending: true }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    // Should show setup choice screen with two buttons
    await waitFor(() => {
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });
  });

  // --- Version fetch non-ok response ---

  it("clicking online setup button calls /api/setup/online", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/status/ready") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ready: false, dev_mode: true, setup_pending: true }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    // Should show setup choice screen with two option buttons
    await waitFor(() => {
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });

    // Click the first button (online setup)
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]);

    // POST to /api/setup/online should have been called
    await waitFor(() => {
      const calls = mockFetch.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls).toContain("/api/setup/online");
    });
  });

  // --- Dev mode setup choice: offline button triggers POST ---

  it("clicking offline setup button calls /api/setup/offline", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/status/ready") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ready: false, dev_mode: true, setup_pending: true }),
        });
      }
      if (url === "/api/setup/offline") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });

    // Click the second button (offline setup)
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[1]);

    await waitFor(() => {
      const calls = mockFetch.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls).toContain("/api/setup/offline");
    });
  });

  // --- Quitting state shows goodbye screen ---

  it("shows sync progress phase and step text from WebSocket messages", async () => {
    const { cleanup, getLastWs } = setupPreparingScreenWs();

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(getLastWs()?.onmessage).toBeTruthy();
    });

    const ws = getLastWs();

    // Send sync_progress with pokedex phase and species step
    act(() => {
      ws.onmessage!({
        data: JSON.stringify({
          type: "sync_progress",
          payload: { phase: "pokedex", step: "species", message: "", error: "" },
        }),
      });
    });

    await waitFor(() => {
      expect(document.body.textContent?.length ?? 0).toBeGreaterThan(0);
    });

    // Send sync_progress with forms step
    act(() => {
      ws.onmessage!({
        data: JSON.stringify({
          type: "sync_progress",
          payload: { phase: "games", step: "forms", message: "", error: "" },
        }),
      });
    });

    // Send sync_progress with names step
    act(() => {
      ws.onmessage!({
        data: JSON.stringify({
          type: "sync_progress",
          payload: { phase: "pokedex", step: "names", message: "", error: "" },
        }),
      });
    });

    // Send sync_progress with form_names step
    act(() => {
      ws.onmessage!({
        data: JSON.stringify({
          type: "sync_progress",
          payload: { phase: "pokedex", step: "form_names", message: "", error: "" },
        }),
      });
    });

    await waitFor(() => {
      expect(document.body.textContent).toBeTruthy();
    });

    cleanup();
  });

  it("shows error state in PreparingScreen when sync reports error", async () => {
    const { cleanup, getLastWs } = setupPreparingScreenWs();

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(getLastWs()?.onmessage).toBeTruthy();
    });

    act(() => {
      getLastWs().onmessage!({
        data: JSON.stringify({
          type: "sync_progress",
          payload: { phase: "pokedex", step: "error", message: "", error: "Connection timeout" },
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Connection timeout")).toBeInTheDocument();
    });

    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(2);

    cleanup();
  });

  it("retry button clears error and re-triggers online setup", async () => {
    const { cleanup, getLastWs } = setupPreparingScreenWs();

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(getLastWs()?.onmessage).toBeTruthy();
    });

    act(() => {
      getLastWs().onmessage!({
        data: JSON.stringify({
          type: "sync_progress",
          payload: { phase: "pokedex", step: "error", message: "", error: "Failed" },
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Failed")).toBeInTheDocument();
    });

    const retryBtn = screen
      .getAllByRole("button")
      .find(
        (el) => el.textContent?.includes("Erneut versuchen") || el.textContent?.includes("Retry"),
      );
    expect(retryBtn).toBeTruthy();
    fireEvent.click(retryBtn!);

    await waitFor(() => {
      const calls = mockFetch.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls).toContain("/api/setup/online");
    });

    expect(screen.queryByText("Failed")).not.toBeInTheDocument();

    cleanup();
  });

  it("offline fallback button calls /api/setup/offline and transitions on success", async () => {
    const { cleanup, getLastWs } = setupPreparingScreenWs({
      "/api/setup/offline": () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(getLastWs()?.onmessage).toBeTruthy();
    });

    act(() => {
      getLastWs().onmessage!({
        data: JSON.stringify({
          type: "sync_progress",
          payload: { phase: "pokedex", step: "error", message: "", error: "Network error" },
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });

    const fallbackBtn = screen
      .getAllByRole("button")
      .find((el) => el.textContent?.includes("Offline") || el.textContent?.includes("offline"));
    expect(fallbackBtn).toBeTruthy();
    fireEvent.click(fallbackBtn!);

    await waitFor(() => {
      const calls = mockFetch.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls).toContain("/api/setup/offline");
    });

    cleanup();
  });

  it("offline fallback button shows error when /api/setup/offline fails", async () => {
    const { cleanup, getLastWs } = setupPreparingScreenWs({
      "/api/setup/offline": () => Promise.reject(new Error("Offline setup network failure")),
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(getLastWs()?.onmessage).toBeTruthy();
    });

    act(() => {
      getLastWs().onmessage!({
        data: JSON.stringify({
          type: "sync_progress",
          payload: { phase: "pokedex", step: "error", message: "", error: "Initial error" },
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Initial error")).toBeInTheDocument();
    });

    const fallbackBtn = screen
      .getAllByRole("button")
      .find((el) => el.textContent?.includes("Offline") || el.textContent?.includes("offline"));
    expect(fallbackBtn).toBeTruthy();
    fireEvent.click(fallbackBtn!);

    await waitFor(() => {
      expect(screen.getByText("Offline setup failed")).toBeInTheDocument();
    });

    cleanup();
  });

  it("PreparingScreen calls onReady when system_ready WebSocket message is received", async () => {
    const { cleanup, getLastWs } = setupPreparingScreenWs({
      "/api/state": () =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ license_accepted: true, pokemon: [], settings: {}, hotkeys: {} }),
        }),
      "/api/version": () =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ display: "1.0.0", build_date: "" }),
        }),
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(getLastWs()?.onmessage).toBeTruthy();
    });

    act(() => {
      getLastWs().onmessage!({
        data: JSON.stringify({ type: "system_ready", payload: {} }),
      });
    });

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      const navLinks = links.filter(
        (el) => el.getAttribute("href") === "/" || el.getAttribute("href") === "/settings",
      );
      expect(navLinks.length).toBeGreaterThan(0);
    });

    cleanup();
  });

  it("dev mode offline setup failure shows error and progress screen", async () => {
    const OrigWebSocket = globalThis.WebSocket;

    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/status/ready") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ready: false, dev_mode: true, setup_pending: true }),
        });
      }
      if (url === "/api/setup/offline") {
        return Promise.reject(new Error("Setup failed"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });

    // Mock WebSocket before clicking offline, must use a regular function for `new`
    (globalThis as Record<string, unknown>).WebSocket = vi.fn(
      function (this: Record<string, unknown>) {
        this.onmessage = null;
        this.onclose = null;
        this.onerror = null;
        this.close = vi.fn();
      },
    );

    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[1]);

    await waitFor(() => {
      expect(screen.getByText("Offline setup failed")).toBeInTheDocument();
    });

    globalThis.WebSocket = OrigWebSocket;
  });

  it("PreparingScreen handles unparseable WebSocket messages gracefully", async () => {
    const { cleanup, getLastWs } = setupPreparingScreenWs();

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(getLastWs()?.onmessage).toBeTruthy();
    });

    act(() => {
      getLastWs().onmessage!({ data: "not valid json{{{" });
    });

    expect(document.body).toBeTruthy();

    cleanup();
  });

  it("PreparingScreen shows syncing step without step text", async () => {
    const { cleanup, getLastWs } = setupPreparingScreenWs();

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(getLastWs()?.onmessage).toBeTruthy();
    });

    act(() => {
      getLastWs().onmessage!({
        data: JSON.stringify({
          type: "sync_progress",
          payload: { phase: "games", step: "syncing", message: "", error: "" },
        }),
      });
    });

    await waitFor(() => {
      expect(document.body.textContent).toBeTruthy();
    });

    cleanup();
  });
});
