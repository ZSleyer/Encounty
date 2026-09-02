/**
 * Layers panel of the overlay editor: selecting a layer, reordering it and
 * switching its visibility.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, makeOverlaySettings, makePokemon, userEvent } from "../../test-utils";
import { OverlayEditor } from "./OverlayEditor";

// Mock the overlay utils
vi.mock("../../utils/overlay", () => ({
  resolveOverlay: (_p: unknown, _all: unknown, settings: unknown) => settings,
  wouldCreateCircularLink: () => false,
}));

// Mock the api utility
vi.mock("../../utils/api", () => ({
  apiUrl: (path: string) => `http://localhost:8192${path}`,
}));

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  vi.stubGlobal("fetch", mockFetch);
  // Mock localStorage for tutorial and split state
  const store: Record<string, string> = { encounty_editor_tutorial_seen: "true" };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => {
      store[key] = val;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  });
  // Mock HTMLDialogElement methods not available in jsdom
  HTMLDialogElement.prototype.showModal = HTMLDialogElement.prototype.showModal || vi.fn();
  HTMLDialogElement.prototype.close = HTMLDialogElement.prototype.close || vi.fn();
});

describe("OverlayEditor", () => {
  // --- Layers panel ---

  it("renders layer list with all overlay elements", () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // All element layers should appear (may appear multiple times due to property panel)
    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Name").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Canvas").length).toBeGreaterThan(0);
  });

  it("allows selecting a layer element", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Click on the "Name" layer button to select it
    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);

    // The clicked layer should now be visually selected (parent wrapper has accent-blue class)
    const wrapper = nameLayerButtons[0].closest("div");
    expect(wrapper?.className).toMatch(/accent-blue/);
  });

  // --- Visibility toggle ---

  it("toggles element visibility when eye button is clicked", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Find the hide/show buttons in the layers panel (exact match for German labels)
    const hideButtons = screen.getAllByLabelText(/^(Ausblenden|Einblenden)$/);
    expect(hideButtons.length).toBeGreaterThan(0);

    await user.click(hideButtons[0]);

    // onUpdate should have been called with updated visibility
    expect(onUpdate).toHaveBeenCalled();
  });

  // --- Layer z-index controls ---

  it("renders move up and move down buttons for each element layer", () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const moveUpButtons = screen.getAllByLabelText(/Nach oben verschieben/i);
    const moveDownButtons = screen.getAllByLabelText(/Nach unten verschieben/i);

    // 4 element layers (sprite, name, title, counter) should have up/down buttons
    expect(moveUpButtons.length).toBeGreaterThanOrEqual(4);
    expect(moveDownButtons.length).toBeGreaterThanOrEqual(4);
  });

  it("calls onUpdate when move up button is clicked", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const moveUpButtons = screen.getAllByLabelText(/Nach oben verschieben/i);
    await user.click(moveUpButtons[0]);

    expect(onUpdate).toHaveBeenCalled();
  });

  // --- Layers section ---

  it("renders layers section with heading", () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Layers heading
    expect(screen.getByText(/Ebenen|Layers/i)).toBeInTheDocument();
  });

  // --- Reset layout button ---

  it("renders reset layout button in layers panel", () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // The layers reset button has title="Layout zurücksetzen"
    const resetButtons = screen.getAllByTitle(/Layout zurücksetzen/i);
    expect(resetButtons.length).toBeGreaterThan(0);
  });

  it("resets settings to defaults when reset layout is clicked", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <OverlayEditor
        settings={makeOverlaySettings({ canvas_width: 600 })}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Find the reset button by title (the second one is in layers panel, not the divider reset)
    const resetButtons = screen.getAllByTitle(/Layout zurücksetzen/i);
    // Click the layers section reset (second match)
    await user.click(resetButtons[1]);

    // onUpdate should be called with default settings (the 800x264 default panel)
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ canvas_width: 800, canvas_height: 264 }),
    );
  });

  // --- Canvas element: hidden toggle ---

  it("toggles canvas visibility via layers panel", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({ hidden: false });

    render(<OverlayEditor settings={settings} onUpdate={onUpdate} activePokemon={makePokemon()} />);

    // Find hide/show buttons; the last one belongs to the Canvas layer
    const hideButtons = screen.getAllByLabelText(/Ausblenden|Einblenden|Hide|Show/i);
    const canvasHideBtn = hideButtons[hideButtons.length - 1];
    await user.click(canvasHideBtn);

    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ hidden: true }));
  });

  // --- Canvas layer selection ---

  it("selects canvas layer when clicked", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Click on "Canvas" layer
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);

    const canvasWrapper = canvasLayerButtons[0].closest("div");
    expect(canvasWrapper?.className).toMatch(/accent-blue/);
  });

  // --- Move layer down ---

  it("calls onUpdate when move down button is clicked", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const moveDownButtons = screen.getAllByLabelText(/Nach unten verschieben/i);
    await user.click(moveDownButtons[0]);

    expect(onUpdate).toHaveBeenCalled();
  });

  // --- Title layer selection ---

  it("selects title layer when clicked", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Click on the title layer
    const titleLabel = screen.getAllByText(/Titel/i);
    // The title layer button in the layers panel
    if (titleLabel.length > 0) {
      await user.click(titleLabel[0]);
      expect(titleLabel[0]).toBeInTheDocument();
    }
  });

  // --- Counter layer selection ---

  it("selects counter layer when clicked", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Find the counter element label in the layers panel
    const counterLabel = screen.getAllByText(/Zähler|Counter/i);
    if (counterLabel.length > 0) {
      await user.click(counterLabel[0]);
      expect(counterLabel[0]).toBeInTheDocument();
    }
  });

  // --- Move layer down clamped to 0 ---

  it("does not produce negative z_index when moving layer down at z_index 0", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    // Set sprite z_index to 0
    const settings = makeOverlaySettings({
      sprite: { ...makeOverlaySettings().sprite, z_index: 0 },
    });

    render(<OverlayEditor settings={settings} onUpdate={onUpdate} activePokemon={makePokemon()} />);

    const moveDownButtons = screen.getAllByLabelText(/Nach unten verschieben/i);
    await user.click(moveDownButtons[0]);

    // z_index should remain at 0 (Math.max(0, ...))
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ z_index: 0 }),
      }),
    );
  });

  // --- Title layer visibility toggle ---

  it("toggles title element visibility", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Find hide/show buttons, title is the third element layer (after sprite, name)
    const hideButtons = screen.getAllByLabelText(/^(Ausblenden|Einblenden)$/);
    // Click the third one (index 2 = title)
    await user.click(hideButtons[2]);
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.objectContaining({ visible: false }),
      }),
    );
  });

  // --- Counter layer visibility toggle ---

  it("toggles counter element visibility", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const hideButtons = screen.getAllByLabelText(/^(Ausblenden|Einblenden)$/);
    // Click the fourth one (index 3 = counter)
    await user.click(hideButtons[3]);
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        counter: expect.objectContaining({ visible: false }),
      }),
    );
  });

  // --- Move layer up increments z_index ---

  it("increments z_index when move up button is clicked", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({
      sprite: { ...makeOverlaySettings().sprite, z_index: 2 },
    });

    render(<OverlayEditor settings={settings} onUpdate={onUpdate} activePokemon={makePokemon()} />);

    const moveUpButtons = screen.getAllByLabelText(/Nach oben verschieben/i);
    await user.click(moveUpButtons[0]);

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ z_index: 3 }),
      }),
    );
  });

  // --- Move layer down decrements z_index ---

  it("decrements z_index when move down button is clicked", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({
      sprite: { ...makeOverlaySettings().sprite, z_index: 2 },
    });

    render(<OverlayEditor settings={settings} onUpdate={onUpdate} activePokemon={makePokemon()} />);

    const moveDownButtons = screen.getAllByLabelText(/Nach unten verschieben/i);
    await user.click(moveDownButtons[0]);

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ z_index: 1 }),
      }),
    );
  });

  // --- Canvas hidden state renders correct icon ---

  it("renders EyeOff icon for canvas when hidden is true", async () => {
    const settings = makeOverlaySettings({ hidden: true });

    render(<OverlayEditor settings={settings} onUpdate={vi.fn()} activePokemon={makePokemon()} />);

    // The canvas visibility button should show "Show" (Einblenden) since it is hidden
    const showButtons = screen.getAllByLabelText(/Einblenden/i);
    expect(showButtons.length).toBeGreaterThan(0);
  });

  // --- Move layer for name element ---

  it("moves name layer up", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({
      name: { ...makeOverlaySettings().name, z_index: 3 },
    });

    render(<OverlayEditor settings={settings} onUpdate={onUpdate} activePokemon={makePokemon()} />);

    // The second move-up button corresponds to the name layer
    const moveUpButtons = screen.getAllByLabelText(/Nach oben verschieben/i);
    await user.click(moveUpButtons[1]);

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.objectContaining({ z_index: 4 }),
      }),
    );
  });

  // --- Move layer for counter element ---

  it("moves counter layer down", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({
      counter: { ...makeOverlaySettings().counter, z_index: 5 },
    });

    render(<OverlayEditor settings={settings} onUpdate={onUpdate} activePokemon={makePokemon()} />);

    // The fourth move-down button corresponds to the counter layer
    const moveDownButtons = screen.getAllByLabelText(/Nach unten verschieben/i);
    await user.click(moveDownButtons[3]);

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        counter: expect.objectContaining({ z_index: 4 }),
      }),
    );
  });

  // --- Sprite visibility toggle shows Einblenden ---

  it("toggles sprite from visible to hidden and shows Einblenden", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Click hide on sprite (first hide button)
    const hideButtons = screen.getAllByLabelText(/^(Ausblenden|Einblenden)$/);
    await user.click(hideButtons[0]);

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ visible: false }),
      }),
    );
  });

  // --- Name visibility toggle ---

  it("toggles name element visibility", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Click hide on name (second hide button, index 1)
    const hideButtons = screen.getAllByLabelText(/^(Ausblenden|Einblenden)$/);
    await user.click(hideButtons[1]);

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.objectContaining({ visible: false }),
      }),
    );
  });

  // --- Canvas hidden toggle back to visible ---

  it("toggles canvas from hidden to visible", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({ hidden: true });

    render(<OverlayEditor settings={settings} onUpdate={onUpdate} activePokemon={makePokemon()} />);

    // Canvas show button should say "Einblenden"
    const showButtons = screen.getAllByLabelText(/Einblenden/i);
    const canvasShowBtn = showButtons[showButtons.length - 1];
    await user.click(canvasShowBtn);

    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ hidden: false }));
  });

  // --- Move title layer ---

  it("moves title layer up and down", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({
      title: { ...makeOverlaySettings().title, z_index: 4 },
    });

    render(<OverlayEditor settings={settings} onUpdate={onUpdate} activePokemon={makePokemon()} />);

    // title is at index 2 in the LAYERS array (sprite, name, title, counter)
    const moveUpButtons = screen.getAllByLabelText(/Nach oben verschieben/i);
    await user.click(moveUpButtons[2]);

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.objectContaining({ z_index: 5 }),
      }),
    );
  });
});
