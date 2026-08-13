import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import { CatchMetaSummary } from "./CatchMetaSummary";

/** Reference catalogues returned by GET /api/catch-refs. */
const REFS = {
  natures: [{ slug: "adamant", names: { de: "Hart", en: "Adamant" } }],
  balls: [
    {
      slug: "poke-ball",
      names: { de: "Pokéball", en: "Poké Ball" },
      generations: [9],
    },
  ],
  abilities: [{ slug: "overgrow", names: { de: "Notdünger", en: "Overgrow" } }],
  ribbons: [{ slug: "effort-ribbon", names: { de: "Fleiß-Band", en: "Effort Ribbon" } }],
  marks: [{ slug: "rare-mark", names: { de: "Seltenheitszeichen", en: "Rare Mark" } }],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(REFS) })),
  );
});

describe("CatchMetaSummary", () => {
  it("shows the empty state and still offers the edit button", async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(<CatchMetaSummary onEdit={onEdit} />);

    expect(screen.getByText("Keine Details erfasst")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Details bearbeiten" }));
    expect(onEdit).toHaveBeenCalled();
  });

  it("resolves slugs to localized names", async () => {
    render(<CatchMetaSummary meta={{ ball: "poke-ball", ribbons: ["effort-ribbon"] }} />);

    expect(await screen.findByText("Pokéball")).toBeInTheDocument();
    expect(screen.getByText("Fleiß-Band")).toBeInTheDocument();
  });

  it("shows the recorded gender", () => {
    render(<CatchMetaSummary meta={{ gender: "female" }} />);
    expect(screen.getByText("Geschlecht")).toBeInTheDocument();
    expect(screen.getByText("♀")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("♀")).toHaveClass("text-[var(--gender-female)]");
    expect(screen.getByText("Weiblich")).toBeInTheDocument();
  });

  it("renders unset determinant values as an en dash and keeps a stored 0", () => {
    render(<CatchMetaSummary meta={{ hp: 0, atk: 31 }} />);

    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("31")).toBeInTheDocument();
    // Four unset slots stay visible instead of collapsing.
    expect(screen.getAllByText("–")).toHaveLength(4);
  });

  it("marks a perfect determinant spread", () => {
    render(
      <CatchMetaSummary
        meta={{ hp: 31, atk: 31, def: 31, sp_atk: 31, sp_def: 31, speed: 31 }}
      />,
    );

    expect(screen.getByText("DV-Summe 186/186")).toBeInTheDocument();
    expect(screen.getByText("Perfekt")).toBeInTheDocument();
  });
});
