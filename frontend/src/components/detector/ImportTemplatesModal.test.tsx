import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, userEvent, fireEvent, makeAppState, makePokemon } from "../../test-utils";
import { ImportTemplatesModal } from "./ImportTemplatesModal";
import { useCounterStore } from "../../hooks/useCounterState";
import type { DetectorConfig, DetectorTemplate } from "../../types";

// jsdom does not implement HTMLDialogElement.showModal/close — stub them so the
// dialog behaves like a real native modal (toggling the `open` attribute) and
// existing screen queries keep working without needing `{ hidden: true }`.
HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
});
HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute("open");
});

/** Helper to build a minimal DetectorTemplate with required fields. */
function makeTemplate(overrides?: Partial<DetectorTemplate>): DetectorTemplate {
  return { image_path: "", regions: [], name: "tpl", enabled: true, ...overrides };
}

/** Helper to build a minimal DetectorConfig with required fields. */
function makeDetectorConfig(overrides?: Partial<DetectorConfig>): DetectorConfig {
  return {
    enabled: false,
    source_type: "screen_region",
    region: { x: 0, y: 0, w: 0, h: 0 },
    window_title: "",
    templates: [],
    change_threshold: 0.1,
    ...overrides,
  };
}

// Seed the Zustand store with test data before each test
beforeEach(() => {
  const state = makeAppState({
    pokemon: [
      makePokemon({
        id: "current",
        name: "Bisasam",
        detector_config: makeDetectorConfig({
          templates: [makeTemplate({ name: "T1" })],
        }),
      }),
      makePokemon({
        id: "source-1",
        name: "Glumanda",
        detector_config: makeDetectorConfig({
          templates: [
            makeTemplate({ name: "Fire1" }),
            makeTemplate({ name: "Fire2" }),
          ],
        }),
      }),
      makePokemon({
        id: "source-2",
        name: "Schiggy",
        detector_config: makeDetectorConfig({
          templates: [makeTemplate({ name: "Water1" })],
        }),
      }),
      // Pokemon with no templates should not appear
      makePokemon({
        id: "no-templates",
        name: "Pikachu",
        detector_config: makeDetectorConfig({ templates: [] }),
      }),
    ],
  });
  useCounterStore.setState({ appState: state });
  vi.mocked(HTMLDialogElement.prototype.showModal).mockClear();
  vi.mocked(HTMLDialogElement.prototype.close).mockClear();
});

describe("ImportTemplatesModal", () => {
  it("renders modal with search input", () => {
    render(
      <ImportTemplatesModal
        currentPokemonId="current"
        onImport={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("shows pokemon list excluding current pokemon", () => {
    render(
      <ImportTemplatesModal
        currentPokemonId="current"
        onImport={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Glumanda and Schiggy should be visible (they have templates)
    expect(screen.getByText("Glumanda")).toBeInTheDocument();
    expect(screen.getByText("Schiggy")).toBeInTheDocument();
    // Current pokemon (Bisasam) should not appear, nor Pikachu (no templates)
    expect(screen.queryByText("Bisasam")).not.toBeInTheDocument();
    expect(screen.queryByText("Pikachu")).not.toBeInTheDocument();
  });

  it("filters pokemon by search term", async () => {
    const user = userEvent.setup();
    render(
      <ImportTemplatesModal
        currentPokemonId="current"
        onImport={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const searchInput = screen.getByRole("textbox");
    await user.type(searchInput, "Glum");

    expect(screen.getByText("Glumanda")).toBeInTheDocument();
    expect(screen.queryByText("Schiggy")).not.toBeInTheDocument();
  });

  it("calls onImport when a pokemon import button is clicked", async () => {
    const onImport = vi.fn();
    const user = userEvent.setup();
    render(
      <ImportTemplatesModal
        currentPokemonId="current"
        onImport={onImport}
        onClose={vi.fn()}
      />,
    );

    // The import button has an aria-label like "Templates importieren Glumanda"
    const importBtn = screen.getAllByRole("button").find((btn) => {
      const label = btn.getAttribute("aria-label") ?? "";
      return label.includes("Glumanda") && label.toLowerCase().includes("import");
    });
    expect(importBtn).toBeDefined();
    if (!importBtn) throw new Error("Import button not found");
    await user.click(importBtn);

    expect(onImport).toHaveBeenCalledWith("source-1");
  });

  it("calls onClose when close button clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <ImportTemplatesModal
        currentPokemonId="current"
        onImport={vi.fn()}
        onClose={onClose}
      />,
    );

    // The X close button has aria-label matching the close key
    const closeBtn = screen.getAllByRole("button").find((btn) => {
      const label = btn.getAttribute("aria-label") ?? "";
      return label.toLowerCase().includes("schließen") || label.toLowerCase().includes("close");
    });
    expect(closeBtn).toBeDefined();
    if (!closeBtn) throw new Error("Close button not found");
    await user.click(closeBtn);

    // onClose is deferred until the dialog's close transition finishes (or
    // the hook's fallback timeout fires — jsdom doesn't run real CSS
    // transitions), not called in the same tick as the click.
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("closes modal on Escape key press (native dialog cancel event)", async () => {
    const onClose = vi.fn();
    render(
      <ImportTemplatesModal currentPokemonId="current" onImport={vi.fn()} onClose={onClose} />,
    );
    // Pressing Escape on an open native <dialog> fires a `cancel` event;
    // jsdom doesn't implement this automatically, so we simulate it directly.
    // The modal is rendered via createPortal into document.body.
    const dialog = document.querySelector("dialog");
    expect(dialog).not.toBeNull();
    dialog!.dispatchEvent(new Event("cancel", { bubbles: true }));
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("shows no search results when search matches nothing", async () => {
    const user = userEvent.setup();
    render(
      <ImportTemplatesModal currentPokemonId="current" onImport={vi.fn()} onClose={vi.fn()} />,
    );
    await user.type(screen.getByRole("textbox"), "NonExistentPokemon");
    expect(screen.getByText(/detector.noSearchResults|Keine Ergebnisse/i)).toBeInTheDocument();
  });

  it("shows no import sources when no candidates exist", () => {
    useCounterStore.setState({
      appState: makeAppState({
        pokemon: [makePokemon({ id: "current", name: "Bisasam" })],
      }),
    });
    render(
      <ImportTemplatesModal currentPokemonId="current" onImport={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/detector.noImportSources|Kein|keine/i)).toBeInTheDocument();
  });

  it("expands pokemon to show template previews", async () => {
    const user = userEvent.setup();
    render(
      <ImportTemplatesModal currentPokemonId="current" onImport={vi.fn()} onClose={vi.fn()} />,
    );
    const expandBtn = screen.getByLabelText(/Glumanda.*2 Templates/);
    await user.click(expandBtn);
    const imgs = screen.getAllByRole("img");
    const templateImgs = imgs.filter((i) => i.getAttribute("alt")?.includes("Fire"));
    expect(templateImgs.length).toBeGreaterThan(0);
  });

  it("collapses expanded pokemon on second click", async () => {
    const user = userEvent.setup();
    render(
      <ImportTemplatesModal currentPokemonId="current" onImport={vi.fn()} onClose={vi.fn()} />,
    );
    const expandBtn = screen.getByLabelText(/Glumanda.*2 Templates/);
    await user.click(expandBtn); // expand
    // Verify template images are shown
    expect(screen.getAllByRole("img").filter((i) => i.getAttribute("alt")?.includes("Fire")).length).toBeGreaterThan(0);
    await user.click(expandBtn); // collapse
    // Template images should no longer be visible
    const fireImgs = screen.queryAllByRole("img").filter((i) => i.getAttribute("alt") === "Fire1");
    expect(fireImgs.length).toBe(0);
  });

  it("imports individual template from expanded view", async () => {
    const onImport = vi.fn();
    const user = userEvent.setup();
    render(
      <ImportTemplatesModal currentPokemonId="current" onImport={onImport} onClose={vi.fn()} />,
    );
    const expandBtn = screen.getByLabelText(/Glumanda.*2 Templates/);
    await user.click(expandBtn);
    // Click on a template preview button (has aria-label with "importieren")
    const singleImport = screen.getAllByRole("button").find(
      (btn) => btn.getAttribute("aria-label")?.includes("Fire1 importieren"),
    );
    expect(singleImport).toBeDefined();
    if (singleImport) {
      await user.click(singleImport);
      expect(onImport).toHaveBeenCalledWith("source-1", [0]);
    }
  });

  it("shows singular Template for pokemon with one template", () => {
    render(
      <ImportTemplatesModal currentPokemonId="current" onImport={vi.fn()} onClose={vi.fn()} />,
    );
    // Schiggy has 1 template
    expect(screen.getByText("1 Template")).toBeInTheDocument();
  });

  it("shows plural Templates for pokemon with multiple templates", () => {
    render(
      <ImportTemplatesModal currentPokemonId="current" onImport={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText("2 Templates")).toBeInTheDocument();
  });

  it("shows disabled template with opacity style when enabled is false", async () => {
    const user = userEvent.setup();
    // Override store with a pokemon that has a disabled template
    useCounterStore.setState({
      appState: makeAppState({
        pokemon: [
          makePokemon({ id: "current", name: "Bisasam" }),
          makePokemon({
            id: "source-disabled",
            name: "Gengar",
            detector_config: makeDetectorConfig({
              templates: [
                makeTemplate({ name: "Disabled1", enabled: false }),
                makeTemplate({ name: "Enabled1", enabled: true }),
              ],
            }),
          }),
        ],
      }),
    });
    render(
      <ImportTemplatesModal currentPokemonId="current" onImport={vi.fn()} onClose={vi.fn()} />,
    );
    const expandBtn = screen.getByLabelText(/Gengar.*2 Templates/);
    await user.click(expandBtn);
    // Disabled template button should have opacity-70 class
    const disabledBtn = screen.getByTitle("Disabled1 importieren");
    expect(disabledBtn.className).toContain("opacity-70");
    // Enabled template button should have ring-1 class
    const enabledBtn = screen.getByTitle("Enabled1 importieren");
    expect(enabledBtn.className).toContain("ring-1");
  });

  it("shows fallback name when template has no name", async () => {
    const user = userEvent.setup();
    useCounterStore.setState({
      appState: makeAppState({
        pokemon: [
          makePokemon({ id: "current", name: "Bisasam" }),
          makePokemon({
            id: "source-noname",
            name: "Haunter",
            detector_config: makeDetectorConfig({
              templates: [makeTemplate({ name: "" })],
            }),
          }),
        ],
      }),
    });
    render(
      <ImportTemplatesModal currentPokemonId="current" onImport={vi.fn()} onClose={vi.fn()} />,
    );
    const expandBtn = screen.getByLabelText(/Haunter.*1 Template/);
    await user.click(expandBtn);
    // Should show "Template 1" as fallback name
    expect(screen.getByText("Template 1")).toBeInTheDocument();
  });

  it("closes modal when backdrop is clicked", async () => {
    const onClose = vi.fn();
    render(
      <ImportTemplatesModal currentPokemonId="current" onImport={vi.fn()} onClose={onClose} />,
    );
    // On a native <dialog>, a click whose target is the dialog element itself
    // lands on the ::backdrop area; the shared modal hook closes on it.
    const dialog = document.querySelector("dialog");
    expect(dialog).not.toBeNull();
    fireEvent.click(dialog!);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
