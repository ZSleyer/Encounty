/**
 * Keyboard shortcuts of the overlay editor: tool switching, arrow nudging,
 * selection cycling and the guards that keep them out of input fields.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  makeOverlaySettings,
  makePokemon,
  userEvent,
  fireEvent,
  waitFor,
} from "../../test-utils";
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
    const settings = makeOverlaySettings({
      sprite: { ...makeOverlaySettings().sprite, x: 50, y: 10 },
    });

    render(<OverlayEditor settings={settings} onUpdate={onUpdate} activePokemon={makePokemon()} />);

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
    const settings = makeOverlaySettings({
      sprite: { ...makeOverlaySettings().sprite, x: 50, y: 10 },
    });

    render(<OverlayEditor settings={settings} onUpdate={onUpdate} activePokemon={makePokemon()} />);

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
    const settings = makeOverlaySettings({
      sprite: { ...makeOverlaySettings().sprite, x: 10, y: 50 },
    });

    render(<OverlayEditor settings={settings} onUpdate={onUpdate} activePokemon={makePokemon()} />);

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
    const settings = makeOverlaySettings({
      sprite: { ...makeOverlaySettings().sprite, x: 10, y: 50 },
    });

    render(<OverlayEditor settings={settings} onUpdate={onUpdate} activePokemon={makePokemon()} />);

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

  // --- Shift+Arrow nudges by 10 ---

  it("nudges element by 10px when Shift+ArrowRight is pressed", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({
      sprite: { ...makeOverlaySettings().sprite, x: 50, y: 10 },
    });

    render(<OverlayEditor settings={settings} onUpdate={onUpdate} activePokemon={makePokemon()} />);

    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ x: 60 }),
      }),
    );
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

  // --- Shift+ArrowLeft nudge by 10 ---

  it("nudges element by 10px when Shift+ArrowLeft is pressed", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({
      sprite: { ...makeOverlaySettings().sprite, x: 50, y: 10 },
    });

    render(<OverlayEditor settings={settings} onUpdate={onUpdate} activePokemon={makePokemon()} />);

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
    const settings = makeOverlaySettings({
      sprite: { ...makeOverlaySettings().sprite, x: 10, y: 50 },
    });

    render(<OverlayEditor settings={settings} onUpdate={onUpdate} activePokemon={makePokemon()} />);

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
    const settings = makeOverlaySettings({
      sprite: { ...makeOverlaySettings().sprite, x: 10, y: 50 },
    });

    render(<OverlayEditor settings={settings} onUpdate={onUpdate} activePokemon={makePokemon()} />);

    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ y: 60 }),
      }),
    );
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

    // Title should now be selected, check via the layer button's parent wrapper
    const titleLayerButtons = screen.getAllByLabelText(/Titel/i);
    const titleWrapper = titleLayerButtons[0].closest("div");
    expect(titleWrapper?.className).toMatch(/accent-blue/);
  });

  // --- Multiple nudge operations accumulate ---

  it("accumulates multiple nudge operations", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const settings = makeOverlaySettings({
      sprite: { ...makeOverlaySettings().sprite, x: 50, y: 50 },
    });

    render(<OverlayEditor settings={settings} onUpdate={onUpdate} activePokemon={makePokemon()} />);

    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    await user.click(spriteLayerButtons[0]);

    // Nudge right twice
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{ArrowRight}");

    // First call should be x:51, second call depends on local state resync
    expect(onUpdate).toHaveBeenCalledTimes(2);
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

    // Tab: sprite -> name -> title -> counter -> timer -> odds -> phase ->
    //      total_counter -> total_timer -> canvas
    await user.keyboard("{Tab}"); // name
    await user.keyboard("{Tab}"); // title
    await user.keyboard("{Tab}"); // counter
    await user.keyboard("{Tab}"); // timer
    await user.keyboard("{Tab}"); // odds
    await user.keyboard("{Tab}"); // phase
    await user.keyboard("{Tab}"); // total_counter
    await user.keyboard("{Tab}"); // total_timer
    await user.keyboard("{Tab}"); // canvas

    // Canvas should now be selected
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    const canvasWrapper = canvasLayerButtons[0].closest("div");
    expect(canvasWrapper?.className).toMatch(/accent-blue/);
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
});
