/**
 * DexPage.grid.test.tsx: how the grid itself renders, meaning the sprite
 * fallback chain of a slot and the frame-by-frame generation mounting.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, makeAppState } from "../test-utils";
import { useCounterStore } from "../hooks/useCounterState";
import { SPRITE_FALLBACK, cachedSpriteSrc, getBoxSpriteUrl } from "../utils/sprites";
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

describe("DexPage sprite failures", () => {
  beforeEach(() => {
    stubFetch();
    stubWideViewport();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useCounterStore.setState({ appState: null });
  });

  // A sprite host that blips or throttles once must not cost the slot its
  // sprite for the rest of the session. The unloading observer restores from
  // data-dex-sprite, so that attribute has to survive the failure: React
  // never rewrites it on its own, the prop behind it does not change.
  it("keeps the real sprite URL after a failed load so it can be retried", async () => {
    await renderDex([]);

    const sprite = slot(1).querySelector("img") as HTMLImageElement;
    const real = sprite.dataset.dexSprite;
    expect(real).toMatch(/\.png$/);

    // First failure steps down to the Pokésprite box sprite, a handful of
    // cosmetic forms (e.g. "pikachu-starter") have no default PokeAPI pixel
    // sprite at all, only that one.
    fireEvent.error(sprite);
    expect(sprite.src).toMatch(/pokesprite/);
    expect(sprite.dataset.dexSprite).toBe(real);

    // Only a second failure (the box sprite missing too) falls back to the
    // placeholder glyph.
    fireEvent.error(sprite);
    expect(sprite.src).toBe(SPRITE_FALLBACK);
    expect(sprite.dataset.dexSprite).toBe(real);
  });

  // The sprite-cache URLs are relative wherever the backend shares the
  // renderer's origin, so `sprite.src` (absolute) can never equal the box URL
  // the handler compares against. Without the one-shot marker the chain would
  // then loop on the box sprite instead of reaching the placeholder.
  it("reaches the placeholder from a box sprite it did not set itself", async () => {
    await renderDex([]);

    const sprite = slot(1).querySelector("img") as HTMLImageElement;
    const boxUrl = cachedSpriteSrc(getBoxSpriteUrl("bulbasaur", "normal"));
    sprite.setAttribute("src", boxUrl);

    fireEvent.error(sprite);
    expect(sprite.src).toBe(SPRITE_FALLBACK);
  });

  // Pokésprite's set stops at Gen 8, so no Gen 9 slot has box art at all, and
  // the ride legendaries' builds and modes have no sprite of their own either.
  // Both steps 404 and the slot used to land on the placeholder glyph.
  it("falls back to the base species sprite on a form slot", async () => {
    await renderDex([]);

    const formSlot = document.querySelector('[data-dex-slot-key="6:charizard-mega-x"]');
    const sprite = formSlot!.querySelector("img") as HTMLImageElement;
    expect(decodeURIComponent(sprite.getAttribute("src")!)).toContain("/pokemon/10034.png");

    fireEvent.error(sprite);
    expect(sprite.src).toMatch(/pokesprite/);

    fireEvent.error(sprite);
    expect(decodeURIComponent(sprite.src)).toContain("/pokemon/6.png");

    fireEvent.error(sprite);
    expect(sprite.src).toBe(SPRITE_FALLBACK);
  });
});

describe("DexPage generation mounting", () => {
  beforeEach(() => {
    useCounterStore.setState({ appState: makeAppState({ pokemon: [] }) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useCounterStore.setState({ appState: null });
  });

  // The grid mounts one generation per frame so entering the tab does not
  // block on a single render of every slot. The ramp is only worth having if
  // it still arrives at the whole dex, and only correct if it never stops
  // early: a generation that never mounts is a species the user cannot reach.
  it("mounts every generation, not just the first", async () => {
    const across = [
      { id: 1, canonical: "bulbasaur", names: { de: "Bisasam", en: "Bulbasaur" } },
      { id: 152, canonical: "chikorita", names: { de: "Endivie", en: "Chikorita" } },
      { id: 252, canonical: "treecko", names: { de: "Geckarbor", en: "Treecko" } },
    ];
    stubFetch(GAMES, across);

    await act(async () => {
      render(<DexPage />);
    });

    // Generation 1 is up immediately; the rest follow over the next frames.
    await screen.findByRole("heading", { name: /Generation 1/ });
    await screen.findByRole("heading", { name: /Generation 2/ });
    await screen.findByRole("heading", { name: /Generation 3/ });

    for (const id of [1, 152, 252]) {
      expect(slot(id), `slot ${id} never mounted`).toBeTruthy();
    }
  });
});
