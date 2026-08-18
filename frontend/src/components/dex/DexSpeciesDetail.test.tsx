import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor, makePokemon } from "../../test-utils";
import { DexCatchList, DexSpeciesDetail, type DexSpeciesDetailProps } from "./DexSpeciesDetail";
import { DexDetailModal } from "./DexDetailModal";
import { DexCatchesModal } from "./DexCatchesModal";
import type { GameEntry, Pokemon } from "../../types";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useNavigate: () => navigateMock };
});

// The catch-reference catalogues are fetched by CatchMetaSummary.
vi.stubGlobal(
  "fetch",
  vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })),
);

const GAMES: GameEntry[] = [
  { key: "pokemon-scarlet", names: { de: "Karmesin", en: "Scarlet" }, generation: 9, platform: "switch" },
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

/** The value of one labelled fact inside a card. */
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
      overrides: [{
        id: 1,
        speciesId: 37,
        formCanonical: "",
        gender: "",
        game: "",
        caught: true,
        seen: true,
        meta: { nickname: "Sparky" },
      }],
    });

    expect(screen.getByText("Sparky")).toBeInTheDocument();
    expect(screen.queryByText("Standardform")).not.toBeInTheDocument();
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
    renderDetail(
      [caught({ id: "a" }), caught({ id: "b" }), caught({ id: "c" })],
      [],
      { onShowAllCatches },
    );

    const control = screen.getByRole("button", { name: "Alle 3 Fänge anzeigen" });
    fireEvent.click(control);

    expect(onShowAllCatches).toHaveBeenCalledTimes(1);
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
      />,
    );

    const cards = screen.getAllByRole("listitem");
    expect(within(cards[0]).getByText("Neu")).toBeInTheDocument();
    expect(within(cards[1]).getByText("Alt")).toBeInTheDocument();
  });
});

describe("DexCatchesModal", () => {
  /** Renders the catch-list dialog with spies for both callbacks. */
  function renderCatchesModal(catches: Pokemon[]) {
    const onClose = vi.fn();
    const onEditCatch = vi.fn();
    render(
      <DexCatchesModal
        name="Vulpix"
        canonical="vulpix"
        catches={catches}
        snapshot={[]}
        games={GAMES}
        languages={["de", "en"]}
        onEditCatch={onEditCatch}
        onClose={onClose}
      />,
    );
    return { onClose, onEditCatch };
  }

  it("titles itself after the species and lists every catch", () => {
    renderCatchesModal([caught({ id: "a" }), caught({ id: "b" }), caught({ id: "c" })]);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Alle Fänge von Vulpix" })).toBeInTheDocument();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(3);
  });

  it("reports an edit request only after it has closed itself", async () => {
    const { onClose, onEditCatch } = renderCatchesModal([caught({ id: "a" }), caught({ id: "b" })]);

    const cards = screen.getAllByRole("listitem");
    fireEvent.click(within(cards[1]).getByRole("button", { name: "Details bearbeiten" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onEditCatch).toHaveBeenCalledWith("b");
    // Closing first keeps the metadata editor from opening on top of this one.
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(
      onEditCatch.mock.invocationCallOrder[0],
    );
  });
});

describe("DexDetailModal", () => {
  /** Renders the narrow-viewport dialog around the given catches. */
  function renderDetailModal(catches: Pokemon[], onEditCatch = vi.fn(), onClose = vi.fn()) {
    render(
      <DexDetailModal
        id={37}
        canonical="vulpix"
        name="Vulpix"
        generation={1}
        catches={catches}
        snapshot={[]}
        games={GAMES}
        languages={["de", "en"]}
        onEditCatch={onEditCatch}
        onClose={onClose}
        caught={catches.length > 0}
        overrides={[]}
        setOverride={vi.fn()}
      />,
    );
    return { onEditCatch, onClose };
  }

  it("renders the shared summary body inside the dialog", () => {
    renderDetailModal([caught()]);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("#0037")).toBeInTheDocument();
    expect(fact(within(dialog).getByRole("region", { name: "Neuester Fang" }), "Spiel")).toBe(
      "Karmesin",
    );
  });

  it("swaps its own body for the catch list instead of stacking a second dialog", () => {
    renderDetailModal([caught({ id: "a" }), caught({ id: "b" })]);

    fireEvent.click(screen.getByRole("button", { name: "Alle 2 Fänge anzeigen" }));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Alle Fänge von Vulpix" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("hands the focus to the back control and returns it to the opener", () => {
    renderDetailModal([caught({ id: "a" }), caught({ id: "b" })]);

    fireEvent.click(screen.getByRole("button", { name: "Alle 2 Fänge anzeigen" }));
    const back = screen.getByRole("button", { name: "Zurück zur Übersicht" });
    expect(back).toHaveFocus();

    fireEvent.click(back);
    expect(screen.getByRole("button", { name: "Alle 2 Fänge anzeigen" })).toHaveFocus();
  });

  it("reports an edit request only after it has closed itself", async () => {
    const { onClose, onEditCatch } = renderDetailModal([caught({ id: "a" })]);

    fireEvent.click(screen.getByRole("button", { name: "Details bearbeiten" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onEditCatch).toHaveBeenCalledWith("a");
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(
      onEditCatch.mock.invocationCallOrder[0],
    );
  });
});
