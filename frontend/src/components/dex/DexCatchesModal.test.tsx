/**
 * DexCatchesModal.test.tsx: the dialog listing every catch of one species.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor, makePokemon } from "../../test-utils";
import { DexCatchesModal } from "./DexCatchesModal";
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
        nameLanguage="de"
        onEditCatch={onEditCatch}
        onClose={onClose}
      />,
    );
    return { onClose, onEditCatch };
  }

  it("titles itself after the species and lists every catch", () => {
    renderCatchesModal([caught({ id: "a" }), caught({ id: "b" }), caught({ id: "c" })]);

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Alle Fänge von Vulpix" }),
    ).toBeInTheDocument();
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
