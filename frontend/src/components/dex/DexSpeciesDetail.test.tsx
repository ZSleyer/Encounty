import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, makePokemon } from "../../test-utils";
import { DexSpeciesDetail } from "./DexSpeciesDetail";
import { DexDetailModal } from "./DexDetailModal";
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

function renderDetail(catches: Pokemon[], snapshot: Pokemon[] = catches) {
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
    />,
  );
}

/** The hunt-method fact of the single rendered catch card. */
function huntMethodText(): string {
  return screen.getByText("Hunt-Methode").nextElementSibling?.textContent ?? "";
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
      />,
    );

    expect(screen.getByRole("heading", { name: "Vulpix" })).toHaveAttribute("id", "panel-heading");
  });

  it("labels a base-species catch as the default form", () => {
    renderDetail([caught()]);

    expect(screen.getByText("Standardform")).toBeInTheDocument();
  });

  it("shows the form name of a regional form", () => {
    renderDetail([caught({ canonical_name: "vulpix-alola", form_name: "Alola-Form" })]);

    expect(screen.getByText("Alola-Form")).toBeInTheDocument();
  });

  it("lists the source game, encounters and hunt method of a catch", () => {
    renderDetail([caught()]);

    expect(screen.getByText("Karmesin")).toBeInTheDocument();
    expect(screen.getByText("512")).toBeInTheDocument();
    expect(screen.getByText("Zufallsbegegnung")).toBeInTheDocument();
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

  it("keeps the catches in the order it was handed", () => {
    renderDetail([
      caught({ id: "new", form_name: "Neu", completed_at: "2026-03-01T00:00:00Z" }),
      caught({ id: "old", form_name: "Alt", completed_at: "2026-01-01T00:00:00Z" }),
    ]);

    const cards = screen.getAllByRole("listitem");
    expect(within(cards[0]).getByText("Neu")).toBeInTheDocument();
    expect(within(cards[1]).getByText("Alt")).toBeInTheDocument();
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
      />,
    );
    expect(screen.getByRole("button", { name: "Details bearbeiten" })).toBeInTheDocument();
  });
});

describe("DexDetailModal", () => {
  it("renders the shared detail body inside the dialog", () => {
    render(
      <DexDetailModal
        id={37}
        canonical="vulpix"
        name="Vulpix"
        generation={1}
        catches={[caught()]}
        snapshot={[caught()]}
        games={GAMES}
        languages={["de", "en"]}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("#0037")).toBeInTheDocument();
    expect(within(dialog).getByText("Karmesin")).toBeInTheDocument();
  });
});
