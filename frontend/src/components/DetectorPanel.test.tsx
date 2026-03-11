import { describe, it, expect, vi } from "vitest";
import { render, screen } from "../test-utils";
import { DetectorPanel } from "./DetectorPanel";
import { makePokemon } from "../test-utils";

vi.stubGlobal(
  "fetch",
  vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve([]),
    }),
  ),
);

// Mock the CaptureServiceContext hooks used by DetectorPanel
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
}));

describe("DetectorPanel", () => {
  it("renders without crashing", () => {
    render(
      <DetectorPanel
        pokemon={makePokemon()}
        onConfigChange={vi.fn()}
        isRunning={false}
        confidence={0}
        detectorState="idle"
      />,
    );
    // Should show the start button
    expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument();
  });

  it("shows stop button when running", () => {
    render(
      <DetectorPanel
        pokemon={makePokemon()}
        onConfigChange={vi.fn()}
        isRunning={true}
        confidence={0.9}
        detectorState="idle"
      />,
    );
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
  });
});
