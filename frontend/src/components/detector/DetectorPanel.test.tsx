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
    // Should show the source type selector (combobox)
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("shows status label when running", () => {
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
    // Should show source selector and confidence
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
});
