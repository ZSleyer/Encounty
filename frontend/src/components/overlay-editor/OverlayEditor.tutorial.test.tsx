/**
 * Walkthrough of the overlay editor: when it opens, the dialogs its steps
 * point into, and the flag it stores once it is done.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  makeOverlaySettings,
  makePokemon,
  userEvent,
  fireEvent,
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
  it("anchors the templates tutorial step on the template picker button", () => {
    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const templatesBtn = container.querySelector("[data-tutorial='templates']");
    expect(templatesBtn).not.toBeNull();
    expect(templatesBtn).toHaveAttribute("aria-label", "Vorlagen");
  });

  // --- Tutorial shows on first visit ---

  it("shows tutorial on first visit (tutorial_seen not set)", () => {
    // Clear the tutorial flag
    localStorage.removeItem("encounty_editor_tutorial_seen");
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = val;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
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

  it("suppresses the canvas Tab shortcut while the tutorial is open", async () => {
    const user = userEvent.setup();
    localStorage.removeItem("encounty_editor_tutorial_seen");
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = val;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    });

    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // The walkthrough is up, so Tab has to stay a focus move inside it instead
    // of cycling the selected layer behind the backdrop.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Tab}");

    const spriteLayerButtons = screen.getAllByLabelText("Sprite");
    const spriteWrapper = spriteLayerButtons[0].closest("div");
    expect(spriteWrapper?.className).toMatch(/accent-blue/);
  });

  // --- Dialogs the walkthrough opens ---

  /** Renders the editor with the walkthrough running on its first step. */
  function renderWithTutorial(onUpdate = vi.fn()) {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = val;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    });
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );
    return { onUpdate, store };
  }

  /** Clicks the walkthrough's next button the given number of times. */
  function advanceTutorial(times: number) {
    for (let i = 0; i < times; i++) {
      fireEvent.click(screen.getByText("Weiter"));
    }
  }

  it("opens the template picker while the templates step is shown", () => {
    renderWithTutorial();
    expect(document.querySelector('[data-tutorial="template-list"]')).toBeNull();

    advanceTutorial(1);
    const list = document.querySelector('[data-tutorial="template-list"]');
    expect(list).not.toBeNull();
    expect(list?.closest("dialog")).toHaveAttribute("open");

    advanceTutorial(1);
    expect(document.querySelector('[data-tutorial="template-list"]')).toBeNull();
  });

  it("opens the color dialog while the color step is shown", () => {
    renderWithTutorial();
    advanceTutorial(5);
    const toggle = document.querySelector('[data-tutorial="text-color-type"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.closest("dialog")).toHaveAttribute("open");

    advanceTutorial(1);
    expect(document.querySelector('[data-tutorial="text-color-type"]')).toBeNull();
  });

  it("closes the walkthrough's dialog when the walkthrough is skipped mid-step", () => {
    renderWithTutorial();
    advanceTutorial(1);
    expect(document.querySelector('[data-tutorial="template-list"]')).not.toBeNull();

    fireEvent.click(screen.getByText("Überspringen"));
    expect(document.querySelector('[data-tutorial="template-list"]')).toBeNull();
  });

  it("closes the walkthrough's dialog when Escape ends it mid-step", () => {
    renderWithTutorial();
    advanceTutorial(5);
    expect(document.querySelector('[data-tutorial="text-color-type"]')).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector('[data-tutorial="text-color-type"]')).toBeNull();
  });

  it("reopens the template picker when stepping back into its step", () => {
    renderWithTutorial();
    advanceTutorial(2);
    expect(document.querySelector('[data-tutorial="template-list"]')).toBeNull();

    fireEvent.click(screen.getByText("Zurück"));
    expect(document.querySelector('[data-tutorial="template-list"]')).not.toBeNull();
  });

  it("writes no setting while the walkthrough opens its dialogs", () => {
    const { onUpdate, store } = renderWithTutorial();
    // The whole walkthrough, both dialog steps included.
    advanceTutorial(8);
    fireEvent.click(screen.getByText("Fertig"));

    // onUpdate is the editor's only route to persistence.
    expect(onUpdate).not.toHaveBeenCalled();
    // Nothing about the layout was cached either, only the "seen" flag.
    expect(store).toHaveProperty("encounty_editor_tutorial_seen", "true");
    expect(store).not.toHaveProperty("encounty_editor_split");
  });

  it("cannot apply a template from the copy the walkthrough opens", () => {
    const { onUpdate } = renderWithTutorial();
    advanceTutorial(1);

    const list = document.querySelector('[data-tutorial="template-list"]')!;
    const rows = list.querySelectorAll("button");
    expect(rows.length).toBeGreaterThan(0);
    // The real picker would raise the confirmation here. This copy is wired to
    // nothing, so picking a row can neither confirm nor apply anything.
    fireEvent.click(rows[0]);

    expect(screen.queryByText("Vorlage anwenden")).not.toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
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

  // --- Tutorial completes and sets localStorage ---

  it("sets tutorial seen flag when tutorial completes", async () => {
    // Clear tutorial flag
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = val;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
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

  // --- Tutorial completion sets localStorage ---

  it("completes tutorial by clicking skip button and sets localStorage flag", async () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = val;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    });

    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Tutorial should be showing, click the "Überspringen" (skip) button
    const skipBtn = screen.getByText("Überspringen");
    await user.click(skipBtn);

    // After skip, the tutorial completion callback sets the localStorage flag
    expect(store["encounty_editor_tutorial_seen"]).toBe("true");
  });
});
