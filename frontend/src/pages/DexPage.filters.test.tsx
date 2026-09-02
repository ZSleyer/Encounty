/**
 * DexPage.filters.test.tsx: the toolbar filters, meaning the shiny variant
 * select and which slots survive it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, makeAppState, makePokemon } from "../test-utils";
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

/** The species slot button of one dex number (not one of its form slots). */
function slot(id: number): HTMLElement {
  return document.querySelector(`[data-dex-slot-key="${id}"]`) as HTMLElement;
}

describe("DexPage shiny variant filter", () => {
  beforeEach(() => {
    stubFetch();
    stubWideViewport();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useCounterStore.setState({ appState: null });
  });

  it("stays hidden while no catch records a variant", async () => {
    await renderDex([CHARIZARD]);

    expect(screen.queryByRole("radiogroup", { name: /Shiny-Variante/i })).toBeNull();
  });

  it("keeps only the slots carrying the chosen variant", async () => {
    await renderDex([
      completed({
        id: "c6",
        name: "Glurak",
        canonical_name: "charizard",
        catch: { shiny_variant: "square" },
      }),
      DUGTRIO,
    ]);

    expect(slot(6)).toBeTruthy();
    expect(slot(51)).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Square" }));
    await waitFor(() => expect(slot(51)).toBeFalsy());
    expect(slot(6)).toBeTruthy();

    // A slot without a recorded variant is unknown, not "the other one".
    fireEvent.click(screen.getByRole("radio", { name: "Star" }));
    await waitFor(() => expect(slot(6)).toBeFalsy());
    expect(slot(51)).toBeFalsy();

    fireEvent.click(screen.getByRole("radio", { name: "Alle Varianten" }));
    await waitFor(() => expect(slot(51)).toBeTruthy());
  });
});
