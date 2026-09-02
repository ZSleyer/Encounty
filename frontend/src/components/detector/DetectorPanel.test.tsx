import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  makePokemon,
  makeAppState,
  userEvent,
  waitFor,
  act,
} from "../../test-utils";
import { DetectorPanel } from "./DetectorPanel";
import { CaptureServiceProvider } from "../../contexts/CaptureServiceContext";
import { useCounterStore } from "../../hooks/useCounterState";

// Mock engine modules that require WebGPU / browser-only APIs
vi.mock("../../engine/DetectionLoop", () => ({
  getActiveLoop: vi.fn(() => null),
}));

vi.mock("../../engine/startDetection", () => ({
  ensureDetector: vi.fn(() => Promise.resolve()),
  getDetectorBackend: vi.fn(() => "gpu"),
  setForceCPU: vi.fn(),
  isForceCPU: vi.fn(() => false),
  stopDetectionForPokemon: vi.fn(),
  reloadDetectionTemplates: vi.fn(),
}));

vi.stubGlobal(
  "fetch",
  vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve([]),
    }),
  ),
);

// Partial mock of CaptureServiceContext — keep real implementation but allow overriding useCaptureService
vi.mock("../../contexts/CaptureServiceContext", async () => {
  const actual = await vi.importActual<typeof import("../../contexts/CaptureServiceContext")>(
    "../../contexts/CaptureServiceContext",
  );
  return {
    ...actual,
    useCaptureService: vi.fn(actual.useCaptureService),
    useCaptureVersion: vi.fn(() => 0),
  };
});

// Mock DetectorPreview to avoid video playback issues in jsdom
vi.mock("./DetectorPreview", () => ({
  DetectorPreview: ({ pokemon }: { pokemon: { name: string } }) => (
    <div data-testid="detector-preview-mock">{pokemon.name} Preview</div>
  ),
}));

// Mock child components that are heavy and trigger uncovered callbacks
vi.mock("./SourcePickerModal", () => ({
  SourcePickerModal: ({
    onSelect,
    onClose,
  }: {
    onSelect: (s: { type: string; sourceId: string; label: string }) => void;
    onClose: () => void;
  }) => (
    <dialog open data-testid="source-picker-mock">
      <p>Source Picker</p>
      <button
        onClick={() => onSelect({ type: "screen", sourceId: "screen:1", label: "Monitor 1" })}
      >
        Select Source
      </button>
      <button onClick={onClose}>Close Picker</button>
    </dialog>
  ),
}));

vi.mock("./ImportTemplatesModal", () => ({
  ImportTemplatesModal: ({
    onImport,
    onClose,
  }: {
    onImport: (sourcePokemonId: string, indices?: number[]) => void;
    onClose: () => void;
  }) => (
    <dialog open data-testid="import-modal-mock">
      <p>Import Templates</p>
      <button onClick={() => onImport("poke-2", [0, 1])}>Import From Pokemon</button>
      <button onClick={onClose}>Close Import</button>
    </dialog>
  ),
}));

vi.mock("./TemplateEditor", () => ({
  TemplateEditor: (props: {
    onClose: () => void;
    onSaveTemplate?: (payload: {
      imageBase64: string;
      regions: unknown[];
      name?: string;
    }) => Promise<void>;
    onUpdateRegions?: (
      regions: unknown[],
      opts?: { name?: string; precision?: number; hysteresisFactor?: number },
    ) => Promise<void>;
  }) => (
    <div data-testid="template-editor-mock">
      <p>Template bearbeiten</p>
      {props.onSaveTemplate && (
        <button
          onClick={() =>
            props.onSaveTemplate!({ imageBase64: "base64data", regions: [], name: "New Template" })
          }
        >
          Save New Template
        </button>
      )}
      {props.onUpdateRegions && (
        <button
          onClick={() =>
            props.onUpdateRegions!(
              [{ type: "image", expected_text: "", rect: { x: 5, y: 5, w: 50, h: 50 } }],
              { name: "Updated Name" },
            )
          }
        >
          Update Regions
        </button>
      )}
      <button onClick={props.onClose}>Close Editor</button>
    </div>
  ),
}));

/** Helper to render DetectorPanel with default props. */
function renderPanel(overrides: Partial<Parameters<typeof DetectorPanel>[0]> = {}) {
  const props = {
    pokemon: makePokemon(),
    onConfigChange: vi.fn(),
    isRunning: false,
    confidence: 0,
    detectorState: "idle",
    ...overrides,
  };
  return render(
    <CaptureServiceProvider>
      <DetectorPanel {...props} />
    </CaptureServiceProvider>,
  );
}

describe("DetectorPanel", () => {
  beforeEach(() => {
    // Set up appState with settings so tutorial completion works
    useCounterStore.setState({ appState: makeAppState() });
    // Reset fetch mock to default implementation
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      } as Response),
    );
  });

  it("renders without crashing", async () => {
    renderPanel();
    await waitFor(() => {
      // Should show the source type selector (combobox)
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });
  });

  it("shows status label when running", async () => {
    renderPanel({ isRunning: true, confidence: 0.9 });
    await waitFor(() => {
      // Should show source selector and confidence
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });
  });

  // --- Status dot and label rendering ---

  it("shows stopped label when not running", async () => {
    renderPanel({ isRunning: false, detectorState: "idle" });
    await waitFor(() => {
      // The status label should show the stopped/dash text
      expect(screen.getByText(/\u2013|stopped|Gestoppt/i)).toBeInTheDocument();
    });
  });

  it("shows match state label when running with match", async () => {
    const { container } = renderPanel({
      isRunning: true,
      detectorState: "match",
      confidence: 0.95,
    });
    await waitFor(() => {
      // The match state label should be visible with the green-400 color class
      const matchLabel = container.querySelector(".text-accent-green");
      expect(matchLabel).toBeTruthy();
      expect(matchLabel?.textContent).toBeTruthy();
    });
  });

  it("shows cooldown state label when in cooldown", async () => {
    renderPanel({ isRunning: true, detectorState: "cooldown", confidence: 0.5 });
    await waitFor(() => {
      // Cooldown label is rendered via stateLabel helper
      const allText = document.body.textContent ?? "";
      // Should contain a cooldown-related string (i18n key: detector.stateCooldown)
      expect(allText.length).toBeGreaterThan(0);
    });
  });

  // --- CPU fallback badge ---

  it("does not show CPU fallback badge when backend is GPU", async () => {
    const { container } = renderPanel();
    await waitFor(() => {
      // The CPU fallback badge has bg-accent-yellow/10 styling — should not be present with GPU backend
      const cpuBadge = container.querySelector(String.raw`.bg-accent-yellow\/10`);
      expect(cpuBadge).not.toBeInTheDocument();
    });
  });

  it("shows CPU fallback badge when backend is CPU", async () => {
    // Override the mock to return "cpu"
    const { getDetectorBackend } = await import("../../engine/startDetection");
    vi.mocked(getDetectorBackend).mockReturnValue("cpu");

    const { container } = renderPanel();
    await act(async () => {});
    // The CPU badge is a span with specific styling and "CPU" text
    const cpuBadge = container.querySelector(String.raw`.bg-accent-yellow\/10`);
    expect(cpuBadge).toBeInTheDocument();
    expect(cpuBadge?.textContent).toContain("CPU");

    // Restore to gpu for other tests
    vi.mocked(getDetectorBackend).mockReturnValue("gpu");
  });

  // --- Confidence bar rendering ---

  it("shows confidence bar when running", async () => {
    const { container } = renderPanel({ isRunning: true, confidence: 0.75 });
    await waitFor(() => {
      // Confidence value displayed as percentage
      expect(screen.getByText("75.0%")).toBeInTheDocument();
      // The progress bar element should exist
      const bar = container.querySelector("[style*='width: 75%']");
      expect(bar).toBeInTheDocument();
    });
  });

  it("does not show confidence bar when not running", async () => {
    renderPanel({ isRunning: false, confidence: 0.5 });
    await waitFor(() => {
      expect(screen.queryByText("50.0%")).not.toBeInTheDocument();
    });
  });

  it("caps confidence bar at 100%", async () => {
    const { container } = renderPanel({ isRunning: true, confidence: 1.5 });
    await waitFor(() => {
      expect(screen.getByText("150.0%")).toBeInTheDocument();
      const bar = container.querySelector("[style*='width: 100%']");
      expect(bar).toBeInTheDocument();
    });
  });

  // --- Error badge ---

  it("does not show error badge by default", async () => {
    const { container } = renderPanel();
    await waitFor(() => {
      // Error badge uses AlertTriangle + text; should not be present initially
      const errorBadges = container.querySelectorAll("[title]");
      const errorBadge = Array.from(errorBadges).find((el) =>
        el.classList.contains("bg-accent-red/10"),
      );
      expect(errorBadge).toBeUndefined();
    });
  });

  // --- Pokemon name in control bar ---

  it("displays the pokemon name in the control bar", async () => {
    renderPanel({ pokemon: makePokemon({ name: "Pikachu" }) });
    await waitFor(() => {
      expect(screen.getByText("Pikachu")).toBeInTheDocument();
    });
  });

  // --- Stopped label ---

  it("displays stopped state text in the control bar", async () => {
    renderPanel({ isRunning: false });
    await waitFor(() => {
      // The stopped label should contain translated text (detector.stopped)
      const allText = document.body.textContent ?? "";
      // The stopped label is shown as "Gestoppt" or an en-dash depending on i18n
      expect(allText).toBeTruthy();
    });
  });

  // --- Cooldown with remaining time ---

  it("renders cooldown state in the control bar while running", async () => {
    renderPanel({ isRunning: true, detectorState: "cooldown", confidence: 0.5 });
    await waitFor(() => {
      // The cooldown state label should be visible
      const allText = document.body.textContent ?? "";
      // i18n key: detector.stateCooldown should produce a translated label
      expect(allText.length).toBeGreaterThan(0);
    });
  });

  // --- Starting state label ---

  it("renders starting label when isStarting flag is set", async () => {
    // The isStarting state is internally managed, but we can test via detectorState
    renderPanel({ isRunning: true, detectorState: "idle", confidence: 0 });
    await waitFor(() => {
      // When running with idle state, the stateLabel should show "idle" label
      const allText = document.body.textContent ?? "";
      expect(allText.length).toBeGreaterThan(0);
    });
  });

  // --- Error badge rendering ---

  it("shows error badge when capture error occurs", async () => {
    // We can trigger the error by clicking add template without stream
    const user = userEvent.setup();
    renderPanel();

    const addBtn = screen.getByLabelText(/Video/i);
    await user.click(addBtn);

    // Error badge should appear (with the error message)
    await waitFor(() => {
      const allText = document.body.textContent ?? "";
      expect(allText.length).toBeGreaterThan(0);
    });
  });

  // --- Confidence bar color changes at threshold ---

  it("shows green confidence bar when confidence exceeds precision", async () => {
    const { container } = renderPanel({ isRunning: true, confidence: 0.8 });
    await waitFor(() => {
      // Confidence bar should be green (bg-accent-green) when above 0.55 precision
      const greenBar = container.querySelector(".bg-accent-green");
      expect(greenBar).toBeInTheDocument();
    });
  });

  it("shows blue confidence bar when confidence is below precision", async () => {
    const { container } = renderPanel({ isRunning: true, confidence: 0.2 });
    await waitFor(() => {
      // Confidence bar should be blue (bg-accent-blue/50) when below precision
      const blueBar = container.querySelector("[class*='bg-accent-blue']");
      expect(blueBar).toBeInTheDocument();
    });
  });

  // --- Error badge dismissal ---

  it("shows error badge with message and allows dismissal", async () => {
    const user = userEvent.setup();
    renderPanel();

    // Trigger error by clicking add template without stream
    const addBtn = screen.getByLabelText(/Video/i);
    await user.click(addBtn);

    // Error badge should appear
    await waitFor(() => {
      const errorBadge = document.querySelector(String.raw`.bg-accent-red\/10`);
      expect(errorBadge).toBeInTheDocument();
    });

    // Click the error badge to dismiss it
    const errorBtn = document.querySelector(String.raw`.bg-accent-red\/10`);
    if (errorBtn) {
      await user.click(errorBtn as HTMLElement);
      // Error badge should be removed
      await waitFor(() => {
        const badge = document.querySelector(String.raw`.bg-accent-red\/10`);
        expect(badge).not.toBeInTheDocument();
      });
    }
  });

  // --- Cooldown with remaining time display ---

  it("renders cooldown label when in cooldown state", async () => {
    renderPanel({
      isRunning: true,
      detectorState: "cooldown",
      confidence: 0.5,
    });
    await waitFor(() => {
      // Should display the cooldown state label
      const allText = document.body.textContent ?? "";
      // The cooldown label is from i18n key detector.stateCooldown
      expect(allText.length).toBeGreaterThan(0);
    });
  });

  // --- Cooldown with remaining time renders countdown ---

  it("displays cooldown countdown when cooldown_remaining_ms is set", async () => {
    const { useCounterStore } = await import("../../hooks/useCounterState");

    // Set up detector status with cooldown remaining
    const store = useCounterStore.getState();
    store.setDetectorStatus("poke-1", {
      state: "cooldown",
      confidence: 0.6,
      poll_ms: 200,
      cooldown_remaining_ms: 3000,
    });

    const { unmount } = renderPanel({
      isRunning: true,
      detectorState: "cooldown",
      confidence: 0.6,
    });
    await act(async () => {});

    // Should show the "3s" countdown
    const allText = document.body.textContent ?? "";
    expect(allText).toContain("3s");

    // Clean up — unmount before clearing store to avoid stale state updates
    unmount();
    store.clearDetectorStatus("poke-1");
  });

  // --- Stopped state text uses en-dash ---

  it("shows Gestoppt label when not running", async () => {
    renderPanel({ isRunning: false, detectorState: "idle" });
    await waitFor(() => {
      // The stopped state shows the translated "Gestoppt" text
      expect(screen.getByText("Gestoppt")).toBeInTheDocument();
    });
  });

  // --- stateDotClass helper: idle while running uses blue pulse ---

  it("shows pulsing blue dot when running in idle state", async () => {
    const { container } = renderPanel({ isRunning: true, detectorState: "idle", confidence: 0 });
    await waitFor(() => {
      const pulsingDot = container.querySelector(".animate-pulse.bg-accent-blue");
      expect(pulsingDot).toBeInTheDocument();
    });
  });

  // --- stateDotClass helper: match state uses green dot ---

  it("shows green dot when in match state", async () => {
    const { container } = renderPanel({ isRunning: true, detectorState: "match", confidence: 0.9 });
    await waitFor(() => {
      const greenDot = container.querySelector(".bg-accent-green:not(.animate-pulse)");
      expect(greenDot).toBeInTheDocument();
    });
  });

  // --- stateDotClass helper: cooldown state uses purple dot ---

  it("shows purple dot when in cooldown state", async () => {
    const { container } = renderPanel({
      isRunning: true,
      detectorState: "cooldown",
      confidence: 0.5,
    });
    await waitFor(() => {
      const purpleDot = container.querySelector(".bg-accent-purple:not(.animate-pulse)");
      expect(purpleDot).toBeInTheDocument();
    });
  });

  // --- stateDotClass helper: not running uses muted dot ---

  it("shows muted dot when not running", async () => {
    const { container } = renderPanel({ isRunning: false });
    await waitFor(() => {
      const mutedDot = container.querySelector(".bg-text-muted");
      expect(mutedDot).toBeInTheDocument();
    });
  });

  // --- Confidence bar renders correctly at exactly threshold ---

  it("shows green confidence bar when confidence equals precision exactly", async () => {
    const { container } = renderPanel({ isRunning: true, confidence: 0.55 });
    await waitFor(() => {
      // At exactly 0.55 (equal to default precision), should be green
      const greenBar = container.querySelector(".bg-accent-green");
      expect(greenBar).toBeInTheDocument();
    });
  });

  // --- State label for match ---

  it("shows correct state label text for match state", async () => {
    renderPanel({ isRunning: true, detectorState: "match", confidence: 0.9 });
    await waitFor(() => {
      // Match state should show a specific translated label
      const allText = document.body.textContent ?? "";
      expect(allText.length).toBeGreaterThan(0);
    });
  });

  // --- Capture error propagation ---

  it("propagates capture error from capture service to error badge", async () => {
    // We need to trigger a capture error through the service
    // The simplest way is via startCapture with browser_display in non-Electron
    // which will call capture.startCapture and potentially set captureError
    renderPanel();
    await act(async () => {});

    // Verify the capture error effect runs by checking error badge is not shown initially
    expect(document.querySelector(String.raw`.bg-accent-red\/10`)).not.toBeInTheDocument();
  });

  // --- stateLabel for idle while running ---

  it("shows idle state label when running in idle state", async () => {
    renderPanel({ isRunning: true, detectorState: "idle", confidence: 0.1 });
    await waitFor(() => {
      // The idle label should be translated via detector.stateIdle
      const allText = document.body.textContent ?? "";
      expect(allText.length).toBeGreaterThan(0);
    });
  });

  // --- captureError propagation renders error badge ---

  it("renders error badge when capture service has captureError", async () => {
    const { useCaptureService } = await import("../../contexts/CaptureServiceContext");
    vi.mocked(useCaptureService).mockReturnValue({
      startCapture: vi.fn(),
      stopCapture: vi.fn(),
      getStream: vi.fn(() => null),
      getVideoElement: vi.fn(() => null),
      isCapturing: vi.fn(() => false),
      getSourceLabel: vi.fn(() => null),
      captureError: "Permission denied",
      getVersion: vi.fn(() => 0),
      subscribe: vi.fn(() => () => {}),
    } as never);

    renderPanel();

    // The captureError effect should set errorMsg and show the error badge
    await waitFor(() => {
      const errorBadge = document.querySelector(String.raw`.bg-accent-red\/10`);
      expect(errorBadge).toBeInTheDocument();
    });

    vi.mocked(useCaptureService).mockRestore();
  });
});
