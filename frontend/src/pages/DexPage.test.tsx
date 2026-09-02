/**
 * DexPage.test.tsx: the master-detail behavior of the Pokédex page, meaning
 * which species the panel shows and how the selection follows the grid.
 *
 * The catalog fixtures and render helpers below are per file: every split
 * DexPage suite carries the ones its own cases rely on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, makeAppState, makePokemon } from "../test-utils";
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
const DUGTRIO = completed({ id: "c51", name: "Digdri", canonical_name: "dugtrio" });

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

/** The species the detail panel currently shows. */
function panelHeading(): string {
  const heading = screen
    .getAllByRole("heading", { level: 2 })
    .find((el) => !el.textContent?.startsWith("Generation"));
  return heading?.textContent ?? "";
}

/** The species slot button of one dex number (not one of its form slots). */
function slot(id: number): HTMLElement {
  return document.querySelector(`[data-dex-slot-key="${id}"]`) as HTMLElement;
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

    expect(panelHeading()).toBe("Glurak");
    expect(document.querySelector('[data-dex-slot-key="6:charizard-mega-x"]')).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("keeps showing a selection that a filter hides", async () => {
    await renderDex([CHARIZARD]);

    fireEvent.click(screen.getByRole("radio", { name: "Fehlend" }));

    expect(slot(6)).toBeNull();
    expect(panelHeading()).toBe("Glurak");
  });
});
