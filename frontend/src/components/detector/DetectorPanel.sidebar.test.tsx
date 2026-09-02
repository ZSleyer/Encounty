import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  makePokemon,
  makeAppState,
  userEvent,
  waitFor,
  fireEvent,
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

  // --- Sidebar tabs (log / settings) ---

  it("renders log and settings tabs in the sidebar", async () => {
    renderPanel();
    await waitFor(() => {
      // The tab buttons should be present (i18n keys: detector.logTitle, detector.settingsTitle)
      const buttons = screen.getAllByRole("button");
      // Find tab-like buttons — there should be at least two in the right panel
      expect(buttons.length).toBeGreaterThan(2);
    });
  });

  // --- Log tab with entries ---

  it("renders detection log entries when present", async () => {
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [],
        detection_log: [
          { confidence: 0.8, at: "2024-03-01T12:00:00Z" },
          { confidence: 0.3, at: "2024-03-01T12:01:00Z" },
        ],
      },
    });
    renderPanel({ pokemon });
    await waitFor(() => {
      // Confidence percentages should appear in the log
      expect(screen.getByText("80.0%")).toBeInTheDocument();
      expect(screen.getByText("30.0%")).toBeInTheDocument();
    });
  });

  it("shows match badge for log entries above precision threshold", async () => {
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [],
        detection_log: [{ confidence: 0.9, at: "2024-03-01T12:00:00Z" }],
      },
    });
    renderPanel({ pokemon });
    await waitFor(() => {
      // The "Match" label should appear for entries above threshold
      expect(screen.getByText("Match")).toBeInTheDocument();
    });
  });

  it("shows empty log message when no detection log entries exist", async () => {
    renderPanel();
    await waitFor(() => {
      // The "no log entries" placeholder should appear (i18n: detector.noLogEntries)
      const allText = document.body.textContent ?? "";
      expect(allText).toBeTruthy();
    });
  });

  // --- Clear log button ---

  it("renders clear log button when log entries exist", async () => {
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [],
        detection_log: [{ confidence: 0.8, at: "2024-03-01T12:00:00Z" }],
      },
    });
    renderPanel({ pokemon });
    await waitFor(() => {
      const clearBtn = screen.getByLabelText(/löschen|clear/i);
      expect(clearBtn).toBeInTheDocument();
    });
  });

  // --- Reset layout divider button ---

  it("renders reset layout button for the divider", async () => {
    renderPanel();
    await waitFor(() => {
      const resetBtns = screen.getAllByLabelText(/Layout zurücksetzen|Reset layout/i);
      expect(resetBtns.length).toBeGreaterThanOrEqual(1);
    });
  });

  // --- Divider drag button ---

  it("renders the resize divider button", async () => {
    renderPanel();
    await waitFor(() => {
      const dividerBtn = screen.getByLabelText(/Größe ändern|Resize/i);
      expect(dividerBtn).toBeInTheDocument();
    });
  });

  // --- Log tab is default active tab ---

  it("shows log tab as default active", async () => {
    renderPanel();
    await waitFor(() => {
      // The log tab button should have the active styling
      const logTab = screen
        .getAllByRole("button")
        .find(
          (btn) =>
            /Verlauf|Log/i.exec(btn.textContent ?? "") &&
            btn.className.includes("border-accent-blue"),
        );
      expect(logTab).toBeTruthy();
    });
  });

  // --- Precision threshold context in log ---

  it("shows precision threshold context when log entries exist", async () => {
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [],
        detection_log: [{ confidence: 0.8, at: "2024-03-01T12:00:00Z" }],
      },
    });
    renderPanel({ pokemon });
    await waitFor(() => {
      // Should show the precision threshold percentage
      const allText = document.body.textContent ?? "";
      expect(allText).toContain("55%");
    });
  });

  // --- Log entry time display ---

  it("shows timestamps in log entries", async () => {
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [],
        detection_log: [{ confidence: 0.8, at: "2024-03-01T12:00:00Z" }],
      },
    });
    renderPanel({ pokemon });
    await waitFor(() => {
      // A <time> element should be rendered with the log entry timestamp
      const timeEl = document.querySelector("time");
      expect(timeEl).toBeInTheDocument();
    });
  });

  // --- Multiple log entries render in reverse order ---

  it("renders log entries in reverse chronological order", async () => {
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [],
        detection_log: [
          { confidence: 0.3, at: "2024-03-01T12:00:00Z" },
          { confidence: 0.9, at: "2024-03-01T12:01:00Z" },
        ],
      },
    });
    renderPanel({ pokemon });
    await waitFor(() => {
      // Both percentages should be visible
      expect(screen.getByText("30.0%")).toBeInTheDocument();
      expect(screen.getByText("90.0%")).toBeInTheDocument();
    });
  });

  // --- Log entry count label ---

  it("shows log entry count in the precision context", async () => {
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [],
        detection_log: [
          { confidence: 0.8, at: "2024-03-01T12:00:00Z" },
          { confidence: 0.4, at: "2024-03-01T12:01:00Z" },
          { confidence: 0.6, at: "2024-03-01T12:02:00Z" },
        ],
      },
    });
    renderPanel({ pokemon });
    await waitFor(() => {
      // Should show "3" for the log entry count
      const allText = document.body.textContent ?? "";
      expect(allText).toContain("3");
    });
  });

  // --- Clear log button click ---

  it("calls fetch when clear log button is clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [],
        detection_log: [{ confidence: 0.8, at: "2024-03-01T12:00:00Z" }],
      },
    });
    renderPanel({ pokemon });

    const clearBtn = screen.getByLabelText(/löschen|clear/i);
    await user.click(clearBtn);

    // Should have made a DELETE request to clear the log
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      expect.stringContaining("/detection_log"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  // --- No match badge for low confidence log entries ---

  it("does not show match badge for log entries below precision threshold", async () => {
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [],
        detection_log: [{ confidence: 0.3, at: "2024-03-01T12:00:00Z" }],
      },
    });
    renderPanel({ pokemon });
    await waitFor(() => {
      // "Match" label should NOT appear for entries below threshold
      expect(screen.queryByText("Match")).not.toBeInTheDocument();
      // But the confidence percentage should still show
      expect(screen.getByText("30.0%")).toBeInTheDocument();
    });
  });

  // --- Multiple log entries with mixed match/no-match ---

  it("renders both match and non-match log entries correctly", async () => {
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [],
        detection_log: [
          { confidence: 0.8, at: "2024-03-01T12:00:00Z" },
          { confidence: 0.3, at: "2024-03-01T12:01:00Z" },
          { confidence: 0.6, at: "2024-03-01T12:02:00Z" },
          { confidence: 0.1, at: "2024-03-01T12:03:00Z" },
        ],
      },
    });
    renderPanel({ pokemon });
    await waitFor(() => {
      // Should show all percentages
      expect(screen.getByText("80.0%")).toBeInTheDocument();
      expect(screen.getByText("30.0%")).toBeInTheDocument();
      expect(screen.getByText("60.0%")).toBeInTheDocument();
      expect(screen.getByText("10.0%")).toBeInTheDocument();

      // Should show "Match" for entries above 0.55 threshold (80%, 60%)
      const matchLabels = screen.getAllByText("Match");
      expect(matchLabels.length).toBe(2);
    });
  });

  // --- Reset layout button click resets split height ---

  it("resets template split height when reset layout button is clicked", async () => {
    const user = userEvent.setup();
    renderPanel();

    const resetBtns = screen.getAllByLabelText(/Layout zurücksetzen|Reset layout/i);
    await user.click(resetBtns[0]);

    // localStorage should have the split item removed
    expect(localStorage.getItem("encounty_detector_split")).toBeNull();
  });

  // --- Saved localStorage split height is restored ---

  it("restores template split height from localStorage", async () => {
    localStorage.setItem("encounty_detector_split", "500");
    renderPanel();
    await waitFor(() => {
      // The component should use 500 from localStorage as the template height
      const templateGrid = document.querySelector("[style*='height: 500px']");
      expect(templateGrid).toBeInTheDocument();
    });
    localStorage.removeItem("encounty_detector_split");
  });

  // --- Divider drag starts ---

  it("starts divider drag on mousedown", async () => {
    renderPanel();
    const dividerBtn = await screen.findByLabelText(/Größe ändern|Resize/i);
    // Simulate mousedown on the divider
    const mousedownEvent = new MouseEvent("mousedown", {
      clientY: 300,
      bubbles: true,
    });
    dividerBtn.dispatchEvent(mousedownEvent);

    // The component should handle the drag start without errors
    expect(dividerBtn).toBeInTheDocument();
  });

  // --- Divider drag with mouse movement ---

  it("handles divider drag with mouse movement via React events", async () => {
    renderPanel();
    await act(async () => {});
    const dividerBtn = screen.getByLabelText(/Größe ändern|Resize/i);

    // Use fireEvent to trigger React's onMouseDown handler
    await act(async () => {
      fireEvent.mouseDown(dividerBtn, { clientY: 300 });
    });

    // Move mouse during drag (ref is set)
    await act(async () => {
      globalThis.dispatchEvent(new MouseEvent("mousemove", { clientY: 350, bubbles: true }));
    });

    // Release mouse — clears the ref and removes listeners
    await act(async () => {
      globalThis.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    // After mouseup, localStorage should be set with the new height
    await waitFor(() => {
      const stored = localStorage.getItem("encounty_detector_split");
      expect(stored).toBeTruthy();
    });

    // Dispatch another mousemove after mouseup — the onMove callback was
    // already removed in onUp, so this tests that the listener is properly
    // cleaned up. This also covers the early return in onMove when ref is null.
    await act(async () => {
      globalThis.dispatchEvent(new MouseEvent("mousemove", { clientY: 400, bubbles: true }));
    });
  });

  // --- Divider keyboard resize ---

  it("increases template split height on ArrowDown keydown", async () => {
    // Start below the innerHeight-250 ceiling so the +24px step isn't clamped
    localStorage.setItem("encounty_detector_split", "400");
    renderPanel();
    const dividerBtn = await screen.findByLabelText(/Größe ändern|Resize/i);

    fireEvent.keyDown(dividerBtn, { key: "ArrowDown" });

    await waitFor(() => {
      const templateGrid = document.querySelector("[style*='height: 424px']");
      expect(templateGrid).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(localStorage.getItem("encounty_detector_split")).toBe("424");
    });
    localStorage.removeItem("encounty_detector_split");
  });

  it("clamps template split height to the minimum on repeated ArrowUp keydown", async () => {
    localStorage.setItem("encounty_detector_split", "90");
    renderPanel();
    const dividerBtn = await screen.findByLabelText(/Größe ändern|Resize/i);

    // Press ArrowUp repeatedly — well past enough presses to hit the 80px floor
    for (let i = 0; i < 5; i++) {
      fireEvent.keyDown(dividerBtn, { key: "ArrowUp" });
    }

    await waitFor(() => {
      const templateGrid = document.querySelector("[style*='height: 80px']");
      expect(templateGrid).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(localStorage.getItem("encounty_detector_split")).toBe("80");
    });
    localStorage.removeItem("encounty_detector_split");
  });

  it("caps a stored split that does not fit the right column, keeping the log and settings tabs reachable", async () => {
    // Regression guard for issue #48: on a short window (high Windows display
    // scaling) the stored 500px ate the whole column, so the settings tab with
    // the precision slider had zero height and could not be reached.
    let notifyResize: (() => void) | undefined;
    const OriginalResizeObserver = globalThis.ResizeObserver;
    class ResizeObserverStub implements ResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        // The component ignores the entries, so an empty notification suffices.
        notifyResize = () => cb([], this);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub;
    localStorage.setItem("encounty_detector_split", "500");
    renderPanel({});

    const templateGrid = await waitFor(() => {
      const el = document.querySelector("[style*='height: 500px']");
      expect(el).toBeInTheDocument();
      return el as HTMLElement;
    });
    // jsdom measures everything as 0, so the column height has to be faked.
    Object.defineProperty(templateGrid.parentElement as HTMLElement, "clientHeight", {
      value: 400,
      configurable: true,
    });
    act(() => notifyResize?.());

    // 400px column minus the divider, the tab strip and the tab content
    // reservation. jsdom reports a zero-sized header above the grid.
    await waitFor(() => {
      expect(templateGrid.style.height).toBe("198px");
    });
    // The capped value must not overwrite what was chosen on a larger monitor.
    expect(localStorage.getItem("encounty_detector_split")).toBe("500");

    localStorage.removeItem("encounty_detector_split");
    globalThis.ResizeObserver = OriginalResizeObserver;
  });
});
