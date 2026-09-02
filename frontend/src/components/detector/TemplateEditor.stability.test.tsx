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
        width: 640,
        height: 480,
        data: new Uint8ClampedArray(640 * 480 * 4),
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

      const button = await screen.findByRole("button", {
        name: /Stabilitäts-Analyse: Zuverlässig erkennbar/,
      });
      expect(button).toBeEnabled();
      // The auto-applied calibration is part of the accessible name
      expect(button).toHaveAccessibleName(/Empfehlungen werden beim Speichern übernommen/);
    });

    it("shows rating, stats and recommendation in the modal after a batch run", async () => {
      setBatchResults(goodScores);
      const user = await goToTestPhase();

      const dialog = await openStabilityModal(user);
      expect(
        within(dialog).getByText(/Stabilitäts-Analyse: Zuverlässig erkennbar/),
      ).toBeInTheDocument();
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
      // The closed dialog stays mounted until that deferred handoff runs;
      // wait for the unmount so the reopen click mounts a fresh dialog.
      await waitFor(() => expect(screen.queryByRole("dialog", { hidden: true })).toBeNull());

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
      const checkbox = within(dialog).getByRole("switch", {
        name: /Empfohlene Einstellungen beim Speichern übernehmen/,
      });
      expect(checkbox).toBeChecked();
    });

    it("defaults the apply checkbox to unchecked for a poor rating", async () => {
      setBatchResults(poorScores);
      const user = await goToTestPhase();

      const dialog = await openStabilityModal(user);
      expect(within(dialog).getByText(/Stabilitäts-Analyse: Unzuverlässig/)).toBeInTheDocument();
      const checkbox = within(dialog).getByRole("switch", {
        name: /Empfohlene Einstellungen beim Speichern übernehmen/,
      });
      expect(checkbox).not.toBeChecked();
    });

    it("lets the user toggle the apply checkbox", async () => {
      setBatchResults(goodScores);
      const user = await goToTestPhase();

      const dialog = await openStabilityModal(user);
      const checkbox = within(dialog).getByRole("switch", {
        name: /Empfohlene Einstellungen beim Speichern übernehmen/,
      });
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
    type SaveTemplateFn = NonNullable<
      React.ComponentProps<typeof TemplateEditor>["onSaveTemplate"]
    >;

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
        width: 640,
        height: 480,
        data: new Uint8ClampedArray(640 * 480 * 4),
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
        const checkbox = within(dialog).getByRole("switch", {
          name: /Empfohlene Einstellungen beim Speichern übernehmen/,
        });
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
      expect(
        within(dialog).getByText(
          "Neuer Treffer erst, wenn der alte verschwunden ist (Schwelle: 85%)",
        ),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByText("Ein Match zählt erst nach 2 Treffern in Folge"),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByText("Empfohlene Scan-Rate: alle 400 ms (min 50 ms, max 2000 ms)"),
      ).toBeInTheDocument();
      // Progress line disappears once the sweep finished
      expect(
        within(dialog).queryByText("Simuliere optimale Einstellungen…"),
      ).not.toBeInTheDocument();
      // A perfect sweep shows no caution line
      expect(
        within(dialog).queryByText(/Der automatische Test konnte den Match nicht/),
      ).not.toBeInTheDocument();
    });

    it("shows a caution line when the sweep is imperfect", async () => {
      setBatchResults(goodScores);
      mockSweepControl.result = { ...sweepFixture, cleanPhases: 3, perfect: false };
      const user = await goToTestPhase();

      const dialog = await openStabilityModal(user);
      expect(
        within(dialog).getByText(
          /Der automatische Test konnte den Match nicht in jedem Durchlauf sicher bestätigen/,
        ),
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
});
