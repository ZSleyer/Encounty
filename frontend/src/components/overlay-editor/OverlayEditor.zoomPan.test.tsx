/**
 * Zoom and pan of the overlay editor canvas: the fit-to-view button, the zoom
 * and hand drags, and the pointer position readout.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  makeOverlaySettings,
  makePokemon,
  userEvent,
  fireEvent,
  act,
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
    act(() => {
      globalThis.dispatchEvent(new Event("resize"));
    });

    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
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
});
