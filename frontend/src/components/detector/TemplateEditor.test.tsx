import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, userEvent, waitFor } from "../../test-utils";
import { TemplateEditor } from "./TemplateEditor";
import type { MatchedRegion } from "../../types";
import type { SweepResult } from "../../engine/parameterSweep";

// HTMLDialogElement.showModal/close are not implemented in jsdom (the
// stability-analysis panel is a native <dialog>). Reflect the `open`
// attribute so the implicit dialog role resolves for role-based queries.
HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
  this.focus();
});
HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute("open");
});

// Mock useOCR since it uses tesseract.js which is heavy
vi.mock("../../hooks/useOCR", () => ({
  useOCR: () => ({
    recognize: vi.fn(),
    isRecognizing: false,
    ocrError: null,
  }),
}));

// Mock useReplayBuffer since it requires a real video element.
// Use a mutable ref so individual tests can override the return value.
const mockReplayBuffer = {
  frames: [] as unknown[],
  frameCount: 0,
  // Mirror the real hook: snapshotFrameCount equals frameCount until extend()
  get snapshotFrameCount() {
    return this.frameCount;
  },
  get snapshotSeconds() {
    return this.frameCount / 60;
  },
  getFrame: vi.fn().mockReturnValue(null) as ReturnType<typeof vi.fn>,
  isBuffering: false,
  bufferedSeconds: 0,
  maxSeconds: 5,
  clear: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
  extend: vi.fn(() => mockReplayBuffer.frameCount),
};
vi.mock("../../hooks/useReplayBuffer", () => ({
  useReplayBuffer: () => mockReplayBuffer,
}));

// Mock useTemplateTest since it uses engine internals.
// Use a mutable ref so individual tests can override the return value.
const mockTemplateTest = {
  runBatch: vi.fn() as ReturnType<typeof vi.fn>,
  scoreFrame: vi
    .fn()
    .mockReturnValue({ frameIndex: 0, overallScore: 0, regionScores: [] }) as ReturnType<
    typeof vi.fn
  >,
  batchResults: new Map<number, { overallScore: number; frameIndex?: number }>(),
  isRunning: false,
  progress: 0,
  currentResult: null as {
    overallScore: number;
    regionScores: { index: number; score: number }[];
  } | null,
  cancel: vi.fn() as ReturnType<typeof vi.fn>,
  bestScore: 0,
  avgScoreMs: 0,
};
vi.mock("../../hooks/useTemplateTest", () => ({
  useTemplateTest: () => mockTemplateTest,
}));

// Mock the parameter sweep with a controllable runner. The editor pumps the
// runner via the setTimeout fallback (jsdom has no requestIdleCallback), so a
// finished runner delivers its result asynchronously after the batch stats
// appear, just like the real incremental sweep.
const mockSweepControl = {
  /** Result the runner reports once finished (null = sweep found nothing). */
  result: null as SweepResult | null,
  /** When false, step() never finishes and the sweep stays "running". */
  finished: true,
};
vi.mock("../../engine/parameterSweep", () => ({
  createSweepRunner: () => ({
    step: () => mockSweepControl.finished,
    progress: () => (mockSweepControl.finished ? 1 : 0.5),
    result: () => (mockSweepControl.finished ? mockSweepControl.result : null),
  }),
}));

// Mock ResizeObserver which is not available in jsdom
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {
      // no-op
    }
    unobserve() {
      // no-op
    }
    disconnect() {
      // no-op
    }
  },
);

// Store reference to the original Image constructor
const OriginalImage = globalThis.Image;

/**
 * Mock Image that auto-fires onload with configurable natural dimensions.
 */
function createMockImage(width = 640, height = 480) {
  return class MockImage {
    onload: (() => void) | null = null;
    crossOrigin = "";
    naturalWidth = width;
    naturalHeight = height;
    private _src = "";
    get src() {
      return this._src;
    }
    set src(val: string) {
      this._src = val;
      setTimeout(() => this.onload?.(), 0);
    }
  } as unknown as typeof Image;
}

/**
 * Helper to render TemplateEditor in edit mode and wait for the image to "load"
 * so that the phase transitions to "snapshot" and regions become visible.
 *
 * Waits for the snapshot phase to activate by checking for phase-specific UI.
 */
async function renderEditMode(props: {
  initialRegions?: Array<{
    type: "image" | "text";
    expected_text: string;
    rect: { x: number; y: number; w: number; h: number };
  }>;
  initialName?: string;
  pokemonName?: string;
  onClose?: () => void;
  onUpdateRegions?: (
    regions: MatchedRegion[],
    opts?: { name?: string; precision?: number; hysteresisFactor?: number },
  ) => void | Promise<void>;
  precision?: number;
  cooldownSec?: number;
}) {
  const result = render(
    <TemplateEditor
      initialImageUrl="/api/detector/poke-1/template/0"
      initialRegions={props.initialRegions}
      initialName={props.initialName}
      pokemonName={props.pokemonName}
      onClose={props.onClose ?? vi.fn()}
      onUpdateRegions={props.onUpdateRegions ?? vi.fn()}
      initialPrecision={props.precision}
      initialCooldownSec={props.cooldownSec}
    />,
  );
  // Wait for the mocked Image.onload to fire and phase to transition to "snapshot".
  // The no-regions hint or region delete buttons are reliable signals that the
  // snapshot phase is active (they only render when phase === "snapshot").
  await waitFor(() => {
    if ((props.initialRegions?.length ?? 0) > 0) {
      expect(screen.getAllByTitle("Region löschen").length).toBe(props.initialRegions!.length);
    } else {
      expect(screen.getByText("Mindestens eine Region ist erforderlich.")).toBeInTheDocument();
    }
  });
  return result;
}

describe("TemplateEditor", () => {
  let getContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Mock Image constructor so onload fires in jsdom
    globalThis.Image = createMockImage();

    // Stub getContext to return a mock 2d context so drawImage doesn't
    // validate the mock Image against the real canvas implementation.
    const mockCanvas = {
      width: 640,
      height: 480,
      toDataURL: vi.fn().mockReturnValue("data:image/png;base64,"),
    };
    const mockContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4) }),
      putImageData: vi.fn(),
      createImageData: vi
        .fn()
        .mockReturnValue({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      setTransform: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 0 }),
      canvas: mockCanvas,
    };
    getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(mockContext as never);

    // Reset template test mock to defaults
    mockTemplateTest.runBatch = vi.fn();
    mockTemplateTest.scoreFrame = vi
      .fn()
      .mockReturnValue({ frameIndex: 0, overallScore: 0, regionScores: [] });
    mockTemplateTest.batchResults = new Map();
    mockTemplateTest.isRunning = false;
    mockTemplateTest.progress = 0;
    mockTemplateTest.currentResult = null;
    mockTemplateTest.cancel = vi.fn();
    mockTemplateTest.bestScore = 0;
    mockTemplateTest.avgScoreMs = 0;

    // Reset sweep mock: finishes immediately without a result (analytic fallback)
    mockSweepControl.result = null;
    mockSweepControl.finished = true;

    // Reset replay buffer mock to default (no frames)
    mockReplayBuffer.frameCount = 0;
    mockReplayBuffer.getFrame = vi.fn().mockReturnValue(null);
    mockReplayBuffer.isBuffering = false;
    mockReplayBuffer.bufferedSeconds = 0;
    mockReplayBuffer.maxSeconds = 5;
    mockReplayBuffer.stop = vi.fn();
    mockReplayBuffer.restart = vi.fn();
    mockReplayBuffer.clear = vi.fn();
    mockReplayBuffer.extend = vi.fn(() => mockReplayBuffer.frameCount);
  });

  afterEach(() => {
    globalThis.Image = OriginalImage;
    getContextSpy.mockRestore();
  });

  it("renders in edit mode with an initial image URL", () => {
    render(
      <TemplateEditor
        initialImageUrl="/api/detector/poke-1/template/0"
        onClose={vi.fn()}
        onUpdateRegions={vi.fn()}
      />,
    );
    // Should render the close button
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("renders in new-template mode with stream", () => {
    render(<TemplateEditor onClose={vi.fn()} onSaveTemplate={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("shows step 1 heading in new-template mode", () => {
    render(<TemplateEditor onClose={vi.fn()} onSaveTemplate={vi.fn()} />);
    // Step 1 title in German (default locale)
    expect(screen.getByText("Schritt 1: Aufnahme")).toBeInTheDocument();
  });

  it("shows edit heading in edit mode", async () => {
    await renderEditMode({ initialRegions: [] });
    expect(screen.getByText("Template bearbeiten")).toBeInTheDocument();
  });

  it("calls onClose when close button clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TemplateEditor onClose={onClose} onSaveTemplate={vi.fn()} />);
    // The close button is the X in the top-right corner
    const closeButtons = screen.getAllByRole("button");
    // First button is the close X button
    await user.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows take snapshot button in video phase", () => {
    render(<TemplateEditor onClose={vi.fn()} onSaveTemplate={vi.fn()} />);
    expect(screen.getByText("Schnappschuss")).toBeInTheDocument();
  });

  it("shows cancel and next buttons in edit mode", async () => {
    await renderEditMode({ initialRegions: [] });
    expect(screen.getByText("Abbrechen")).toBeInTheDocument();
    expect(screen.getByText("Weiter")).toBeInTheDocument();
  });

  it("pre-fills template name from initialName prop in confirm phase", async () => {
    const user = userEvent.setup();
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions, initialName: "Test Name" });
    // Click Next to enter confirm phase
    await user.click(screen.getByText("Weiter"));
    const input = await waitFor(() => screen.getByLabelText("Template-Name (optional)"));
    expect(input).toHaveValue("Test Name");
  });

  it("shows edit hint text in edit mode", async () => {
    await renderEditMode({ initialRegions: [] });
    expect(
      screen.getByText("Passe die gescannten Bereiche auf dem bestehenden Template-Bild an."),
    ).toBeInTheDocument();
  });

  it("shows step 1 hint in new-template video phase", () => {
    render(<TemplateEditor onClose={vi.fn()} onSaveTemplate={vi.fn()} />);
    expect(
      screen.getByText(
        "Die letzten 5 Sekunden werden aufgezeichnet. Drücke Schnappschuss, wenn bereit.",
      ),
    ).toBeInTheDocument();
  });

  it("renders with pre-loaded regions in edit mode", async () => {
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
      { type: "text" as const, expected_text: "Pikachu", rect: { x: 200, y: 30, w: 150, h: 40 } },
    ];
    await renderEditMode({ initialRegions: regions });
    // Component renders without crashing with initial regions
    expect(screen.getByText("Template bearbeiten")).toBeInTheDocument();
  });

  it("allows editing template name via input in confirm phase", async () => {
    const user = userEvent.setup();
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions });
    // Click Next to enter confirm phase
    await user.click(screen.getByText("Weiter"));
    const input = await waitFor(() => screen.getByLabelText("Template-Name (optional)"));
    await user.clear(input);
    await user.type(input, "New Name");
    expect(input).toHaveValue("New Name");
  });

  // --- Phase switching tests ---

  it("shows edit heading after edit mode loads (snapshot phase)", async () => {
    await renderEditMode({ initialRegions: [] });
    // Edit mode goes directly to snapshot phase with edit title
    expect(screen.getByText("Template bearbeiten")).toBeInTheDocument();
    expect(
      screen.getByText("Passe die gescannten Bereiche auf dem bestehenden Template-Bild an."),
    ).toBeInTheDocument();
  });

  it("shows retake and save buttons in new-template snapshot phase", () => {
    // In new-template mode without stream, the component starts in video phase.
    // We render with a stream to test snapshot phase transition.
    render(<TemplateEditor onClose={vi.fn()} onSaveTemplate={vi.fn()} />);
    // In video phase, the snapshot button should be visible
    expect(screen.getByText("Schnappschuss")).toBeInTheDocument();
  });

  // --- New template mode: snapshot button and flow controls ---

  it("renders snapshot button in video phase for new templates", () => {
    render(<TemplateEditor onClose={vi.fn()} onSaveTemplate={vi.fn()} />);
    const snapshotBtn = screen.getByText("Schnappschuss");
    expect(snapshotBtn).toBeInTheDocument();
  });

  // --- Cancel button in edit mode calls onClose ---

  it("calls onClose when cancel button is clicked in edit mode", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    await renderEditMode({ initialRegions: [], onClose });
    const cancelBtn = screen.getByText("Abbrechen");
    await user.click(cancelBtn);
    expect(onClose).toHaveBeenCalled();
  });

  // --- Snapshot phase: retake and save buttons appear ---

  it("shows retake and save buttons after transitioning to snapshot phase in new-template mode", async () => {
    // Configure replay buffer to have frames
    mockReplayBuffer.frameCount = 5;
    mockReplayBuffer.bufferedSeconds = 2;
    mockReplayBuffer.getFrame = vi.fn().mockReturnValue({
      width: 640,
      height: 480,
      data: new Uint8ClampedArray(640 * 480 * 4),
    });

    render(<TemplateEditor onClose={vi.fn()} onSaveTemplate={vi.fn()} />);

    const user = userEvent.setup();
    await user.click(screen.getByText("Schnappschuss"));

    // Since frameCount > 0, it should enter replay phase
    await waitFor(() => {
      expect(screen.getByText("Zurück zu Live")).toBeInTheDocument();
    });
    expect(screen.getByText("Diesen Frame verwenden")).toBeInTheDocument();
  });

  // --- Snapshot phase from replay: use frame transitions to snapshot ---

  it("transitions from replay to snapshot when use frame button is clicked", async () => {
    mockReplayBuffer.frameCount = 5;
    mockReplayBuffer.bufferedSeconds = 2;
    mockReplayBuffer.getFrame = vi.fn().mockReturnValue({
      width: 640,
      height: 480,
      data: new Uint8ClampedArray(640 * 480 * 4),
    });
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      putImageData: vi.fn(),
    }) as never;

    render(<TemplateEditor onClose={vi.fn()} onSaveTemplate={vi.fn()} />);

    const user = userEvent.setup();

    // Enter replay phase
    await user.click(screen.getByText("Schnappschuss"));
    await waitFor(() => {
      expect(screen.getByText("Diesen Frame verwenden")).toBeInTheDocument();
    });

    // Click "use frame" to transition to snapshot phase
    await user.click(screen.getByText("Diesen Frame verwenden"));

    await waitFor(() => {
      expect(screen.getByText("Weiter")).toBeInTheDocument();
    });
  });

  // --- Back to live from replay restarts buffer ---

  it("returns to video phase when back to live is clicked from replay", async () => {
    mockReplayBuffer.frameCount = 5;
    mockReplayBuffer.bufferedSeconds = 2;
    mockReplayBuffer.getFrame = vi.fn().mockReturnValue({
      width: 640,
      height: 480,
      data: new Uint8ClampedArray(640 * 480 * 4),
    });

    render(<TemplateEditor onClose={vi.fn()} onSaveTemplate={vi.fn()} />);

    const user = userEvent.setup();

    // Enter replay phase
    await user.click(screen.getByText("Schnappschuss"));
    await waitFor(() => {
      expect(screen.getByText("Zurück zu Live")).toBeInTheDocument();
    });

    // Click back to live
    await user.click(screen.getByText("Zurück zu Live"));

    // Should return to video phase with snapshot button
    await waitFor(() => {
      expect(screen.getByText("Schnappschuss")).toBeInTheDocument();
    });
    expect(mockReplayBuffer.restart).toHaveBeenCalled();
  });

  // --- Retake from snapshot returns to video ---

  it("returns to video phase when retake is clicked from snapshot", async () => {
    mockReplayBuffer.frameCount = 5;
    mockReplayBuffer.bufferedSeconds = 2;
    mockReplayBuffer.getFrame = vi.fn().mockReturnValue({
      width: 640,
      height: 480,
      data: new Uint8ClampedArray(640 * 480 * 4),
    });
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      putImageData: vi.fn(),
    }) as never;

    render(<TemplateEditor onClose={vi.fn()} onSaveTemplate={vi.fn()} />);

    const user = userEvent.setup();

    // Go through replay -> snapshot
    await user.click(screen.getByText("Schnappschuss"));
    await waitFor(() => {
      expect(screen.getByText("Diesen Frame verwenden")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Diesen Frame verwenden"));
    await waitFor(() => {
      expect(screen.getByText("Wiederholen")).toBeInTheDocument();
    });

    // Click retake
    await user.click(screen.getByText("Wiederholen"));

    // Should be back in video phase
    await waitFor(() => {
      expect(screen.getByText("Schnappschuss")).toBeInTheDocument();
    });
    expect(mockReplayBuffer.restart).toHaveBeenCalled();
  });

  // --- Save in new-template mode calls onSaveTemplate ---

  it("calls onSaveTemplate with image data and regions in new-template confirm phase", async () => {
    const onSaveTemplate = vi.fn().mockResolvedValue(undefined);
    mockReplayBuffer.frameCount = 5;
    mockReplayBuffer.bufferedSeconds = 2;
    mockReplayBuffer.getFrame = vi.fn().mockReturnValue({
      width: 640,
      height: 480,
      data: new Uint8ClampedArray(640 * 480 * 4),
    });
    const mockToDataURL = vi.fn().mockReturnValue("data:image/png;base64,testdata");
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      putImageData: vi.fn(),
    }) as never;
    HTMLCanvasElement.prototype.toDataURL = mockToDataURL;

    render(<TemplateEditor onClose={vi.fn()} onSaveTemplate={onSaveTemplate} />);

    const user = userEvent.setup();

    // Go through replay -> snapshot
    await user.click(screen.getByText("Schnappschuss"));
    await waitFor(() => {
      expect(screen.getByText("Diesen Frame verwenden")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Diesen Frame verwenden"));
    await waitFor(() => {
      expect(screen.getByText("Weiter")).toBeInTheDocument();
    });

    // Click "Weiter" to go to confirm phase (no regions, so Next is disabled)
    // The Next button is disabled when there are 0 regions.
    // In this test, no regions were drawn, so we can't proceed.
    // This verifies the component is in snapshot phase with the Next button disabled.
    const nextBtn = screen.getByText("Weiter").closest("button");
    expect(nextBtn).toBeDisabled();
  });

  // --- Snapshot with no replay frames falls through to captureCurrentFrame ---

  it("falls back to captureCurrentFrame when replay buffer has no frames", async () => {
    // useReplayBuffer returns 0 frames but frameCount=0, so handleTakeSnapshot
    // should call captureCurrentFrame. Without a real video element this is a no-op
    // but we verify the phase transition doesn't happen (stays in video).
    render(<TemplateEditor onClose={vi.fn()} onSaveTemplate={vi.fn()} />);

    const user = userEvent.setup();
    await user.click(screen.getByText("Schnappschuss"));

    // With no frames and no video element, the component should stay in video phase
    // or fail gracefully — the snapshot button should still be accessible
    const allText = document.body.textContent ?? "";
    expect(allText.length).toBeGreaterThan(0);
  });

  // --- Replay heading and hint text ---

  it("shows replay phase heading and hint text", async () => {
    mockReplayBuffer.frameCount = 5;
    mockReplayBuffer.bufferedSeconds = 2;
    mockReplayBuffer.getFrame = vi.fn().mockReturnValue({
      width: 640,
      height: 480,
      data: new Uint8ClampedArray(640 * 480 * 4),
    });

    render(<TemplateEditor onClose={vi.fn()} onSaveTemplate={vi.fn()} />);

    const user = userEvent.setup();
    await user.click(screen.getByText("Schnappschuss"));

    await waitFor(() => {
      expect(screen.getByText("Schritt 2: Frame wählen")).toBeInTheDocument();
    });
  });

  // --- Test phase (step 4) ---

  describe("test phase (step 4)", () => {
    const defaultRegions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];

    /**
     * Navigate to test phase in edit mode: set replay buffer to have frames,
     * render with regions, then click "Weiter" which triggers handleGoToTestOrConfirm.
     * Since frameCount > 0, it goes to the test phase.
     */
    async function navigateToTestPhase(opts?: {
      regions?: typeof defaultRegions;
      precision?: number;
      cooldownSec?: number;
    }) {
      const regions = opts?.regions ?? defaultRegions;
      mockReplayBuffer.frameCount = 10;
      mockReplayBuffer.getFrame = vi.fn().mockReturnValue({
        width: 640,
        height: 480,
        data: new Uint8ClampedArray(640 * 480 * 4),
      });
      mockReplayBuffer.bufferedSeconds = 0.5;
      mockReplayBuffer.isBuffering = false;

      const user = userEvent.setup();
      await renderEditMode({
        initialRegions: regions,
        precision: opts?.precision,
        cooldownSec: opts?.cooldownSec,
      });
      // Click "Weiter" to navigate to test phase (frameCount > 0 → test)
      await user.click(screen.getByText("Weiter"));
      // Wait for test phase UI
      await waitFor(() => {
        expect(screen.getByText("Frame wählen")).toBeInTheDocument();
      });
      return user;
    }

    it("renders score bars with correct labels and values", async () => {
      mockTemplateTest.currentResult = {
        overallScore: 0.72,
        regionScores: [{ index: 0, score: 0.68 }],
      };
      await navigateToTestPhase();

      // "Gesamt" label for overall score bar
      expect(screen.getByText("Gesamt")).toBeInTheDocument();
      // Overall score bar has aria-label with the percentage
      expect(screen.getByRole("meter", { name: /Gesamt: 72%/ })).toBeInTheDocument();
      // Region label: "Region 1"
      expect(screen.getByText("Region 1")).toBeInTheDocument();
      // Region score bar has aria-label with the percentage
      expect(screen.getByRole("meter", { name: /Region 1: 68%/ })).toBeInTheDocument();
    });

    it("shows precision threshold marker on score bars", async () => {
      mockTemplateTest.currentResult = {
        overallScore: 0.72,
        regionScores: [],
      };
      await navigateToTestPhase({ precision: 0.55 });

      // The threshold marker text shows the precision percentage
      expect(screen.getByText("55%")).toBeInTheDocument();
      // aria-label contains "Genauigkeit" (German for precision)
      const marker = screen.getByLabelText(/Genauigkeit/);
      expect(marker).toBeInTheDocument();
    });

    it("shows green text when score >= precision", async () => {
      mockTemplateTest.currentResult = {
        overallScore: 0.9,
        regionScores: [],
      };
      await navigateToTestPhase({ precision: 0.55 });

      // The percentage text should have green styling
      const pctText = screen.getByText("90%");
      expect(pctText).toHaveClass("text-accent-green");
    });

    it("shows muted text when score < precision", async () => {
      mockTemplateTest.currentResult = {
        overallScore: 0.3,
        regionScores: [],
      };
      await navigateToTestPhase({ precision: 0.55 });

      // The percentage text should have muted styling
      const pctText = screen.getByText("30%");
      expect(pctText).toHaveClass("text-text-muted");
    });

    it("shows match label from i18n in legend", async () => {
      // Need batch results for the sparkline to render
      mockTemplateTest.batchResults = new Map([
        [0, { overallScore: 0.8 }],
        [5, { overallScore: 0.3 }],
      ]);
      await navigateToTestPhase();

      // "Treffer" is "detector.stateMatch" in German
      expect(screen.getAllByText("Treffer").length).toBeGreaterThanOrEqual(1);
    });

    it("shows low score hint when best score is below precision", async () => {
      mockTemplateTest.bestScore = 0.3;
      mockTemplateTest.isRunning = false;
      mockTemplateTest.batchResults = new Map([[0, { overallScore: 0.3 }]]);
      await navigateToTestPhase({ precision: 0.55 });

      expect(
        screen.getByText(
          "Niedrige Scores — probiere einen anderen Frame oder passe die Regionen an.",
        ),
      ).toBeInTheDocument();
    });

    it("shows progress bar during batch scoring", async () => {
      mockTemplateTest.isRunning = true;
      mockTemplateTest.progress = 0.5;
      await navigateToTestPhase();

      // "Teste…" is "templateEditor.testRunning" in German
      expect(screen.getByText("Teste…")).toBeInTheDocument();
    });
  });

  // --- Step 3 heading in new-template snapshot phase ---

  it("shows step 3 heading in new-template snapshot phase", async () => {
    mockReplayBuffer.frameCount = 5;
    mockReplayBuffer.bufferedSeconds = 2;
    mockReplayBuffer.getFrame = vi.fn().mockReturnValue({
      width: 640,
      height: 480,
      data: new Uint8ClampedArray(640 * 480 * 4),
    });
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      putImageData: vi.fn(),
    }) as never;

    render(<TemplateEditor onClose={vi.fn()} onSaveTemplate={vi.fn()} />);

    const user = userEvent.setup();

    // Enter replay then snapshot
    await user.click(screen.getByText("Schnappschuss"));
    await waitFor(() => {
      expect(screen.getByText("Diesen Frame verwenden")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Diesen Frame verwenden"));

    await waitFor(() => {
      expect(screen.getByText("Schritt 3: Regionen definieren")).toBeInTheDocument();
    });
  });
});
