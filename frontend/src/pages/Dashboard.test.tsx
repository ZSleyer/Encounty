import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "../test-utils";
import { Dashboard } from "./Dashboard";
import { useCounterStore } from "../hooks/useCounterState";
import { makeAppState } from "../test-utils";

vi.stubGlobal(
  "fetch",
  vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    }),
  ),
);

vi.mock("../hooks/useWebSocket", () => ({
  useWebSocket: vi.fn(() => ({ send: vi.fn() })),
}));

// Mock the CaptureServiceContext hooks used indirectly via DetectorPanel
vi.mock("../contexts/CaptureServiceContext", () => ({
  useCaptureService: () => ({
    startCapture: vi.fn(),
    stopCapture: vi.fn(),
    getStream: () => null,
    isCapturing: () => false,
    registerSubmitter: vi.fn(),
    unregisterSubmitter: vi.fn(),
    updateSubmitterInterval: vi.fn(),
    captureError: null,
  }),
  useCaptureVersion: () => 0,
  CaptureServiceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe("Dashboard", () => {
  beforeEach(() => {
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("renders without crashing when state is available", () => {
    const { container } = render(<Dashboard />);
    // The active pokemon name should appear at least once in the DOM
    const matches = screen.getAllByText("Bisasam");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("renders when no app state", () => {
    useCounterStore.setState({ appState: null });
    const { container } = render(<Dashboard />);
    expect(container).toBeTruthy();
  });
});
