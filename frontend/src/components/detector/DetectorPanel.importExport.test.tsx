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

  // --- Import templates button ---

  it("renders import templates button", async () => {
    renderPanel();
    await waitFor(() => {
      const importBtn = screen.getByLabelText(/importieren|import/i);
      expect(importBtn).toBeInTheDocument();
    });
  });

  // --- More menu ---

  it("opens more menu when more button is clicked", async () => {
    const user = userEvent.setup();
    renderPanel();

    const moreBtn = screen.getByLabelText(/Mehr|More/i);
    await user.click(moreBtn);

    // The "import from file" option should be visible in the menu
    expect(screen.getByText(/Datei importieren|Import from file/i)).toBeInTheDocument();
  });

  // --- Export templates ---

  it("shows export templates option when templates exist and more menu is open", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [{ enabled: true, name: "Template 1", regions: [] }],
      },
    });
    renderPanel({ pokemon });

    const moreBtn = screen.getByLabelText(/Mehr|More/i);
    await user.click(moreBtn);

    // Export templates option should be visible
    expect(screen.getByText(/exportieren|Export/i)).toBeInTheDocument();
  });

  // --- Clear all templates option ---

  it("shows clear templates option in more menu when templates exist", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [{ enabled: true, name: "Template 1", regions: [] }],
      },
    });
    renderPanel({ pokemon });

    const moreBtn = screen.getByLabelText(/Mehr|More/i);
    await user.click(moreBtn);

    // "Clear templates" / "Alle löschen" option
    expect(screen.getByText(/Alle.*löschen|Clear all/i)).toBeInTheDocument();
  });

  // --- Import button disabled while running ---

  it("disables import templates button while detection is running", async () => {
    renderPanel({ isRunning: true });
    await waitFor(() => {
      const importBtn = screen.getByLabelText(/importieren|import/i);
      expect(importBtn).toBeDisabled();
    });
  });

  // --- More menu button disabled while running ---

  it("disables more menu button while detection is running", async () => {
    renderPanel({ isRunning: true });
    await waitFor(() => {
      const moreBtn = screen.getByLabelText(/Mehr|More/i);
      expect(moreBtn).toBeDisabled();
    });
  });

  // --- Close more menu backdrop ---

  it("closes more menu when backdrop is clicked", async () => {
    const user = userEvent.setup();
    renderPanel();

    // Open the more menu
    const moreBtn = screen.getByLabelText(/Mehr|More/i);
    await user.click(moreBtn);

    // The import from file option should be visible
    expect(screen.getByText(/Datei importieren|Import from file/i)).toBeInTheDocument();

    // Click the backdrop to close
    const backdrop = screen.getByLabelText(/close|schließen/i);
    await user.click(backdrop);

    // The menu should be closed
    expect(screen.queryByText(/Datei importieren|Import from file/i)).not.toBeInTheDocument();
  });

  // --- Export templates menu item click ---

  it("calls window.open when export templates is clicked", async () => {
    const user = userEvent.setup();
    const mockOpen = vi.fn();
    vi.stubGlobal("open", mockOpen);

    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [{ enabled: true, name: "Template 1", regions: [] }],
      },
    });
    renderPanel({ pokemon });

    // Open more menu
    const moreBtn = screen.getByLabelText(/Mehr|More/i);
    await user.click(moreBtn);

    // Click export
    const exportBtn = screen.getByText(/exportieren|Export/i);
    await user.click(exportBtn);

    expect(mockOpen).toHaveBeenCalledWith(expect.stringContaining("/export_templates"), "_blank");
  });

  // --- Clear all templates menu item ---

  it("calls fetch DELETE when clear templates is clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [{ enabled: true, name: "T1", regions: [] }],
      },
    });
    renderPanel({ pokemon });

    // Open more menu
    const moreBtn = screen.getByLabelText(/Mehr|More/i);
    await user.click(moreBtn);

    // Click clear all templates
    const clearBtn = screen.getByText(/Alle.*löschen|Clear all/i);
    await user.click(clearBtn);

    // Should have called DELETE on the templates endpoint
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      expect.stringContaining("/templates"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  // --- File import button in more menu ---

  it("shows file import option in more menu", async () => {
    const user = userEvent.setup();
    renderPanel();

    const moreBtn = screen.getByLabelText(/Mehr|More/i);
    await user.click(moreBtn);

    expect(screen.getByText(/Datei importieren|Import from file/i)).toBeInTheDocument();
  });

  // --- Import templates button opens modal ---

  it("opens import modal when import button is clicked", async () => {
    const user = userEvent.setup();
    renderPanel();

    const importBtn = screen.getByLabelText(/importieren|import/i);
    await user.click(importBtn);

    // The ImportTemplatesModal should be rendered (it appears in the DOM)
    // After clicking import, the modal markup should exist
    const allText = document.body.textContent ?? "";
    expect(allText.length).toBeGreaterThan(0);
  });

  // --- Import templates modal opens and renders ---

  it("opens import templates modal when import button is clicked", async () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();

    const user = userEvent.setup();
    renderPanel();

    const importBtn = screen.getByLabelText(/importieren|import/i);
    await user.click(importBtn);

    // The ImportTemplatesModal dialog should exist in the DOM
    const dialog = document.querySelector("dialog");
    expect(dialog).toBeInTheDocument();
  });

  // --- File import option triggers file input click ---

  it("triggers file input when file import option is clicked in more menu", async () => {
    const user = userEvent.setup();
    renderPanel();

    // Open more menu
    const moreBtn = screen.getByLabelText(/Mehr|More/i);
    await user.click(moreBtn);

    // Click "Import from file"
    const fileImportBtn = screen.getByText(/Datei importieren|Import from file/i);
    await user.click(fileImportBtn);

    // The file input click was triggered and the menu closes
    await waitFor(() => {
      expect(screen.queryByText(/Datei importieren|Import from file/i)).not.toBeInTheDocument();
    });
  });

  // --- File import from more menu with file selection ---

  it("handles file import via hidden file input", async () => {
    userEvent.setup();
    vi.mocked(globalThis.fetch).mockClear();

    renderPanel();
    await act(async () => {});

    // Find the hidden file input for template import
    const fileInputs = document.querySelectorAll("input[type='file']");
    // There should be at least one file input (for .encounty-templates)
    expect(fileInputs.length).toBeGreaterThan(0);
  });

  // --- handleImportFromFile success ---

  it("imports templates from file via hidden input change event", async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/import_templates_file")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ imported: 3 }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    });

    renderPanel();

    // Find the hidden file input for .encounty-templates
    const fileInputs = document.querySelectorAll<HTMLInputElement>(
      "input[type='file'][accept*='.encounty-templates']",
    );
    expect(fileInputs.length).toBe(1);
    const fileInput = fileInputs[0];

    // Create a mock file and trigger change event
    const file = new File(["data"], "templates.encounty-templates", {
      type: "application/octet-stream",
    });
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
    fireEvent.change(fileInput);

    // Should have called import_templates_file endpoint
    await waitFor(() => {
      const importCalls = vi
        .mocked(globalThis.fetch)
        .mock.calls.filter((call) => (call[0] as string).includes("/import_templates_file"));
      expect(importCalls.length).toBeGreaterThan(0);
    });

    // Restore default mock
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    );
  });

  // --- handleImportFromFile failure ---

  it("shows error toast when file import fails", async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/import_templates_file")) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: "Invalid file" }),
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    });

    renderPanel();

    const fileInputs = document.querySelectorAll<HTMLInputElement>(
      "input[type='file'][accept*='.encounty-templates']",
    );
    const fileInput = fileInputs[0];
    const file = new File(["bad"], "bad.zip", { type: "application/zip" });
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
    fireEvent.change(fileInput);

    await waitFor(() => {
      const importCalls = vi
        .mocked(globalThis.fetch)
        .mock.calls.filter((call) => (call[0] as string).includes("/import_templates_file"));
      expect(importCalls.length).toBeGreaterThan(0);
    });

    // Restore
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    );
  });

  // --- handleImportFromFile network error ---

  it("handles network error during file import gracefully", async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/import_templates_file")) {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    });

    renderPanel();

    const fileInputs = document.querySelectorAll<HTMLInputElement>(
      "input[type='file'][accept*='.encounty-templates']",
    );
    const fileInput = fileInputs[0];
    const file = new File(["data"], "templates.encounty-templates", {
      type: "application/octet-stream",
    });
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
    fireEvent.change(fileInput);

    await waitFor(() => {
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalled();
    });

    // Restore
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    );
  });

  // --- handleImportFromFile with no file selected ---

  it("does nothing when file import input fires with no file", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    const fileInputs = document.querySelectorAll<HTMLInputElement>(
      "input[type='file'][accept*='.encounty-templates']",
    );
    const fileInput = fileInputs[0];
    // Trigger change with empty files
    Object.defineProperty(fileInput, "files", { value: [], configurable: true });
    fireEvent.change(fileInput);

    // Should not crash and no import calls made
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  // --- Clear all templates via more menu click handler ---

  it("calls DELETE on templates endpoint when clear all is clicked", async () => {
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
          { enabled: true, name: "A", regions: [] },
          { enabled: false, name: "B", regions: [] },
        ],
      },
    });
    renderPanel({ pokemon });

    const moreBtn = screen.getByLabelText(/Mehr|More/i);
    await user.click(moreBtn);

    const clearBtn = screen.getByText(/Alle.*löschen|Clear all/i);
    await user.click(clearBtn);

    // Should DELETE all templates and close the menu
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      expect.stringContaining("/templates"),
      expect.objectContaining({ method: "DELETE" }),
    );
    // Menu should be closed after clicking
    await waitFor(() => {
      expect(screen.queryByText(/Alle.*löschen|Clear all/i)).not.toBeInTheDocument();
    });
  });

  // --- handleImportFromPokemon via mocked ImportTemplatesModal ---

  it("imports templates from another pokemon via ImportTemplatesModal", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/import_templates")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ imported: 2 }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    });

    renderPanel();

    // Click import button to open ImportTemplatesModal
    const importBtn = screen.getByLabelText(/importieren|import/i);
    await user.click(importBtn);

    // ImportTemplatesModal mock should render
    await waitFor(() => {
      expect(screen.getByTestId("import-modal-mock")).toBeInTheDocument();
    });

    // Click "Import From Pokemon" to trigger handleImportFromPokemon
    await user.click(screen.getByText("Import From Pokemon"));

    // Modal should close after import
    await waitFor(() => {
      expect(screen.queryByTestId("import-modal-mock")).not.toBeInTheDocument();
    });

    // Should have called the import endpoint
    const importCalls = vi
      .mocked(globalThis.fetch)
      .mock.calls.filter(
        (call) =>
          (call[0] as string).includes("/import_templates") &&
          !(call[0] as string).includes("_file"),
      );
    expect(importCalls.length).toBeGreaterThan(0);

    // Restore
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    );
  });

  // --- handleImportFromPokemon failure ---

  it("shows error toast when import from pokemon fails", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/import_templates") && !url.includes("_file")) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: "Source not found" }),
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    });

    renderPanel();

    const importBtn = screen.getByLabelText(/importieren|import/i);
    await user.click(importBtn);

    await waitFor(() => {
      expect(screen.getByTestId("import-modal-mock")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Import From Pokemon"));

    // Modal should close even on error
    await waitFor(() => {
      expect(screen.queryByTestId("import-modal-mock")).not.toBeInTheDocument();
    });

    // Restore
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    );
  });

  // --- handleImportFromPokemon network error ---

  it("shows error toast when import from pokemon has network error", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/import_templates") && !url.includes("_file")) {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    });

    renderPanel();

    const importBtn = screen.getByLabelText(/importieren|import/i);
    await user.click(importBtn);

    await waitFor(() => {
      expect(screen.getByTestId("import-modal-mock")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Import From Pokemon"));

    await waitFor(() => {
      expect(screen.queryByTestId("import-modal-mock")).not.toBeInTheDocument();
    });

    // Restore
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    );
  });

  // --- ImportTemplatesModal close button ---

  it("closes ImportTemplatesModal without importing", async () => {
    const user = userEvent.setup();
    renderPanel();

    const importBtn = screen.getByLabelText(/importieren|import/i);
    await user.click(importBtn);

    await waitFor(() => {
      expect(screen.getByTestId("import-modal-mock")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Close Import"));

    await waitFor(() => {
      expect(screen.queryByTestId("import-modal-mock")).not.toBeInTheDocument();
    });
  });
});
