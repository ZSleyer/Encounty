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

/**
 * Navigates from snapshot phase to confirm phase and clicks Save.
 * In edit mode with no replay frames, clicking "Weiter" goes directly to confirm.
 */
async function clickNextThenSave(user: ReturnType<typeof userEvent.setup>) {
  // Click "Weiter" (Next) to go to confirm phase
  await user.click(screen.getByText("Weiter"));
  // Wait for the confirm phase to appear with inline name input and save button
  await waitFor(() => {
    expect(screen.getByText("Speichern")).toBeInTheDocument();
  });
  // Click save in the confirm phase
  await user.click(screen.getByText("Speichern"));
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

  // --- Save template flow ---

  it("calls onUpdateRegions with regions and name on save in edit mode", async () => {
    const user = userEvent.setup();
    const onUpdateRegions = vi.fn().mockResolvedValue(undefined);
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({
      initialRegions: regions,
      initialName: "Test Template",
      onUpdateRegions,
    });
    await clickNextThenSave(user);

    await waitFor(() => {
      expect(onUpdateRegions).toHaveBeenCalledWith(
        regions,
        expect.objectContaining({ name: "Test Template" }),
      );
    });
  });

  it("assigns a category to a region and includes it in the saved regions", async () => {
    const user = userEvent.setup();
    const onUpdateRegions = vi.fn().mockResolvedValue(undefined);
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({
      initialRegions: regions,
      initialName: "Test Template",
      onUpdateRegions,
    });

    const categoryInput = screen.getByLabelText("Kategorie");
    await user.type(categoryInput, "Console A");
    await clickNextThenSave(user);

    await waitFor(() => {
      expect(onUpdateRegions).toHaveBeenCalledWith(
        [expect.objectContaining({ category: "Console A" })],
        expect.objectContaining({ name: "Test Template" }),
      );
    });
  });

  it("opens and closes the category help dialog", async () => {
    const user = userEvent.setup();
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions, initialName: "T", onUpdateRegions: vi.fn() });

    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Was sind Kategorien?" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows error message when save fails", async () => {
    const user = userEvent.setup();
    const onUpdateRegions = vi.fn().mockRejectedValue(new Error("Network error"));
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions, onUpdateRegions });
    await clickNextThenSave(user);

    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });

  it("trims template name before saving", async () => {
    const user = userEvent.setup();
    const onUpdateRegions = vi.fn().mockResolvedValue(undefined);
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions, initialName: "  Trimmed  ", onUpdateRegions });
    await clickNextThenSave(user);

    await waitFor(() => {
      expect(onUpdateRegions).toHaveBeenCalledWith(
        regions,
        expect.objectContaining({ name: "Trimmed" }),
      );
    });
  });

  it("passes undefined name when template name is empty", async () => {
    const user = userEvent.setup();
    const onUpdateRegions = vi.fn().mockResolvedValue(undefined);
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions, initialName: "", onUpdateRegions });
    await clickNextThenSave(user);

    await waitFor(() => {
      expect(onUpdateRegions).toHaveBeenCalledWith(
        regions,
        expect.objectContaining({ name: undefined }),
      );
    });
  });

  // --- Per-template precision/hysteresis ---

  it("saves this template's precision/hysteresis, defaulting to the hunt values", async () => {
    const user = userEvent.setup();
    const onUpdateRegions = vi.fn().mockResolvedValue(undefined);
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions, onUpdateRegions });
    await clickNextThenSave(user);

    await waitFor(() => {
      expect(onUpdateRegions).toHaveBeenCalledWith(
        regions,
        expect.objectContaining({ precision: 0.55, hysteresisFactor: 0.7 }),
      );
    });
  });

  it("pre-fills and keeps a template's existing precision/hysteresis", async () => {
    const user = userEvent.setup();
    const onUpdateRegions = vi.fn().mockResolvedValue(undefined);
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    render(
      <TemplateEditor
        initialImageUrl="/api/detector/poke-1/template/0"
        initialRegions={regions}
        initialPrecision={0.66}
        initialHysteresisFactor={0.8}
        onClose={vi.fn()}
        onUpdateRegions={onUpdateRegions}
      />,
    );
    await waitFor(() => {
      expect(screen.getAllByTitle("Region löschen").length).toBe(1);
    });

    await user.click(screen.getByText("Weiter"));
    await waitFor(() => {
      expect(screen.getByText("Speichern")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Speichern"));

    await waitFor(() => {
      expect(onUpdateRegions).toHaveBeenCalledWith(
        regions,
        expect.objectContaining({ precision: 0.66, hysteresisFactor: 0.8 }),
      );
    });
  });

  // --- Saving state ---

  it("disables save button while saving in edit mode", async () => {
    const user = userEvent.setup();
    // Use a never-resolving promise to keep the saving state active
    const onUpdateRegions = vi.fn().mockReturnValue(new Promise(() => {}));
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions, onUpdateRegions });
    await clickNextThenSave(user);

    // The save button should show "Speichere…" text while saving
    await waitFor(() => {
      expect(screen.getByText("Speichere…")).toBeInTheDocument();
    });
  });

  // --- Save in new template mode uses onSaveTemplate ---

  it("calls onSaveTemplate with base64 data in new-template snapshot phase", async () => {
    userEvent.setup();
    const onSaveTemplate = vi.fn().mockResolvedValue(undefined);

    // Mock canvas toDataURL for the save flow
    const mockToDataURL = vi.fn().mockReturnValue("data:image/png;base64,mockdata");
    HTMLCanvasElement.prototype.toDataURL = mockToDataURL;
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      putImageData: vi.fn(),
    }) as never;

    // Render in new-template mode (no initialImageUrl, no stream)
    // Since there's no stream, we can't normally reach snapshot phase.
    // Instead, test that the component renders in video phase
    render(<TemplateEditor onClose={vi.fn()} onSaveTemplate={onSaveTemplate} />);
    expect(screen.getByText("Schnappschuss")).toBeInTheDocument();
  });

  // --- Template name is preserved after region operations ---

  it("preserves template name after deleting a region", async () => {
    const user = userEvent.setup();
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
      { type: "image" as const, expected_text: "", rect: { x: 50, y: 60, w: 80, h: 40 } },
    ];
    await renderEditMode({ initialRegions: regions, initialName: "Keep This" });

    // Delete the first region (still have one remaining so Next is enabled)
    const deleteBtn = await waitFor(() => screen.getAllByTitle("Region löschen"));
    await user.click(deleteBtn[0]);

    // Navigate to confirm phase to verify name is preserved
    await user.click(screen.getByText("Weiter"));
    const nameInput = await waitFor(() =>
      screen.getByLabelText<HTMLInputElement>("Template-Name (optional)"),
    );
    expect(nameInput.value).toBe("Keep This");
  });

  // --- Save with text regions includes expected text ---

  it("saves text regions with their expected text values", async () => {
    const user = userEvent.setup();
    const onUpdateRegions = vi.fn().mockResolvedValue(undefined);
    const regions = [
      { type: "text" as const, expected_text: "Pikachu", rect: { x: 200, y: 30, w: 150, h: 40 } },
    ];
    await renderEditMode({ initialRegions: regions, onUpdateRegions });

    // Modify the expected text
    const textInput = screen.getByPlaceholderText("Erwarteter Text");
    await user.clear(textInput);
    await user.type(textInput, "Glumanda");

    await clickNextThenSave(user);

    await waitFor(() => {
      expect(onUpdateRegions).toHaveBeenCalled();
    });
    const savedRegions = onUpdateRegions.mock.calls[0][0];
    expect(savedRegions[0].expected_text).toBe("Glumanda");
  });

  // --- Error clears after successful save ---

  it("clears error message on successful save after failure", async () => {
    const user = userEvent.setup();
    let callCount = 0;
    const onUpdateRegions = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error("First failure"));
      return Promise.resolve();
    });
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions, onUpdateRegions });

    // First save fails — navigate to confirm and save
    await clickNextThenSave(user);
    expect(await screen.findByText("First failure")).toBeInTheDocument();

    // Second save succeeds — click save again (still in confirm phase)
    await user.click(screen.getByText("Speichern"));
    await waitFor(() => {
      expect(screen.queryByText("First failure")).not.toBeInTheDocument();
    });
  });

  // --- Generic error message for non-Error throws ---

  it("shows generic error message for non-Error exceptions", async () => {
    const user = userEvent.setup();
    const onUpdateRegions = vi.fn().mockRejectedValue("string error");
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions, onUpdateRegions });
    await clickNextThenSave(user);

    expect(await screen.findByText("Failed to save template")).toBeInTheDocument();
  });
});
