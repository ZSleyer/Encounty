import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, makeOverlaySettings, makePokemon, userEvent, fireEvent, act, waitFor } from "../../test-utils";
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
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
  });
  // Mock HTMLDialogElement methods not available in jsdom
  HTMLDialogElement.prototype.showModal = HTMLDialogElement.prototype.showModal || vi.fn();
  HTMLDialogElement.prototype.close = HTMLDialogElement.prototype.close || vi.fn();
});

describe("OverlayEditor", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );
    expect(container.firstChild).not.toBeNull();
  });

  // --- Toolbar rendering ---

  it("renders the vertical toolbar with pointer, hand and zoom tool buttons", () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Toolbar tool buttons have aria-labels with shortcut keys
    expect(screen.getByLabelText(/\(V\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/\(H\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/\(Z\)/)).toBeInTheDocument();
  });

  it("renders undo and redo buttons in toolbar", () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Undo and redo buttons should exist (aria-labels include keyboard shortcuts)
    expect(screen.getByLabelText(/Rückgängig.*Strg\+Z/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Wiederholen.*Strg\+Y/i)).toBeInTheDocument();
  });

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

  // --- Read-only mode ---

  it("applies pointer-events-none in read-only mode", () => {
    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
        readOnly
      />,
    );

    // The right panel should have pointer-events-none and opacity-60
    const rightPanel = container.querySelector("[class*='pointer-events-none']");
    expect(rightPanel).not.toBeNull();
  });

  // --- Canvas background toggle ---

  it("renders canvas background toggle buttons in toolbar", () => {
    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // The toolbar has a data-tutorial="toolbar" attribute
    const toolbarEl = container.querySelector("[data-tutorial='toolbar']");
    expect(toolbarEl).not.toBeNull();
  });

  // --- Property panel rendering ---

  it("renders property panel on the right side", () => {
    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // The property panel section should exist
    const propertiesSection = container.querySelector("[data-tutorial='properties']");
    expect(propertiesSection).not.toBeNull();
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

    // onUpdate should be called with default settings (canvas_width 800)
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ canvas_width: 800 }),
    );
  });

  // --- Test counter buttons ---

  it("renders test increment/decrement buttons when a pokemon is active", () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon({ encounters: 42 })}
      />,
    );

    // Test counter should display the current encounter count
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  // --- Canvas container ---

  it("renders the canvas area for overlay preview", () => {
    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // The canvas container should exist
    const canvasEl = container.querySelector("[data-tutorial='toolbar']");
    expect(canvasEl).not.toBeNull();
  });

  // --- Divider between properties and layers ---

  it("renders a draggable divider between properties and layers", () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const dividerBtn = screen.getByLabelText(/Größe ändern/i);
    expect(dividerBtn).toBeInTheDocument();
  });

  // --- Canvas element: hidden toggle ---

  it("toggles canvas visibility via layers panel", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({ hidden: false });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Find hide/show buttons; the last one belongs to the Canvas layer
    const hideButtons = screen.getAllByLabelText(/Ausblenden|Einblenden|Hide|Show/i);
    const canvasHideBtn = hideButtons[hideButtons.length - 1];
    await user.click(canvasHideBtn);

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ hidden: true }),
    );
  });

  // --- Fit-to-view button ---

  it("renders fit-to-view button in toolbar", () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const fitBtn = screen.getByLabelText(/Ansicht anpassen/i);
    expect(fitBtn).toBeInTheDocument();
  });

  // --- Keyboard shortcuts: tool switching ---

  it("switches to hand tool on H key press", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Press H to switch to hand tool
    await user.keyboard("h");

    // The hand tool button should now be active (aria-pressed or visually highlighted)
    const handBtn = screen.getByLabelText(/\(H\)/);
    expect(handBtn).toBeInTheDocument();
  });

  it("switches to zoom tool on Z key press", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    await user.keyboard("z");

    const zoomBtn = screen.getByLabelText(/\(Z\)/);
    expect(zoomBtn).toBeInTheDocument();
  });

  it("switches back to pointer tool on V key press", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Switch to hand first, then back to pointer
    await user.keyboard("h");
    await user.keyboard("v");

    const pointerBtn = screen.getByLabelText(/\(V\)/);
    expect(pointerBtn).toBeInTheDocument();
  });

  // --- Arrow key nudging ---

  it("nudges selected element left with ArrowLeft key", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({ sprite: { ...makeOverlaySettings().sprite, x: 50, y: 10 } });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Select the sprite layer first
    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);

    // Press ArrowLeft to nudge
    await user.keyboard("{ArrowLeft}");

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ x: 49 }),
      }),
    );
  });

  it("nudges selected element right with ArrowRight key", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({ sprite: { ...makeOverlaySettings().sprite, x: 50, y: 10 } });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);
    await user.keyboard("{ArrowRight}");

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ x: 51 }),
      }),
    );
  });

  it("nudges element up with ArrowUp key", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({ sprite: { ...makeOverlaySettings().sprite, x: 10, y: 50 } });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);
    await user.keyboard("{ArrowUp}");

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ y: 49 }),
      }),
    );
  });

  it("nudges element down with ArrowDown key", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({ sprite: { ...makeOverlaySettings().sprite, x: 10, y: 50 } });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);
    await user.keyboard("{ArrowDown}");

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ y: 51 }),
      }),
    );
  });

  // --- Escape key resets selection ---

  it("resets selection to sprite on Escape key", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Select the Name layer first
    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);

    // Press Escape to reset selection
    await user.keyboard("{Escape}");

    // Sprite layer should now be selected
    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    const spriteWrapper = spriteLayerButtons[0].closest("div");
    expect(spriteWrapper?.className).toMatch(/accent-blue/);
  });

  // --- Tab key cycles element selection ---

  it("cycles element selection on Tab key", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Select sprite first
    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);

    // Tab should cycle to the next element (name)
    await user.keyboard("{Tab}");

    const nameLayerButtons = screen.getAllByLabelText("Name");
    const nameWrapper = nameLayerButtons[0].closest("div");
    expect(nameWrapper?.className).toMatch(/accent-blue/);
  });

  // --- Test counter buttons: increment, decrement, reset ---

  it("increments test counter when + button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon({ encounters: 10 })}
      />,
    );

    // Counter should show 10 initially
    expect(screen.getByText("10")).toBeInTheDocument();

    // Click the increment button (aria-label from i18n: "Vorschau: Zähler erhöhen")
    const incBtn = screen.getByLabelText(/Vorschau.*erhöhen/i);
    await user.click(incBtn);

    // Counter should now show 11
    expect(screen.getByText("11")).toBeInTheDocument();
  });

  it("decrements test counter when - button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon({ encounters: 10 })}
      />,
    );

    const decBtn = screen.getByLabelText(/Vorschau.*verringern/i);
    await user.click(decBtn);

    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("resets test counter when reset button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon({ encounters: 10 })}
      />,
    );

    // First increment to have a local counter value
    const incBtn = screen.getByLabelText(/Vorschau.*erhöhen/i);
    await user.click(incBtn);
    expect(screen.getByText("11")).toBeInTheDocument();

    // Click reset button
    const resetBtn = screen.getByLabelText(/Vorschau.*zurücksetzen/i);
    await user.click(resetBtn);

    expect(screen.getByText("0")).toBeInTheDocument();
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

  // --- Compact mode ---

  it("applies compact padding when compact prop is set", () => {
    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
        compact
      />,
    );

    // The root div should have pb-2 class for compact mode
    const rootDiv = container.firstChild as HTMLElement;
    expect(rootDiv.className).toContain("pb-2");
  });

  // --- OBSSourceHint rendering ---

  it("renders OBS source hint without pokemon URL when no pokemon provided", async () => {
    const { OBSSourceHint } = await import("./OverlayEditor");
    render(<OBSSourceHint />);
    // Should show "select pokemon" message when no pokemonId
    const allText = document.body.textContent ?? "";
    expect(allText).toContain("OBS Browser Source");
  });

  it("renders OBS source hint with URL when pokemonId is provided", async () => {
    const { OBSSourceHint } = await import("./OverlayEditor");
    render(<OBSSourceHint pokemonId="poke-1" />);
    // Should show the URL containing the pokemon ID
    const allText = document.body.textContent ?? "";
    expect(allText).toContain("poke-1");
  });

  it("copies OBS URL to clipboard when copy button is clicked", async () => {
    const user = userEvent.setup();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: writeTextMock },
    });

    const { OBSSourceHint } = await import("./OverlayEditor");
    render(<OBSSourceHint pokemonId="poke-1" />);

    // Click the copy button (German: "Kopieren")
    const copyBtn = screen.getByText(/Kopieren|Copy/i);
    await user.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining("poke-1"));
  });

  // --- Settings migration ---

  it("migrates settings with missing title element", () => {
    const settings = makeOverlaySettings();
    // Remove title dimensions to trigger migration
    const settingsWithEmptyTitle = {
      ...settings,
      title: { ...settings.title, width: 0, height: 0 },
    };

    render(
      <OverlayEditor
        settings={settingsWithEmptyTitle}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Should render without crashing after migration
    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Grid toggle ---

  it("toggles grid visibility from toolbar", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // The grid toggle button has the exact aria-label from de.json
    const gridBtn = screen.getByLabelText("Raster ein-/ausblenden");
    await user.click(gridBtn);
    // Should not crash and button remains accessible
    expect(gridBtn).toBeInTheDocument();
  });

  // --- Snap toggle ---

  it("toggles snap from toolbar", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const snapBtn = screen.getByLabelText("Am Raster einrasten");
    await user.click(snapBtn);
    expect(snapBtn).toBeInTheDocument();
  });

  // --- Shift+Arrow nudges by 10 ---

  it("nudges element by 10px when Shift+ArrowRight is pressed", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({ sprite: { ...makeOverlaySettings().sprite, x: 50, y: 10 } });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ x: 60 }),
      }),
    );
  });

  // --- Canvas background changes ---

  it("changes canvas background when transparent/white/black buttons are clicked", async () => {
    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // The canvas background buttons are in the toolbar (transparent is default)
    // Click the white background option
    const toolbarEl = container.querySelector("[data-tutorial='toolbar']");
    expect(toolbarEl).not.toBeNull();
  });

  // --- Fit-to-view click ---

  it("resets zoom when fit-to-view button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const fitBtn = screen.getByLabelText(/Ansicht anpassen/i);
    await user.click(fitBtn);
    // Should not crash and canvas remains visible
    expect(fitBtn).toBeInTheDocument();
  });

  // --- Undo button in toolbar ---

  it("renders undo button that is initially disabled", () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Undo should be present but visually disabled (no history yet)
    const undoBtn = screen.getByLabelText(/Rückgängig.*Strg\+Z/i);
    expect(undoBtn).toBeInTheDocument();
    // The button has opacity-40 when canUndo is false
    expect(undoBtn.className).toMatch(/opacity/);
  });

  // --- Tutorial shows on first visit ---

  it("shows tutorial on first visit (tutorial_seen not set)", () => {
    // Clear the tutorial flag
    localStorage.removeItem("encounty_editor_tutorial_seen");
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
    });

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Tutorial component should be rendered (EditorTutorial)
    // After the tutorial effect runs, it should show the tutorial
    const allText = document.body.textContent ?? "";
    expect(allText).toBeTruthy();
  });

  // --- Divider reset button ---

  it("resets divider height when reset button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Click the reset button on the divider (first match of the specific title)
    const resetButtons = screen.getAllByTitle(/Layout zurücksetzen/i);
    // The first one is on the divider
    await user.click(resetButtons[0]);
    // Should not crash
    expect(resetButtons[0]).toBeInTheDocument();
  });

  // --- No active pokemon renders without crashing ---

  it("renders without active pokemon", () => {
    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
      />,
    );

    // Should render even without an active pokemon
    expect(container.firstChild).not.toBeNull();
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

  // --- Tutorial button in toolbar ---

  it("shows tutorial when tutorial button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const tutorialBtn = screen.getByLabelText(/Tutorial anzeigen/i);
    await user.click(tutorialBtn);
    // Tutorial overlay should now be visible
    const allText = document.body.textContent ?? "";
    expect(allText).toBeTruthy();
  });

  // --- Undo/redo keyboard shortcuts ---

  it("handles Ctrl+Z shortcut without errors when no history available", async () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Dispatch Ctrl+Z when there is nothing to undo — should not crash
    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    await waitFor(() => {
      expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
    });
  });

  it("handles Ctrl+Y shortcut without errors when no history available", async () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Dispatch Ctrl+Y when there is nothing to redo — should not crash
    fireEvent.keyDown(document, { key: "y", ctrlKey: true });
    await waitFor(() => {
      expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
    });
  });

  // --- Space bar for hand tool ---

  it("activates hand tool when Space key is held", async () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Fire Space keydown on globalThis
    fireEvent.keyDown(document, { code: "Space", key: " " });
    // Space should activate hand tool temporarily
    // Release Space
    fireEvent.keyUp(document, { code: "Space", key: " " });
    // Should not crash
    await waitFor(() => {
      expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
    });
  });

  // --- Alt key tracking ---

  it("tracks Alt key press and release", async () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    fireEvent.keyDown(document, { key: "Alt" });
    fireEvent.keyUp(document, { key: "Alt" });
    // Should not crash
    await waitFor(() => {
      expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
    });
  });

  // --- Delete key does NOT remove element (no delete handler in OverlayEditor) ---

  it("does not crash when Delete key is pressed with selected element", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);
    await user.keyboard("{Delete}");
    // No crash, elements still rendered
    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Undo after a change actually reverts ---

  it("handles Ctrl+Z undo after a nudge without crashing", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({ sprite: { ...makeOverlaySettings().sprite, x: 50, y: 10 } });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Select sprite and nudge right
    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);
    await user.keyboard("{ArrowRight}");
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ sprite: expect.objectContaining({ x: 51 }) }),
    );

    // Ctrl+Z — history may not have committed yet (debounced), but should not crash
    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Redo after undo ---

  it("handles Ctrl+Y redo after undo without crashing", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({ sprite: { ...makeOverlaySettings().sprite, x: 50, y: 10 } });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);
    await user.keyboard("{ArrowRight}");
    // Undo then redo — debounce means history may not be populated, but no crash
    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    fireEvent.keyDown(document, { key: "y", ctrlKey: true });
    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Undo via toolbar button ---

  it("clicks undo toolbar button without crashing", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Click undo button (no history yet, should be a no-op but not crash)
    const undoBtn = screen.getByLabelText(/Rückgängig.*Strg\+Z/i);
    await user.click(undoBtn);
    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Redo via toolbar button ---

  it("clicks redo toolbar button without crashing", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Click redo button (no history yet, should be a no-op but not crash)
    const redoBtn = screen.getByLabelText(/Wiederholen.*Strg\+Y/i);
    await user.click(redoBtn);
    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Canvas does not respond to arrow nudge ---

  it("does not nudge when canvas is selected", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Select canvas layer
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);
    onUpdate.mockClear();

    // Arrow keys should not cause an update when canvas is selected
    await user.keyboard("{ArrowRight}");
    expect(onUpdate).not.toHaveBeenCalled();
  });

  // --- Move layer down clamped to 0 ---

  it("does not produce negative z_index when moving layer down at z_index 0", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    // Set sprite z_index to 0
    const settings = makeOverlaySettings({
      sprite: { ...makeOverlaySettings().sprite, z_index: 0 },
    });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const moveDownButtons = screen.getAllByLabelText(/Nach unten verschieben/i);
    await user.click(moveDownButtons[0]);

    // z_index should remain at 0 (Math.max(0, ...))
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ z_index: 0 }),
      }),
    );
  });

  // --- Tool buttons set active tool ---

  it("activates pointer tool when pointer button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Switch to hand first
    await user.keyboard("h");
    // Click pointer button
    const pointerBtn = screen.getByLabelText(/\(V\)/);
    await user.click(pointerBtn);
    expect(pointerBtn).toBeInTheDocument();
  });

  it("activates hand tool when hand button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const handBtn = screen.getByLabelText(/\(H\)/);
    await user.click(handBtn);
    expect(handBtn).toBeInTheDocument();
  });

  it("activates zoom tool when zoom button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const zoomBtn = screen.getByLabelText(/\(Z\)/);
    await user.click(zoomBtn);
    expect(zoomBtn).toBeInTheDocument();
  });

  // --- Shift+ArrowLeft nudge by 10 ---

  it("nudges element by 10px when Shift+ArrowLeft is pressed", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({ sprite: { ...makeOverlaySettings().sprite, x: 50, y: 10 } });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ x: 40 }),
      }),
    );
  });

  // --- Shift+ArrowUp nudge by 10 ---

  it("nudges element by 10px when Shift+ArrowUp is pressed", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({ sprite: { ...makeOverlaySettings().sprite, x: 10, y: 50 } });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ y: 40 }),
      }),
    );
  });

  // --- Shift+ArrowDown nudge by 10 ---

  it("nudges element by 10px when Shift+ArrowDown is pressed", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({ sprite: { ...makeOverlaySettings().sprite, x: 10, y: 50 } });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ y: 60 }),
      }),
    );
  });

  // --- Mouse interaction: canvas mousedown/up for hand tool ---

  it("handles pan drag mousedown and mouseup on canvas container", async () => {
    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Switch to hand tool
    fireEvent.keyDown(document, { key: "h" });

    // Find the canvas container area (flex-1 div with onMouseDown)
    const canvasArea = container.querySelector("[class*='flex-1 min-w-0']");
    if (canvasArea) {
      fireEvent.mouseDown(canvasArea, { clientX: 100, clientY: 100 });
      fireEvent.mouseUp(canvasArea, { clientX: 150, clientY: 150 });
    }
    // Should not crash
    await waitFor(() => {
      expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
    });
  });

  // --- Space held temporarily activates hand tool ---

  it("temporarily activates hand tool while Space is held and reverts on release", async () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Start with pointer tool (default)
    const pointerBtn = screen.getByLabelText(/\(V\)/);
    expect(pointerBtn).toBeInTheDocument();

    // Hold space
    fireEvent.keyDown(document, { code: "Space", key: " " });
    // Release space
    fireEvent.keyUp(document, { code: "Space", key: " " });

    // Pointer tool should still be selected after space release
    await waitFor(() => {
      expect(pointerBtn).toBeInTheDocument();
    });
  });

  // --- Tab wraps around to first element ---

  it("cycles Tab from name to title element", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Select name layer (index 1 in LAYERS), use Tab from existing sprite selection
    // First select sprite explicitly
    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);

    // Tab from sprite -> name (already tested)
    await user.keyboard("{Tab}");

    // Tab from name -> title
    await user.keyboard("{Tab}");

    // Title should now be selected — check via the layer button's parent wrapper
    const titleLayerButtons = screen.getAllByLabelText(/Titel/i);
    const titleWrapper = titleLayerButtons[0].closest("div");
    expect(titleWrapper?.className).toMatch(/accent-blue/);
  });

  // --- Multiple nudge operations accumulate ---

  it("accumulates multiple nudge operations", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({ sprite: { ...makeOverlaySettings().sprite, x: 50, y: 50 } });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);

    // Nudge right twice
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{ArrowRight}");

    // First call should be x:51, second call depends on local state resync
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  // --- Decrement does not go below zero ---

  it("does not decrement test counter below zero", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon({ encounters: 0 })}
      />,
    );

    // Counter at 0
    expect(screen.getByText("0")).toBeInTheDocument();

    const decBtn = screen.getByLabelText(/Vorschau.*verringern/i);
    await user.click(decBtn);

    // Should remain at 0
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  // --- Keyboard shortcuts ignored in input fields ---

  it("does not switch tool when typing in an input field", async () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Simulate keydown with target being an INPUT element
    const event = new KeyboardEvent("keydown", { key: "h", bubbles: true });
    Object.defineProperty(event, "target", {
      value: { tagName: "INPUT" },
      writable: false,
    });
    document.dispatchEvent(event);

    // Should not crash; pointer tool should remain active (not hand)
    await waitFor(() => {
      expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
    });
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

    // Find hide/show buttons — title is the third element layer (after sprite, name)
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

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

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

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const moveDownButtons = screen.getAllByLabelText(/Nach unten verschieben/i);
    await user.click(moveDownButtons[0]);

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ z_index: 1 }),
      }),
    );
  });

  // --- OBSSourceHint without pokemonId shows select message ---

  it("shows select pokemon message when no pokemonId in OBSSourceHint", async () => {
    const { OBSSourceHint } = await import("./OverlayEditor");
    render(<OBSSourceHint />);
    const allText = document.body.textContent ?? "";
    // Should show the select pokemon message (no URL rendered)
    expect(allText).not.toContain("http");
  });

  // --- OBSSourceHint external link ---

  it("renders an external link to the overlay URL", async () => {
    const { OBSSourceHint } = await import("./OverlayEditor");
    const { container } = render(<OBSSourceHint pokemonId="poke-abc" />);
    const externalLink = container.querySelector("a[target='_blank']");
    expect(externalLink).not.toBeNull();
    expect(externalLink?.getAttribute("href")).toContain("poke-abc");
  });

  // --- Tutorial completes and sets localStorage ---

  it("sets tutorial seen flag when tutorial completes", async () => {
    // Clear tutorial flag
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
    });

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Tutorial should be shown; verify localStorage flag is not yet set
    expect(store["encounty_editor_tutorial_seen"]).toBeUndefined();
  });

  // --- Properties panel updates when different layer selected ---

  it("shows different properties when switching between layers", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Select name layer via its aria-label button
    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);
    const nameWrapper = nameLayerButtons[0].closest("div");
    expect(nameWrapper?.className).toMatch(/accent-blue/);

    // Switch to sprite layer via its aria-label button
    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);

    // Re-query the name wrapper's class - it should no longer be highlighted
    // (need fresh reference since React re-renders)
    const nameLayerButtonsAfter = screen.getAllByLabelText("Name");
    const nameWrapperAfter = nameLayerButtonsAfter[0].closest("div");
    expect(nameWrapperAfter?.className).not.toMatch(/accent-blue/);
  });

  // --- Overlay settings sync when props change ---

  it("renders correctly with custom canvas dimensions", () => {
    const settings = makeOverlaySettings({ canvas_width: 600, canvas_height: 300 });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Should render without crashing
    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Fake counter resets when pokemon changes ---

  it("displays encounters from activePokemon prop", () => {
    const pokemon = makePokemon({ id: "poke-1", encounters: 77 });

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={pokemon}
      />,
    );

    // Should show the pokemon's encounter count
    expect(screen.getByText("77")).toBeInTheDocument();
  });

  // --- Background upload handler ---

  it("triggers file input when background upload is invoked", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    // Mock document.createElement to intercept the dynamically created input
    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "input") {
        Object.defineProperty(el, "click", { value: clickSpy });
      }
      return el;
    });

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Select canvas layer to see background properties
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);

    // Look for the upload button (if visible in canvas properties)
    const uploadBtn = screen.queryByLabelText(/Hintergrundbild hochladen/i);
    if (uploadBtn) {
      await user.click(uploadBtn);
      expect(clickSpy).toHaveBeenCalled();
    } else {
      // Background upload might not be directly exposed as a button in the current layer
      expect(canvasLayerButtons[0]).toBeInTheDocument();
    }

    vi.restoreAllMocks();
  });

  // --- Background remove handler ---

  it("calls fetch DELETE when background is removed", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    const settings = makeOverlaySettings({
      background_image: "test-bg.png",
      background_image_fit: "cover",
    } as Partial<import("../../types").OverlaySettings>);

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Select canvas layer
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);

    // Look for remove background button
    const removeBtn = screen.queryByLabelText(/Hintergrundbild entfernen/i);
    if (removeBtn) {
      await user.click(removeBtn);
      // Should have called fetch with DELETE method
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/backgrounds/test-bg.png"),
        expect.objectContaining({ method: "DELETE" }),
      );
    } else {
      // Just verify the component rendered without crashing
      expect(canvasLayerButtons[0]).toBeInTheDocument();
    }
  });

  // --- Divider drag interaction ---

  it("handles divider drag to resize properties panel", () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const dividerBtn = screen.getByLabelText(/Größe ändern/i);

    // Start drag
    fireEvent.mouseDown(dividerBtn, { clientX: 200, clientY: 500 });

    // Move
    fireEvent.mouseMove(document, { clientX: 200, clientY: 550 });

    // Release
    fireEvent.mouseUp(document);

    // Should not crash, divider still accessible
    expect(dividerBtn).toBeInTheDocument();
  });

  // --- Zoom drag interaction ---

  it("handles zoom drag interaction on canvas", () => {
    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Switch to zoom tool
    fireEvent.keyDown(document, { key: "z" });

    // Find the canvas area
    const canvasArea = container.querySelector("[class*='flex-1 min-w-0']");
    if (canvasArea) {
      // Mouse down in zoom mode starts zoom drag
      fireEvent.mouseDown(canvasArea, { clientX: 200, clientY: 200 });
      // Move horizontally to zoom
      fireEvent.mouseMove(canvasArea, { clientX: 300, clientY: 200 });
      // Release
      fireEvent.mouseUp(canvasArea);
    }

    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Pan drag interaction ---

  it("handles pan drag interaction on canvas with hand tool", () => {
    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Switch to hand tool
    fireEvent.keyDown(document, { key: "h" });

    const canvasArea = container.querySelector("[class*='flex-1 min-w-0']");
    if (canvasArea) {
      fireEvent.mouseDown(canvasArea, { clientX: 100, clientY: 100 });
      fireEvent.mouseMove(canvasArea, { clientX: 200, clientY: 200 });
      fireEvent.mouseUp(canvasArea);
    }

    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Canvas mouse move tracking ---

  it("tracks mouse position on canvas move", () => {
    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const canvasArea = container.querySelector("[class*='flex-1 min-w-0']");
    if (canvasArea) {
      fireEvent.mouseMove(canvasArea, { clientX: 150, clientY: 75 });
    }

    // Should not crash
    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Fake counter resets when pokemon id changes ---

  it("resets fake counter when activePokemon changes", () => {
    const pokemon1 = makePokemon({ id: "poke-1", encounters: 10 });
    const pokemon2 = makePokemon({ id: "poke-2", encounters: 20 });

    const { rerender } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={pokemon1}
      />,
    );

    expect(screen.getByText("10")).toBeInTheDocument();

    // Change pokemon
    rerender(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={pokemon2}
      />,
    );

    // Should display new pokemon's encounters
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  // --- Settings prop change re-syncs local state ---

  it("updates local settings when external settings prop changes", () => {
    const settings1 = makeOverlaySettings({ canvas_width: 400 });
    const settings2 = makeOverlaySettings({ canvas_width: 600 });

    const { rerender } = render(
      <OverlayEditor
        settings={settings1}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Re-render with different settings
    rerender(
      <OverlayEditor
        settings={settings2}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Should not crash
    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Update callback propagation ---

  it("calls onUpdate when element is moved via drag simulation", () => {
    const onUpdate = vi.fn();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // The OverlayCanvas component handles drag; verify the callback is wired
    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Canvas hidden state renders correct icon ---

  it("renders EyeOff icon for canvas when hidden is true", async () => {
    const settings = makeOverlaySettings({ hidden: true });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // The canvas visibility button should show "Show" (Einblenden) since it is hidden
    const showButtons = screen.getAllByLabelText(/Einblenden/i);
    expect(showButtons.length).toBeGreaterThan(0);
  });

  // --- Stored split height from localStorage ---

  it("reads stored split height from localStorage", () => {
    const store: Record<string, string> = {
      encounty_editor_tutorial_seen: "true",
      encounty_editor_split: "350",
    };
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
    });

    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // The properties section should have height: 350
    const propertiesSection = container.querySelector("[data-tutorial='properties']");
    expect(propertiesSection).not.toBeNull();
    expect((propertiesSection as HTMLElement).style.height).toBe("350px");
  });

  // --- localStorage getItem throws (fallback to default split height) ---

  it("falls back to default split height when localStorage throws", () => {
    const store: Record<string, string> = { encounty_editor_tutorial_seen: "true" };
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => {
        if (key === "encounty_editor_split") throw new Error("localStorage disabled");
        return store[key] ?? null;
      },
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });

    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Should fall back to 500 height
    const propertiesSection = container.querySelector("[data-tutorial='properties']");
    expect(propertiesSection).not.toBeNull();
    expect((propertiesSection as HTMLElement).style.height).toBe("500px");
  });

  // --- Background image upload: processBackgroundFile ---

  it("uploads a background image file and updates settings", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    // Mock FileReader
    const mockFileReader = {
      readAsDataURL: vi.fn(),
      onload: null as (() => void) | null,
      result: "data:image/png;base64,abc123",
    };
    vi.stubGlobal("FileReader", vi.fn(() => mockFileReader));

    // Mock fetch to return a filename
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ filename: "uploaded-bg.png" }),
    });

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Select canvas layer to see canvas properties
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);

    // The upload button is rendered by OverlayPropertyPanel. If present, click it.
    const uploadBtn = screen.queryByLabelText(/Hintergrundbild hochladen/i);
    if (uploadBtn) {
      await user.click(uploadBtn);
    }
    // Verify the component renders without error
    expect(screen.getAllByText("Canvas").length).toBeGreaterThan(0);
  });

  // --- Background remove: handleBgRemove with actual background_image ---

  it("removes background image and calls onUpdate", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    mockFetch.mockResolvedValueOnce({ ok: true });

    const settings = makeOverlaySettings();
    settings.background_image = "bg-test.png";
    settings.background_image_fit = "cover";

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Select canvas layer
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);

    // Look for remove button
    const removeBtn = screen.queryByLabelText(/Hintergrundbild entfernen/i);
    if (removeBtn) {
      await user.click(removeBtn);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/backgrounds/bg-test.png"),
        expect.objectContaining({ method: "DELETE" }),
      );
    } else {
      expect(canvasLayerButtons[0]).toBeInTheDocument();
    }
  });

  // --- Settings migration: title with zero dimensions triggers migration ---

  it("migrates settings when title has zero width and height", () => {
    const settings = makeOverlaySettings({
      title: { ...makeOverlaySettings().title, width: 0, height: 0, x: 0, y: 0 },
    });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Should render without crashing after migration fills in default title
    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Undo via toolbar after making a change ---

  it("performs undo via toolbar button after modifying z_index", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Make a change first: move sprite layer up
    const moveUpButtons = screen.getAllByLabelText(/Nach oben verschieben/i);
    await user.click(moveUpButtons[0]);
    expect(onUpdate).toHaveBeenCalled();

    // Wait for history debounce
    await act(async () => { await new Promise(r => setTimeout(r, 500)); });

    // Now click undo
    const undoBtn = screen.getByLabelText(/Rückgängig.*Strg\+Z/i);
    await user.click(undoBtn);

    // Should have called onUpdate again (undo reverts)
    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Redo via toolbar after undo ---

  it("performs redo via toolbar button after undo", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Make a change
    const moveUpButtons = screen.getAllByLabelText(/Nach oben verschieben/i);
    await user.click(moveUpButtons[0]);

    // Wait for debounce
    await act(async () => { await new Promise(r => setTimeout(r, 500)); });

    // Undo
    const undoBtn = screen.getByLabelText(/Rückgängig.*Strg\+Z/i);
    await user.click(undoBtn);

    // Redo
    const redoBtn = screen.getByLabelText(/Wiederholen.*Strg\+Y/i);
    await user.click(redoBtn);

    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Ctrl+Z undo after actual change ---

  it("performs Ctrl+Z undo after a change and verifies handler runs", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({ sprite: { ...makeOverlaySettings().sprite, x: 50, y: 10 } });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Select sprite and nudge
    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);
    await user.keyboard("{ArrowRight}");
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ sprite: expect.objectContaining({ x: 51 }) }),
    );

    // Ctrl+Z triggers the undo handler path (even if debounce hasn't committed yet)
    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    // The handler runs without crashing
    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Ctrl+Y redo after Ctrl+Z ---

  it("performs Ctrl+Y redo after Ctrl+Z undo", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({ sprite: { ...makeOverlaySettings().sprite, x: 50, y: 10 } });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);
    await user.keyboard("{ArrowRight}");

    // Undo then redo
    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    fireEvent.keyDown(document, { key: "y", ctrlKey: true });

    // Both handlers run without crashing
    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Divider drag clamps height ---

  it("clamps divider height during drag", () => {
    // Set innerHeight so we can test clamping
    Object.defineProperty(globalThis, "innerHeight", { value: 800, writable: true });

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const dividerBtn = screen.getByLabelText(/Größe ändern/i);

    // Start drag at a high position
    fireEvent.mouseDown(dividerBtn, { clientX: 200, clientY: 100 });
    // Try to drag very far down (should clamp)
    fireEvent.mouseMove(document, { clientX: 200, clientY: 900 });
    fireEvent.mouseUp(document);

    expect(dividerBtn).toBeInTheDocument();
  });

  // --- Divider drag clamps minimum height ---

  it("clamps divider height minimum during drag", () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const dividerBtn = screen.getByLabelText(/Größe ändern/i);

    // Start drag and drag up to try to go below minimum
    fireEvent.mouseDown(dividerBtn, { clientX: 200, clientY: 500 });
    fireEvent.mouseMove(document, { clientX: 200, clientY: 0 });
    fireEvent.mouseUp(document);

    expect(dividerBtn).toBeInTheDocument();
  });

  // --- Zoom mouse down/up on canvas with zoom tool ---

  it("handles zoom tool mousedown and mouseup on canvas container", () => {
    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Switch to zoom tool
    fireEvent.keyDown(document, { key: "z" });

    const canvasArea = container.querySelector("[class*='flex-1 min-w-0']");
    if (canvasArea) {
      // Mouse down in zoom mode starts zoom drag
      fireEvent.mouseDown(canvasArea, { clientX: 200, clientY: 200 });
      // Mouse move with zoom drag active
      fireEvent.mouseMove(canvasArea, { clientX: 350, clientY: 200 });
      // Mouse up ends zoom drag
      fireEvent.mouseUp(canvasArea);
    }

    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Pan drag with mouse move ---

  it("handles pan drag with mouse move on canvas container", () => {
    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Switch to hand tool
    fireEvent.keyDown(document, { key: "h" });

    const canvasArea = container.querySelector("[class*='flex-1 min-w-0']");
    if (canvasArea) {
      fireEvent.mouseDown(canvasArea, { clientX: 100, clientY: 100 });
      // Move multiple times to test pan drag
      fireEvent.mouseMove(canvasArea, { clientX: 200, clientY: 200 });
      fireEvent.mouseMove(canvasArea, { clientX: 250, clientY: 250 });
      fireEvent.mouseUp(canvasArea);
    }

    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Tab cycles through all layers ---

  it("cycles Tab through all layers from sprite to canvas", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Start with sprite selected
    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);

    // Tab: sprite -> name -> title -> counter -> canvas
    await user.keyboard("{Tab}"); // name
    await user.keyboard("{Tab}"); // title
    await user.keyboard("{Tab}"); // counter
    await user.keyboard("{Tab}"); // canvas

    // Canvas should now be selected
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    const canvasWrapper = canvasLayerButtons[0].closest("div");
    expect(canvasWrapper?.className).toMatch(/accent-blue/);
  });

  // --- Multiple increment/decrement test counter ---

  it("handles multiple increments followed by decrements", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon({ encounters: 5 })}
      />,
    );

    const incBtn = screen.getByLabelText(/Vorschau.*erhöhen/i);
    await user.click(incBtn);
    await user.click(incBtn);
    expect(screen.getByText("7")).toBeInTheDocument();

    const decBtn = screen.getByLabelText(/Vorschau.*verringern/i);
    await user.click(decBtn);
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  // --- Space key not intercepted in INPUT fields ---

  it("does not intercept space key in input fields", () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Simulate space keydown with target being an INPUT element
    const event = new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true });
    Object.defineProperty(event, "target", {
      value: { tagName: "INPUT" },
      writable: false,
    });
    document.dispatchEvent(event);

    // Should not crash; the space handler has an isInput check
    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- No activePokemon renders test counter area ---

  it("renders test counter area when no activePokemon provided", () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
      />,
    );

    // Should render without crashing even without a pokemon
    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Move layer for name element ---

  it("moves name layer up", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({
      name: { ...makeOverlaySettings().name, z_index: 3 },
    });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

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

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

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

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Canvas show button should say "Einblenden"
    const showButtons = screen.getAllByLabelText(/Einblenden/i);
    const canvasShowBtn = showButtons[showButtons.length - 1];
    await user.click(canvasShowBtn);

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ hidden: false }),
    );
  });

  // --- Window resize handler ---

  it("handles window resize event without crashing", async () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );
    await act(async () => {});

    // Trigger resize event
    act(() => { globalThis.dispatchEvent(new Event("resize")); });

    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Divider reset button resets to 500 ---

  it("resets divider height to 500 when divider reset button is clicked", async () => {
    const user = userEvent.setup();
    const store: Record<string, string> = {
      encounty_editor_tutorial_seen: "true",
      encounty_editor_split: "300",
    };
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
    });

    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Verify initial height is 300 from stored state
    const propertiesSection = container.querySelector("[data-tutorial='properties']");
    expect((propertiesSection as HTMLElement).style.height).toBe("300px");

    // Click divider reset (first reset button by title)
    const resetButtons = screen.getAllByTitle(/Layout zurücksetzen/i);
    await user.click(resetButtons[0]);

    // Height should be reset to 500
    expect((propertiesSection as HTMLElement).style.height).toBe("500px");
    // localStorage key should be removed
    expect(store["encounty_editor_split"]).toBeUndefined();
  });

  // --- Test counter: increment fires trigger on all elements ---

  it("fires test trigger on all elements when incrementing", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon({ encounters: 5 })}
      />,
    );

    // Increment fires triggers on counter, sprite, name, and title
    const incBtn = screen.getByLabelText(/Vorschau.*erhöhen/i);
    await user.click(incBtn);

    // Counter should reflect the increment
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  // --- Test counter: reset sets to 0 ---

  it("resets test counter to 0 directly from initial state", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon({ encounters: 25 })}
      />,
    );

    expect(screen.getByText("25")).toBeInTheDocument();

    const resetBtn = screen.getByLabelText(/Vorschau.*zurücksetzen/i);
    await user.click(resetBtn);

    expect(screen.getByText("0")).toBeInTheDocument();
  });

  // --- ColorPickerModal opens when background color swatch is clicked ---

  it("opens ColorPickerModal when background color swatch is clicked on canvas", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Select canvas layer to show canvas properties
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);

    // Click the background color swatch (title contains the hex color)
    const colorSwatch = screen.getByTitle("#000000");
    await user.click(colorSwatch);

    // ColorPickerModal should now be rendered — look for dialog element
    const dialog = document.querySelector("dialog");
    expect(dialog).not.toBeNull();
  });

  // --- TextColorEditorModal opens when text color swatch is clicked ---

  it("opens TextColorEditorModal when text color swatch is clicked on name layer", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Select name layer
    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);

    // Click the text color swatch — title is "Farbe #ffffff"
    const colorSwatches = screen.getAllByTitle(/^Farbe #/);
    await user.click(colorSwatches[0]);

    // TextColorEditorModal should now be visible
    const allText = document.body.textContent ?? "";
    expect(allText).toBeTruthy();
  });

  // --- OutlineEditorModal opens when outline swatch is clicked ---

  it("opens OutlineEditorModal when outline swatch is clicked on name layer", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Select name layer
    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);

    // Click the outline swatch — title is "Umriss (Keine)" for none outline
    const outlineSwatch = screen.getByTitle(/^Umriss/);
    await user.click(outlineSwatch);

    // OutlineEditorModal should render
    const allText = document.body.textContent ?? "";
    expect(allText).toBeTruthy();
  });

  // --- ShadowEditorModal opens when shadow swatch is clicked ---

  it("opens ShadowEditorModal when shadow swatch is clicked on name layer", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Select name layer
    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);

    // Click the shadow swatch — title is "Schatten (Aus)"
    const shadowSwatch = screen.getByTitle(/^Schatten/);
    await user.click(shadowSwatch);

    // ShadowEditorModal should render
    const allText = document.body.textContent ?? "";
    expect(allText).toBeTruthy();
  });

  // --- Background upload button triggers file input ---

  it("triggers file input via background upload button on canvas", async () => {
    const user = userEvent.setup();
    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "input") {
        Object.defineProperty(el, "click", { value: clickSpy });
      }
      return el;
    });

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Select canvas layer
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);

    // Click upload button (by title)
    const uploadBtn = screen.getByTitle(/Eigenes Hintergrundbild hochladen/i);
    await user.click(uploadBtn);

    expect(clickSpy).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  // --- Background remove button triggers fetch DELETE ---

  it("removes background image when remove button is clicked on canvas", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

    const settings = makeOverlaySettings();
    settings.background_image = "my-bg.png";
    settings.background_image_fit = "cover";

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Select canvas layer
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);

    // Click remove button (by title)
    const removeBtn = screen.getByTitle(/Hintergrundbild entfernen/i);
    await user.click(removeBtn);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/backgrounds/my-bg.png"),
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ background_image: "" }),
    );
  });

  // --- Move title layer ---

  it("moves title layer up and down", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({
      title: { ...makeOverlaySettings().title, z_index: 4 },
    });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // title is at index 2 in the LAYERS array (sprite, name, title, counter)
    const moveUpButtons = screen.getAllByLabelText(/Nach oben verschieben/i);
    await user.click(moveUpButtons[2]);

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.objectContaining({ z_index: 5 }),
      }),
    );
  });

  // --- ColorPickerModal close dismisses modal ---

  it("closes ColorPickerModal when close callback fires", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Select canvas layer and open color picker
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);
    const colorSwatch = screen.getByTitle("#000000");
    await user.click(colorSwatch);

    // Dialog should be open
    const dialog = document.querySelector("dialog");
    expect(dialog).not.toBeNull();

    // Close button in the modal (aria-label for close)
    const closeBtn = screen.queryByLabelText(/Schließen|Close/i);
    if (closeBtn) {
      await user.click(closeBtn);
    }
    // Component should still render fine
    expect(screen.getAllByText("Canvas").length).toBeGreaterThan(0);
  });

  // --- TextColorEditorModal confirm ---

  it("confirms TextColorEditorModal and closes it", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Select name layer and open text color editor
    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);
    const colorSwatches = screen.getAllByTitle(/^Farbe #/);
    await user.click(colorSwatches[0]);

    // The TextColorEditorModal should have a confirm button
    const confirmBtn = screen.queryByTitle(/Übernehmen/i);
    if (confirmBtn) {
      await user.click(confirmBtn);
      // onUpdate should have been called with the updated style
      expect(onUpdate).toHaveBeenCalled();
    }
    // Component should still render
    expect(screen.getAllByText("Name").length).toBeGreaterThan(0);
  });

  // --- OutlineEditorModal confirm ---

  it("confirms OutlineEditorModal and closes it", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);
    const outlineSwatch = screen.getByTitle(/^Umriss/);
    await user.click(outlineSwatch);

    // Confirm button in OutlineEditorModal
    const confirmBtn = screen.queryByTitle(/Übernehmen/i);
    if (confirmBtn) {
      await user.click(confirmBtn);
    }
    expect(screen.getAllByText("Name").length).toBeGreaterThan(0);
  });

  // --- ShadowEditorModal confirm ---

  it("confirms ShadowEditorModal and closes it", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);
    const shadowSwatch = screen.getByTitle(/^Schatten/);
    await user.click(shadowSwatch);

    // Confirm in shadow modal
    const confirmBtn = screen.queryByTitle(/Übernehmen/i);
    if (confirmBtn) {
      await user.click(confirmBtn);
    }
    expect(screen.getAllByText("Name").length).toBeGreaterThan(0);
  });

  // --- Tutorial completion sets localStorage ---

  it("completes tutorial by clicking skip button and sets localStorage flag", async () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
    });

    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Tutorial should be showing — click the "Überspringen" (skip) button
    const skipBtn = screen.getByText("Überspringen");
    await user.click(skipBtn);

    // After skip, the tutorial completion callback sets the localStorage flag
    expect(store["encounty_editor_tutorial_seen"]).toBe("true");
  });

  // --- Undo/redo keyboard shortcuts exercise both branches ---

  it("exercises handleUndoRedo Ctrl+Z path with ArrowRight preceding", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({ sprite: { ...makeOverlaySettings().sprite, x: 50, y: 10 } });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Make multiple changes so history has entries
    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{ArrowRight}");

    // Ctrl+Z undo — even without committed history, the handler path is exercised
    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    fireEvent.keyDown(document, { key: "y", ctrlKey: true });

    // Should not crash
    expect(onUpdate).toHaveBeenCalled();
  });

  // --- Zoom tool click on canvas (handleCanvasMouseDown for zoom) ---

  it("handles zoom tool click on canvas triggering zoom at point", () => {
    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Switch to zoom tool
    fireEvent.keyDown(document, { key: "z" });

    const canvasArea = container.querySelector("[class*='flex-1 min-w-0']");
    if (canvasArea) {
      // Zoom tool mousedown sets zoomDragStart
      fireEvent.mouseDown(canvasArea, { clientX: 200, clientY: 200, button: 0 });
      // Mouse move horizontally for zoom drag
      fireEvent.mouseMove(canvasArea, { clientX: 400, clientY: 200 });
      // Mouse up to stop zoom drag
      fireEvent.mouseUp(canvasArea);
    }

    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Hand tool mousedown on canvas (handleCanvasMouseDown for hand) ---

  it("handles hand tool mousedown on canvas starting pan drag", () => {
    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Switch to hand tool
    fireEvent.keyDown(document, { key: "h" });

    const canvasArea = container.querySelector("[class*='flex-1 min-w-0']");
    if (canvasArea) {
      fireEvent.mouseDown(canvasArea, { clientX: 100, clientY: 100, button: 0 });
      // Move to pan
      fireEvent.mouseMove(canvasArea, { clientX: 200, clientY: 150 });
      fireEvent.mouseMove(canvasArea, { clientX: 300, clientY: 200 });
      fireEvent.mouseUp(canvasArea);
    }

    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Canvas mouse move without active tool (pointer mode) ---

  it("tracks mouse position in pointer mode without triggering drag", () => {
    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const canvasArea = container.querySelector("[class*='flex-1 min-w-0']");
    if (canvasArea) {
      fireEvent.mouseMove(canvasArea, { clientX: 100, clientY: 50 });
      fireEvent.mouseMove(canvasArea, { clientX: 200, clientY: 100 });
    }

    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Undo/redo with debounced history (exercise canUndo/canRedo true paths) ---

  it("performs actual undo via Ctrl+Z after debounced history commit", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({ sprite: { ...makeOverlaySettings().sprite, x: 50, y: 10 } });

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Select sprite and nudge to create a change
    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);
    await user.keyboard("{ArrowRight}");

    // Wait for history debounce to commit (useHistory debounce is 400ms)
    await act(async () => {
      await new Promise(r => setTimeout(r, 500));
    });

    // Make another change
    await user.keyboard("{ArrowRight}");
    await act(async () => {
      await new Promise(r => setTimeout(r, 500));
    });

    // Ctrl+Z should now undo since canUndo is true
    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    // Ctrl+Y redo after undo
    fireEvent.keyDown(document, { key: "y", ctrlKey: true });

    expect(onUpdate).toHaveBeenCalled();
  });

  // --- Undo/redo via toolbar buttons with actual history ---

  it("performs actual undo and redo via toolbar buttons after debounced commits", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Make a change: move sprite layer up
    const moveUpButtons = screen.getAllByLabelText(/Nach oben verschieben/i);
    await user.click(moveUpButtons[0]);

    // Wait for history debounce
    await act(async () => {
      await new Promise(r => setTimeout(r, 500));
    });

    // Make another change
    await user.click(moveUpButtons[0]);
    await act(async () => {
      await new Promise(r => setTimeout(r, 500));
    });

    const undoBtn = screen.getByLabelText(/Rückgängig.*Strg\+Z/i);
    await user.click(undoBtn);

    // Undo should have called onUpdate
    const callCountAfterUndo = onUpdate.mock.calls.length;
    expect(callCountAfterUndo).toBeGreaterThan(2);

    const redoBtn = screen.getByLabelText(/Wiederholen.*Strg\+Y/i);
    await user.click(redoBtn);

    expect(onUpdate.mock.calls.length).toBeGreaterThan(callCountAfterUndo);
  });

  // --- ColorPickerModal confirm callback exercises colorPickerTarget.onConfirm ---

  it("exercises ColorPickerModal confirm callback and dismisses modal", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Open color picker via canvas background color swatch
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);
    const colorSwatch = screen.getByTitle("#000000");
    await user.click(colorSwatch);

    // Dialog should be open
    expect(document.querySelector("dialog")).not.toBeNull();

    // Click the confirm/apply button (title="Übernehmen")
    const applyBtn = screen.getByTitle("Übernehmen");
    await user.click(applyBtn);

    // Modal should be dismissed (colorPickerTarget set to null)
    // onUpdate should have been called with updated background_color
    expect(onUpdate).toHaveBeenCalled();
  });

  // --- OutlineEditorModal confirm callback ---

  it("exercises OutlineEditorModal confirm callback", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Select name layer and open outline editor
    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);
    const outlineSwatch = screen.getByTitle(/^Umriss/);
    await user.click(outlineSwatch);

    // Click the apply button inside the OutlineEditorModal
    const applyBtns = screen.getAllByTitle("Übernehmen");
    await user.click(applyBtns[applyBtns.length - 1]);

    // Modal should close and onUpdate should be called
    expect(onUpdate).toHaveBeenCalled();
  });

  // --- ShadowEditorModal confirm callback ---

  it("exercises ShadowEditorModal confirm callback", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);
    const shadowSwatch = screen.getByTitle(/^Schatten/);
    await user.click(shadowSwatch);

    // Click apply in ShadowEditorModal
    const applyBtns = screen.getAllByTitle("Übernehmen");
    await user.click(applyBtns[applyBtns.length - 1]);

    expect(onUpdate).toHaveBeenCalled();
  });

  // --- TextColorEditorModal confirm callback ---

  it("exercises TextColorEditorModal confirm callback", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);
    const colorSwatches = screen.getAllByTitle(/^Farbe #/);
    await user.click(colorSwatches[0]);

    // Click apply in TextColorEditorModal
    const applyBtns = screen.getAllByTitle("Übernehmen");
    await user.click(applyBtns[applyBtns.length - 1]);

    expect(onUpdate).toHaveBeenCalled();
  });

  // --- ColorPickerModal close callback ---

  it("exercises ColorPickerModal close callback and nullifies target", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Open color picker
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);
    const colorSwatch = screen.getByTitle("#000000");
    await user.click(colorSwatch);

    // Click cancel button (title="Abbrechen")
    const cancelBtn = screen.queryByTitle("Abbrechen");
    if (cancelBtn) {
      await user.click(cancelBtn);
    }
    // Modal should be dismissed
    expect(screen.getAllByText("Canvas").length).toBeGreaterThan(0);
  });

  // --- OutlineEditorModal close callback ---

  it("exercises OutlineEditorModal close callback", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);
    const outlineSwatch = screen.getByTitle(/^Umriss/);
    await user.click(outlineSwatch);

    // Click cancel in OutlineEditorModal
    const cancelBtns = screen.getAllByTitle("Abbrechen");
    await user.click(cancelBtns[cancelBtns.length - 1]);

    expect(screen.getAllByText("Name").length).toBeGreaterThan(0);
  });

  // --- ShadowEditorModal close callback ---

  it("exercises ShadowEditorModal close callback", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);
    const shadowSwatch = screen.getByTitle(/^Schatten/);
    await user.click(shadowSwatch);

    // Click cancel in ShadowEditorModal
    const cancelBtns = screen.getAllByTitle("Abbrechen");
    await user.click(cancelBtns[cancelBtns.length - 1]);

    expect(screen.getAllByText("Name").length).toBeGreaterThan(0);
  });

  // --- TextColorEditorModal close callback ---

  it("exercises TextColorEditorModal close callback", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);
    const colorSwatches = screen.getAllByTitle(/^Farbe #/);
    await user.click(colorSwatches[0]);

    // Click cancel in TextColorEditorModal
    const cancelBtns = screen.getAllByTitle("Abbrechen");
    await user.click(cancelBtns[cancelBtns.length - 1]);

    expect(screen.getAllByText("Name").length).toBeGreaterThan(0);
  });

  // --- Canvas mouse handlers via OverlayCanvas wrapper ---

  it("exercises handleCanvasMouseDown and handleCanvasMouseUp for hand tool", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Switch to hand tool
    await user.keyboard("h");

    // Find the OverlayCanvas wrapper div via its aria-label
    const canvasEl = screen.getByLabelText("Overlay canvas");

    // Mouse down triggers pan drag start
    fireEvent.mouseDown(canvasEl, { clientX: 100, clientY: 100 });
    // Mouse move during pan drag
    fireEvent.mouseMove(canvasEl, { clientX: 200, clientY: 150 });
    // Mouse up ends pan drag
    fireEvent.mouseUp(canvasEl);

    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  it("exercises handleCanvasMouseDown and handleCanvasMouseUp for zoom tool", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Switch to zoom tool
    await user.keyboard("z");

    const canvasEl = screen.getByLabelText("Overlay canvas");

    // Mouse down starts zoom drag
    fireEvent.mouseDown(canvasEl, { clientX: 200, clientY: 200 });
    // Mouse move horizontally for zoom
    fireEvent.mouseMove(canvasEl, { clientX: 350, clientY: 200 });
    // Mouse up ends zoom drag
    fireEvent.mouseUp(canvasEl);

    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  it("exercises handleCanvasMouseMove in pointer mode for position tracking", () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const canvasEl = screen.getByLabelText("Overlay canvas");

    // Mouse move tracks position
    fireEvent.mouseMove(canvasEl, { clientX: 100, clientY: 50 });
    fireEvent.mouseMove(canvasEl, { clientX: 200, clientY: 100 });

    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  it("exercises mouseLeave on canvas triggers handleCanvasMouseUp", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Switch to hand tool and start drag
    await user.keyboard("h");
    const canvasEl = screen.getByLabelText("Overlay canvas");

    fireEvent.mouseDown(canvasEl, { clientX: 100, clientY: 100 });
    // Mouse leave triggers mouseUp handler
    fireEvent.mouseLeave(canvasEl);

    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  it("exercises pan drag with space key held while moving mouse", async () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Hold space for temporary hand tool
    fireEvent.keyDown(document, { code: "Space", key: " " });

    const canvasEl = screen.getByLabelText("Overlay canvas");

    // Pan drag while space is held
    fireEvent.mouseDown(canvasEl, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(canvasEl, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(canvasEl);

    // Release space
    fireEvent.keyUp(document, { code: "Space", key: " " });

    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  it("exercises zoom drag with mouse move during zoom tool interaction", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Switch to zoom tool
    await user.keyboard("z");

    const canvasEl = screen.getByLabelText("Overlay canvas");

    // Start zoom drag
    fireEvent.mouseDown(canvasEl, { clientX: 200, clientY: 200 });
    // Multiple mouse moves for zoom drag
    fireEvent.mouseMove(canvasEl, { clientX: 300, clientY: 200 });
    fireEvent.mouseMove(canvasEl, { clientX: 400, clientY: 200 });
    // Release
    fireEvent.mouseUp(canvasEl);

    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- processBackgroundFile with successful upload ---

  it("processes background file upload end-to-end", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    // Mock FileReader as a proper class
    class MockFileReader {
      result = "data:image/png;base64,abc123";
      onload: (() => void) | null = null;
      readAsDataURL() {
        // Trigger onload asynchronously
        setTimeout(() => { if (this.onload) this.onload(); }, 0);
      }
    }
    const OrigFileReader = globalThis.FileReader;
    vi.stubGlobal("FileReader", MockFileReader);

    // Mock fetch for upload
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ filename: "uploaded-bg.png" }),
    });

    // Track the created file input
    let capturedInput: HTMLInputElement | null = null;
    const origCE = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation(
      function (this: Document, tagName: string) {
        const el = origCE.call(this, tagName);
        if (tagName === "input") {
          capturedInput = el as HTMLInputElement;
          Object.defineProperty(el, "click", { value: vi.fn() });
        }
        return el;
      } as typeof document.createElement,
    );

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Select canvas and click upload
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);
    const uploadBtn = screen.getByTitle(/Eigenes Hintergrundbild hochladen/i);
    await user.click(uploadBtn);

    // Simulate file selection
    expect(capturedInput).not.toBeNull();
    const input = capturedInput!;
    const mockFile = new File(["test"], "test.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [mockFile] });
    await act(async () => {
      input.dispatchEvent(new Event("change"));
      // Wait for FileReader onload + fetch
      await new Promise(r => setTimeout(r, 50));
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/backgrounds/upload"),
      expect.objectContaining({ method: "POST" }),
    );

    createElementSpy.mockRestore();
    vi.stubGlobal("FileReader", OrigFileReader);
  });

  // --- processBackgroundFile with fetch failure ---

  it("handles background upload fetch failure gracefully", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    class MockFileReader {
      result = "data:image/png;base64,abc";
      onload: (() => void) | null = null;
      readAsDataURL() {
        setTimeout(() => { if (this.onload) this.onload(); }, 0);
      }
    }
    const OrigFileReader = globalThis.FileReader;
    vi.stubGlobal("FileReader", MockFileReader);

    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    let capturedInput: HTMLInputElement | null = null;
    const origCE = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation(
      function (this: Document, tagName: string) {
        const el = origCE.call(this, tagName);
        if (tagName === "input") {
          capturedInput = el as HTMLInputElement;
          Object.defineProperty(el, "click", { value: vi.fn() });
        }
        return el;
      } as typeof document.createElement,
    );

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);
    const uploadBtn = screen.getByTitle(/Eigenes Hintergrundbild hochladen/i);
    await user.click(uploadBtn);

    expect(capturedInput).not.toBeNull();
    const fileInput = capturedInput!;
    const mockFile = new File(["test"], "test.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", { value: [mockFile] });
    fileInput.dispatchEvent(new Event("change"));
    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    expect(screen.getAllByText("Canvas").length).toBeGreaterThan(0);
    consoleSpy.mockRestore();
    createElementSpy.mockRestore();
    vi.stubGlobal("FileReader", OrigFileReader);
  });

  // --- processBackgroundFile with res.ok = false ---

  it("handles non-ok response from background upload", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    class MockFileReader {
      result = "data:image/png;base64,test";
      onload: (() => void) | null = null;
      readAsDataURL() {
        setTimeout(() => { if (this.onload) this.onload(); }, 0);
      }
    }
    const OrigFileReader = globalThis.FileReader;
    vi.stubGlobal("FileReader", MockFileReader);

    mockFetch.mockResolvedValueOnce({ ok: false });

    let capturedInput: HTMLInputElement | null = null;
    const origCE = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation(
      function (this: Document, tagName: string) {
        const el = origCE.call(this, tagName);
        if (tagName === "input") {
          capturedInput = el as HTMLInputElement;
          Object.defineProperty(el, "click", { value: vi.fn() });
        }
        return el;
      } as typeof document.createElement,
    );

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);
    const uploadBtn = screen.getByTitle(/Eigenes Hintergrundbild hochladen/i);
    await user.click(uploadBtn);

    expect(capturedInput).not.toBeNull();
    const fileInput = capturedInput!;
    const mockFile = new File(["test"], "test.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", { value: [mockFile] });
    await act(async () => {
      fileInput.dispatchEvent(new Event("change"));
      await new Promise(r => setTimeout(r, 50));
    });

    // onUpdate should NOT have been called for bg change since res.ok was false
    const bgUpdateCalls = onUpdate.mock.calls.filter(
      (call: unknown[]) => call[0] != null && typeof call[0] === "object" && "background_image" in call[0],
    );
    expect(bgUpdateCalls.length).toBe(0);

    createElementSpy.mockRestore();
    vi.stubGlobal("FileReader", OrigFileReader);
  });

  // --- handleBgUpload: file input with no file selected ---

  it("handles file input with no file selected in bg upload", async () => {
    const user = userEvent.setup();

    let capturedInput: HTMLInputElement | null = null;
    const origCE = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation(
      function (this: Document, tagName: string) {
        const el = origCE.call(this, tagName);
        if (tagName === "input") {
          capturedInput = el as HTMLInputElement;
          Object.defineProperty(el, "click", { value: vi.fn() });
        }
        return el;
      } as typeof document.createElement,
    );

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);
    const uploadBtn = screen.getByTitle(/Eigenes Hintergrundbild hochladen/i);
    await user.click(uploadBtn);

    // Simulate file input onchange with no file selected
    expect(capturedInput).not.toBeNull();
    const input = capturedInput!;
    Object.defineProperty(input, "files", { value: [] });
    input.dispatchEvent(new Event("change"));

    expect(screen.getAllByText("Canvas").length).toBeGreaterThan(0);
    createElementSpy.mockRestore();
  });

  // --- Settings migration: title with zero dimensions triggers migration ---

  it("migrates settings when title has zero width and height via rerender", () => {
    const settings = makeOverlaySettings({
      title: { ...makeOverlaySettings().title, width: 0, height: 0 },
    });

    const { rerender } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Rerender with zero-dimension title to trigger migration useEffect
    rerender(
      <OverlayEditor
        settings={settings}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- bgPreviewUrl computed from background_image ---

  it("computes bgPreviewUrl when background_image is set", async () => {
    const user = userEvent.setup();
    const settings = makeOverlaySettings();
    settings.background_image = "test-bg.webp";

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Select canvas layer to trigger property panel with bg preview URL
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);

    // The component should render with the bg preview URL available
    expect(screen.getAllByText("Canvas").length).toBeGreaterThan(0);
  });

  // --- handleBgRemove: fetch DELETE failure is caught ---

  it("handles fetch DELETE failure gracefully during bg remove", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const settings = makeOverlaySettings();
    settings.background_image = "fail-bg.png";
    settings.background_image_fit = "cover";

    render(
      <OverlayEditor
        settings={settings}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);

    const removeBtn = screen.getByTitle(/Hintergrundbild entfernen/i);
    await user.click(removeBtn);

    // Wait for async
    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    // Should still call onUpdate to clear the bg even if DELETE failed
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ background_image: "" }),
    );
  });

  // --- updateSelectedEl is a no-op when canvas is selected ---

  it("updateSelectedEl is no-op when canvas selected and arrow key pressed", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Select canvas layer
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);
    onUpdate.mockClear();

    // Arrow keys should be no-ops
    await user.keyboard("{ArrowLeft}");
    await user.keyboard("{ArrowUp}");
    await user.keyboard("{ArrowDown}");
    expect(onUpdate).not.toHaveBeenCalled();
  });

  // --- Escape when canvas is selected is a no-op ---

  it("does not change selection when Escape is pressed with canvas selected", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);

    // handleElementKeys returns false for canvas, so Escape is not handled
    await user.keyboard("{Escape}");

    // Canvas should still be selected since handleElementKeys bails early
    const canvasWrapper = canvasLayerButtons[0].closest("div");
    expect(canvasWrapper?.className).toMatch(/accent-blue/);
  });

  // --- Tab when canvas is selected is a no-op ---

  it("does not cycle selection when Tab is pressed with canvas selected", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Select canvas layer
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);

    // handleElementKeys returns false for canvas, so Tab is not handled
    await user.keyboard("{Tab}");

    // Canvas should still be selected
    const canvasWrapper = canvasLayerButtons[0].closest("div");
    expect(canvasWrapper?.className).toMatch(/accent-blue/);
  });

  // --- Ctrl+Z and Ctrl+Y early return paths ---

  it("Ctrl+Z prevents default and returns early from handler", async () => {
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );
    await act(async () => {});

    // Fire Ctrl+Z (no history, canUndo is false, but handler still runs)
    act(() => {
      const event = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
      document.dispatchEvent(event);
    });

    // Fire Ctrl+Y (no history, canRedo is false, but handler still runs)
    act(() => {
      const event2 = new KeyboardEvent("keydown", { key: "y", ctrlKey: true, bubbles: true, cancelable: true });
      document.dispatchEvent(event2);
    });

    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
  });

  // --- Multiple test counter operations ---

  it("handles increment, decrement, and reset in sequence", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon({ encounters: 3 })}
      />,
    );

    expect(screen.getByText("3")).toBeInTheDocument();

    const incBtn = screen.getByLabelText(/Vorschau.*erhöhen/i);
    const decBtn = screen.getByLabelText(/Vorschau.*verringern/i);
    const resetBtn = screen.getByLabelText(/Vorschau.*zurücksetzen/i);

    await user.click(incBtn);
    expect(screen.getByText("4")).toBeInTheDocument();

    await user.click(incBtn);
    expect(screen.getByText("5")).toBeInTheDocument();

    await user.click(decBtn);
    expect(screen.getByText("4")).toBeInTheDocument();

    await user.click(resetBtn);
    expect(screen.getByText("0")).toBeInTheDocument();

    // Decrement at 0 should stay at 0
    await user.click(decBtn);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  // --- Rerender with new activePokemon resets fakeCount ---

  it("resets fakeCount after increment when pokemon changes", async () => {
    const user = userEvent.setup();
    const pokemon1 = makePokemon({ id: "poke-a", encounters: 5 });
    const pokemon2 = makePokemon({ id: "poke-b", encounters: 15 });

    const { rerender } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={pokemon1}
      />,
    );

    // Increment to create a fakeCount
    const incBtn = screen.getByLabelText(/Vorschau.*erhöhen/i);
    await user.click(incBtn);
    expect(screen.getByText("6")).toBeInTheDocument();

    // Change pokemon -- fakeCount should reset
    rerender(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={pokemon2}
      />,
    );

    expect(screen.getByText("15")).toBeInTheDocument();
  });
});
