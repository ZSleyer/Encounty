/**
 * DexPage.badges.test.tsx: what a slot puts on itself, meaning the catch-count
 * badge, the form badge and the progress totals behind them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within, makeAppState, makePokemon } from "../test-utils";
import { useCounterStore } from "../hooks/useCounterState";
import { DexPage } from "./DexPage";
import type { GameEntry, Pokemon } from "../types";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

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
  {
    key: "pokemon-scarlet",
    names: { de: "Karmesin", en: "Scarlet" },
    generation: 9,
    platform: "switch",
  },
];

/** Serves the two catalogs DexPage pulls on mount; everything else is empty. */
function stubFetch(games: GameEntry[] = GAMES, pokedex: unknown[] = POKEDEX) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/api/pokedex") ? pokedex : url.includes("/api/games") ? games : [];
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

/**
 * Renders the page with the given archive and waits until the fetched
 * catalogs and the default selection they feed have both landed.
 */
async function renderDex(pokemon: Pokemon[]) {
  useCounterStore.setState({ appState: makeAppState({ pokemon }) });
  await act(async () => {
    render(<DexPage />);
  });
  await screen.findByRole("heading", { name: /Generation 1/ });
}

/** The species slot button of one dex number (not one of its form slots). */
function slot(id: number): HTMLElement {
  return document.querySelector(`[data-dex-slot-key="${id}"]`) as HTMLElement;
}

/**
 * The badge counts catches, not forms. It is a decorative shorthand for the
 * accessible name, so every case asserts both: a sighted hunter seeing "×2"
 * while a screen reader hears a different number is the WCAG 1.3.1 parity
 * defect these tests pin down.
 */
describe("DexPage catch-count badge", () => {
  beforeEach(() => {
    stubFetch();
    stubWideViewport();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useCounterStore.setState({ appState: null });
  });

  it("stays silent on a first catch that happens to be a form", async () => {
    // The case the old "+1" chip got wrong: exactly one catch sits on the
    // slot, so there is nothing for it to be "plus one" of.
    await renderDex([
      completed({ id: "c51a", name: "Digdri (Alola)", canonical_name: "dugtrio-alola" }),
    ]);

    expect(within(slot(51)).queryByText(/^×\d+$/)).toBeNull();
    expect(slot(51)).not.toHaveAccessibleName(/Fänge/);
    expect(slot(51)).not.toHaveAccessibleName(/Formen/);
  });

  it("badges and announces two catches", async () => {
    await renderDex([
      completed({ id: "c6x", name: "Glurak X", canonical_name: "charizard-mega-x" }),
      completed({ id: "c6y", name: "Glurak Y", canonical_name: "charizard-mega-y" }),
    ]);

    expect(within(slot(6)).queryByText("×2")).toBeNull();
    expect(slot(6)).not.toHaveAccessibleName(/Fänge/);
    expect(slot(6)).not.toHaveAccessibleName(/Formen/);
  });

  it("keeps the badge out of the row the species name occupies", async () => {
    await renderDex([
      completed({ id: "c6x", name: "Glurak X", canonical_name: "charizard-mega-x" }),
      completed({ id: "c6y", name: "Glurak Y", canonical_name: "charizard-mega-y" }),
    ]);

    expect(within(slot(6)).queryByText("×2")).toBeNull();
    expect(within(slot(6)).getByText("Glurak")).toBeInTheDocument();
  });

  it("neither badges nor miscounts a single base-species catch", async () => {
    await renderDex([CHARIZARD]);

    expect(within(slot(6)).queryByText(/^×\d+$/)).toBeNull();
    expect(slot(6)).not.toHaveAccessibleName(/Formen/);
  });
});

describe("DexPage form progress", () => {
  beforeEach(() => {
    stubFetch();
    stubWideViewport();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useCounterStore.setState({ appState: null });
  });

  it("removes hidden forms from the overall and generation totals", async () => {
    await renderDex([
      completed({ id: "c6x", name: "Glurak X", canonical_name: "charizard-mega-x" }),
    ]);

    expect(screen.getByText("1 von 7")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "Formen" }));
    });

    expect(screen.getByText("0 von 4")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Generation 1.*0\/4/ })).toBeInTheDocument();
    expect(within(slot(6)).getByText("Formen 1")).toHaveAttribute("title", "Formen mit Eintrag");
    expect(slot(6)).toHaveAccessibleName(/Formen mit Eintrag: 1/);
  });
});
