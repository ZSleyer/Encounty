import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, userEvent, makePokemon } from "../../test-utils";
import { CatchMetaModal, type CatchMetaModalPokemon } from "./CatchMetaModal";
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
    // Legends Arceus only. The generations are reported too broadly upstream,
    // so the game list has to win over them.
    {
      slug: "lagreat-ball",
      names: { de: "Superball", en: "Great Ball" },
      generations: [8, 9],
      games: ["pokemon-legends", "pokemon-legends-arceus"],
    },
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
  mode?: "capture" | "edit";
}) {
  const onSubmit = overrides?.onSubmit ?? vi.fn().mockResolvedValue(undefined);
  const onClose = overrides?.onClose ?? vi.fn();
  render(
    <CatchMetaModal
      pokemon={makePokemon(overrides?.pokemon)}
      onSubmit={onSubmit}
      onClose={onClose}
      mode={overrides?.mode}
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

/**
 * Resolves once the reference catalogues arrived. The ribbon toggles are the
 * only catalogue rendered without opening anything, so they are the cheapest
 * signal that the fetch settled.
 */
function awaitRefs() {
  // All matches, because a selected ribbon renders both a chip and a toggle.
  return screen.findAllByRole("button", { name: "Band Fleiß-Band umschalten" });
}

/**
 * The trigger of one catalogue dropdown. Its accessible name is the field
 * label followed by the current entry, e.g. "Ball Pokéball".
 */
function trigger(field: string): HTMLButtonElement {
  return screen.getByRole("button", {
    name: new RegExp(`^${field} `),
  }) as HTMLButtonElement;
}

/** Opens a catalogue dropdown and picks the entry with the given label. */
async function pick(
  user: ReturnType<typeof userEvent.setup>,
  field: string,
  entry: string,
) {
  await user.click(trigger(field));
  await user.click(await screen.findByRole("button", { name: entry }));
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
    await awaitRefs();

    await user.type(screen.getByLabelText("Fundort"), "Route 1");
    await pick(user, "Ball", "Pokéball");
    await user.type(screen.getByLabelText(/^Level,/), "50");
    await pick(user, "Wesen", "Hart");
    await user.type(screen.getByLabelText("Fähigkeit"), "Notdünger");
    await pick(user, "Zeichen", "Seltenheitszeichen");
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
    const user = userEvent.setup();
    renderModal();
    await awaitRefs();

    await user.click(trigger("Ball"));
    expect(await screen.findByRole("button", { name: "Pokéball" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nestball" })).not.toBeInTheDocument();
  });

  it("hides a game-scoped ball outside its game", async () => {
    const user = userEvent.setup();
    renderModal();
    await awaitRefs();

    await user.click(trigger("Ball"));
    expect(await screen.findByRole("button", { name: "Pokéball" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Superball" })).not.toBeInTheDocument();
  });

  it("offers a game-scoped ball inside its game", async () => {
    const user = userEvent.setup();
    renderModal({ pokemon: { game: "pokemon-legends-arceus" } });
    await awaitRefs();

    await user.click(trigger("Ball"));
    expect(await screen.findByRole("button", { name: "Superball" })).toBeInTheDocument();
  });

  it("keeps a stored ball selectable outside its game", async () => {
    renderModal({ pokemon: { catch: { ball: "lagreat-ball" } } });
    await awaitRefs();
    expect(trigger("Ball")).toHaveAccessibleName("Ball Superball");
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
    await awaitRefs();

    expect(screen.getByLabelText("Fundort")).toHaveValue("Route 4");
    expect(trigger("Ball")).toHaveAccessibleName("Ball Pokéball");
    expect(screen.getByLabelText(/^Level,/)).toHaveValue("7");
    expect(trigger("Wesen")).toHaveAccessibleName("Wesen Kühn");
    expect(ivInput("KP")).toHaveValue("0");
    expect(
      screen.getAllByRole("button", { name: "Band Fleiß-Band umschalten" })[0],
    ).toBeInTheDocument();
  });

  it("labels the left footer button 'Skip' by default (capture mode)", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Überspringen" })).toBeInTheDocument();
  });

  it("labels the left footer button 'Cancel' in edit mode, same close behavior", async () => {
    const user = userEvent.setup();
    const { onSubmit, onClose } = renderModal({ mode: "edit" });

    expect(screen.queryByRole("button", { name: "Überspringen" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("accepts a minimal structural pokemon object instead of a full Pokemon", () => {
    // CatchMetaModalPokemon only needs id/game/catch; this is the exact shape
    // DexOverrideModal seeds for a manual override with no real Pokemon.
    const minimal: CatchMetaModalPokemon = {
      id: "override:906::",
      game: "",
      catch: { level: 5 },
    };
    render(
      <CatchMetaModal
        pokemon={minimal}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
        mode="edit"
      />,
    );
    expect(screen.getByLabelText(/^Level,/)).toHaveValue("5");
  });
});
