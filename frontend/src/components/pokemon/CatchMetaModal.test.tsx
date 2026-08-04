import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, userEvent, makePokemon } from "../../test-utils";
import { CatchMetaModal } from "./CatchMetaModal";
import type { CatchMeta, Pokemon } from "../../types";

HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
});
HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute("open");
});

/** Reference catalogues returned by GET /api/catch-refs. */
const REFS = {
  natures: [
    { slug: "adamant", names: { de: "Hart", en: "Adamant" } },
    { slug: "bold", names: { de: "Kühn", en: "Bold" } },
  ],
  balls: [
    {
      slug: "poke-ball",
      names: { de: "Pokéball", en: "Poké Ball" },
      generations: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    },
    // Gen 7 only, so it must not show up for a gen 9 game.
    { slug: "beast-ball", names: { de: "Nestball", en: "Beast Ball" }, generations: [7] },
  ],
  abilities: [{ slug: "overgrow", names: { de: "Notdünger", en: "Overgrow" } }],
  ribbons: [
    { slug: "effort-ribbon", names: { de: "Fleiß-Band", en: "Effort Ribbon" } },
  ],
  marks: [{ slug: "rare-mark", names: { de: "Seltenheitszeichen", en: "Rare Mark" } }],
};

/** Location list returned by GET /api/catch-refs/locations. */
const LOCATIONS = {
  group: "gen9_sv",
  locations: [{ slug: "sv-1", names: { de: "Route 1", en: "Route 1" } }],
};

/** Fetch mock serving both reference endpoints. */
function mockFetch() {
  return vi.fn((url: string) => {
    if (url.includes("/api/catch-refs/locations")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(LOCATIONS) });
    }
    if (url.includes("/api/catch-refs")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(REFS) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

/** Renders the modal with a gen 9 Pokémon and optional overrides. */
function renderModal(overrides?: {
  pokemon?: Partial<Pokemon>;
  onSubmit?: (id: string, meta: CatchMeta) => Promise<void>;
  onClose?: () => void;
}) {
  const onSubmit = overrides?.onSubmit ?? vi.fn().mockResolvedValue(undefined);
  const onClose = overrides?.onClose ?? vi.fn();
  render(
    <CatchMetaModal
      pokemon={makePokemon(overrides?.pokemon)}
      onSubmit={onSubmit}
      onClose={onClose}
    />,
  );
  return { onSubmit, onClose };
}

/** The determinant value input of one stat, matched by its abbreviation. */
function ivInput(abbr: string): HTMLInputElement {
  return screen.getByRole("textbox", {
    name: new RegExp(`^${abbr} \\(`),
  }) as HTMLInputElement;
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch());
  vi.mocked(HTMLDialogElement.prototype.showModal).mockClear();
  vi.mocked(HTMLDialogElement.prototype.close).mockClear();
});

describe("CatchMetaModal", () => {
  it("focuses the location input through data-autofocus", async () => {
    renderModal();
    const location = screen.getByLabelText("Fundort");
    expect(location).toHaveAttribute("data-autofocus");
    await waitFor(() => expect(location).toHaveFocus());
    // Skip must never take the initial focus.
    expect(screen.getByRole("button", { name: "Überspringen" })).not.toHaveFocus();
  });

  it("uses the fresh-catch title and switches to the edit title with stored data", () => {
    renderModal();
    expect(screen.getByRole("heading", { name: "Fang-Details" })).toBeInTheDocument();
  });

  it("uses the edit title when the Pokémon already carries details", () => {
    renderModal({ pokemon: { catch: { level: 5 } } });
    expect(
      screen.getByRole("heading", { name: "Fang-Details bearbeiten" }),
    ).toBeInTheDocument();
  });

  it("skips without submitting or sending any request", async () => {
    const user = userEvent.setup();
    const { onSubmit, onClose } = renderModal();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    await user.type(screen.getByLabelText("Fundort"), "Route 1");
    await user.click(screen.getByRole("button", { name: "Überspringen" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSubmit).not.toHaveBeenCalled();
    // Only the two reference loads, nothing was written back.
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("submits the exact payload of every filled field", async () => {
    const user = userEvent.setup();
    const { onSubmit, onClose } = renderModal();
    await screen.findByRole("option", { name: "Pokéball" });

    await user.type(screen.getByLabelText("Fundort"), "Route 1");
    await user.selectOptions(screen.getByLabelText("Ball"), "poke-ball");
    await user.type(screen.getByLabelText(/^Level,/), "50");
    await user.selectOptions(screen.getByLabelText("Wesen"), "adamant");
    await user.type(screen.getByLabelText("Fähigkeit"), "Notdünger");
    await user.selectOptions(screen.getByLabelText("Zeichen"), "rare-mark");
    await user.type(ivInput("KP"), "31");
    await user.type(ivInput("INIT"), "0");
    await user.click(
      screen.getByRole("button", { name: "Band Fleiß-Band umschalten" }),
    );

    await user.click(screen.getByRole("button", { name: "Speichern" }));

    expect(onSubmit).toHaveBeenCalledWith("poke-1", {
      location: "Route 1",
      ball: "poke-ball",
      level: 50,
      nature: "adamant",
      ability: "Notdünger",
      mark: "rare-mark",
      hp: 31,
      speed: 0,
      ribbons: ["effort-ribbon"],
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("serializes a determinant value of 0 instead of dropping it", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal();

    await user.type(ivInput("KP"), "0");
    await user.click(screen.getByRole("button", { name: "Speichern" }));

    expect(onSubmit).toHaveBeenCalledWith("poke-1", { hp: 0 });
  });

  it("rejects determinant values above 31 and levels above 100 on the keystroke", async () => {
    const user = userEvent.setup();
    renderModal();

    const hp = ivInput("KP");
    await user.type(hp, "35");
    expect(hp).toHaveValue("3");

    const level = screen.getByLabelText(/^Level,/);
    await user.type(level, "150");
    expect(level).toHaveValue("15");
  });

  it("keeps the dialog open with the typed data when saving fails", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error("boom"));
    const { onClose } = renderModal({ onSubmit });

    await user.type(screen.getByLabelText("Fundort"), "Route 1");
    await user.type(ivInput("ANG"), "31");
    await user.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Fundort")).toHaveValue("Route 1");
    expect(ivInput("ANG")).toHaveValue("31");
  });

  it("offers only balls of the game's generation", async () => {
    renderModal();
    await screen.findByRole("option", { name: "Pokéball" });
    expect(screen.queryByRole("option", { name: "Nestball" })).not.toBeInTheDocument();
  });

  it("seeds every field from the stored metadata", async () => {
    renderModal({
      pokemon: {
        catch: {
          location: "Route 4",
          ball: "poke-ball",
          level: 7,
          nature: "bold",
          hp: 0,
          ribbons: ["effort-ribbon"],
        },
      },
    });
    await screen.findByRole("option", { name: "Pokéball" });

    expect(screen.getByLabelText("Fundort")).toHaveValue("Route 4");
    expect(screen.getByLabelText("Ball")).toHaveValue("poke-ball");
    expect(screen.getByLabelText(/^Level,/)).toHaveValue("7");
    expect(screen.getByLabelText("Wesen")).toHaveValue("bold");
    expect(ivInput("KP")).toHaveValue("0");
    expect(
      screen.getAllByRole("button", { name: "Band Fleiß-Band umschalten" })[0],
    ).toBeInTheDocument();
  });
});
