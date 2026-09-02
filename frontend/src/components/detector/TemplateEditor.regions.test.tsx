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

  // --- No-regions hint ---

  it("shows no-regions hint in edit mode when no regions exist", async () => {
    await renderEditMode({ initialRegions: [] });
    await waitFor(() => {
      expect(screen.getByText("Mindestens eine Region ist erforderlich.")).toBeInTheDocument();
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

  // --- Keyboard-driven region drawing (WCAG 2.1.1 / 2.5.7 parallel path) ---

  describe("keyboard region drawing", () => {
    /** Returns the focusable drawing surface (role="application", snapshot phase only). */
    function getDrawSurface() {
      return screen.getByRole("application");
    }

    /** Reads the current in-progress drawn box's inline percentage style as numbers, or null if absent. */
    function readCurrentBoxStyle(surface: HTMLElement) {
      const box = surface.querySelector<HTMLElement>(".border-accent-yellow");
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
