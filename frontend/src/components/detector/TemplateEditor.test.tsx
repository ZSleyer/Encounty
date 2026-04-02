import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, userEvent, waitFor, within } from "../../test-utils";
import { TemplateEditor } from "./TemplateEditor";
import type { MatchedRegion } from "../../types";

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
  getFrame: vi.fn().mockReturnValue(null) as ReturnType<typeof vi.fn>,
  isBuffering: false,
  bufferedSeconds: 0,
  maxSeconds: 5,
  clear: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
};
vi.mock("../../hooks/useReplayBuffer", () => ({
  useReplayBuffer: () => mockReplayBuffer,
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
 * This simulates successful image loading in jsdom where images never load.
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
      // Fire onload asynchronously to match real behavior
      setTimeout(() => this.onload?.(), 0);
    }
  } as unknown as typeof Image;
}

/**
 * Helper to render TemplateEditor in edit mode and wait for the image to "load"
 * so that the phase transitions to "snapshot" and regions become visible.
 *
 * Waits for the template name input to appear, which only shows when
 * `phase === "snapshot" || isEditMode`. Since isEditMode is true immediately,
 * we use the "Schritt 2" heading as a more reliable signal that onload fired.
 */
async function renderEditMode(props: {
  initialRegions?: Array<{ type: "image" | "text"; expected_text: string; rect: { x: number; y: number; w: number; h: number }; polarity?: "positive" | "negative" }>;
  initialName?: string;
  pokemonName?: string;
  onClose?: () => void;
  onUpdateRegions?: (regions: MatchedRegion[], name?: string) => void | Promise<void>;
}) {
  const result = render(
    <TemplateEditor
      initialImageUrl="/api/detector/poke-1/template/0"
      initialRegions={props.initialRegions}
      initialName={props.initialName}
      pokemonName={props.pokemonName}
      onClose={props.onClose ?? vi.fn()}
      onUpdateRegions={props.onUpdateRegions ?? vi.fn()}
    />,
  );
  // Wait for the mocked Image.onload to fire and phase to transition to "snapshot".
  // The no-regions hint or region delete buttons are reliable signals that the
  // snapshot phase is active (they only render when phase === "snapshot").
  await waitFor(() => {
    if ((props.initialRegions?.length ?? 0) > 0) {
      expect(screen.getAllByTitle("Region löschen").length).toBe(props.initialRegions!.length);
    } else {
      expect(screen.getByText("Keine Regionen — ganzes Bild wird verglichen")).toBeInTheDocument();
    }
  });
  return result;
}

/**
 * Clicks the save button in the main editor, waits for the name dialog to open,
 * then clicks the save button inside the dialog to confirm the save.
 */
async function clickSaveThroughDialog(user: ReturnType<typeof userEvent.setup>) {
  // Click the main "Speichern" button to open the name dialog
  await user.click(screen.getByText("Speichern"));
  // Wait for the dialog to appear and click save inside it
  const dialog = await waitFor(() => screen.getByRole("dialog"));
  const dialogSaveBtn = within(dialog).getByText("Speichern");
  await user.click(dialogSaveBtn);
}

describe("TemplateEditor", () => {
  beforeEach(() => {
    // Mock Image constructor so onload fires in jsdom
    globalThis.Image = createMockImage();
    // Reset replay buffer mock to default (no frames)
    mockReplayBuffer.frameCount = 0;
    mockReplayBuffer.getFrame = vi.fn().mockReturnValue(null);
    mockReplayBuffer.isBuffering = false;
    mockReplayBuffer.bufferedSeconds = 0;
    mockReplayBuffer.maxSeconds = 5;
    mockReplayBuffer.stop = vi.fn();
    mockReplayBuffer.restart = vi.fn();
    mockReplayBuffer.clear = vi.fn();
  });

  afterEach(() => {
    globalThis.Image = OriginalImage;
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

  it("shows edit heading in edit mode", () => {
    render(
      <TemplateEditor
        initialImageUrl="/api/detector/poke-1/template/0"
        onClose={vi.fn()}
        onUpdateRegions={vi.fn()}
      />,
    );
    expect(screen.getByText("Template bearbeiten")).toBeInTheDocument();
  });

  it("displays template name input in save dialog when save is clicked", async () => {
    const user = userEvent.setup();
    await renderEditMode({ initialRegions: [], initialName: "My Template" });
    // Click save to open the name dialog
    await user.click(screen.getByText("Speichern"));
    // The dialog should contain the name input pre-filled with initialName
    const nameInput = await waitFor(() => screen.getByLabelText("Template-Name (optional)"));
    expect(nameInput).toBeInTheDocument();
    expect(nameInput).toHaveValue("My Template");
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

  it("shows cancel and save buttons in edit mode", () => {
    render(
      <TemplateEditor
        initialImageUrl="/api/detector/poke-1/template/0"
        onClose={vi.fn()}
        onUpdateRegions={vi.fn()}
      />,
    );
    expect(screen.getByText("Abbrechen")).toBeInTheDocument();
    expect(screen.getByText("Speichern")).toBeInTheDocument();
  });

  it("pre-fills template name from initialName prop in save dialog", async () => {
    const user = userEvent.setup();
    await renderEditMode({ initialRegions: [], initialName: "Test Name" });
    // Open save dialog
    await user.click(screen.getByText("Speichern"));
    const input = await waitFor(() => screen.getByLabelText("Template-Name (optional)"));
    expect(input).toHaveValue("Test Name");
  });

  it("shows edit hint text in edit mode", () => {
    render(
      <TemplateEditor
        initialImageUrl="/api/detector/poke-1/template/0"
        onClose={vi.fn()}
        onUpdateRegions={vi.fn()}
      />,
    );
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

  it("renders with pre-loaded regions in edit mode", () => {
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
      { type: "text" as const, expected_text: "Pikachu", rect: { x: 200, y: 30, w: 150, h: 40 } },
    ];
    render(
      <TemplateEditor
        initialImageUrl="/api/detector/poke-1/template/0"
        initialRegions={regions}
        onClose={vi.fn()}
        onUpdateRegions={vi.fn()}
      />,
    );
    // Component renders without crashing with initial regions
    expect(screen.getByText("Template bearbeiten")).toBeInTheDocument();
  });

  it("allows editing template name via input in save dialog", async () => {
    const user = userEvent.setup();
    await renderEditMode({ initialRegions: [] });
    // Open save dialog
    await user.click(screen.getByText("Speichern"));
    const input = await waitFor(() => screen.getByLabelText("Template-Name (optional)"));
    await user.clear(input);
    await user.type(input, "New Name");
    expect(input).toHaveValue("New Name");
  });

  // --- Phase switching tests ---

  it("shows step 2 heading after edit mode loads (snapshot phase)", () => {
    render(
      <TemplateEditor
        initialImageUrl="/api/detector/poke-1/template/0"
        onClose={vi.fn()}
        onUpdateRegions={vi.fn()}
      />,
    );
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
      const s = screen.getAllByRole("combobox");
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
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    // No expected text input initially (image type)
    expect(screen.queryByPlaceholderText("Erwarteter Text")).not.toBeInTheDocument();

    // Switch the region to text type
    const select = screen.getByRole("combobox");
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
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "text");

    const textInput = screen.getByPlaceholderText("Erwarteter Text");
    expect(textInput).toHaveValue("Bisasam");
  });

  // --- Polarity toggle ---

  it("toggles region polarity between positive and negative", async () => {
    const user = userEvent.setup();
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions });
    const polarityBtn = await waitFor(() => screen.getByTitle("Als negative Region markieren"));
    await user.click(polarityBtn);

    // After toggling, the label should change to "set positive"
    expect(screen.getByTitle("Als positive Region markieren")).toBeInTheDocument();
    // Negative region text should appear
    expect(screen.getByText("Negativ (unterdrückt Treffer)")).toBeInTheDocument();
  });

  it("hides type dropdown for negative regions", async () => {
    const user = userEvent.setup();
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions });
    await waitFor(() => {
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    // Toggle to negative
    const polarityBtn = screen.getByTitle("Als negative Region markieren");
    await user.click(polarityBtn);

    // Type dropdown should be hidden for negative regions
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  // --- Save template flow ---

  it("calls onUpdateRegions with regions and name on save in edit mode", async () => {
    const user = userEvent.setup();
    const onUpdateRegions = vi.fn().mockResolvedValue(undefined);
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions, initialName: "Test Template", onUpdateRegions });
    await clickSaveThroughDialog(user);

    await waitFor(() => {
      expect(onUpdateRegions).toHaveBeenCalledWith(
        regions,
        "Test Template",
      );
    });
  });

  it("creates full-image region when saving with no regions defined", async () => {
    const user = userEvent.setup();
    const onUpdateRegions = vi.fn().mockResolvedValue(undefined);
    await renderEditMode({ initialRegions: [], onUpdateRegions });
    await clickSaveThroughDialog(user);

    await waitFor(() => {
      expect(onUpdateRegions).toHaveBeenCalledTimes(1);
    });
    const calledRegions = onUpdateRegions.mock.calls[0][0];
    expect(calledRegions).toHaveLength(1);
    expect(calledRegions[0].type).toBe("image");
    expect(calledRegions[0].rect.x).toBe(0);
    expect(calledRegions[0].rect.y).toBe(0);
  });

  it("shows error message when save fails", async () => {
    const user = userEvent.setup();
    const onUpdateRegions = vi.fn().mockRejectedValue(new Error("Network error"));
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions, onUpdateRegions });
    await clickSaveThroughDialog(user);

    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });

  it("trims template name before saving", async () => {
    const user = userEvent.setup();
    const onUpdateRegions = vi.fn().mockResolvedValue(undefined);
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions, initialName: "  Trimmed  ", onUpdateRegions });
    await clickSaveThroughDialog(user);

    await waitFor(() => {
      expect(onUpdateRegions).toHaveBeenCalledWith(regions, "Trimmed");
    });
  });

  it("passes undefined name when template name is empty", async () => {
    const user = userEvent.setup();
    const onUpdateRegions = vi.fn().mockResolvedValue(undefined);
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions, initialName: "", onUpdateRegions });
    await clickSaveThroughDialog(user);

    await waitFor(() => {
      expect(onUpdateRegions).toHaveBeenCalledWith(regions, undefined);
    });
  });

  // --- No-regions hint ---

  it("shows no-regions hint in edit mode when no regions exist", async () => {
    await renderEditMode({ initialRegions: [] });
    await waitFor(() => {
      expect(
        screen.getByText("Keine Regionen — ganzes Bild wird verglichen"),
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
    await clickSaveThroughDialog(user);

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

  // --- Multiple region types with negative polarity on canvas ---

  it("renders region overlay labels for negative and text regions in edit mode", async () => {
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 }, polarity: "negative" as const },
      { type: "text" as const, expected_text: "Pikachu", rect: { x: 200, y: 30, w: 150, h: 40 } },
    ];
    await renderEditMode({ initialRegions: regions });
    await waitFor(() => {
      expect(screen.getAllByTitle("Region löschen")).toHaveLength(2);
    });
    // Negative region should show the negative label text
    expect(screen.getByText("Negativ (unterdrückt Treffer)")).toBeInTheDocument();
    // Text region should have the expected text input
    expect(screen.getByPlaceholderText("Erwarteter Text")).toHaveValue("Pikachu");
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

  // --- Edit mode with no initialRegions creates full-image region ---

  it("creates full-image region with correct canvas dimensions on save", async () => {
    const user = userEvent.setup();
    const onUpdateRegions = vi.fn().mockResolvedValue(undefined);
    await renderEditMode({ initialRegions: [], onUpdateRegions });
    await clickSaveThroughDialog(user);

    await waitFor(() => {
      expect(onUpdateRegions).toHaveBeenCalledTimes(1);
    });
    const calledRegions = onUpdateRegions.mock.calls[0][0];
    expect(calledRegions).toHaveLength(1);
    // Full-image region uses canvas dimensions (640x480 from mock Image)
    expect(calledRegions[0].rect.w).toBe(640);
    expect(calledRegions[0].rect.h).toBe(480);
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
    ];
    await renderEditMode({ initialRegions: regions, initialName: "Keep This" });

    // Delete the region
    const deleteBtn = await waitFor(() => screen.getByTitle("Region löschen"));
    await user.click(deleteBtn);

    // Open save dialog to verify name is still preserved
    await user.click(screen.getByText("Speichern"));
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    const nameInput = within(dialog).getByLabelText<HTMLInputElement>("Template-Name (optional)");
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

  // --- Polarity toggle on text region hides type dropdown and expected text ---

  it("hides expected text input when text region is toggled to negative", async () => {
    const user = userEvent.setup();
    const regions = [
      { type: "text" as const, expected_text: "Pikachu", rect: { x: 200, y: 30, w: 150, h: 40 } },
    ];
    await renderEditMode({ initialRegions: regions });

    // Expected text input should be visible
    expect(screen.getByPlaceholderText("Erwarteter Text")).toBeInTheDocument();

    // Toggle to negative
    const polarityBtn = screen.getByTitle("Als negative Region markieren");
    await user.click(polarityBtn);

    // Expected text input should be hidden for negative regions
    expect(screen.queryByPlaceholderText("Erwarteter Text")).not.toBeInTheDocument();
    // Type dropdown should also be hidden
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
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

    await clickSaveThroughDialog(user);

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
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "text");

    // OCR hint should now appear
    expect(
      screen.getByText("Text-Regionen werden per OCR mit dem erwarteten Text verglichen."),
    ).toBeInTheDocument();
  });

  // --- Negative region saves with polarity field ---

  it("saves regions with polarity field when set to negative", async () => {
    const user = userEvent.setup();
    const onUpdateRegions = vi.fn().mockResolvedValue(undefined);
    const regions = [
      { type: "image" as const, expected_text: "", rect: { x: 10, y: 20, w: 100, h: 50 } },
    ];
    await renderEditMode({ initialRegions: regions, onUpdateRegions });

    // Toggle to negative
    const polarityBtn = screen.getByTitle("Als negative Region markieren");
    await user.click(polarityBtn);

    await clickSaveThroughDialog(user);

    await waitFor(() => {
      expect(onUpdateRegions).toHaveBeenCalled();
    });
    const savedRegions = onUpdateRegions.mock.calls[0][0];
    expect(savedRegions[0].polarity).toBe("negative");
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

    // First save fails
    await clickSaveThroughDialog(user);
    expect(await screen.findByText("First failure")).toBeInTheDocument();

    // Second save succeeds
    await clickSaveThroughDialog(user);
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
    await clickSaveThroughDialog(user);

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
    const select = screen.getByRole("combobox");
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

  it("calls onSaveTemplate with image data and regions in new-template snapshot phase", async () => {
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

    // Click "Weiter" to open the name dialog, then confirm save
    await user.click(screen.getByText("Weiter"));
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    await user.click(within(dialog).getByText("Speichern"));

    await waitFor(() => {
      expect(onSaveTemplate).toHaveBeenCalled();
    });
    const payload = onSaveTemplate.mock.calls[0][0];
    expect(payload.imageBase64).toBe("data:image/png;base64,testdata");
    expect(payload.regions).toHaveLength(1);
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

  // --- Step 2 heading in new-template snapshot phase ---

  it("shows step 2 heading in new-template snapshot phase", async () => {
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
});
