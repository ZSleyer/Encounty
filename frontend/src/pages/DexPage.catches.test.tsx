/**
 * DexPage.catches.test.tsx: several catches on one slot, meaning the summary
 * panel, the catch-list dialog and the focus handling around it.
 */

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

/**
 * The game catalog the app actually ships. Reading it instead of restating
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

/** The value of one labeled fact inside a catch card. */
function fact(card: HTMLElement, label: string): string {
  return within(card).getByText(label).nextElementSibling?.textContent ?? "";
}

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

    // One catch per game, dated so that the panel order matches the catalog.
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
