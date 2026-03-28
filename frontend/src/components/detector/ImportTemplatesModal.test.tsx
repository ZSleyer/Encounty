import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent, makeAppState, makePokemon } from "../../test-utils";
import { ImportTemplatesModal } from "./ImportTemplatesModal";
import { useCounterStore } from "../../hooks/useCounterState";
import type { DetectorConfig, DetectorTemplate } from "../../types";

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
    precision: 0.8,
    consecutive_hits: 1,
    cooldown_sec: 5,
    change_threshold: 0.1,
    poll_interval_ms: 1000,
    min_poll_ms: 500,
    max_poll_ms: 5000,
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

    expect(onClose).toHaveBeenCalled();
  });
});
