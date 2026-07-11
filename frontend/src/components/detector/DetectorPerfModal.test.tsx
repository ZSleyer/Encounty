import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "../../test-utils";
import DetectorPerfModal from "./DetectorPerfModal";

vi.mock("../../engine/DetectionLoop", () => ({
  getActiveLoop: vi.fn(() => null),
}));

type ElectronAPIStub = {
  isElectron?: boolean;
  getGpuInfo?: () => Promise<unknown>;
  getProcessStats?: () => Promise<unknown>;
};

// jsdom does not implement HTMLDialogElement.showModal/close, so the modal is
// opened via the real native API, mocked the same way SourcePickerModal does it.
describe("DetectorPerfModal", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { electronAPI?: ElectronAPIStub }).electronAPI;
  });

  it("renders the title and close button", () => {
    render(<DetectorPerfModal pokemonId={null} onClose={vi.fn()} />);
    // Heading exists
    expect(screen.getAllByText(/Performance/i).length).toBeGreaterThan(0);
  });

  it("calls onClose when the close icon is clicked", () => {
    const onClose = vi.fn();
    render(<DetectorPerfModal pokemonId={null} onClose={onClose} />);
    const closeBtn = screen.getByLabelText(/Schließen|Close/);
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the dialog's native cancel event fires (Escape key)", () => {
    const onClose = vi.fn();
    const { container } = render(<DetectorPerfModal pokemonId={null} onClose={onClose} />);
    // The browser dispatches a non-bubbling "cancel" event on the <dialog>
    // itself when Escape is pressed on a modal opened via showModal().
    const dialog = container.querySelector("dialog")!;
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop (the dialog itself) is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(<DetectorPerfModal pokemonId={null} onClose={onClose} />);
    const dialog = container.querySelector("dialog")!;
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when a click inside the dialog content bubbles up", () => {
    const onClose = vi.fn();
    render(<DetectorPerfModal pokemonId={null} onClose={onClose} />);
    // Clicking the heading (inside the dialog's content) must not close it,
    // only a click whose target is the <dialog> element itself (the backdrop) does.
    fireEvent.click(screen.getAllByText(/Performance/i)[0]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows empty loop state when no active loop is registered", () => {
    render(<DetectorPerfModal pokemonId="nope" onClose={vi.fn()} />);
    // "no active loop" hint should appear
    const hint = screen.getAllByText(/aktive|active/i);
    expect(hint.length).toBeGreaterThan(0);
  });

  it("shows electron-only hint outside electron", () => {
    render(<DetectorPerfModal pokemonId={null} onClose={vi.fn()} />);
    // Multiple electron-only sections (process + hardware)
    const msgs = screen.getAllByText(/Electron/i);
    expect(msgs.length).toBeGreaterThanOrEqual(1);
  });

  it("renders GPU info when electronAPI provides it", async () => {
    (window as unknown as { electronAPI: ElectronAPIStub }).electronAPI = {
      isElectron: true,
      getGpuInfo: vi.fn().mockResolvedValue({
        gpuDevice: [
          { active: true, deviceString: "TestGPU", driverVendor: "TestCo", driverVersion: "1.0" },
        ],
      }),
      getProcessStats: vi.fn().mockResolvedValue({
        renderer: null,
        gpu: null,
        browser: null,
        utility: [],
        totalCpuPct: 0,
        totalMemMB: 0,
        cpuCores: 8,
      }),
    };

    render(<DetectorPerfModal pokemonId={null} onClose={vi.fn()} />);

    // Let the useEffect promises settle
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByText(/TestGPU/)).toBeInTheDocument();
  });

  it("shows error message when getProcessStats rejects", async () => {
    (window as unknown as { electronAPI: ElectronAPIStub }).electronAPI = {
      isElectron: true,
      getGpuInfo: vi.fn().mockResolvedValue(null),
      getProcessStats: vi.fn().mockRejectedValue(new Error("boom")),
    };

    render(<DetectorPerfModal pokemonId={null} onClose={vi.fn()} />);
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("renders process table when process stats are available", async () => {
    (window as unknown as { electronAPI: ElectronAPIStub }).electronAPI = {
      isElectron: true,
      getGpuInfo: vi.fn().mockResolvedValue(null),
      getProcessStats: vi.fn().mockResolvedValue({
        renderer: { cpuPct: 12.3, memMB: 256 },
        gpu: { cpuPct: 4.5, memMB: 128 },
        browser: { cpuPct: 1.2, memMB: 64 },
        utility: [{ pid: 42, name: "test", cpuPct: 0.5, memMB: 16 }],
        totalCpuPct: 18.5,
        totalMemMB: 464,
        cpuCores: 8,
      }),
    };

    render(<DetectorPerfModal pokemonId={null} onClose={vi.fn()} />);
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByText("12.3 %")).toBeInTheDocument();
  });

  it("renders loop snapshot when getActiveLoop returns a loop", async () => {
    const { getActiveLoop } = await import("../../engine/DetectionLoop");
    (getActiveLoop as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      getPerfSnapshot: () => ({
        running: true,
        framesProcessed: 123,
        lastDetectMs: 4.2,
        detectMsEMA: 5.1,
        detectMsP95: 9.9,
        effectiveFps: 10,
        pollIntervalMs: 100,
        minPollMs: 50,
        maxPollMs: 500,
        smoothedScore: 0.5,
        inHysteresis: false,
        inCooldown: false,
      }),
    });

    render(<DetectorPerfModal pokemonId="p1" onClose={vi.fn()} />);
    await vi.runOnlyPendingTimersAsync();

    expect(screen.getByText("123")).toBeInTheDocument();
  });
});
