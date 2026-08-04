import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within, makeAppState, makePokemon } from "../test-utils";
import { useCounterStore } from "../hooks/useCounterState";
import { DexPage } from "./DexPage";
import type { Pokemon } from "../types";

// The forms are what let a catch on "dugtrio-alola" resolve onto slot 51,
// which is the only way a slot can end up with a variant count at all.
const POKEDEX = [
  { id: 1, canonical: "bulbasaur", names: { de: "Bisasam", en: "Bulbasaur" } },
  { id: 4, canonical: "charmander", names: { de: "Glumanda", en: "Charmander" } },
  {
    id: 6,
    canonical: "charizard",
    names: { de: "Glurak", en: "Charizard" },
    forms: [
      { canonical: "charizard-mega-x", sprite_id: 10034 },
      { canonical: "charizard-mega-y", sprite_id: 10035 },
    ],
  },
  {
    id: 51,
    canonical: "dugtrio",
    names: { de: "Digdri", en: "Dugtrio" },
    forms: [{ canonical: "dugtrio-alola", sprite_id: 10114 }],
  },
];

const GAMES = [
  { key: "pokemon-scarlet", names: { de: "Karmesin", en: "Scarlet" }, generation: 9, platform: "switch" },
];

/** Serves the two catalogues DexPage pulls on mount; everything else is empty. */
function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/api/pokedex") ? POKEDEX : url.includes("/api/games") ? GAMES : [];
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    }),
  );
}

/** Reports the two-pane breakpoint as met, which jsdom cannot do on its own. */
function stubWideViewport() {
  vi.stubGlobal("matchMedia", (media: string) => ({
    media,
    matches: true,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

function completed(overrides: Partial<Pokemon>): Pokemon {
  return makePokemon({
    is_active: false,
    completed_at: "2026-02-01T10:00:00Z",
    game: "pokemon-scarlet",
    ...overrides,
  });
}

const CHARIZARD = completed({ id: "c6", name: "Glurak", canonical_name: "charizard" });
const DUGTRIO = completed({ id: "c51", name: "Digdri", canonical_name: "dugtrio" });

/**
 * Renders the page with the given archive and waits until the fetched
 * catalogues and the default selection they feed have both landed.
 */
async function renderDex(pokemon: Pokemon[]) {
  useCounterStore.setState({ appState: makeAppState({ pokemon }) });
  await act(async () => {
    render(<DexPage />);
  });
  await screen.findByRole("heading", { name: /Generation 1/ });
}

/** The species the detail panel currently shows. */
function panelHeading(): string {
  const heading = screen
    .getAllByRole("heading", { level: 2 })
    .find((el) => !el.textContent?.startsWith("Generation"));
  return heading?.textContent ?? "";
}

/** The slot button of one dex number. */
function slot(id: number): HTMLElement {
  return document.querySelector(`[data-dex-id="${id}"]`) as HTMLElement;
}

describe("DexPage detail panel", () => {
  beforeEach(() => {
    stubFetch();
    stubWideViewport();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useCounterStore.setState({ appState: null });
  });

  it("selects the first caught species in dex order by default", async () => {
    await renderDex([DUGTRIO, CHARIZARD]);

    expect(panelHeading()).toBe("Glurak");
    expect(screen.getByRole("region", { name: "Glurak" })).toBeInTheDocument();
  });

  it("falls back to the first species when nothing is caught", async () => {
    await renderDex([]);

    expect(panelHeading()).toBe("Bisasam");
  });

  it("marks only the selected slot with aria-current", async () => {
    await renderDex([CHARIZARD]);

    expect(slot(6)).toHaveAttribute("aria-current", "true");
    expect(slot(1)).not.toHaveAttribute("aria-current");
  });

  it("moves the selection to a clicked slot", async () => {
    await renderDex([CHARIZARD]);

    fireEvent.click(slot(51));

    expect(panelHeading()).toBe("Digdri");
    expect(slot(51)).toHaveAttribute("aria-current", "true");
    expect(slot(6)).not.toHaveAttribute("aria-current");
  });

  it("follows the arrow keys through the grid", async () => {
    await renderDex([CHARIZARD]);

    fireEvent.keyDown(slot(6), { key: "ArrowRight" });

    expect(panelHeading()).toBe("Digdri");
    expect(slot(51)).toHaveAttribute("aria-current", "true");
  });

  it("keeps showing a selection that a filter hides", async () => {
    await renderDex([CHARIZARD]);

    fireEvent.click(screen.getByRole("radio", { name: "Fehlend" }));

    expect(slot(6)).toBeNull();
    expect(panelHeading()).toBe("Glurak");
  });
});

/**
 * The chip and the aria label are two renderings of the same fact, so every
 * case asserts both. Sighted users seeing no chip while a screen reader hears
 * "Formen: 1" is the WCAG 1.3.1 parity defect these tests pin down.
 */
describe("DexPage variant chip", () => {
  beforeEach(() => {
    stubFetch();
    stubWideViewport();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useCounterStore.setState({ appState: null });
  });

  it("chips and announces a single caught form", async () => {
    // The everyday case: only the regional form was hunted. The slot still
    // paints the base species sprite, so the chip is the only visual hint
    // that what the hunter owns is a form.
    await renderDex([
      completed({ id: "c51a", name: "Digdri (Alola)", canonical_name: "dugtrio-alola" }),
    ]);

    expect(within(slot(51)).getByText("+1")).toBeInTheDocument();
    expect(slot(51)).toHaveAccessibleName(/Formen: 1/);
  });

  it("chips and announces two caught forms", async () => {
    await renderDex([
      completed({ id: "c6x", name: "Glurak X", canonical_name: "charizard-mega-x" }),
      completed({ id: "c6y", name: "Glurak Y", canonical_name: "charizard-mega-y" }),
    ]);

    expect(within(slot(6)).getByText("+2")).toBeInTheDocument();
    expect(slot(6)).toHaveAccessibleName(/Formen: 2/);
  });

  it("neither chips nor announces a form for a base-species catch", async () => {
    await renderDex([CHARIZARD]);

    expect(within(slot(6)).queryByText(/^\+\d+$/)).toBeNull();
    expect(slot(6)).not.toHaveAccessibleName(/Formen/);
  });
});
