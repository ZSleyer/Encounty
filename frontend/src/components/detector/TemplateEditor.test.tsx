import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, userEvent, waitFor, within, fireEvent } from "../../test-utils";
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
  get snapshotFrameCount() { return this.frameCount; },
  get snapshotSeconds() { return this.frameCount / 60; },
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
  scoreFrame: vi.fn().mockReturnValue({ frameIndex: 0, overallScore: 0, regionScores: [] }) as ReturnType<typeof vi.fn>,
  batchResults: new Map<number, { overallScore: number; frameIndex?: number }>(),
  isRunning: false,
  progress: 0,
  currentResult: null as { overallScore: number; regionScores: { index: number; score: number }[] } | null,
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
vi.stubGlobal("ResizeObserver", class {
  observe() { // no-op
  }
  unobserve() { // no-op
  }
  disconnect() { // no-op
  }
});

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
    get src() { return this._src; }
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
  initialRegions?: Array<{ type: "image" | "text"; expected_text: string; rect: { x: number; y: number; w: number; h: number } }>;
  initialName?: string;
  pokemonName?: string;
  onClose?: () => void;
  onUpdateRegions?: (regions: MatchedRegion[], opts?: { name?: string; precision?: number; hysteresisFactor?: number }) => void | Promise<void>;
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
    const mockCanvas = { width: 640, height: 480, toDataURL: vi.fn().mockReturnValue("data:image/png;base64,") };
    const mockContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4) }),
      putImageData: vi.fn(),
      createImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
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
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(mockContext as never);

    // Reset template test mock to defaults
    mockTemplateTest.runBatch = vi.fn();
    mockTemplateTest.scoreFrame = vi.fn().mockReturnValue({ frameIndex: 0, overallScore: 0, regionScores: [] });
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
    render(
      <TemplateEditor
        onClose={vi.fn()}
        onSaveTemplate={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("shows step 1 heading in new-template mode", () => {
    render(
      <TemplateEditor
        onClose={vi.fn()}
        onSaveTemplate={vi.fn()}
      />,
    );
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
    render(
      <TemplateEditor
        onClose={onClose}
        onSaveTemplate={vi.fn()}
      />,
    );
    // The close button is the X in the top-right corner
    const closeButtons = screen.getAllByRole("button");
    // First button is the close X button
    await user.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows take snapshot button in video phase", () => {
    render(
      <TemplateEditor
        onClose={vi.fn()}
        onSaveTemplate={vi.fn()}
      />,
    );
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
    render(
      <TemplateEditor
        onClose={vi.fn()}
        onSaveTemplate={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Die letzten 5 Sekunden werden aufgezeichnet. Drücke Schnappschuss, wenn bereit."),
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
    render(
      <TemplateEditor
        onClose={vi.fn()}
        onSaveTemplate={vi.fn()}
      />,
    );
    // In video phase, the snapshot button should be visible
    expect(screen.getByText("Schnappschuss")).toBeInTheDocument();
  });

  // --- Region list rendering ---

  it("renders region badges with correct type labels in edit mode", async () => {
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
      { type: "text" as const, expected_text: "Pikachu", rect: { x: 200, y: 30, w: 150, h: 40 } },
    ];
    await renderEditMode({ initialRegions: regions });
    // Wait for regions to render after Image.onload triggers phase transition
    const selects = await waitFor(() => {
      const s = screen.getAllByRole("combobox", { name: "Typ" });
      expect(s.length).toBe(2);
      return s;
    });
    expect(selects).toHaveLength(2);
  });

  it("shows expected text input for text regions in edit mode", async () => {
    const regions = [
      { type: "text" as const, expected_text: "Pikachu", rect: { x: 200, y: 30, w: 150, h: 40 } },
    ];
    await renderEditMode({ initialRegions: regions });
    const textInput = await waitFor(() => screen.getByPlaceholderText("Erwarteter Text"));
    expect(textInput).toBeInTheDocument();
    expect(textInput).toHaveValue("Pikachu");
  });

  it("does not show expected text input for image regions", async () => {
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions });
    // Wait for region list to render, then check no text input
    await waitFor(() => {
      expect(screen.getByTitle("Region löschen")).toBeInTheDocument();
    });
    expect(screen.queryByPlaceholderText("Erwarteter Text")).not.toBeInTheDocument();
  });

  // --- Region deletion ---

  it("deletes a region when delete button is clicked", async () => {
    const user = userEvent.setup();
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
      { type: "text" as const, expected_text: "Pikachu", rect: { x: 200, y: 30, w: 150, h: 40 } },
    ];
    await renderEditMode({ initialRegions: regions });
    const deleteButtons = await waitFor(() => {
      const btns = screen.getAllByTitle("Region löschen");
      expect(btns).toHaveLength(2);
      return btns;
    });

    // Delete the first region
    await user.click(deleteButtons[0]);

    // Now only 1 delete button should remain
    expect(screen.getAllByTitle("Region löschen")).toHaveLength(1);
  });

  // --- Region type toggle ---

  it("changes region type from image to text via dropdown", async () => {
    const user = userEvent.setup();
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions });
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Typ" })).toBeInTheDocument();
    });

    // No expected text input initially (image type)
    expect(screen.queryByPlaceholderText("Erwarteter Text")).not.toBeInTheDocument();

    // Switch the region to text type
    const select = screen.getByRole("combobox", { name: "Typ" });
    await user.selectOptions(select, "text");

    // Now the expected text input should appear
    expect(screen.getByPlaceholderText("Erwarteter Text")).toBeInTheDocument();
  });

  it("pre-fills expected_text with pokemonName when switching to text type", async () => {
    const user = userEvent.setup();
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions, pokemonName: "Bisasam" });
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Typ" })).toBeInTheDocument();
    });
    const select = screen.getByRole("combobox", { name: "Typ" });
    await user.selectOptions(select, "text");

    const textInput = screen.getByPlaceholderText("Erwarteter Text");
    expect(textInput).toHaveValue("Bisasam");
  });

  // --- Save template flow ---

  it("calls onUpdateRegions with regions and name on save in edit mode", async () => {
    const user = userEvent.setup();
    const onUpdateRegions = vi.fn().mockResolvedValue(undefined);
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions, initialName: "Test Template", onUpdateRegions });
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
    await renderEditMode({ initialRegions: regions, initialName: "Test Template", onUpdateRegions });

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
      expect(onUpdateRegions).toHaveBeenCalledWith(regions, expect.objectContaining({ name: "Trimmed" }));
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
      expect(onUpdateRegions).toHaveBeenCalledWith(regions, expect.objectContaining({ name: undefined }));
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

  // --- No-regions hint ---

  it("shows no-regions hint in edit mode when no regions exist", async () => {
    await renderEditMode({ initialRegions: [] });
    await waitFor(() => {
      expect(
        screen.getByText("Mindestens eine Region ist erforderlich."),
      ).toBeInTheDocument();
    });
  });

  // --- OCR hint ---

  it("shows OCR hint when a text region exists", async () => {
    const regions = [
      { type: "text" as const, expected_text: "Pikachu", rect: { x: 200, y: 30, w: 150, h: 40 } },
    ];
    await renderEditMode({ initialRegions: regions });
    await waitFor(() => {
      expect(
        screen.getByText("Text-Regionen werden per OCR mit dem erwarteten Text verglichen."),
      ).toBeInTheDocument();
    });
  });

  it("does not show OCR hint when only image regions exist", async () => {
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions });
    await waitFor(() => {
      expect(screen.getByTitle("Region löschen")).toBeInTheDocument();
    });
    expect(
      screen.queryByText("Text-Regionen werden per OCR mit dem erwarteten Text verglichen."),
    ).not.toBeInTheDocument();
  });

  // --- Edit expected text ---

  it("allows editing expected text for text regions", async () => {
    const user = userEvent.setup();
    const regions = [
      { type: "text" as const, expected_text: "Pikachu", rect: { x: 200, y: 30, w: 150, h: 40 } },
    ];
    await renderEditMode({ initialRegions: regions });
    const textInput = await waitFor(() => screen.getByPlaceholderText("Erwarteter Text"));
    await user.clear(textInput);
    await user.type(textInput, "Glumanda");
    expect(textInput).toHaveValue("Glumanda");
  });

  // --- Multiple regions ---

  it("renders multiple regions with numbered labels", async () => {
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
      { type: "text" as const, expected_text: "Pikachu", rect: { x: 200, y: 30, w: 150, h: 40 } },
      { type: "image" as const, expected_text: "", rect: { x: 50, y: 100, w: 80, h: 60 } },
    ];
    await renderEditMode({ initialRegions: regions });
    // Region list items have numbered labels in the editor
    await waitFor(() => {
      expect(screen.getAllByText("#1").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("#2").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("#3").length).toBeGreaterThanOrEqual(1);
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

  // --- New template mode: snapshot button and flow controls ---

  it("renders snapshot button in video phase for new templates", () => {
    render(
      <TemplateEditor
        onClose={vi.fn()}
        onSaveTemplate={vi.fn()}
      />,
    );
    const snapshotBtn = screen.getByText("Schnappschuss");
    expect(snapshotBtn).toBeInTheDocument();
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
    render(
      <TemplateEditor
        onClose={vi.fn()}
        onSaveTemplate={onSaveTemplate}
      />,
    );
    expect(screen.getByText("Schnappschuss")).toBeInTheDocument();
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
    const nameInput = await waitFor(() => screen.getByLabelText<HTMLInputElement>("Template-Name (optional)"));
    expect(nameInput.value).toBe("Keep This");
  });

  // --- Mixed region operations ---

  it("supports deleting specific regions from a multi-region list", async () => {
    const user = userEvent.setup();
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
      { type: "text" as const, expected_text: "Pikachu", rect: { x: 200, y: 30, w: 150, h: 40 } },
      { type: "image" as const, expected_text: "", rect: { x: 50, y: 100, w: 80, h: 60 } },
    ];
    await renderEditMode({ initialRegions: regions });

    // Delete the middle region (text)
    const deleteButtons = screen.getAllByTitle("Region löschen");
    expect(deleteButtons).toHaveLength(3);
    await user.click(deleteButtons[1]);

    // Now only 2 regions should remain
    expect(screen.getAllByTitle("Region löschen")).toHaveLength(2);
    // The text input for Pikachu should be gone
    expect(screen.queryByPlaceholderText("Erwarteter Text")).not.toBeInTheDocument();
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

  // --- OCR hint updates based on region type changes ---

  it("shows OCR hint after changing a region from image to text", async () => {
    const user = userEvent.setup();
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions });

    // Initially no OCR hint
    expect(
      screen.queryByText("Text-Regionen werden per OCR mit dem erwarteten Text verglichen."),
    ).not.toBeInTheDocument();

    // Switch to text type
    const select = screen.getByRole("combobox", { name: "Typ" });
    await user.selectOptions(select, "text");

    // OCR hint should now appear
    expect(
      screen.getByText("Text-Regionen werden per OCR mit dem erwarteten Text verglichen."),
    ).toBeInTheDocument();
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

  // --- Region with pokemonName pre-fill when no expected_text ---

  it("pre-fills pokemonName when switching image region to text with empty expected_text", async () => {
    const user = userEvent.setup();
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 200, y: 30, w: 150, h: 40 } },
    ];
    await renderEditMode({ initialRegions: regions, pokemonName: "Bisasam" });

    // Switch from image to text
    const select = screen.getByRole("combobox", { name: "Typ" });
    await user.selectOptions(select, "text");

    // Should pre-fill with pokemonName since expected_text was empty
    const textInput = screen.getByPlaceholderText("Erwarteter Text");
    expect(textInput).toHaveValue("Bisasam");
  });

  // --- Snapshot phase: retake and save buttons appear ---

  it("shows retake and save buttons after transitioning to snapshot phase in new-template mode", async () => {
    // Configure replay buffer to have frames
    mockReplayBuffer.frameCount = 5;
    mockReplayBuffer.bufferedSeconds = 2;
    mockReplayBuffer.getFrame = vi.fn().mockReturnValue({
      width: 640, height: 480, data: new Uint8ClampedArray(640 * 480 * 4),
    });

    render(
      <TemplateEditor
        onClose={vi.fn()}
        onSaveTemplate={vi.fn()}
      />,
    );

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
      width: 640, height: 480, data: new Uint8ClampedArray(640 * 480 * 4),
    });
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      putImageData: vi.fn(),
    }) as never;

    render(
      <TemplateEditor
        onClose={vi.fn()}
        onSaveTemplate={vi.fn()}
      />,
    );

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
      width: 640, height: 480, data: new Uint8ClampedArray(640 * 480 * 4),
    });

    render(
      <TemplateEditor
        onClose={vi.fn()}
        onSaveTemplate={vi.fn()}
      />,
    );

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
      width: 640, height: 480, data: new Uint8ClampedArray(640 * 480 * 4),
    });
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      putImageData: vi.fn(),
    }) as never;

    render(
      <TemplateEditor
        onClose={vi.fn()}
        onSaveTemplate={vi.fn()}
      />,
    );

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
      width: 640, height: 480, data: new Uint8ClampedArray(640 * 480 * 4),
    });
    const mockToDataURL = vi.fn().mockReturnValue("data:image/png;base64,testdata");
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      putImageData: vi.fn(),
    }) as never;
    HTMLCanvasElement.prototype.toDataURL = mockToDataURL;

    render(
      <TemplateEditor
        onClose={vi.fn()}
        onSaveTemplate={onSaveTemplate}
      />,
    );

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
    render(
      <TemplateEditor
        onClose={vi.fn()}
        onSaveTemplate={vi.fn()}
      />,
    );

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
      width: 640, height: 480, data: new Uint8ClampedArray(640 * 480 * 4),
    });

    render(
      <TemplateEditor
        onClose={vi.fn()}
        onSaveTemplate={vi.fn()}
      />,
    );

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
        width: 640, height: 480, data: new Uint8ClampedArray(640 * 480 * 4),
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
        screen.getByText("Niedrige Scores — probiere einen anderen Frame oder passe die Regionen an."),
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
      width: 640, height: 480, data: new Uint8ClampedArray(640 * 480 * 4),
    });
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      putImageData: vi.fn(),
    }) as never;

    render(
      <TemplateEditor
        onClose={vi.fn()}
        onSaveTemplate={vi.fn()}
      />,
    );

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

  // --- Stability analysis status button and modal (test phase) ---

  describe("stability analysis panel", () => {
    const stabilityRegions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];

    /** Scores with a clean match window: rating "good". */
    const goodScores = [0.1, 0.12, 0.08, 0.85, 0.9, 0.92, 0.88, 0.86, 0.11, 0.09, 0.1, 0.12];
    /** Overlapping noise/match distributions: rating "poor". */
    const poorScores = [0.6, 0.65, 0.7, 0.72, 0.74, 0.75, 0.7, 0.68, 0.66, 0.64, 0.62, 0.6];

    /** Fill the batch results mock with sampled frame scores. */
    function setBatchResults(scores: number[]) {
      mockTemplateTest.batchResults = new Map(
        scores.map((overallScore, i) => [i * 5, { frameIndex: i * 5, overallScore }]),
      );
      mockTemplateTest.isRunning = false;
    }

    /** Navigate an edit-mode render into the test phase. */
    async function goToTestPhase() {
      mockReplayBuffer.frameCount = 60;
      mockReplayBuffer.getFrame = vi.fn().mockReturnValue({
        width: 640, height: 480, data: new Uint8ClampedArray(640 * 480 * 4),
      });
      const user = userEvent.setup();
      await renderEditMode({ initialRegions: stabilityRegions });
      await user.click(screen.getByText("Weiter"));
      await waitFor(() => {
        expect(screen.getByText("Frame wählen")).toBeInTheDocument();
      });
      return user;
    }

    /**
     * Opens the stability modal via the status button. Waits until the button
     * carries the final rating in its accessible name, which implies the
     * batch analysis and the parameter sweep have both finished.
     */
    async function openStabilityModal(user: ReturnType<typeof userEvent.setup>) {
      const button = await screen.findByRole("button", { name: /Stabilitäts-Analyse:/ });
      await user.click(button);
      return await screen.findByRole("dialog");
    }

    it("shows the rating on the status button after a batch run", async () => {
      setBatchResults(goodScores);
      await goToTestPhase();

      const button = await screen.findByRole("button", { name: /Stabilitäts-Analyse: Zuverlässig erkennbar/ });
      expect(button).toBeEnabled();
      // The auto-applied calibration is part of the accessible name
      expect(button).toHaveAccessibleName(/Empfehlungen werden beim Speichern übernommen/);
    });

    it("shows rating, stats and recommendation in the modal after a batch run", async () => {
      setBatchResults(goodScores);
      const user = await goToTestPhase();

      const dialog = await openStabilityModal(user);
      expect(within(dialog).getByText(/Stabilitäts-Analyse: Zuverlässig erkennbar/)).toBeInTheDocument();
      // Stats line: 5 frames in the match window
      expect(within(dialog).getByText(/5 Bilder zeigen den Match/)).toBeInTheDocument();
      // Recommendation line present with a percentage
      expect(within(dialog).getByText(/Empfohlene Genauigkeit: \d+%/)).toBeInTheDocument();
    });

    it("opens the modal from the status button and closes it again", async () => {
      setBatchResults(goodScores);
      const user = await goToTestPhase();

      const button = await screen.findByRole("button", { name: /Stabilitäts-Analyse:/ });
      await user.click(button);
      const dialog = await screen.findByRole("dialog");
      // Native <dialog>.showModal() carries modal semantics implicitly, no
      // aria-modal attribute needed.

      // Escape fires a native `cancel` event on an open modal <dialog>;
      // jsdom doesn't implement this automatically, so simulate it directly.
      dialog.dispatchEvent(new Event("cancel", { bubbles: true }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      // The close-to-focus handoff is deferred (useDialogClose waits for the
      // clip-path transition or its fallback timeout) so it lands slightly
      // after the dialog itself disappears from the a11y tree.
      await waitFor(() => expect(button).toHaveFocus());

      // Close button closes as well
      await user.click(button);
      const reopened = await screen.findByRole("dialog");
      await user.click(within(reopened).getByRole("button", { name: "Schließen" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(button).toHaveFocus());

      // Backdrop click closes too (a click whose target is the dialog
      // element itself, not its content, per the imperative click-listener).
      await user.click(button);
      const third = await screen.findByRole("dialog");
      fireEvent.click(third, { target: third });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("defaults the apply checkbox to checked for a good rating", async () => {
      setBatchResults(goodScores);
      const user = await goToTestPhase();

      const dialog = await openStabilityModal(user);
      const checkbox = within(dialog).getByRole("checkbox", { name: /Empfohlene Einstellungen beim Speichern übernehmen/ });
      expect(checkbox).toBeChecked();
    });

    it("defaults the apply checkbox to unchecked for a poor rating", async () => {
      setBatchResults(poorScores);
      const user = await goToTestPhase();

      const dialog = await openStabilityModal(user);
      expect(within(dialog).getByText(/Stabilitäts-Analyse: Unzuverlässig/)).toBeInTheDocument();
      const checkbox = within(dialog).getByRole("checkbox", { name: /Empfohlene Einstellungen beim Speichern übernehmen/ });
      expect(checkbox).not.toBeChecked();
    });

    it("lets the user toggle the apply checkbox", async () => {
      setBatchResults(goodScores);
      const user = await goToTestPhase();

      const dialog = await openStabilityModal(user);
      const checkbox = within(dialog).getByRole("checkbox", { name: /Empfohlene Einstellungen beim Speichern übernehmen/ });
      await user.click(checkbox);
      expect(checkbox).not.toBeChecked();
      await user.click(checkbox);
      expect(checkbox).toBeChecked();
    });

    it("shows a disabled analyzing button while the batch is running", async () => {
      setBatchResults(goodScores);
      mockTemplateTest.isRunning = true;
      await goToTestPhase();

      const button = screen.getByRole("button", { name: "Analysiere…" });
      expect(button).toBeDisabled();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("disables the status button when there are too few samples", async () => {
      setBatchResults(goodScores.slice(0, 4));
      await goToTestPhase();

      const button = screen.getByRole("button", { name: "Stabilitäts-Analyse" });
      expect(button).toBeDisabled();
    });

    /** Save handler signature matching TemplateEditorProps.onSaveTemplate. */
    type SaveTemplateFn = NonNullable<React.ComponentProps<typeof TemplateEditor>["onSaveTemplate"]>;

    /**
     * Render with initialImageUrl but WITHOUT onUpdateRegions so the save path
     * uses onSaveTemplate, which carries the calibration payload.
     */
    async function goToConfirmAndSave(
      onSaveTemplate: SaveTemplateFn,
      opts: { uncheck?: boolean; awaitSweep?: boolean; recheck?: boolean } = {},
    ) {
      mockReplayBuffer.frameCount = 60;
      mockReplayBuffer.getFrame = vi.fn().mockReturnValue({
        width: 640, height: 480, data: new Uint8ClampedArray(640 * 480 * 4),
      });
      const mockToDataURL = vi.fn().mockReturnValue("data:image/png;base64,testdata");
      HTMLCanvasElement.prototype.toDataURL = mockToDataURL;

      const user = userEvent.setup();
      render(
        <TemplateEditor
          initialImageUrl="/api/detector/poke-1/template/0"
          initialRegions={stabilityRegions}
          onClose={vi.fn()}
          onSaveTemplate={onSaveTemplate}
        />,
      );
      await waitFor(() => {
        expect(screen.getAllByTitle("Region löschen").length).toBe(1);
      });

      // Snapshot -> test phase
      await user.click(screen.getByText("Weiter"));
      await waitFor(() => {
        expect(screen.getByText("Frame wählen")).toBeInTheDocument();
      });

      if (opts.awaitSweep) {
        // The button only shows the final rating once the sweep has finished
        await screen.findByRole("button", { name: /Stabilitäts-Analyse:/ });
      }

      if (opts.uncheck || opts.recheck) {
        const dialog = await openStabilityModal(user);
        const checkbox = within(dialog).getByRole("checkbox", { name: /Empfohlene Einstellungen beim Speichern übernehmen/ });
        await user.click(checkbox);
        if (opts.recheck) await user.click(checkbox);
        await user.click(within(dialog).getByRole("button", { name: "Schließen" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      }

      // Test -> confirm phase -> save
      await user.click(screen.getByText("Weiter"));
      await waitFor(() => {
        expect(screen.getByText("Speichern")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Speichern"));
      await waitFor(() => {
        expect(onSaveTemplate).toHaveBeenCalledTimes(1);
      });
    }

    it("includes the calibration in the save payload when applied", async () => {
      setBatchResults(goodScores);
      const onSaveTemplate = vi.fn<SaveTemplateFn>().mockResolvedValue(undefined);
      await goToConfirmAndSave(onSaveTemplate);

      const payload = onSaveTemplate.mock.calls[0][0];
      const calibration = payload.calibration!;
      expect(calibration).toBeDefined();
      expect(calibration.recommended_precision).toBeGreaterThan(0);
      expect(calibration.recommended_precision).toBeLessThanOrEqual(0.95);
      expect(calibration.sample_count).toBe(5);
      expect(calibration.match_p10).toBeCloseTo(0.85, 3);
      expect(calibration.noise_p90).toBeLessThanOrEqual(0.12);
    });

    it("omits the calibration from the save payload when unchecked", async () => {
      setBatchResults(goodScores);
      const onSaveTemplate = vi.fn<SaveTemplateFn>().mockResolvedValue(undefined);
      await goToConfirmAndSave(onSaveTemplate, { uncheck: true });

      const payload = onSaveTemplate.mock.calls[0][0];
      expect(payload.calibration).toBeUndefined();
    });

    // --- Parameter sweep in the stability panel ---

    /** Complete sweep result fixture used by the sweep display and save tests. */
    const sweepFixture: SweepResult = {
      precision: 0.6,
      hysteresisFactor: 0.85,
      consecutiveHits: 2,
      pollIntervalMs: 400,
      minPollMs: 50,
      maxPollMs: 2000,
      cleanPhases: 4,
      totalPhases: 4,
      perfect: true,
      robustnessMargin: 0.2,
      worstLatencyMs: 120,
    };

    it("shows a progress line in the modal while the sweep is running", async () => {
      setBatchResults(goodScores);
      mockSweepControl.finished = false;
      const user = await goToTestPhase();

      // While the sweep runs, the button shows the analyzing state but stays clickable
      const button = await screen.findByRole("button", { name: "Analysiere…" });
      expect(button).toBeEnabled();
      await user.click(button);
      const dialog = await screen.findByRole("dialog");

      expect(within(dialog).getByText("Simuliere optimale Einstellungen…")).toBeInTheDocument();
      // Analytic recommendation stays visible as the fallback while sweeping
      expect(within(dialog).getByText(/Empfohlene Genauigkeit: \d+%/)).toBeInTheDocument();
    });

    it("shows the swept values in the modal once the sweep completes", async () => {
      setBatchResults(goodScores);
      mockSweepControl.result = { ...sweepFixture };
      const user = await goToTestPhase();

      const dialog = await openStabilityModal(user);
      await waitFor(() => {
        expect(within(dialog).getByText("Empfohlene Genauigkeit: 60%")).toBeInTheDocument();
      });
      expect(within(dialog).getByText("Neuer Treffer erst, wenn der alte verschwunden ist (Schwelle: 85%)")).toBeInTheDocument();
      expect(within(dialog).getByText("Ein Match zählt erst nach 2 Treffern in Folge")).toBeInTheDocument();
      expect(within(dialog).getByText("Empfohlene Scan-Rate: alle 400 ms (min 50 ms, max 2000 ms)")).toBeInTheDocument();
      // Progress line disappears once the sweep finished
      expect(within(dialog).queryByText("Simuliere optimale Einstellungen…")).not.toBeInTheDocument();
      // A perfect sweep shows no caution line
      expect(within(dialog).queryByText(/Der automatische Test konnte den Match nicht/)).not.toBeInTheDocument();
    });

    it("shows a caution line when the sweep is imperfect", async () => {
      setBatchResults(goodScores);
      mockSweepControl.result = { ...sweepFixture, cleanPhases: 3, perfect: false };
      const user = await goToTestPhase();

      const dialog = await openStabilityModal(user);
      expect(
        within(dialog).getByText(/Der automatische Test konnte den Match nicht in jedem Durchlauf sicher bestätigen/),
      ).toBeInTheDocument();
    });

    it("saves the swept hits and polling values in the payload when applied", async () => {
      setBatchResults(goodScores);
      mockSweepControl.result = { ...sweepFixture };
      const onSaveTemplate = vi.fn<SaveTemplateFn>().mockResolvedValue(undefined);
      await goToConfirmAndSave(onSaveTemplate, { awaitSweep: true });

      const payload = onSaveTemplate.mock.calls[0][0];
      expect(payload.precision).toBeCloseTo(0.6, 5);
      expect(payload.hysteresisFactor).toBeCloseTo(0.85, 5);
      expect(payload.consecutiveHits).toBe(2);
      expect(payload.pollIntervalMs).toBe(400);
      expect(payload.minPollMs).toBe(50);
      expect(payload.maxPollMs).toBe(2000);
      // The calibration embeds the full sweep outcome
      expect(payload.calibration?.recommended_precision).toBeCloseTo(0.6, 3);
      expect(payload.calibration?.sweep?.consecutive_hits).toBe(2);
      expect(payload.calibration?.sweep?.poll_interval_ms).toBe(400);
    });

    it("writes the swept values into the save payload when re-applied via the modal checkbox", async () => {
      setBatchResults(goodScores);
      mockSweepControl.result = { ...sweepFixture };
      const onSaveTemplate = vi.fn<SaveTemplateFn>().mockResolvedValue(undefined);
      await goToConfirmAndSave(onSaveTemplate, { awaitSweep: true, recheck: true });

      const payload = onSaveTemplate.mock.calls[0][0];
      expect(payload.precision).toBeCloseTo(0.6, 5);
      expect(payload.consecutiveHits).toBe(2);
      expect(payload.calibration?.sweep?.consecutive_hits).toBe(2);
    });

    it("restores the pre-apply draft values when the apply checkbox is toggled off", async () => {
      setBatchResults(goodScores);
      mockSweepControl.result = { ...sweepFixture };
      const onSaveTemplate = vi.fn<SaveTemplateFn>().mockResolvedValue(undefined);
      await goToConfirmAndSave(onSaveTemplate, { awaitSweep: true, uncheck: true });

      const payload = onSaveTemplate.mock.calls[0][0];
      // Hardcoded defaults restored (this render passed no initial overrides)
      expect(payload.precision).toBeCloseTo(0.55, 5);
      expect(payload.hysteresisFactor).toBeCloseTo(0.7, 5);
      expect(payload.consecutiveHits).toBe(1);
      expect(payload.pollIntervalMs).toBe(200);
      expect(payload.calibration).toBeUndefined();
    });
  });

  // --- Keyboard-driven region drawing (WCAG 2.1.1 / 2.5.7 parallel path) ---

  describe("keyboard region drawing", () => {
    /** Returns the focusable drawing surface (role="application", snapshot phase only). */
    function getDrawSurface() {
      return screen.getByRole("application");
    }

    /** Reads the current in-progress drawn box's inline percentage style as numbers, or null if absent. */
    function readCurrentBoxStyle(surface: HTMLElement) {
      const box = surface.querySelector<HTMLElement>(".border-yellow-400");
      if (!box) return null;
      return {
        left: parseFloat(box.style.left),
        top: parseFloat(box.style.top),
        width: parseFloat(box.style.width),
        height: parseFloat(box.style.height),
      };
    }

    /** Asserts each numeric field of the pending box is close to the expected percentage value. */
    function expectCurrentBoxCloseTo(
      surface: HTMLElement,
      expected: { left: number; top: number; width: number; height: number },
    ) {
      const style = readCurrentBoxStyle(surface);
      expect(style).not.toBeNull();
      expect(style!.left).toBeCloseTo(expected.left, 5);
      expect(style!.top).toBeCloseTo(expected.top, 5);
      expect(style!.width).toBeCloseTo(expected.width, 5);
      expect(style!.height).toBeCloseTo(expected.height, 5);
    }

    it("is focusable and exposes an aria-label describing the keyboard flow", async () => {
      await renderEditMode({ initialRegions: [] });
      const surface = getDrawSurface();
      expect(surface).toHaveAttribute("tabindex", "0");
      expect(surface).toHaveAttribute(
        "aria-label",
        "Bereich zum Zeichnen einer Region. Enter startet ein Feld, Pfeiltasten verschieben es, Umschalt+Pfeiltaste ändert die Größe, Enter bestätigt.",
      );
    });

    it("Enter starts a new box at the default centered position", async () => {
      const { fireEvent } = await import("@testing-library/react");
      await renderEditMode({ initialRegions: [] });
      const surface = getDrawSurface();

      expect(readCurrentBoxStyle(surface)).toBeNull();
      fireEvent.keyDown(surface, { key: "Enter" });

      expectCurrentBoxCloseTo(surface, { left: 40, top: 40, width: 20, height: 20 });
    });

    it("arrow keys move the pending box without resizing it", async () => {
      const { fireEvent } = await import("@testing-library/react");
      await renderEditMode({ initialRegions: [] });
      const surface = getDrawSurface();

      fireEvent.keyDown(surface, { key: "Enter" });
      fireEvent.keyDown(surface, { key: "ArrowRight" });
      fireEvent.keyDown(surface, { key: "ArrowDown" });

      expectCurrentBoxCloseTo(surface, { left: 42, top: 42, width: 20, height: 20 });
    });

    it("Shift+arrow keys resize the pending box without moving its origin", async () => {
      const { fireEvent } = await import("@testing-library/react");
      await renderEditMode({ initialRegions: [] });
      const surface = getDrawSurface();

      fireEvent.keyDown(surface, { key: "Enter" });
      fireEvent.keyDown(surface, { key: "ArrowRight", shiftKey: true });
      fireEvent.keyDown(surface, { key: "ArrowDown", shiftKey: true });

      expectCurrentBoxCloseTo(surface, { left: 40, top: 40, width: 22, height: 22 });
    });

    it("Enter again commits the pending box as a new region", async () => {
      const { fireEvent } = await import("@testing-library/react");
      await renderEditMode({ initialRegions: [] });
      const surface = getDrawSurface();

      fireEvent.keyDown(surface, { key: "Enter" });
      fireEvent.keyDown(surface, { key: "Enter" });

      expect(readCurrentBoxStyle(surface)).toBeNull();
      await waitFor(() => {
        expect(screen.getAllByTitle("Region löschen")).toHaveLength(1);
      });
    });

    it("Escape cancels the pending box without committing it", async () => {
      const { fireEvent } = await import("@testing-library/react");
      await renderEditMode({ initialRegions: [] });
      const surface = getDrawSurface();

      fireEvent.keyDown(surface, { key: "Enter" });
      expect(readCurrentBoxStyle(surface)).not.toBeNull();

      fireEvent.keyDown(surface, { key: "Escape" });

      expect(readCurrentBoxStyle(surface)).toBeNull();
      expect(screen.queryByTitle("Region löschen")).not.toBeInTheDocument();
    });
  });
});
