/**
 * DexDetailModal.test.tsx: the narrow-viewport dialog around the species
 * panel, meaning its body swap to the catch list and the focus it hands over.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor, makePokemon } from "../../test-utils";
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

/** The value of one labelled fact inside a card. */
function fact(scope: HTMLElement, label: string): string {
  return within(scope).getByText(label).nextElementSibling?.textContent ?? "";
}

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
