import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  makeAppState,
  makePokemon,
} from "../test-utils";
import { useCounterStore } from "../hooks/useCounterState";
import { getGameName } from "../utils/games";
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
  { key: "pokemon-scarlet", names: { de: "Karmesin", en: "Scarlet" }, generation: 9, platform: "switch" },
];

/**
 * The game catalogue the app actually ships. Reading it instead of restating
 * it keeps "caught in every game" honest: a game added to the backend widens
 * this fixture on its own instead of quietly leaving a hole in the coverage.
 */
function shippedGames(): GameEntry[] {
  // vitest runs in frontend/, the sibling of backend/, but a run from the
  // repo root has to find the file too.
  const candidates = [
    "../backend/internal/gamesync/fallback_games.json",
    "backend/internal/gamesync/fallback_games.json",
  ];
  const path = candidates.map((rel) => resolve(process.cwd(), rel)).find(existsSync);
  expect(path, `fallback_games.json not found, tried ${candidates.join(" and ")}`).toBeDefined();
  const raw = JSON.parse(readFileSync(path!, "utf8")) as Record<string, Omit<GameEntry, "key">>;
  return Object.entries(raw).map(([key, entry]) => ({ key, ...entry }));
}

/** Serves the two catalogues DexPage pulls on mount; everything else is empty. */
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

/** The species slot button of one dex number (not one of its form slots). */
function slot(id: number): HTMLElement {
  return document.querySelector(`[data-dex-slot-key="${id}"]`) as HTMLElement;
}

/** The control that opens the catch list of the selected species, if any. */
function showAllControl(): HTMLElement | null {
  return screen.queryByRole("button", { name: /^Alle \d+ Fänge anzeigen$/ });
}

/**
 * Opens the catch list of the selected species and returns its cards. The
 * panel is a species summary now, so this dialog is the only surface that
 * carries the individual catches.
 */
async function openCatchList(): Promise<HTMLElement[]> {
  await act(async () => {
    fireEvent.click(showAllControl()!);
  });
  return within(screen.getByRole("dialog")).getAllByRole("listitem");
}

/** Closes the catch-list dialog and waits for the close transition. */
async function closeCatchList(): Promise<void> {
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Schließen" }));
  // Queried on the element, not the role: closing drops the `open` attribute
  // long before the CRT transition lets the dialog actually unmount, and the
  // focus only comes back once it has.
  await waitFor(() => expect(document.querySelector("dialog")).toBeNull());
}

/** The inline card of the newest catch inside the detail panel. */
function inlineCatch(): HTMLElement {
  return screen.getByRole("region", { name: "Neuester Fang" });
}

/** The value of one labelled fact inside a catch card. */
function fact(card: HTMLElement, label: string): string {
  return within(card).getByText(label).nextElementSibling?.textContent ?? "";
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
    expect(document.querySelector('[data-dex-slot-key="6:charizard-mega-x"]')).toHaveAttribute("aria-current", "true");
  });

  it("keeps showing a selection that a filter hides", async () => {
    await renderDex([CHARIZARD]);

    fireEvent.click(screen.getByRole("radio", { name: "Fehlend" }));

    expect(slot(6)).toBeNull();
    expect(panelHeading()).toBe("Glurak");
  });
});

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

/**
 * A slot is a species, never a catch. Whatever collapses onto it has to stay
 * reachable one by one, and since the panel became a species summary the catch
 * list dialog is the surface that has to carry them.
 */
describe("DexPage multi-catch slots", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useCounterStore.setState({ appState: null });
  });

  it("offers no catch list for a species caught exactly once", async () => {
    stubFetch();
    stubWideViewport();
    await renderDex([CHARIZARD]);

    // The inline catch already is the whole story; a "1 catch" control would
    // promise a list that does not exist.
    expect(showAllControl()).toBeNull();
    expect(fact(inlineCatch(), "Spiel")).toBe("Karmesin");
  });

  it("returns the focus to the control that opened the catch list", async () => {
    stubFetch();
    stubWideViewport();
    await renderDex([
      completed({ id: "c6a", name: "Glurak", canonical_name: "charizard" }),
      completed({ id: "c6b", name: "Glurak", canonical_name: "charizard" }),
    ]);

    const control = showAllControl()!;
    await act(async () => {
      fireEvent.click(control);
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await closeCatchList();
    expect(control).toHaveFocus();
  });

  it("keeps repeated catches of one species in one game separately reachable", async () => {
    stubFetch();
    stubWideViewport();
    // Same species, same game, same form: three cards that differ in nothing
    // but their encounters, their date and their recorded location.
    await renderDex([
      completed({
        id: "c6a",
        name: "Glurak",
        canonical_name: "charizard",
        completed_at: "2026-03-01T00:00:00Z",
        encounters: 111,
        catch: { location: "Route 1" },
      }),
      completed({
        id: "c6b",
        name: "Glurak",
        canonical_name: "charizard",
        completed_at: "2026-02-01T00:00:00Z",
        encounters: 222,
        catch: { location: "Route 2" },
      }),
      completed({
        id: "c6c",
        name: "Glurak",
        canonical_name: "charizard",
        completed_at: "2026-01-01T00:00:00Z",
        encounters: 333,
        catch: { location: "Route 3" },
      }),
    ]);

    // One slot, counted once, badged with what sits behind it.
    expect(document.querySelectorAll('[data-dex-slot-key="6"]')).toHaveLength(1);
    expect(within(slot(6)).getByText("Fänge 3")).toBeInTheDocument();
    expect(slot(6)).toHaveAccessibleName(/Fänge: 3/);
    expect(screen.getByText("1 von 7")).toBeInTheDocument();

    // The panel stays calm: one summary, the newest catch inline, one control
    // naming the count that leads to the rest.
    expect(fact(inlineCatch(), "Encounter")).toBe("111");
    expect(showAllControl()).toHaveAccessibleName("Alle 3 Fänge anzeigen");

    const cards = await openCatchList();
    expect(cards).toHaveLength(3);
    // Newest first, and every card names its own form and source game.
    expect(cards.map((card) => fact(card, "Encounter"))).toEqual(["111", "222", "333"]);
    expect(cards.map((card) => fact(card, "Spiel"))).toEqual(["Karmesin", "Karmesin", "Karmesin"]);
    for (const [i, card] of cards.entries()) {
      expect(within(card).getByText("Standardform")).toBeInTheDocument();
      expect(within(card).getByText(`Route ${i + 1}`)).toBeInTheDocument();
      expect(within(card).getByRole("button", { name: "Im Dashboard öffnen" })).toBeInTheDocument();
      expect(within(card).getByRole("button", { name: "Details bearbeiten" })).toBeInTheDocument();
    }

    // The pencil of the middle card has to open the middle catch. Addressing
    // the cards by name alone would open the newest one every time.
    fireEvent.click(within(cards[1]).getByRole("button", { name: "Details bearbeiten" }));

    // The catch list closes itself first, so the two dialogs never overlap.
    await waitFor(() => expect(screen.getByLabelText("Fundort")).toHaveValue("Route 2"));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("holds one species caught in every shipped game on a single slot", async () => {
    const allGames = shippedGames();
    expect(allGames).toHaveLength(54);
    stubFetch(allGames);
    stubWideViewport();

    // One catch per game, dated so that the panel order matches the catalogue.
    const perGame = allGames.map((game, i) =>
      completed({
        id: `c6-${game.key}`,
        name: "Glurak",
        canonical_name: "charizard",
        game: game.key,
        completed_at: new Date(Date.UTC(2026, 0, 1) - i * 86_400_000).toISOString(),
      }),
    );
    await renderDex(perGame);

    // National mode counts the species once, no matter how many games it came
    // from, and the badge states the number of catches behind the slot.
    expect(document.querySelectorAll('[data-dex-slot-key="6"]')).toHaveLength(1);
    expect(within(slot(6)).getByText("Fänge 54")).toBeInTheDocument();
    expect(slot(6)).toHaveAccessibleName(/Fänge: 54/);
    expect(screen.getByText("1 von 7")).toBeInTheDocument();

    // 54 catches collapse into one summary card. The game list is capped, so
    // the panel never grows with the archive.
    expect(showAllControl()).toHaveAccessibleName("Alle 54 Fänge anzeigen");
    const chips = [...(screen.getByText("Spiele").nextElementSibling?.children ?? [])];
    expect(chips).toHaveLength(4);
    expect(chips[3].textContent).toBe("+51 weitere");

    // Every single catch is still rendered, each carrying the game it came
    // from. Eight of the shipped keys are legacy aliases sharing a display
    // name, so the cards are compared positionally rather than as a set.
    const cards = await openCatchList();
    expect(cards).toHaveLength(54);
    expect(cards.map((card) => fact(card, "Spiel"))).toEqual(
      allGames.map((game) => getGameName(game, ["de", "en"])),
    );
    // The whole list is one scrollport, and no card is parked out of the tab
    // order behind a collapsed section.
    for (const card of cards) {
      expect(within(card).getByRole("button", { name: "Im Dashboard öffnen" })).toBeEnabled();
    }
    await closeCatchList();

    // Per-game mode surfaces exactly the one catch belonging to that game,
    // which drops the control along with the list behind it.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Spiel" }));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Spiel wählen"), {
        target: { value: "pokemon-scarlet" },
      });
    });

    expect(showAllControl()).toBeNull();
    expect(fact(inlineCatch(), "Spiel")).toBe("Pokémon Karmesin");
    expect(within(slot(6)).queryByText(/^×\d+$/)).toBeNull();
  });
});

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
      completed({ id: "c6", name: "Glurak", canonical_name: "charizard", catch: { shiny_variant: "square" } }),
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
