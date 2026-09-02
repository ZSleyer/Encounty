/**
 * Divider between the properties pane and the layers list of the overlay
 * editor: dragging it, resizing it by keyboard and restoring a stored height.
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

  // --- Divider keyboard resize ---

  it("increases properties panel height on ArrowDown keydown", () => {
    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const dividerBtn = screen.getByLabelText(/Größe ändern/i);
    fireEvent.keyDown(dividerBtn, { key: "ArrowDown" });

    // Default height is 500px, one ArrowDown step increases it by 24px
    const propertiesSection = container.querySelector("[data-tutorial='properties']");
    expect((propertiesSection as HTMLElement).style.height).toBe("524px");
    expect(localStorage.getItem("encounty_editor_split")).toBe("524");
  });

  it("clamps properties panel height to the minimum on repeated ArrowUp keydown", () => {
    localStorage.setItem("encounty_editor_split", "110");

    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const dividerBtn = screen.getByLabelText(/Größe ändern/i);
    // Press ArrowUp repeatedly, well past enough presses to hit the 100px floor
    for (let i = 0; i < 5; i++) {
      fireEvent.keyDown(dividerBtn, { key: "ArrowUp" });
    }

    const propertiesSection = container.querySelector("[data-tutorial='properties']");
    expect((propertiesSection as HTMLElement).style.height).toBe("100px");
    expect(localStorage.getItem("encounty_editor_split")).toBe("100");
  });

  it("caps a stored split that does not fit the right column, leaving room for the layers panel", () => {
    // Regression guard for issue #48: on a short window (high Windows display
    // scaling) the stored 500px ate the whole column and collapsed the layers
    // panel to zero height.
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
    localStorage.setItem("encounty_editor_split", "500");

    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const propertiesSection = container.querySelector(
      "[data-tutorial='properties']",
    ) as HTMLElement;
    // jsdom measures everything as 0, so the column height has to be faked.
    Object.defineProperty(propertiesSection.parentElement as HTMLElement, "clientHeight", {
      value: 400,
      configurable: true,
    });
    act(() => notifyResize?.());

    // 400px column minus the divider and the layers panel minimum (24 + 140).
    expect(propertiesSection.style.height).toBe("236px");
    // The capped value must not overwrite what was chosen on a larger monitor.
    expect(localStorage.getItem("encounty_editor_split")).toBe("500");

    globalThis.ResizeObserver = OriginalResizeObserver;
  });

  // --- Stored split height from localStorage ---

  it("reads stored split height from localStorage", () => {
    const store: Record<string, string> = {
      encounty_editor_tutorial_seen: "true",
      encounty_editor_split: "350",
    };
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = val;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
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

  // --- Divider reset button resets to 500 ---

  it("resets divider height to 500 when divider reset button is clicked", async () => {
    const user = userEvent.setup();
    const store: Record<string, string> = {
      encounty_editor_tutorial_seen: "true",
      encounty_editor_split: "300",
    };
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = val;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
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
});
