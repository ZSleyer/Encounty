/**
 * DexSpeciesDetail.test.tsx: the species panel itself, meaning its header, its
 * empty state and the catch card of the newest catch.
 *
 * The mocks and fixtures below are per file: every split suite of this
 * component carries the ones its own cases rely on.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor, makePokemon } from "../../test-utils";
import { DexCatchList, DexSpeciesDetail, type DexSpeciesDetailProps } from "./DexSpeciesDetail";
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

/** The hunt-method fact of the inline catch card. */
function huntMethodText(): string {
  return fact(latestCatch(), "Hunt-Methode");
}

describe("DexSpeciesDetail", () => {
  beforeEach(() => {
    navigateMock.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })),
    );
  });

  it("shows the padded dex number and the generation chip", () => {
    renderDetail([]);

    expect(screen.getByText("#0037")).toBeInTheDocument();
    expect(screen.getByText("Generation 1")).toBeInTheDocument();
  });

  it("renders an uncaught species with the empty state", () => {
    renderDetail([]);

    expect(screen.getByText("Noch nicht gefangen")).toBeInTheDocument();
  });

  it("uses the latest evolved form sprite in the catch information", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const data = String(input).includes("/api/pokedex")
          ? [
              {
                id: 38,
                canonical: "ninetales",
                forms: [{ canonical: "ninetales-alola", sprite_id: 10104 }],
              },
            ]
          : [];
        return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
      }),
    );
    renderDetail([caught({ catch: { evolutions: [{ canonical_name: "ninetales-alola" }] } })]);

    await waitFor(() => expect(latestCatch().querySelector("img")?.src).toContain("10104"));
  });

  it("names the species in a heading a wrapper can label itself with", () => {
    render(
      <DexSpeciesDetail
        id={37}
        canonical="vulpix"
        name="Vulpix"
        generation={1}
        catches={[]}
        snapshot={[]}
        games={GAMES}
        languages={["de", "en"]}
        nameLanguage="de"
        headingId="panel-heading"
        caught={false}
        overrides={[]}
        setOverride={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Vulpix" })).toHaveAttribute("id", "panel-heading");
  });

  it("labels a base-species catch as the default form", () => {
    renderDetail([caught()]);

    expect(screen.getByText("Standardform")).toBeInTheDocument();
  });

  it("shows a catch nickname instead of its normal form name", () => {
    renderDetail([caught({ nickname: "Sparky" })]);

    expect(within(latestCatch()).getByText("Sparky")).toBeInTheDocument();
    expect(within(latestCatch()).queryByText("Standardform")).not.toBeInTheDocument();
  });

  it("shows the nickname of a manually added catch", () => {
    renderDetail([], [], {
      caught: true,
      overrides: [
        {
          id: 1,
          speciesId: 37,
          formCanonical: "",
          gender: "",
          game: "",
          caught: true,
          seen: true,
          meta: { nickname: "Sparky" },
        },
      ],
    });

    expect(screen.getByText("Sparky")).toBeInTheDocument();
    expect(screen.queryByText("Standardform")).not.toBeInTheDocument();
  });

  it("shows the hunt details of a hand-entered catch", () => {
    renderDetail([
      caught({
        id: "m1",
        entry_source: "manual",
        game: "pokemon-scarlet",
        hunt_type: "soft_reset",
        encounters: 8192,
        timer_accumulated_ms: 3_661_000,
      }),
    ]);

    // Once as the game chip of the species, once as the card's own fact.
    expect(screen.getAllByText("Karmesin").length).toBeGreaterThan(0);
    expect(screen.getByText("Soft Reset")).toBeInTheDocument();
    expect(screen.getByText("8192")).toBeInTheDocument();
    expect(screen.getByText("01:01:01")).toBeInTheDocument();
  });

  it("lists the phases under a hand-entered catch", () => {
    renderDetail([
      caught({ id: "m1", entry_source: "manual", encounters: 400, timer_accumulated_ms: 0 }),
      caught({
        id: "m2",
        entry_source: "manual",
        phase_of: "m1",
        phase_number: 1,
        encounters: 1200,
        timer_accumulated_ms: 3_661_000,
      }),
    ]);

    expect(screen.getByText("Phasen-Historie")).toBeInTheDocument();
    expect(screen.getByText("1200")).toBeInTheDocument();
    // Parent plus phase, derived rather than stored.
    expect(screen.getByText("1600")).toBeInTheDocument();
  });

  it("marks an orphaned phase without naming a parent", () => {
    renderDetail([caught({ id: "m2", entry_source: "manual", phase_of: "gone", phase_number: 3 })]);

    expect(screen.getByText("Phase 3")).toBeInTheDocument();
    expect(screen.queryByText(/Phase 3 von/)).toBeNull();
  });

  it("marks a hand-entered catch and offers no dashboard link", () => {
    renderDetail([caught({ id: "m1", entry_source: "manual", timer_accumulated_ms: 3_661_000 })]);

    expect(screen.getByText("Manuell")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Im Dashboard öffnen" })).toBeNull();
    // The timer is the one fact only a hand-entered catch used to show.
    expect(screen.getByText("01:01:01")).toBeInTheDocument();
  });

  it("lists the phases of a tracked hunt on its card", () => {
    const parent = caught({ id: "hunt", canonical_name: "vulpix", encounters: 400 });
    const phase = caught({
      id: "p1",
      canonical_name: "vulpix",
      phase_of: "hunt",
      phase_number: 1,
      encounters: 1200,
      timer_accumulated_ms: 3_661_000,
    });
    renderDetail([parent, phase]);

    expect(screen.getByText("Phasen-Historie")).toBeInTheDocument();
    expect(screen.getByText("1600")).toBeInTheDocument();
  });

  it("dates a failed phase as failed, not as caught", () => {
    const parent = caught({ id: "hunt", canonical_name: "vulpix" });
    const phase = caught({
      id: "p1",
      canonical_name: "vulpix",
      phase_of: "hunt",
      phase_number: 1,
      failed: true,
    });
    renderDetail([parent, phase]);

    const history = screen.getByRole("list", { name: "Phasen dieses Hunts" });
    expect(within(history).getByText("Fehlgeschlagen am")).toBeInTheDocument();
    expect(within(history).queryByText("Gefangen am")).toBeNull();
  });

  it("shows the form name of a regional form", () => {
    renderDetail([caught({ canonical_name: "vulpix-alola", form_name: "Alola-Form" })]);

    expect(screen.getByText("Alola-Form")).toBeInTheDocument();
  });

  it("lists the source game, encounters and hunt method of a catch", () => {
    renderDetail([caught()]);

    const card = latestCatch();
    expect(fact(card, "Spiel")).toBe("Karmesin");
    expect(fact(card, "Encounter")).toBe("512");
    expect(huntMethodText()).toBe("Zufallsbegegnung");
  });

  it("translates a known hunt type", () => {
    renderDetail([caught({ hunt_type: "masuda" })]);

    expect(huntMethodText()).toBe("Masuda-Methode");
  });

  it("shows the plain encounter label when no hunt type is recorded", () => {
    const { unmount } = renderDetail([caught({ hunt_type: undefined })]);
    expect(huntMethodText()).toBe("Zufallsbegegnung");
    unmount();

    renderDetail([caught({ hunt_type: "" })]);
    expect(huntMethodText()).toBe("Zufallsbegegnung");
  });

  it("shows the plain encounter label instead of the raw key for an unknown hunt type", () => {
    // Old archives and retired hunt types carry values no locale translates.
    // The lookup then returns the key itself, which must never reach the UI.
    renderDetail([caught({ hunt_type: "retired_method" })]);

    expect(huntMethodText()).toBe("Zufallsbegegnung");
    expect(document.body.textContent).not.toContain("huntType.");
  });

  it("marks a phase entry with its phase number", () => {
    const parent = makePokemon({ id: "hunt", name: "Karpador" });
    const phase = caught({ id: "phase1", phase_of: "hunt", phase_number: 3 });
    renderDetail([phase], [parent, phase]);

    expect(screen.getByText("Phase 3 von Karpador")).toBeInTheDocument();
  });

  it("navigates to the dashboard with the entry id as router state", () => {
    renderDetail([caught()]);

    fireEvent.click(screen.getByRole("button", { name: "Im Dashboard öffnen" }));

    expect(navigateMock).toHaveBeenCalledWith("/", { state: { openEntryId: "c1" } });
  });

  it("offers the metadata edit affordance only when a handler is given", () => {
    const { rerender } = renderDetail([caught()]);
    expect(screen.queryByRole("button", { name: "Details bearbeiten" })).not.toBeInTheDocument();

    rerender(
      <DexSpeciesDetail
        id={37}
        canonical="vulpix"
        name="Vulpix"
        generation={1}
        catches={[caught()]}
        snapshot={[caught()]}
        games={GAMES}
        languages={["de", "en"]}
        nameLanguage="de"
        onEditCatch={vi.fn()}
        caught={true}
        overrides={[]}
        setOverride={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Details bearbeiten" })).toBeInTheDocument();
  });
});

describe("DexCatchList", () => {
  it("keeps the catches in the order it was handed", () => {
    render(
      <DexCatchList
        canonical="vulpix"
        catches={[
          caught({ id: "new", form_name: "Neu", completed_at: "2026-03-01T00:00:00Z" }),
          caught({ id: "old", form_name: "Alt", completed_at: "2026-01-01T00:00:00Z" }),
        ]}
        snapshot={[]}
        games={GAMES}
        languages={["de", "en"]}
        nameLanguage="de"
      />,
    );

    const cards = screen.getAllByRole("listitem");
    expect(within(cards[0]).getByText("Neu")).toBeInTheDocument();
    expect(within(cards[1]).getByText("Alt")).toBeInTheDocument();
  });
});
