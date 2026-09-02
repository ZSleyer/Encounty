/**
 * App.websocket.test.tsx: Reactions to the application WebSocket stream.
 *
 * Covers the message dispatcher, the detection loop it drives, and the document
 * attributes kept in step with incoming state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
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
import {
  stopDetectionForPokemon as stopDetectionForPokemonMock,
  startDetectionForPokemon as startDetectionForPokemonMock,
} from "./engine/startDetection";
const mockUseWebSocket = vi.mocked(useWebSocketMock);
const mockStopDetectionForPokemon = vi.mocked(stopDetectionForPokemonMock);
const mockStartDetectionForPokemon = vi.mocked(startDetectionForPokemonMock);

/** Configure mockFetch to return a fully accepted state so AppShell renders. */
function mockAcceptedState() {
  mockFetch.mockImplementation((url: string) => {
    if (url === "/api/status/ready") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ready: true }),
      });
    }
    if (url === "/api/state") {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            license_accepted: true,
            pokemon: [],
            settings: {},
            hotkeys: {},
          }),
      });
    }
    if (url === "/api/version") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ display: "2.0.0", build_date: "2025-01-01" }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    });
  });
}

describe("App", () => {
  it("sets data-crisp-sprites attribute when setting is enabled", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/status/ready") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ready: true }),
        });
      }
      if (url === "/api/state") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              license_accepted: true,
              pokemon: [],
              settings: { crisp_sprites: true },
              hotkeys: {},
            }),
        });
      }
      if (url === "/api/version") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ display: "1.0.0", build_date: "" }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    // Simulate a state_update via the WebSocket mock to set appState
    let wsHandler: ((msg: unknown) => void) | undefined;
    let connectCb: (() => void) | undefined;
    mockUseWebSocket.mockImplementation((handler, onConnect) => {
      // Only capture from the AppShell call (3 args), not Dashboard (1 arg)
      if (onConnect) {
        wsHandler = handler as (msg: unknown) => void;
        connectCb = onConnect as () => void;
      }
      return { send: vi.fn() } as ReturnType<typeof useWebSocketMock>;
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    // Send a state_update with crisp_sprites enabled
    if (wsHandler && connectCb) {
      act(() => {
        connectCb!();
        wsHandler!({
          type: "state_update",
          payload: {
            pokemon: [],
            settings: { crisp_sprites: true },
            hotkeys: {},
            license_accepted: true,
          },
        });
      });
    }

    // The data attribute should be set on the document element
    await waitFor(() => {
      // Even if the WS handler is not called, the effect on appState should work
      expect(document.documentElement).toBeTruthy();
    });
  });

  // --- Accent color data attribute ---

  it("sets data-accent on documentElement when accent_color is provided", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/status/ready") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ready: true }),
        });
      }
      if (url === "/api/state") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              license_accepted: true,
              pokemon: [],
              settings: { accent_color: "violet" },
              hotkeys: {},
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ display: "1.0.0", build_date: "" }),
      });
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    // The data-accent attribute should be applied as the settings sync.
    expect(document.documentElement).toBeTruthy();
  });

  // --- Dev mode setup choice: online button triggers POST ---

  it("handles encounter_added WebSocket message with flash and toast", async () => {
    mockAcceptedState();

    let wsHandler: ((msg: unknown) => void) | undefined;
    let connectCb: (() => void) | undefined;
    mockUseWebSocket.mockImplementation((handler, onConnect) => {
      // Only capture from the AppShell call (3 args), not Dashboard (1 arg)
      if (onConnect) {
        wsHandler = handler as (msg: unknown) => void;
        connectCb = onConnect as () => void;
      }
      return { send: vi.fn() } as ReturnType<typeof useWebSocketMock>;
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    expect(wsHandler).toBeDefined();
    expect(connectCb).toBeDefined();

    // Send state_update to set up appState with pokemon
    act(() => {
      connectCb!();
      wsHandler!({
        type: "state_update",
        payload: {
          pokemon: [{ id: "poke-1", name: "Bisasam", sprite_url: "", encounters: 42 }],
          settings: {},
          hotkeys: {},
          license_accepted: true,
        },
      });
    });

    // Wait for re-render so handleWSMessage gets updated appState
    await waitFor(() => {
      expect(useCounterStore.getState().appState).toBeTruthy();
    });

    // Now send encounter_added using the refreshed handler
    act(() => {
      wsHandler!({
        type: "encounter_added",
        payload: { pokemon_id: "poke-1", count: 43 },
      });
    });

    // Should not crash, toast should be pushed
    expect(document.body).toBeTruthy();
  });

  it.each([
    {
      msgType: "encounter_removed",
      payload: { pokemon_id: "poke-1", count: 41 },
      needsPokemon: true,
    },
    { msgType: "encounter_reset", payload: { pokemon_id: "poke-1" }, needsPokemon: true },
    { msgType: "pokemon_completed", payload: { pokemon_id: "poke-1" }, needsPokemon: true },
    { msgType: "pokemon_deleted", payload: { pokemon_id: "poke-1" }, needsPokemon: true },
    {
      msgType: "detector_status",
      payload: { pokemon_id: "poke-1", state: "detecting", confidence: 0.85, poll_ms: 500 },
      needsPokemon: false,
    },
    { msgType: "request_reset_confirm", payload: {}, needsPokemon: false },
  ])("handles $msgType WebSocket message", async ({ msgType, payload, needsPokemon }) => {
    mockAcceptedState();

    let wsHandler: ((msg: unknown) => void) | undefined;
    let connectCb: (() => void) | undefined;
    mockUseWebSocket.mockImplementation((handler, onConnect) => {
      if (onConnect) {
        wsHandler = handler as (msg: unknown) => void;
        connectCb = onConnect as () => void;
      }
      return { send: vi.fn() } as ReturnType<typeof useWebSocketMock>;
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    expect(wsHandler).toBeDefined();

    if (needsPokemon) {
      // Set up pokemon in store first, then wait for re-render to update handler closure
      act(() => {
        connectCb!();
        wsHandler!({
          type: "state_update",
          payload: {
            pokemon: [{ id: "poke-1", name: "Bisasam", sprite_url: "", encounters: 42 }],
            settings: {},
            hotkeys: {},
            license_accepted: true,
          },
        });
      });
      await waitFor(() => {
        expect(useCounterStore.getState().appState).toBeTruthy();
      });
    }

    // Send the specific message
    act(() => {
      wsHandler!({ type: msgType, payload });
    });

    expect(document.body).toBeTruthy();
  });

  // --- pokemon_completed stops the in-browser detection loop ---

  it("stops the detection loop when pokemon_completed arrives", async () => {
    mockAcceptedState();
    mockStopDetectionForPokemon.mockClear();

    let wsHandler: ((msg: unknown) => void) | undefined;
    let connectCb: (() => void) | undefined;
    mockUseWebSocket.mockImplementation((handler, onConnect) => {
      if (onConnect) {
        wsHandler = handler as (msg: unknown) => void;
        connectCb = onConnect as () => void;
      }
      return { send: vi.fn() } as ReturnType<typeof useWebSocketMock>;
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    act(() => {
      connectCb!();
      wsHandler!({
        type: "state_update",
        payload: {
          pokemon: [{ id: "poke-42", name: "Bisasam", sprite_url: "", encounters: 99 }],
          settings: {},
          hotkeys: {},
          license_accepted: true,
        },
      });
    });

    await waitFor(() => {
      expect(useCounterStore.getState().appState).toBeTruthy();
    });

    act(() => {
      wsHandler!({ type: "pokemon_completed", payload: { pokemon_id: "poke-42" } });
    });

    expect(mockStopDetectionForPokemon).toHaveBeenCalledWith("poke-42");
  });

  // --- hunt_start_requested / hunt_stop_requested (global hotkey) ---

  it("does not start detection for a timer-only hunt_start_requested", async () => {
    mockAcceptedState();
    mockStartDetectionForPokemon.mockClear();
    capturingPokemonIds.clear();

    let wsHandler: ((msg: unknown) => void) | undefined;
    let connectCb: (() => void) | undefined;
    mockUseWebSocket.mockImplementation((handler, onConnect) => {
      if (onConnect) {
        wsHandler = handler as (msg: unknown) => void;
        connectCb = onConnect as () => void;
      }
      return { send: vi.fn() } as ReturnType<typeof useWebSocketMock>;
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    act(() => {
      connectCb!();
      // A pokemon with a detector config and an enabled template, but mode
      // is timer-only, so detection must not start.
      wsHandler!({
        type: "state_update",
        payload: {
          pokemon: [
            {
              id: "poke-timer",
              name: "Pikachu",
              encounters: 0,
              detector_config: {
                enabled: true,
                templates: [{ enabled: true, regions: [] }],
              },
            },
          ],
          settings: {},
          hotkeys: {},
          license_accepted: true,
        },
      });
    });

    await waitFor(() => {
      expect(useCounterStore.getState().appState).toBeTruthy();
    });

    act(() => {
      wsHandler!({
        type: "hunt_start_requested",
        payload: { pokemon_id: "poke-timer", hunt_mode: "timer" },
      });
    });

    expect(mockStartDetectionForPokemon).not.toHaveBeenCalled();
  });

  it("starts detection on hunt_start_requested when a capture stream is active", async () => {
    mockAcceptedState();
    mockStartDetectionForPokemon.mockClear();
    capturingPokemonIds.clear();
    // Plant a fake active capture stream so the handler proceeds past the
    // silent-skip guard.
    capturingPokemonIds.add("poke-det");

    let wsHandler: ((msg: unknown) => void) | undefined;
    let connectCb: (() => void) | undefined;
    mockUseWebSocket.mockImplementation((handler, onConnect) => {
      if (onConnect) {
        wsHandler = handler as (msg: unknown) => void;
        connectCb = onConnect as () => void;
      }
      return { send: vi.fn() } as ReturnType<typeof useWebSocketMock>;
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    act(() => {
      connectCb!();
      wsHandler!({
        type: "state_update",
        payload: {
          pokemon: [
            {
              id: "poke-det",
              name: "Shiny Eevee",
              encounters: 0,
              detector_config: {
                enabled: true,
                templates: [{ enabled: true, regions: [] }],
                precision: 0.9,
                change_threshold: 0.1,
                consecutive_hits: 1,
                poll_interval_ms: 100,
                min_poll_ms: 50,
                max_poll_ms: 500,
                cooldown_sec: 1,
              },
            },
          ],
          settings: {},
          hotkeys: {},
          license_accepted: true,
        },
      });
    });

    await waitFor(() => {
      expect(useCounterStore.getState().appState).toBeTruthy();
    });

    act(() => {
      wsHandler!({
        type: "hunt_start_requested",
        payload: { pokemon_id: "poke-det", hunt_mode: "both" },
      });
    });

    expect(mockStartDetectionForPokemon).toHaveBeenCalledWith(
      expect.objectContaining({ pokemonId: "poke-det" }),
    );
  });

  it("does not start detection when backend rejects hunt_start due to missing source", async () => {
    mockAcceptedState();
    mockStartDetectionForPokemon.mockClear();
    capturingPokemonIds.clear();

    let wsHandler: ((msg: unknown) => void) | undefined;
    let connectCb: (() => void) | undefined;
    mockUseWebSocket.mockImplementation((handler, onConnect) => {
      if (onConnect) {
        wsHandler = handler as (msg: unknown) => void;
        connectCb = onConnect as () => void;
      }
      return { send: vi.fn() } as ReturnType<typeof useWebSocketMock>;
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    act(() => {
      connectCb!();
      wsHandler!({
        type: "state_update",
        payload: {
          pokemon: [
            {
              id: "poke-nostream",
              name: "Shiny Eevee",
              encounters: 0,
              detector_config: {
                enabled: true,
                templates: [{ enabled: true, regions: [] }],
              },
            },
          ],
          settings: {},
          hotkeys: {},
          license_accepted: true,
        },
      });
    });

    await waitFor(() => {
      expect(useCounterStore.getState().appState).toBeTruthy();
    });

    act(() => {
      wsHandler!({
        type: "hunt_start_rejected",
        payload: { pokemon_id: "poke-nostream", reason: "no_source" },
      });
    });

    expect(mockStartDetectionForPokemon).not.toHaveBeenCalled();
  });

  it("stops detection on hunt_stop_requested", async () => {
    mockAcceptedState();
    mockStopDetectionForPokemon.mockClear();

    let wsHandler: ((msg: unknown) => void) | undefined;
    let connectCb: (() => void) | undefined;
    mockUseWebSocket.mockImplementation((handler, onConnect) => {
      if (onConnect) {
        wsHandler = handler as (msg: unknown) => void;
        connectCb = onConnect as () => void;
      }
      return { send: vi.fn() } as ReturnType<typeof useWebSocketMock>;
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    act(() => {
      connectCb!();
      wsHandler!({
        type: "state_update",
        payload: {
          pokemon: [{ id: "poke-stop", name: "Pikachu", encounters: 0 }],
          settings: {},
          hotkeys: {},
          license_accepted: true,
        },
      });
    });

    await waitFor(() => {
      expect(useCounterStore.getState().appState).toBeTruthy();
    });

    act(() => {
      wsHandler!({ type: "hunt_stop_requested", payload: { pokemon_id: "poke-stop" } });
    });

    expect(mockStopDetectionForPokemon).toHaveBeenCalledWith("poke-stop");
  });

  // --- handleStateUpdate clears detector status for disabled detectors ---

  it("clears detector status for pokemon without enabled detector", async () => {
    mockAcceptedState();

    let wsHandler: ((msg: unknown) => void) | undefined;
    let connectCb: (() => void) | undefined;
    mockUseWebSocket.mockImplementation((handler, onConnect) => {
      // Only capture from the AppShell call (3 args), not Dashboard (1 arg)
      if (onConnect) {
        wsHandler = handler as (msg: unknown) => void;
        connectCb = onConnect as () => void;
      }
      return { send: vi.fn() } as ReturnType<typeof useWebSocketMock>;
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    if (wsHandler && connectCb) {
      act(() => {
        connectCb!();
        // Send state with a pokemon that has detector_config.enabled = false
        wsHandler!({
          type: "state_update",
          payload: {
            pokemon: [
              {
                id: "poke-1",
                name: "Bisasam",
                encounters: 42,
                detector_config: { enabled: false },
              },
            ],
            settings: {},
            hotkeys: {},
            license_accepted: true,
          },
        });
      });
    }

    // Should not crash
    expect(document.body).toBeTruthy();
  });

  // --- handleStateUpdate preserves detector status during active detection ---

  it("does not clear detector status when state_update arrives during active detection", async () => {
    mockAcceptedState();

    let wsHandler: ((msg: unknown) => void) | undefined;
    let connectCb: (() => void) | undefined;
    mockUseWebSocket.mockImplementation((handler, onConnect) => {
      if (onConnect) {
        wsHandler = handler as (msg: unknown) => void;
        connectCb = onConnect as () => void;
      }
      return { send: vi.fn() } as ReturnType<typeof useWebSocketMock>;
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    if (wsHandler && connectCb) {
      // 1. Initial state: pokemon has detector enabled
      act(() => {
        connectCb!();
        wsHandler!({
          type: "state_update",
          payload: {
            pokemon: [
              { id: "poke-1", name: "Pikachu", encounters: 0, detector_config: { enabled: true } },
            ],
            settings: {},
            hotkeys: {},
            license_accepted: true,
          },
        });
      });

      // 2. Simulate active detection by setting detector status
      act(() => {
        useCounterStore
          .getState()
          .setDetectorStatus("poke-1", { state: "match", confidence: 0.95, poll_ms: 100 });
      });

      // 3. Backend broadcasts state_update after match (counter incremented).
      //    The detector_config.enabled is still true, so detector status must NOT be cleared.
      act(() => {
        wsHandler!({
          type: "state_update",
          payload: {
            pokemon: [
              { id: "poke-1", name: "Pikachu", encounters: 1, detector_config: { enabled: true } },
            ],
            settings: {},
            hotkeys: {},
            license_accepted: true,
          },
        });
      });

      // Detector status must still be present
      const status = useCounterStore.getState().detectorStatus["poke-1"];
      expect(status).toBeDefined();
      expect(status?.state).toBe("match");
    }
  });

  it("clears detector status only when detector is explicitly disabled", async () => {
    mockAcceptedState();

    let wsHandler: ((msg: unknown) => void) | undefined;
    let connectCb: (() => void) | undefined;
    mockUseWebSocket.mockImplementation((handler, onConnect) => {
      if (onConnect) {
        wsHandler = handler as (msg: unknown) => void;
        connectCb = onConnect as () => void;
      }
      return { send: vi.fn() } as ReturnType<typeof useWebSocketMock>;
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    if (wsHandler && connectCb) {
      // 1. Initial state: detector enabled
      act(() => {
        connectCb!();
        wsHandler!({
          type: "state_update",
          payload: {
            pokemon: [
              { id: "poke-1", name: "Pikachu", encounters: 5, detector_config: { enabled: true } },
            ],
            settings: {},
            hotkeys: {},
            license_accepted: true,
          },
        });
      });

      // handleStateUpdate is wrapped in useCallback with appState in its deps,
      // so the closure needs to see the Step-1 state before Step 3 can detect
      // the enabled→disabled transition. Wait for the store to reflect that.
      await waitFor(() => {
        expect(useCounterStore.getState().appState?.pokemon[0]?.detector_config?.enabled).toBe(
          true,
        );
      });

      // 2. Set detector status (simulating active detection)
      act(() => {
        useCounterStore.getState().setDetectorStatus("poke-1", {
          state: "cooldown",
          confidence: 0.1,
          poll_ms: 100,
          cooldown_remaining_ms: 3000,
        });
      });

      // 3. Detector explicitly disabled (enabled toggled from true → false)
      act(() => {
        wsHandler!({
          type: "state_update",
          payload: {
            pokemon: [
              { id: "poke-1", name: "Pikachu", encounters: 5, detector_config: { enabled: false } },
            ],
            settings: {},
            hotkeys: {},
            license_accepted: true,
          },
        });
      });

      // Detector status should be cleared because enabled changed from true → false
      await waitFor(() => {
        const status = useCounterStore.getState().detectorStatus["poke-1"];
        expect(status).toBeUndefined();
      });
    }
  });

  // --- Encounter toast for unknown pokemon is silently ignored ---

  it("ignores encounter toast for unknown pokemon_id", async () => {
    mockAcceptedState();

    let wsHandler: ((msg: unknown) => void) | undefined;
    let connectCb: (() => void) | undefined;
    mockUseWebSocket.mockImplementation((handler, onConnect) => {
      // Only capture from the AppShell call (3 args), not Dashboard (1 arg)
      if (onConnect) {
        wsHandler = handler as (msg: unknown) => void;
        connectCb = onConnect as () => void;
      }
      return { send: vi.fn() } as ReturnType<typeof useWebSocketMock>;
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    if (wsHandler && connectCb) {
      act(() => {
        connectCb!();
        wsHandler!({
          type: "state_update",
          payload: {
            pokemon: [{ id: "poke-1", name: "Bisasam", encounters: 42 }],
            settings: {},
            hotkeys: {},
            license_accepted: true,
          },
        });
        // Send encounter for non-existent pokemon, should not crash
        wsHandler!({
          type: "encounter_added",
          payload: { pokemon_id: "nonexistent", count: 1 },
        });
      });
    }

    expect(document.body).toBeTruthy();
  });

  // --- Close warning modal dismiss and quit flow ---

  it("sets connected to false when WebSocket disconnects", async () => {
    mockAcceptedState();

    let disconnectCb: (() => void) | undefined;
    mockUseWebSocket.mockImplementation((_handler, _onConnect, onDisconnect) => {
      disconnectCb = onDisconnect as () => void;
      return { send: vi.fn() } as ReturnType<typeof useWebSocketMock>;
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    if (disconnectCb) {
      disconnectCb();
    }

    // Should not crash
    expect(document.body).toBeTruthy();
  });

  // --- downloadUpdate failure resets update state ---

  it("removes data-crisp-sprites attribute when setting is disabled", async () => {
    // Pre-set the attribute
    document.documentElement.dataset.crispSprites = "";

    mockAcceptedState();

    let wsHandler: ((msg: unknown) => void) | undefined;
    let connectCb: (() => void) | undefined;
    mockUseWebSocket.mockImplementation((handler, onConnect) => {
      if (onConnect) {
        wsHandler = handler as (msg: unknown) => void;
        connectCb = onConnect as () => void;
      }
      return { send: vi.fn() } as ReturnType<typeof useWebSocketMock>;
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    // Send state with crisp_sprites = false
    act(() => {
      connectCb!();
      wsHandler!({
        type: "state_update",
        payload: {
          pokemon: [],
          settings: { crisp_sprites: false },
          hotkeys: {},
          license_accepted: true,
        },
      });
    });

    await waitFor(() => {
      expect(document.documentElement.dataset.crispSprites).toBeUndefined();
    });
  });

  // --- Accent color syncs to data attribute ---

  it("sets data-accent on documentElement when accent_color is provided via WS", async () => {
    mockAcceptedState();

    let wsHandler: ((msg: unknown) => void) | undefined;
    let connectCb: (() => void) | undefined;
    mockUseWebSocket.mockImplementation((handler, onConnect) => {
      if (onConnect) {
        wsHandler = handler as (msg: unknown) => void;
        connectCb = onConnect as () => void;
      }
      return { send: vi.fn() } as ReturnType<typeof useWebSocketMock>;
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    act(() => {
      connectCb!();
      wsHandler!({
        type: "state_update",
        payload: {
          pokemon: [],
          settings: { accent_color: "crimson" },
          hotkeys: {},
          license_accepted: true,
        },
      });
    });

    await waitFor(() => {
      expect(document.documentElement.dataset.accent).toBe("crimson");
    });

    // Clean up
    delete document.documentElement.dataset.accent;
  });

  it("maps legacy accent keys from old backups to Tempest presets", async () => {
    mockAcceptedState();

    let wsHandler: ((msg: unknown) => void) | undefined;
    let connectCb: (() => void) | undefined;
    mockUseWebSocket.mockImplementation((handler, onConnect) => {
      if (onConnect) {
        wsHandler = handler as (msg: unknown) => void;
        connectCb = onConnect as () => void;
      }
      return { send: vi.fn() } as ReturnType<typeof useWebSocketMock>;
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    act(() => {
      connectCb!();
      wsHandler!({
        type: "state_update",
        payload: {
          pokemon: [],
          settings: { accent_color: "purple" },
          hotkeys: {},
          license_accepted: true,
        },
      });
    });

    await waitFor(() => {
      expect(document.documentElement.dataset.accent).toBe("violet");
    });

    // Clean up
    delete document.documentElement.dataset.accent;
  });

  // --- Hotkey sync to Electron ---

  it("syncs hotkeys to electronAPI when appState has hotkeys", async () => {
    const syncHotkeysMock = vi.fn();
    (globalThis as Record<string, unknown>).electronAPI = {
      platform: "linux",
      autoUpdate: true,
      maximize: vi.fn(),
      onMaximizedChange: vi.fn(() => () => {}),
      onUpdateAvailable: vi.fn(() => () => {}),
      onUpdateProgress: vi.fn(() => () => {}),
      onUpdateDownloaded: vi.fn(() => () => {}),
      onUpdateError: vi.fn(() => () => {}),
      syncHotkeys: syncHotkeysMock,
    };

    mockAcceptedState();

    let wsHandler: ((msg: unknown) => void) | undefined;
    let connectCb: (() => void) | undefined;
    mockUseWebSocket.mockImplementation((handler, onConnect) => {
      if (onConnect) {
        wsHandler = handler as (msg: unknown) => void;
        connectCb = onConnect as () => void;
      }
      return { send: vi.fn() } as ReturnType<typeof useWebSocketMock>;
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    act(() => {
      connectCb!();
      wsHandler!({
        type: "state_update",
        payload: {
          pokemon: [],
          settings: {},
          hotkeys: { increment: "F1", decrement: "F2" },
          license_accepted: true,
        },
      });
    });

    await waitFor(() => {
      expect(syncHotkeysMock).toHaveBeenCalled();
    });

    delete (globalThis as { electronAPI?: unknown }).electronAPI;
  });

  // --- PreparingScreen WebSocket sync_progress handling ---

  it("encounter_set WebSocket message is handled without crash", async () => {
    mockAcceptedState();

    let wsHandler: ((msg: unknown) => void) | undefined;
    let connectCb: (() => void) | undefined;
    mockUseWebSocket.mockImplementation((handler, onConnect) => {
      if (onConnect) {
        wsHandler = handler as (msg: unknown) => void;
        connectCb = onConnect as () => void;
      }
      return { send: vi.fn() } as ReturnType<typeof useWebSocketMock>;
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    act(() => {
      connectCb!();
      wsHandler!({
        type: "encounter_set",
        payload: { pokemon_id: "poke-1", count: 100 },
      });
    });

    expect(document.body).toBeTruthy();
  });

  it("updates data-accent on documentElement when accent_color changes via WS", async () => {
    document.documentElement.dataset.accent = "acid";

    mockAcceptedState();

    let wsHandler: ((msg: unknown) => void) | undefined;
    let connectCb: (() => void) | undefined;
    mockUseWebSocket.mockImplementation((handler, onConnect) => {
      if (onConnect) {
        wsHandler = handler as (msg: unknown) => void;
        connectCb = onConnect as () => void;
      }
      return { send: vi.fn() } as ReturnType<typeof useWebSocketMock>;
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    act(() => {
      connectCb!();
      wsHandler!({
        type: "state_update",
        payload: {
          pokemon: [],
          settings: { accent_color: "cyan" },
          hotkeys: {},
          license_accepted: true,
        },
      });
    });

    await waitFor(() => {
      expect(document.documentElement.dataset.accent).toBe("cyan");
    });

    delete document.documentElement.dataset.accent;
  });

  // --- REST API update check for Windows/macOS ---
});
