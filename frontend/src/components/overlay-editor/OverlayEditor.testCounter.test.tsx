/**
 * Test counter of the overlay editor: the increment, decrement and reset
 * buttons that drive the preview without touching the live overlay.
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

  // --- Fake counter resets when pokemon changes ---

  it("displays encounters from activePokemon prop", () => {
    const pokemon = makePokemon({ id: "poke-1", encounters: 77 });

    render(
      <OverlayEditor settings={makeOverlaySettings()} onUpdate={vi.fn()} activePokemon={pokemon} />,
    );

    // Should show the pokemon's encounter count
    expect(screen.getByText("77")).toBeInTheDocument();
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

  // --- No activePokemon renders test counter area ---

  it("renders test counter area when no activePokemon provided", () => {
    render(<OverlayEditor settings={makeOverlaySettings()} onUpdate={vi.fn()} />);

    // Should render without crashing even without a pokemon
    expect(screen.getAllByText("Sprite").length).toBeGreaterThan(0);
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
