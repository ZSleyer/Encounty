/**
 * DexSpeciesDetail.facts.test.tsx: the aggregate card over every catch of one
 * species, meaning the counts, the date range, the game chips and the control
 * that leads to the full list.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, makePokemon } from "../../test-utils";
import { DexSpeciesDetail, type DexSpeciesDetailProps } from "./DexSpeciesDetail";
import type { GameEntry, Pokemon } from "../../types";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useNavigate: () => navigateMock };
});

// The catch-reference catalogs are fetched by CatchMetaSummary.
vi.stubGlobal(
  "fetch",
  vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })),
);

const GAMES: GameEntry[] = [
  {
    key: "pokemon-scarlet",
    names: { de: "Karmesin", en: "Scarlet" },
    generation: 9,
    platform: "switch",
  },
];

function caught(overrides: Partial<Pokemon> = {}): Pokemon {
  return makePokemon({
    id: "c1",
    name: "Vulpix",
    canonical_name: "vulpix",
    completed_at: "2026-02-01T10:00:00Z",
    is_active: false,
    game: "pokemon-scarlet",
    hunt_type: "encounter",
    encounters: 512,
    ...overrides,
  });
}

function renderDetail(
  catches: Pokemon[],
  snapshot: Pokemon[] = catches,
  extra: Partial<DexSpeciesDetailProps> = {},
) {
  return render(
    <DexSpeciesDetail
      id={37}
      canonical="vulpix"
      name="Vulpix"
      generation={1}
      catches={catches}
      snapshot={snapshot}
      games={GAMES}
      languages={["de", "en"]}
      nameLanguage="de"
      caught={catches.length > 0}
      overrides={[]}
      setOverride={vi.fn()}
      {...extra}
    />,
  );
}

/** The inline card of the newest catch, the only one the summary shows. */
function latestCatch(): HTMLElement {
  return screen.getByRole("region", { name: "Neuester Fang" });
}

/** The value of one labeled fact inside a card. */
function fact(scope: HTMLElement, label: string): string {
  return within(scope).getByText(label).nextElementSibling?.textContent ?? "";
}

describe("DexSpeciesDetail", () => {
  beforeEach(() => {
    navigateMock.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })),
    );
  });

  it("shows only the newest catch inline, whatever sits behind it", () => {
    renderDetail([
      caught({ id: "new", form_name: "Neu", completed_at: "2026-03-01T00:00:00Z" }),
      caught({ id: "old", form_name: "Alt", completed_at: "2026-01-01T00:00:00Z" }),
    ]);

    expect(within(latestCatch()).getByText("Neu")).toBeInTheDocument();
    expect(screen.queryByText("Alt")).not.toBeInTheDocument();
  });

  it("aggregates count, forms and the date range over every catch", () => {
    renderDetail([
      caught({ id: "new", form_name: "Alola-Form", completed_at: "2026-03-01T00:00:00Z" }),
      caught({ id: "mid", completed_at: "2026-02-01T00:00:00Z" }),
      caught({ id: "old", completed_at: "2026-01-01T00:00:00Z" }),
    ]);

    expect(fact(document.body, "Fänge")).toBe("3");
    expect(fact(document.body, "Formen")).toBe("2");
    expect(fact(document.body, "Erster Fang")).toBe(
      new Date("2026-01-01T00:00:00Z").toLocaleDateString("de"),
    );
    expect(fact(document.body, "Letzter Fang")).toBe(
      new Date("2026-03-01T00:00:00Z").toLocaleDateString("de"),
    );
  });

  it("reports catches and evolutions into the slot separately", () => {
    renderDetail([
      caught({ id: "own" }),
      caught({
        id: "evolved",
        canonical_name: "bulbasaur",
        catch: { evolutions: [{ canonical_name: "vulpix" }] },
      }),
    ]);

    expect(fact(document.body, "Fänge")).toBe("1");
    expect(fact(document.body, "Entwickelt")).toBe("1");
  });

  it("hides the evolved fact when nothing evolved into the slot", () => {
    renderDetail([caught()]);

    expect(screen.queryByText("Entwickelt")).not.toBeInTheDocument();
  });

  it("counts a living-dex projection as an evolution rather than a catch", () => {
    renderDetail([
      caught({
        id: "evolved",
        canonical_name: "bulbasaur",
        catch: { evolutions: [{ canonical_name: "vulpix" }] },
      }),
    ]);

    expect(fact(document.body, "Fänge")).toBe("0");
    expect(fact(document.body, "Entwickelt")).toBe("1");
  });

  it("drops the first-catch date when it would only repeat the last one", () => {
    renderDetail([caught()]);

    expect(screen.queryByText("Erster Fang")).not.toBeInTheDocument();
    expect(screen.getByText("Letzter Fang")).toBeInTheDocument();
  });

  it("collapses a long game list to the newest few plus a count", () => {
    const games: GameEntry[] = [
      ...GAMES,
      { key: "g2", names: { de: "Rot" }, generation: 1, platform: "gb" },
      { key: "g3", names: { de: "Blau" }, generation: 1, platform: "gb" },
      { key: "g4", names: { de: "Gelb" }, generation: 1, platform: "gb" },
      { key: "g5", names: { de: "Gold" }, generation: 2, platform: "gbc" },
    ];
    render(
      <DexSpeciesDetail
        id={37}
        canonical="vulpix"
        name="Vulpix"
        generation={1}
        catches={games.map((game, i) => caught({ id: `c${i}`, game: game.key }))}
        snapshot={[]}
        games={games}
        languages={["de", "en"]}
        nameLanguage="de"
        caught={true}
        overrides={[]}
        setOverride={vi.fn()}
      />,
    );

    const chips = [...(screen.getByText("Spiele").nextElementSibling?.children ?? [])].map(
      (chip) => chip.textContent,
    );
    // The two oldest games only survive as a count, never as silent omissions.
    expect(chips).toEqual(["Karmesin", "Rot", "Blau", "+2 weitere"]);
    expect(screen.queryByText("Gelb")).not.toBeInTheDocument();
  });

  it("hides the catch-list control for a single catch", () => {
    renderDetail([caught()], [caught()], { onShowAllCatches: vi.fn() });

    expect(screen.queryByRole("button", { name: /Fänge anzeigen/ })).not.toBeInTheDocument();
  });

  it("names the catch count on the control that opens the list", () => {
    const onShowAllCatches = vi.fn();
    renderDetail([caught({ id: "a" }), caught({ id: "b" }), caught({ id: "c" })], [], {
      onShowAllCatches,
    });

    const control = screen.getByRole("button", { name: "Alle 3 Fänge anzeigen" });
    fireEvent.click(control);

    expect(onShowAllCatches).toHaveBeenCalledTimes(1);
  });
});
