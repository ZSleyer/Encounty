import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "../../test-utils";
import { DexOverrideModal } from "./DexOverrideModal";
import type { DexOverride } from "../../utils/dex";
import type { PokemonData } from "../pokemon/pokemonPicker";

/** Pokedex response used by usePokedex() inside the modal. */
function pokedexResponse(): PokemonData[] {
  return [
    {
      id: 906,
      canonical: "sprigatito",
      names: { en: "Sprigatito" },
      forms: [
        { canonical: "sprigatito-female", sprite_id: 9061, gender: "female" },
      ],
    },
  ];
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/api/pokedex/overrides")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url.includes("/api/pokedex")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(pokedexResponse()) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }),
  );
});

function renderModal(overrides: DexOverride[] = [], setOverride = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(
    <DexOverrideModal
      speciesId={906}
      canonical="sprigatito"
      name="Sprigatito"
      generation={9}
      caught={false}
      overrides={overrides}
      setOverride={setOverride}
      onClose={onClose}
    />,
  );
  return { onClose, setOverride };
}

describe("DexOverrideModal", () => {
  it("renders the species header inside the dialog", () => {
    renderModal();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Sprigatito");
    expect(dialog).toHaveTextContent("#0906");
  });

  it("shows the gender radio group once the species' forms load with a gender-restricted form", async () => {
    renderModal();

    await waitFor(() =>
      expect(screen.getByRole("radiogroup")).toBeInTheDocument(),
    );
  });

  it("toggles caught on for the species-level, global scope", async () => {
    const { setOverride } = renderModal();

    const toggle = await screen.findByRole("button", { name: "Als gefangen markieren" });
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(setOverride).toHaveBeenCalledWith({
        speciesId: 906,
        formCanonical: "",
        gender: "",
        game: "",
        caught: true,
        seen: true,
      }),
    );
  });

  it("disables the seen toggle once caught is on, since caught implies seen", async () => {
    renderModal([
      { id: 1, speciesId: 906, formCanonical: "", gender: "", game: "", caught: true, seen: true },
    ]);

    const seenToggle = await screen.findByRole("button", { name: "Als gesehen markieren" });
    expect(seenToggle).toBeDisabled();
    expect(seenToggle).toHaveAttribute("aria-pressed", "true");
  });

  it("lists an already-set override with a working remove action", async () => {
    const { setOverride } = renderModal([
      { id: 1, speciesId: 906, formCanonical: "sprigatito-female", gender: "female", game: "", caught: true, seen: true },
    ]);

    const removeButton = await screen.findByRole("button", { name: "Entfernen" });
    fireEvent.click(removeButton);

    await waitFor(() =>
      expect(setOverride).toHaveBeenCalledWith({
        speciesId: 906,
        formCanonical: "sprigatito-female",
        gender: "female",
        game: "",
        caught: false,
        seen: false,
      }),
    );
  });
});
