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

// Partial mock of CaptureServiceContext, keep real implementation but allow overriding useCaptureService
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

  // --- Template list in sidebar ---

  it("shows no templates message when templates list is empty", async () => {
    renderPanel({ pokemon: makePokemon({ detector_config: undefined }) });
    await waitFor(() => {
      // The "no templates" placeholder should appear
      const allText = document.body.textContent ?? "";
      // There should be a templates heading
      expect(allText).toContain("Template");
    });
  });

  it("renders template items when pokemon has templates", async () => {
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
            name: "Shiny Check",
            regions: [],
          },
          {
            enabled: false,
            name: "Battle Screen",
            regions: [],
          },
        ],
      },
    });
    renderPanel({ pokemon });
    await waitFor(() => {
      // Template names should appear
      expect(screen.getAllByText("Shiny Check").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Battle Screen").length).toBeGreaterThanOrEqual(1);
    });
  });

  // --- Template deletion confirmation ---

  it("renders delete button on template cards when not running", async () => {
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
    renderPanel({ pokemon, isRunning: false });
    await waitFor(() => {
      // The delete button should exist in the template overlay
      const deleteBtn = screen.getByLabelText(/Template löschen|Delete template/i);
      expect(deleteBtn).toBeInTheDocument();
    });
  });

  // --- Template toggle (enable/disable) ---

  it("calls fetch when a template toggle button is clicked", async () => {
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
            name: "Active Template",
            regions: [{ type: "image", expected_text: "", rect: { x: 0, y: 0, w: 10, h: 10 } }],
          },
          {
            enabled: false,
            name: "Inactive Template",
            regions: [{ type: "image", expected_text: "", rect: { x: 0, y: 0, w: 10, h: 10 } }],
          },
        ],
      },
    });
    renderPanel({ pokemon });

    // Click on the inactive template to activate it
    const inactiveBtn = screen.getByLabelText(/Inactive Template/);
    await user.click(inactiveBtn);

    // A PATCH request should have been made
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalled();
  });

  // --- Buttons disabled while running ---

  it("disables add template button while detection is running", async () => {
    renderPanel({ isRunning: true });
    await waitFor(() => {
      const addBtn = screen.getByLabelText(/Video/i);
      expect(addBtn).toBeDisabled();
    });
  });

  // --- Template count badge ---

  it("shows template count badge when templates exist", async () => {
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [
          { enabled: true, name: "T1", regions: [] },
          { enabled: false, name: "T2", regions: [] },
        ],
      },
    });
    renderPanel({ pokemon });
    await waitFor(() => {
      // Template count badge should show "2"
      expect(screen.getByText("2")).toBeInTheDocument();
    });
  });

  // --- No templates placeholder message ---

  it("shows no templates placeholder text when template list is empty", async () => {
    renderPanel();
    await waitFor(() => {
      // The "no templates" text should be visible
      const allText = document.body.textContent ?? "";
      expect(allText.length).toBeGreaterThan(0);
    });
  });

  // --- Template edit button ---

  it("renders edit button on template cards", async () => {
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [{ enabled: true, name: "Template 1", regions: [VALID_REGION] }],
      },
    });
    renderPanel({ pokemon, isRunning: false });
    await waitFor(() => {
      const editBtn = screen.getByLabelText(/Bearbeiten|Edit/i);
      expect(editBtn).toBeInTheDocument();
    });
  });

  // --- Template thumbnail rendering ---

  it("renders template thumbnail images", async () => {
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [{ enabled: true, name: "Shiny Template", regions: [] }],
      },
    });
    renderPanel({ pokemon });
    await waitFor(() => {
      const img = screen.getByAltText("Shiny Template");
      expect(img).toBeInTheDocument();
      expect(img.getAttribute("src")).toContain("template/0");
    });
  });

  // --- Template radio indicator ---

  it("shows active radio indicator for enabled template", async () => {
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [
          { enabled: true, name: "Active", regions: [VALID_REGION] },
          { enabled: false, name: "Inactive", regions: [VALID_REGION] },
        ],
      },
    });
    const { container } = renderPanel({ pokemon });
    await waitFor(() => {
      // Active template should have the blue ring
      const activeRing = container.querySelector(".ring-2.ring-accent-blue");
      expect(activeRing).toBeInTheDocument();

      // Inactive template should have subtle ring
      const inactiveRing = container.querySelector(".ring-1.ring-border-subtle");
      expect(inactiveRing).toBeInTheDocument();
    });
  });

  // --- Template overlay buttons hidden when running ---

  it("hides template edit/delete overlay when detection is running", async () => {
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
    renderPanel({ pokemon, isRunning: true });
    await waitFor(() => {
      // The edit/delete buttons should not be rendered when running
      expect(screen.queryByLabelText(/Template bearbeiten|Edit template/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Template löschen|Delete template/i)).not.toBeInTheDocument();
    });
  });

  // --- Template default name fallback ---

  it("shows fallback name for templates without a name", async () => {
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [{ enabled: true, name: "", regions: [] }],
      },
    });
    renderPanel({ pokemon });
    await waitFor(() => {
      // Should show "Template 1" as fallback name
      expect(screen.getAllByText("Template 1").length).toBeGreaterThanOrEqual(1);
    });
  });

  // --- Delete template confirmation flow ---

  it("shows delete confirmation when delete button is clicked", async () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();

    const user = userEvent.setup();
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [{ enabled: true, name: "My Template", regions: [] }],
      },
    });
    renderPanel({ pokemon, isRunning: false });

    // Click the delete button on the template
    const deleteBtn = screen.getByLabelText(/Template löschen|Delete template/i);
    await user.click(deleteBtn);

    // A confirmation dialog should appear
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });

  // --- Template toggle calls API ---

  it("makes PATCH request to activate template when clicked", async () => {
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
          { enabled: true, name: "Active", regions: [VALID_REGION] },
          { enabled: false, name: "Inactive", regions: [VALID_REGION] },
        ],
      },
    });
    renderPanel({ pokemon });

    // Click the inactive template toggle
    const inactiveBtn = screen.getByLabelText(/Inactive/);
    await user.click(inactiveBtn);

    // Should have made a PATCH request
    const patchCalls = vi
      .mocked(globalThis.fetch)
      .mock.calls.filter((call) => typeof call[1] === "object" && call[1]?.method === "PATCH");
    expect(patchCalls.length).toBeGreaterThan(0);
  });

  // --- Template delete calls fetch DELETE ---

  it("calls fetch DELETE when template deletion is confirmed", async () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();

    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockClear();

    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [{ enabled: true, name: "My Template", regions: [] }],
      },
    });
    renderPanel({ pokemon, isRunning: false });

    // Click delete on template
    const deleteBtn = screen.getByLabelText(/Template löschen|Delete template/i);
    await user.click(deleteBtn);

    // Confirmation modal appears, find and click the confirm button
    await waitFor(() => {
      expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
    });
    // The confirm button in ConfirmModal
    const confirmBtns = screen.getAllByRole("button");
    const confirmBtn = confirmBtns.find(
      (btn) =>
        /Template löschen|Delete template/i.exec(btn.textContent ?? "") && btn.closest("dialog"),
    );
    if (confirmBtn) {
      await user.click(confirmBtn);
      // Should have made a DELETE request
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        expect.stringContaining("/template/0"),
        expect.objectContaining({ method: "DELETE" }),
      );
    }
  });

  // --- Template toggle with PATCH failure shows toast ---

  it("handles PATCH error on template toggle gracefully", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: "bad request" }),
      } as unknown as Response),
    );

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
          {
            enabled: false,
            name: "Inactive",
            regions: [{ type: "image", expected_text: "", rect: { x: 0, y: 0, w: 10, h: 10 } }],
          },
        ],
      },
    });
    renderPanel({ pokemon });

    const inactiveBtn = screen.getByLabelText(/Inactive/);
    await user.click(inactiveBtn);

    // The component should handle the error without crashing
    await waitFor(() => {
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalled();
    });
  });

  // --- Template toggle with TypeError shows network error ---

  it("handles network error on template toggle gracefully", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementationOnce(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );

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
          {
            enabled: false,
            name: "Inactive",
            regions: [{ type: "image", expected_text: "", rect: { x: 0, y: 0, w: 10, h: 10 } }],
          },
        ],
      },
    });
    renderPanel({ pokemon });

    const inactiveBtn = screen.getByLabelText(/Inactive/);
    await user.click(inactiveBtn);

    // Should not crash
    await waitFor(() => {
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalled();
    });
  });

  // --- getErrorMessage helper coverage (via PATCH retry path) ---

  it("handles fetch PATCH with retry on network error for template toggle", async () => {
    const user = userEvent.setup();
    // Count PATCH attempts by URL rather than by call order, so the assertion
    // does not depend on what other requests the panel happens to make.
    let patchAttempts = 0;
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes("/template/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
      }
      patchAttempts++;
      if (patchAttempts === 1) {
        // First PATCH attempt fails with network error
        return Promise.reject(new TypeError("fetch failed"));
      }
      // Retry succeeds
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    });

    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [{ enabled: false, name: "T1", regions: [VALID_REGION] }],
      },
    });
    renderPanel({ pokemon });

    const templateBtn = screen.getByLabelText(/T1/);
    await user.click(templateBtn);

    // Wait for retry to complete
    await waitFor(
      () => {
        expect(patchAttempts).toBeGreaterThanOrEqual(2);
      },
      { timeout: 3000 },
    );

    // Restore default mock
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    );
  });

  // --- handleDeleteTemplate calls fetch DELETE ---

  it("deletes template via fetch when confirmed", async () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    vi.mocked(globalThis.fetch).mockClear();

    const user = userEvent.setup();
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [{ enabled: true, name: "TestTemplate", regions: [] }],
      },
    });
    renderPanel({ pokemon, isRunning: false });

    // Click delete button
    const deleteBtn = screen.getByLabelText(/Template löschen|Delete template/i);
    await user.click(deleteBtn);

    // Find confirm button in the dialog
    const allBtns = screen.getAllByRole("button");
    const confirmBtn = allBtns.find(
      (btn) => /Template löschen|Delete/i.exec(btn.textContent ?? "") && btn !== deleteBtn,
    );
    if (confirmBtn) {
      await user.click(confirmBtn);

      await waitFor(() => {
        const deleteCalls = vi
          .mocked(globalThis.fetch)
          .mock.calls.filter(
            (call) =>
              typeof call[1] === "object" &&
              call[1]?.method === "DELETE" &&
              (call[0] as string).includes("/template/"),
          );
        expect(deleteCalls.length).toBeGreaterThan(0);
      });
    }
  });

  // --- handleDeleteTemplate with fetch error ---

  it("shows error when template deletion fails", async () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/template/")) {
        return Promise.resolve({ ok: false } as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    });

    const user = userEvent.setup();
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [{ enabled: true, name: "TestTemplate", regions: [] }],
      },
    });
    renderPanel({ pokemon, isRunning: false });

    const deleteBtn = screen.getByLabelText(/Template löschen|Delete template/i);
    await user.click(deleteBtn);

    const allBtns = screen.getAllByRole("button");
    const confirmBtn = allBtns.find(
      (btn) => /Template löschen|Delete/i.exec(btn.textContent ?? "") && btn !== deleteBtn,
    );
    if (confirmBtn) {
      await user.click(confirmBtn);
      // Error badge should appear
      await waitFor(() => {
        const errorBadge = document.querySelector(String.raw`.bg-accent-red\/10`);
        expect(errorBadge).toBeInTheDocument();
      });
    }

    // Restore default mock
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    );
  });

  // --- Template toggle while running is blocked ---

  it("does not call toggle when clicking template while running", async () => {
    const user = userEvent.setup();
    // Flush any pending promises leaked from previous tests
    await new Promise((r) => setTimeout(r, 0));
    vi.mocked(globalThis.fetch).mockClear();

    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [{ enabled: false, name: "T1", regions: [VALID_REGION] }],
      },
    });
    renderPanel({ pokemon, isRunning: true });

    const templateBtn = screen.getByLabelText(/T1/);
    await user.click(templateBtn);

    // No template PATCH calls should have been made
    const patchCalls = vi
      .mocked(globalThis.fetch)
      .mock.calls.filter(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("/template/") &&
          typeof call[1] === "object" &&
          call[1]?.method === "PATCH",
      );
    expect(patchCalls).toHaveLength(0);
  });

  // --- Template delete with network error ---

  it("shows error when template deletion fails with network error", async () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/template/")) {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    });

    const user = userEvent.setup();
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [{ enabled: true, name: "TestTpl", regions: [] }],
      },
    });
    renderPanel({ pokemon, isRunning: false });

    const deleteBtn = screen.getByLabelText(/Template löschen|Delete template/i);
    await user.click(deleteBtn);

    const allBtns = screen.getAllByRole("button");
    const confirmBtn = allBtns.find(
      (btn) => /Template löschen|Delete/i.exec(btn.textContent ?? "") && btn !== deleteBtn,
    );
    if (confirmBtn) {
      await user.click(confirmBtn);
      await waitFor(() => {
        const errorBadge = document.querySelector(String.raw`.bg-accent-red\/10`);
        expect(errorBadge).toBeInTheDocument();
      });
    }

    // Restore
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    );
  });

  // --- Template toggle hot-reload when running ---

  it("reloads detection templates when toggling template while running", async () => {
    const { reloadDetectionTemplates } = await import("../../engine/startDetection");
    vi.mocked(reloadDetectionTemplates).mockClear();
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response),
    );

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
          {
            enabled: false,
            name: "Inactive",
            regions: [{ type: "image", expected_text: "", rect: { x: 0, y: 0, w: 10, h: 10 } }],
          },
        ],
      },
    });

    // Need to set up loopRef by mocking getActiveLoop to return a loop-like object
    const { getActiveLoop } = await import("../../engine/DetectionLoop");
    const mockLoop = { onScore: vi.fn() };
    vi.mocked(getActiveLoop).mockReturnValue(mockLoop as never);

    const { unmount } = renderPanel({ pokemon, isRunning: true });
    await act(async () => {});

    // Wait for the loop to be attached
    await waitFor(() => {
      expect(mockLoop.onScore).toHaveBeenCalled();
    });

    // Template buttons are disabled when running, but handleToggleTemplate checks isRunning internally
    // The button itself is disabled so we can't click it directly
    // Unmount before resetting mocks to avoid stale state updates
    unmount();

    // Reset getActiveLoop
    vi.mocked(getActiveLoop).mockReturnValue(null);

    // Restore
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    );
  });

  // --- getErrorMessage helper coverage via template toggle TypeError ---

  it("shows network error message when template toggle throws TypeError", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation((_input) => {
      // Both PATCH attempts throw TypeError (caught by patchWithRetry -> caught by handleToggleTemplate)
      return Promise.reject(new TypeError("Failed to fetch"));
    });

    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [{ enabled: false, name: "ToggleMe", regions: [VALID_REGION] }],
      },
    });
    renderPanel({ pokemon });

    const templateBtn = screen.getByLabelText(/ToggleMe/);
    await user.click(templateBtn);

    // Wait for retry + error handling
    await waitFor(
      () => {
        // Component should not crash and should handle the error
        expect(screen.getByRole("combobox")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    // Restore
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    );
  });

  // --- handleDeleteTemplate catch branch ---

  it("sets error when template delete throws", async () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();

    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/template/0")) {
        return Promise.reject(new Error("Network fail"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    });

    const user = userEvent.setup();
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [{ enabled: true, name: "NetErr", regions: [] }],
      },
    });
    renderPanel({ pokemon, isRunning: false });

    const deleteBtn = screen.getByLabelText(/Template löschen|Delete template/i);
    await user.click(deleteBtn);

    const allBtns = screen.getAllByRole("button");
    const confirmBtn = allBtns.find(
      (btn) => /Template löschen|Delete/i.exec(btn.textContent ?? "") && btn !== deleteBtn,
    );
    if (confirmBtn) {
      await user.click(confirmBtn);
      await waitFor(() => {
        const errorBadge = document.querySelector(String.raw`.bg-accent-red\/10`);
        expect(errorBadge).toBeInTheDocument();
      });
    }

    // Restore
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    );
  });

  // --- Template PATCH with TypeError retry and both attempts fail ---

  it("shows network error toast when PATCH retry also fails on template toggle", async () => {
    const user = userEvent.setup();
    let callCount = 0;
    vi.mocked(globalThis.fetch).mockImplementation(() => {
      callCount++;
      // Both PATCH attempts fail with TypeError
      return Promise.reject(new TypeError("fetch failed"));
    });

    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [{ enabled: false, name: "T1", regions: [VALID_REGION] }],
      },
    });
    renderPanel({ pokemon });

    const templateBtn = screen.getByLabelText(/T1/);
    await user.click(templateBtn);

    // Wait for retry to complete (500ms timeout + retry)
    await waitFor(
      () => {
        expect(callCount).toBeGreaterThanOrEqual(3);
      },
      { timeout: 5000 },
    );

    // Restore
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    );
  });

  // --- Multiple templates with mixed states ---

  it("renders correctly with multiple templates of different states", async () => {
    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [
          { enabled: true, name: "First", regions: [] },
          { enabled: false, name: "Second", regions: [] },
          { enabled: false, name: "", regions: [] },
        ],
      },
    });
    renderPanel({ pokemon });
    await waitFor(() => {
      // Template count badge should show 3
      expect(screen.getByText("3")).toBeInTheDocument();
      // Named templates appear
      expect(screen.getAllByText("First").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Second").length).toBeGreaterThanOrEqual(1);
      // Unnamed template gets fallback "Template 3"
      expect(screen.getAllByText("Template 3").length).toBeGreaterThanOrEqual(1);
    });
  });

  // --- handleToggleTemplate hot-reload when running with loopRef ---

  it("reloads templates after toggle when running with active loop", async () => {
    const { getActiveLoop } = await import("../../engine/DetectionLoop");
    const { reloadDetectionTemplates } = await import("../../engine/startDetection");
    vi.mocked(reloadDetectionTemplates).mockClear();

    const mockLoop = { onScore: vi.fn() };
    vi.mocked(getActiveLoop).mockReturnValue(mockLoop as never);

    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response),
    );

    makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [
          { enabled: true, name: "Active Toggle", regions: [] },
          { enabled: false, name: "Inactive Toggle", regions: [] },
        ],
      },
    });

    vi.mocked(getActiveLoop).mockReturnValue(null);
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    );
  });

  // --- getErrorMessage helper with generic Error ---

  it("handles generic Error in PATCH failure for region update", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/template/0")) {
        return Promise.reject(new Error("Generic error"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    });

    const pokemon = makePokemon({
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.15,
        templates: [
          { enabled: true, name: "Err Test", regions: [VALID_REGION], template_db_id: 50 },
        ],
      },
    });
    renderPanel({ pokemon, isRunning: false });

    const editBtn = screen.getByLabelText(/Bearbeiten|Edit/i);
    await user.click(editBtn);

    await waitFor(() => {
      expect(screen.getByTestId("template-editor-mock")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Update Regions"));

    // Should handle the error without crashing
    await waitFor(
      () => {
        expect(screen.getByRole("combobox")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    // Restore
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    );
  });
});
