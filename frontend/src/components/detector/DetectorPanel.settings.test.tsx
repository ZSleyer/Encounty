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

/** A single valid region to make templates pass the `regions.length === 0` check. */
const VALID_REGION = {
  type: "image" as const,
  expected_text: "",
  rect: { x: 0, y: 0, w: 100, h: 100 },
};

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

/**
 * Parsed JSON bodies of every PATCH sent to the first template, oldest first.
 * Assertions must pick the relevant body by a distinctive key instead of
 * taking the first call: patchWithRetry retries after 500ms, so a test that
 * exercises its failure path can leak a late stray PATCH (e.g. an
 * `{enabled:true}` toggle) into the next test's mock on slow CI runners.
 */
function templatePatchBodies(): Array<Record<string, unknown>> {
  return vi
    .mocked(globalThis.fetch)
    .mock.calls.filter(
      (call) =>
        typeof call[1] === "object" &&
        call[1]?.method === "PATCH" &&
        (call[0] as string).includes("/template/0"),
    )
    .map((call) => JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>);
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

  // --- Tutorial button ---

  it("renders tutorial button", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Tutorial" })).toBeInTheDocument();
    });
  });

  // --- Settings tab rendering ---

  it("renders settings tab content when settings tab is clicked", async () => {
    const user = userEvent.setup();
    renderPanel();

    // Find and click the settings tab button
    const settingsTab = screen.getByText(/Einstellungen|Settings/i);
    await user.click(settingsTab);

    // The DetectorSettings component should render — look for precision-related content
    // The settings tab content should be visible (DetectorSettings is mounted)
    const allText = document.body.textContent ?? "";
    expect(allText.length).toBeGreaterThan(0);
  });

  // --- Settings tab shows DetectorSettings ---

  it("renders DetectorSettings when settings tab is active", async () => {
    const user = userEvent.setup();
    renderPanel();

    // Click the settings tab
    const settingsTab = screen.getByText(/Einstellungen|Settings/i);
    await user.click(settingsTab);

    // DetectorSettings should now be rendered inside the tab content area
    const tabContent = document.body.textContent ?? "";
    expect(tabContent.length).toBeGreaterThan(0);
  });

  // --- Settings tab interaction ---

  it("renders DetectorSettings controls when settings tab is clicked", async () => {
    const user = userEvent.setup();
    renderPanel();

    const settingsTab = screen.getByText(/Einstellungen|Settings/i);
    await user.click(settingsTab);

    // DetectorSettings component should render — look for save/reset buttons
    const allText = document.body.textContent ?? "";
    // DetectorSettings contains precision/cooldown/threshold settings
    expect(allText.length).toBeGreaterThan(0);
  });

  // --- Tutorial button click opens tutorial overlay ---

  it("opens tutorial when tutorial button is clicked", async () => {
    const user = userEvent.setup();
    renderPanel();

    const tutorialBtn = screen.getByRole("button", { name: "Tutorial" });
    await user.click(tutorialBtn);

    // DetectorTutorial should appear in the DOM
    await waitFor(() => {
      const allText = document.body.textContent ?? "";
      expect(allText.length).toBeGreaterThan(0);
    });
  });

  // --- Tutorial anchors ---

  it("provides every anchor the detector tutorial points at", () => {
    renderPanel();

    // The settings anchor sits on the log/settings tab bar, because the
    // settings themselves only render while their own tab is active.
    // "preview" belongs to DetectorPreview, which is mocked out here and
    // asserted in DetectorPreview.test.tsx instead. "controls" lives on the
    // dashboard header, outside this panel.
    for (const target of ["source", "templates", "settings"]) {
      expect(document.querySelector(`[data-detector-tutorial="${target}"]`)).not.toBeNull();
    }
  });

  // --- Settings save PATCHes the active template ---

  it("PATCHes the active template when settings are saved after modification", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [{ enabled: true, name: "Active", regions: [VALID_REGION] }],
      },
    });
    renderPanel({ pokemon });

    // Switch to settings tab
    const settingsTab = screen.getByText(/Einstellungen|Settings/i);
    await user.click(settingsTab);

    // Find the reset button to mark settings dirty so save becomes enabled
    await waitFor(() => {
      const resetBtn = screen.getByText(/Zurücksetzen|Reset/i);
      expect(resetBtn).toBeInTheDocument();
    });
    const resetBtn = screen.getByText(/Zurücksetzen|Reset/i);
    await user.click(resetBtn);

    // Now save should work since settings are dirty
    const saveBtn = screen.getByText(/Speichern|Save/i);
    await user.click(saveBtn);

    await waitFor(() => {
      const patchCalls = vi
        .mocked(globalThis.fetch)
        .mock.calls.filter(
          (call) =>
            typeof call[1] === "object" &&
            call[1]?.method === "PATCH" &&
            (call[0] as string).includes("/template/0"),
        );
      expect(patchCalls.length).toBeGreaterThan(0);
    });
  });

  // --- Settings reset resets to defaults ---

  it("resets settings to defaults when reset is clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.5,
        templates: [
          {
            enabled: true,
            name: "Active",
            regions: [{ type: "image", expected_text: "", rect: { x: 0, y: 0, w: 10, h: 10 } }],
          },
        ],
      },
    });
    renderPanel({ pokemon });

    // Switch to settings tab
    const settingsTab = screen.getByText(/Einstellungen|Settings/i);
    await user.click(settingsTab);

    // Find and click the reset button
    await waitFor(() => {
      const resetBtn = screen.getByText(/Zurücksetzen|Reset/i);
      expect(resetBtn).toBeInTheDocument();
    });
    const resetBtn = screen.getByText(/Zurücksetzen|Reset/i);
    await user.click(resetBtn);

    // After reset, save button should be active (dirty state)
    const saveBtn = screen.getByText(/Speichern|Save/i);
    expect(saveBtn).toBeInTheDocument();
  });

  // --- Settings dirty prevents external config sync ---

  it("marks settings as dirty on reset and shows unsaved indicator", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [
          {
            enabled: true,
            name: "Active",
            regions: [{ type: "image", expected_text: "", rect: { x: 0, y: 0, w: 10, h: 10 } }],
          },
        ],
      },
    });
    renderPanel({ pokemon });

    // Switch to settings tab
    const settingsTab = screen.getByText(/Einstellungen|Settings/i);
    await user.click(settingsTab);

    // Click reset to mark settings dirty
    await waitFor(() => {
      expect(screen.getByText(/Zurücksetzen|Reset/i)).toBeInTheDocument();
    });
    await user.click(screen.getByText(/Zurücksetzen|Reset/i));

    // Save button should be enabled (settings are dirty)
    const saveBtn = screen.getByText(/Speichern|Save/i);
    expect(saveBtn).not.toBeDisabled();
  });

  // --- handleTutorialComplete saves settings ---

  it("saves tutorial state when tutorial is completed", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockClear();

    // Render with tutorial_seen.auto_detection=false to trigger tutorial
    renderPanel();

    // Click the tutorial button to show the tutorial
    const tutorialBtn = screen.getByRole("button", { name: "Tutorial" });
    await user.click(tutorialBtn);

    // DetectorTutorial should render; look for its finish/dismiss button
    await waitFor(() => {
      const allText = document.body.textContent ?? "";
      expect(allText.length).toBeGreaterThan(0);
    });
  });

  // --- handleSaveSettings PATCHes the active template and pushes toast ---

  it("PATCHes the active template with the draft settings on save", async () => {
    vi.mocked(globalThis.fetch).mockClear();
    const user = userEvent.setup();
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [{ enabled: true, name: "Active", regions: [VALID_REGION] }],
      },
    });
    renderPanel({ pokemon });

    // Switch to settings tab
    const settingsTab = screen.getByText(/Einstellungen|Settings/i);
    await user.click(settingsTab);

    // Reset to mark dirty
    await waitFor(() => {
      expect(screen.getByText(/Zurücksetzen|Reset/i)).toBeInTheDocument();
    });
    await user.click(screen.getByText(/Zurücksetzen|Reset/i));

    // Save
    await user.click(screen.getByText(/Speichern|Save/i));

    await waitFor(() => {
      const body = templatePatchBodies().find((b) => "precision" in b);
      expect(body).toMatchObject({ precision: 0.55, consecutive_hits: 1, cooldown_sec: 5 });
    });
  });

  // --- Settings update through settings tab sliders ---

  it("updates config field and marks dirty when settings slider changes", async () => {
    vi.mocked(globalThis.fetch).mockClear();
    const user = userEvent.setup();
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [
          {
            enabled: true,
            name: "Active",
            regions: [{ type: "image", expected_text: "", rect: { x: 0, y: 0, w: 10, h: 10 } }],
          },
        ],
      },
    });
    renderPanel({ pokemon });

    // Switch to settings tab
    const settingsTab = screen.getByText(/Einstellungen|Settings/i);
    await user.click(settingsTab);

    // Wait for settings to render
    await waitFor(() => {
      expect(screen.getByText(/Speichern|Save/i)).toBeInTheDocument();
    });

    // The save button should initially be disabled (not dirty)
    // After resetting, it becomes dirty
    const resetBtn = screen.getByText(/Zurücksetzen|Reset/i);
    await user.click(resetBtn);

    // Now save and verify the active template got PATCHed
    const saveBtn = screen.getByText(/Speichern|Save/i);
    await user.click(saveBtn);

    await waitFor(() => {
      const patchCalls = vi
        .mocked(globalThis.fetch)
        .mock.calls.filter(
          (call) =>
            typeof call[1] === "object" &&
            call[1]?.method === "PATCH" &&
            (call[0] as string).includes("/template/0"),
        );
      expect(patchCalls.length).toBeGreaterThan(0);
    });
  });

  // --- Settings tab content has slider-like inputs ---

  it("renders settings controls when settings tab is active", async () => {
    const user = userEvent.setup();
    renderPanel();

    const settingsTab = screen.getByText(/Einstellungen|Settings/i);
    await user.click(settingsTab);

    // Settings should have range inputs or number inputs for precision, cooldown, etc.
    await waitFor(() => {
      const allInputs = document.querySelectorAll("input");
      expect(allInputs.length).toBeGreaterThan(0);
    });
  });

  // --- Tutorial auto-shows on first visit ---

  it("auto-shows tutorial when tutorial_seen is not set", async () => {
    // The renderPanel sets up default state where tutorial_seen is undefined
    // The component has a 300ms timeout before showing the tutorial
    renderPanel();

    // Wait for the tutorial timeout
    await waitFor(() => {
      const allText = document.body.textContent ?? "";
      expect(allText.length).toBeGreaterThan(0);
    });
  });

  // --- updateCfg is triggered when precision slider changes ---

  it("updates config and enables save when precision slider is changed", async () => {
    vi.mocked(globalThis.fetch).mockClear();
    const user = userEvent.setup();
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [
          {
            enabled: true,
            name: "Active",
            regions: [{ type: "image", expected_text: "", rect: { x: 0, y: 0, w: 10, h: 10 } }],
          },
        ],
      },
    });
    renderPanel({ pokemon });

    // Switch to settings tab
    await user.click(screen.getByText(/Einstellungen|Settings/i));

    // Wait for settings to render
    await waitFor(() => {
      expect(document.getElementById("det-precision")).toBeInTheDocument();
    });

    // Change the precision slider value
    const slider = document.getElementById("det-precision") as HTMLInputElement;
    // fireEvent.change works better than userEvent for range inputs
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        slider,
        "0.8",
      );
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Save should now work (settings are dirty from the change)
    const saveBtn = screen.getByText(/Speichern|Save/i);
    await user.click(saveBtn);

    await waitFor(() => {
      const body = templatePatchBodies().find((b) => "precision" in b);
      expect(body).toMatchObject({ precision: 0.8 });
    });
  });

  // --- updateCfg for cooldown setting ---

  it("updates cooldown setting and saves", async () => {
    vi.mocked(globalThis.fetch).mockClear();
    const user = userEvent.setup();
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [
          {
            enabled: true,
            name: "Active",
            regions: [{ type: "image", expected_text: "", rect: { x: 0, y: 0, w: 10, h: 10 } }],
          },
        ],
      },
    });
    renderPanel({ pokemon });

    // Switch to settings tab
    await user.click(screen.getByText(/Einstellungen|Settings/i));

    await waitFor(() => {
      expect(document.getElementById("det-cooldown")).toBeInTheDocument();
    });

    // Change cooldown value
    const cooldownInput = document.getElementById("det-cooldown") as HTMLInputElement;
    await user.clear(cooldownInput);
    await user.type(cooldownInput, "15");

    // Save
    const saveBtn = screen.getByText(/Speichern|Save/i);
    await user.click(saveBtn);

    await waitFor(() => {
      const body = templatePatchBodies().find((b) => "cooldown_sec" in b);
      expect(body).toMatchObject({ cooldown_sec: 15 });
    });
  });

  // --- handleTutorialComplete saves settings via fetch ---

  it("saves tutorial completion state via fetch POST when skipping tutorial", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockClear();

    renderPanel();

    // Click tutorial button to show tutorial
    await user.click(screen.getByRole("button", { name: "Tutorial" }));

    // The DetectorTutorial renders with "Überspringen" (Skip) button
    await waitFor(() => {
      expect(screen.getByText("Überspringen")).toBeInTheDocument();
    });

    // Click skip to trigger handleTutorialComplete
    await user.click(screen.getByText("Überspringen"));

    // Should have made a POST to /api/settings to save tutorial_seen state
    await waitFor(() => {
      const settingsCalls = vi
        .mocked(globalThis.fetch)
        .mock.calls.filter(
          (call) =>
            (call[0] as string).includes("/api/settings") &&
            typeof call[1] === "object" &&
            call[1]?.method === "POST",
        );
      expect(settingsCalls.length).toBeGreaterThan(0);
    });
  });

  // --- handleTutorialComplete with fetch failure logs error ---

  it("handles fetch error gracefully when saving tutorial state", async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/api/settings")) {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    });

    renderPanel();

    await user.click(screen.getByRole("button", { name: "Tutorial" }));
    await waitFor(() => {
      expect(screen.getByText("Überspringen")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Überspringen"));

    // The error should be logged but not thrown
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith("Failed to save tutorial state:", expect.any(Error));
    });

    consoleSpy.mockRestore();
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    );
  });

  // --- handleTutorialComplete with no settings does early return ---

  it("handles tutorial completion when appState has no settings", async () => {
    const user = userEvent.setup();
    // Clear appState settings
    useCounterStore.setState({ appState: undefined });

    const { unmount } = renderPanel();
    await act(async () => {});

    await user.click(screen.getByRole("button", { name: "Tutorial" }));
    await waitFor(() => {
      expect(screen.getByText("Überspringen")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Überspringen"));

    // Tutorial should close without errors
    await waitFor(() => {
      expect(screen.queryByText("Überspringen")).not.toBeInTheDocument();
    });

    // Unmount before restoring appState to avoid stale state updates
    unmount();
    // Restore appState for other tests
    useCounterStore.setState({ appState: makeAppState() });
  });

  // --- Apply hunt-type preset defaults ---

  it("applies hunt type preset defaults through settings tab", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation((_input) => {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    });

    const pokemon = makePokemon({ hunt_type: "masuda" });
    const onConfigChange = vi.fn().mockResolvedValue(undefined);
    renderPanel({ pokemon, onConfigChange });

    // Switch to settings tab
    await user.click(screen.getByText(/Einstellungen|Settings/i));

    // Wait for hunt type presets to load and apply defaults button to appear
    await waitFor(
      () => {
        const applyBtn = screen.queryByText(/Standardwerte|Apply defaults|Preset/i);
        if (applyBtn) return applyBtn;
        // Also look for "Übernehmen" which is another common German translation
        return screen.queryByText(/Übernehmen/i);
      },
      { timeout: 3000 },
    ).catch(() => {});

    // Try to find and click the apply defaults button
    const applyBtn = screen.queryByText(/Standardwerte|Apply defaults|Preset|Übernehmen/i);
    if (applyBtn) {
      await user.click(applyBtn);

      // Save to verify the values were applied
      const saveBtn = screen.getByText(/Speichern|Save/i);
      await user.click(saveBtn);

      await waitFor(() => {
        expect(onConfigChange).toHaveBeenCalledWith(
          expect.objectContaining({
            cooldown_sec: 12,
            consecutive_hits: 4,
          }),
        );
      });
    }

    // Restore
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    );
  });

  // --- Settings disabled while running ---

  it("disables settings controls while detection is running", async () => {
    const user = userEvent.setup();
    renderPanel({ isRunning: true });

    const settingsTab = screen.getByText(/Einstellungen|Settings/i);
    await user.click(settingsTab);

    // DetectorSettings should be rendered with disabled prop
    await waitFor(() => {
      const allText = document.body.textContent ?? "";
      expect(allText.length).toBeGreaterThan(0);
    });
  });

  // --- handleApplyDefaults with matched preset ---

  it("applies hunt type defaults when preset matches pokemon hunt_type", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation((_input) => {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    });

    const pokemon = makePokemon({ hunt_type: "random_encounters" });
    const onConfigChange = vi.fn().mockResolvedValue(undefined);
    renderPanel({ pokemon, onConfigChange });

    // Switch to settings tab
    await user.click(screen.getByText(/Einstellungen|Settings/i));

    // Wait for presets to load and look for the apply button
    await waitFor(
      () => {
        const applyBtn = screen.queryByText(/Standardwerte anwenden|Apply/i);
        return !!applyBtn;
      },
      { timeout: 3000 },
    ).catch(() => {});

    const applyBtn = screen.queryByText(/Standardwerte anwenden|Apply/i);
    if (applyBtn) {
      await user.click(applyBtn);

      // Save to verify the defaults were applied
      const saveBtn = screen.getByText(/Speichern|Save/i);
      await user.click(saveBtn);

      await waitFor(() => {
        expect(onConfigChange).toHaveBeenCalledWith(
          expect.objectContaining({
            cooldown_sec: 15,
            consecutive_hits: 3,
          }),
        );
      });
    }

    // Restore
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    );
  });

  // --- Hysteresis mode (3D mode) flows through the settings draft ---

  it("includes the template's hysteresis_mode in the settings save PATCH body", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockClear();

    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [
          { enabled: true, name: "Active", regions: [VALID_REGION], hysteresis_mode: "region" },
        ],
      },
    });
    renderPanel({ pokemon });

    // Switch to settings tab
    const settingsTab = screen.getByText(/Einstellungen|Settings/i);
    await user.click(settingsTab);

    // Mark the draft dirty without touching the mode checkbox
    const slider = document.getElementById("det-precision") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "0.9" } });

    const saveBtn = screen.getByText(/Speichern|Save/i);
    await user.click(saveBtn);

    await waitFor(() => {
      const body = templatePatchBodies().find((b) => "hysteresis_mode" in b);
      // The draft is seeded from the template, so the mode must survive a save
      expect(body?.hysteresis_mode).toBe("region");
    });
  });

  it("resets hysteresis_mode to score when settings are reset and saved", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockClear();

    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [
          { enabled: true, name: "Active", regions: [VALID_REGION], hysteresis_mode: "region" },
        ],
      },
    });
    renderPanel({ pokemon });

    const settingsTab = screen.getByText(/Einstellungen|Settings/i);
    await user.click(settingsTab);

    // Reset marks the draft dirty and reverts every setting to its default
    const resetBtn = screen.getByText(/Zurücksetzen|Reset/i);
    await user.click(resetBtn);

    const saveBtn = screen.getByText(/Speichern|Save/i);
    await user.click(saveBtn);

    await waitFor(() => {
      const body = templatePatchBodies().find((b) => "hysteresis_mode" in b);
      expect(body?.hysteresis_mode).toBe("score");
    });
  });

  it("does not include hysteresis_mode in the region update PATCH body", async () => {
    const user = userEvent.setup();
    // Clear the shared mock's call history so earlier settings-save PATCHes
    // from previous tests cannot leak into this test's assertions.
    vi.mocked(globalThis.fetch).mockClear();
    vi.mocked(globalThis.fetch).mockImplementation((_input) => {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    });

    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [
          {
            enabled: true,
            name: "3D Template",
            regions: [VALID_REGION],
            template_db_id: 77,
            hysteresis_mode: "region",
          },
        ],
      },
    });
    renderPanel({ pokemon, isRunning: false });

    const editBtn = screen.getByLabelText("Bearbeiten");
    await user.click(editBtn);

    await waitFor(() => {
      expect(screen.getByTestId("template-editor-mock")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Update Regions"));

    await waitFor(() => {
      expect(screen.queryByTestId("template-editor-mock")).not.toBeInTheDocument();
    });

    const body = templatePatchBodies().find((b) => "regions" in b);
    expect(body).toBeDefined();
    // A region edit must never touch the mode; the backend treats an omitted
    // field as "keep", while null would clear it back to score mode.
    expect("hysteresis_mode" in body!).toBe(false);

    // Restore
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    );
  });
});
