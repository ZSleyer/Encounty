import { describe, it, expect, vi } from "vitest";
import { render, screen, makePokemon } from "../../test-utils";
import { DetectorPanel } from "./DetectorPanel";
import { CaptureServiceProvider } from "../../contexts/CaptureServiceContext";

vi.stubGlobal(
  "fetch",
  vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve([]),
    }),
  ),
);


describe("DetectorPanel", () => {
  it("renders without crashing", () => {
    render(
      <CaptureServiceProvider>
        <DetectorPanel
          pokemon={makePokemon()}
          onConfigChange={vi.fn()}
          isRunning={false}
          confidence={0}
          detectorState="idle"
        />
      </CaptureServiceProvider>,
    );
    // Should show the start button
    expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument();
  });

  it("shows stop button when running", () => {
    render(
      <CaptureServiceProvider>
        <DetectorPanel
          pokemon={makePokemon()}
          onConfigChange={vi.fn()}
          isRunning={true}
          confidence={0.9}
          detectorState="idle"
        />
      </CaptureServiceProvider>,
    );
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
  });
});
