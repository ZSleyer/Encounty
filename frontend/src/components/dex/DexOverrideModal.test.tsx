import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, userEvent } from "../../test-utils";
import { DexOverrideModal } from "./DexOverrideModal";
import type { DexOverride } from "../../utils/dex";
import type { PokemonData } from "../pokemon/pokemonPicker";
import { cachedSpriteSrc } from "../../utils/sprites";

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

function renderModal(
  overrides: DexOverride[] = [],
  setOverride = vi.fn().mockResolvedValue(undefined),
  scope?: { formCanonical: string; gender: string },
) {
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
      initialFormCanonical={scope?.formCanonical}
      initialGender={scope?.gender}
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

  it("removes the current scope's override after confirming, when opened pre-scoped to it", async () => {
    const { setOverride } = renderModal(
      [{ id: 1, speciesId: 906, formCanonical: "sprigatito-female", gender: "female", game: "", caught: true, seen: true }],
      undefined,
      { formCanonical: "sprigatito-female", gender: "female" },
    );

    const removeButton = await screen.findByRole("button", { name: "Entfernen" });
    fireEvent.click(removeButton);

    const confirmButton = await screen.findByRole("button", { name: "Bestätigen" });
    fireEvent.click(confirmButton);

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

  describe("form strip", () => {
    it("shows a sprite chip per available form plus the default form", async () => {
      renderModal();

      expect(await screen.findByRole("button", { name: "Standardform" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: "Weiblich" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("renders the female sprite path for the gender-restricted form chip", async () => {
      renderModal();

      const chip = await screen.findByRole("button", { name: "Weiblich" });
      const img = chip.querySelector("img");
      // sprite_id 9061 is a base-species id (<= 10000), so the synthesized
      // female pseudo-form takes the female path segment instead of the
      // plain id path a male-appearing sprite would use.
      expect(img).toHaveAttribute(
        "src",
        cachedSpriteSrc("https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/female/9061.png"),
      );
    });

    it("scopes the next write to the form picked from the strip", async () => {
      const { setOverride } = renderModal();

      fireEvent.click(await screen.findByRole("button", { name: "Weiblich" }));
      fireEvent.click(screen.getByRole("button", { name: "Als gefangen markieren" }));

      await waitFor(() =>
        expect(setOverride).toHaveBeenCalledWith(
          expect.objectContaining({ formCanonical: "sprigatito-female" }),
        ),
      );
    });
  });

  describe("details editor", () => {
    it("hides the edit-details entry point when the scope has no override row yet", () => {
      renderModal();
      expect(screen.queryByRole("button", { name: "Details bearbeiten" })).not.toBeInTheDocument();
    });

    it("shows the edit-details entry point once the scope has an override row", async () => {
      renderModal([
        { id: 1, speciesId: 906, formCanonical: "", gender: "", game: "", caught: true, seen: true },
      ]);
      expect(await screen.findByRole("button", { name: "Details bearbeiten" })).toBeInTheDocument();
    });

    it("swaps to the details editor without stacking a second dialog, and saves meta while preserving caught/seen", async () => {
      const { setOverride } = renderModal([
        { id: 1, speciesId: 906, formCanonical: "", gender: "", game: "", caught: true, seen: true },
      ]);

      fireEvent.click(await screen.findByRole("button", { name: "Details bearbeiten" }));

      // The close transition plays out (or falls back to its safety timeout)
      // before the details editor's own dialog takes over; only then is its
      // cancel button (edit mode, not "skip") reachable.
      expect(
        await screen.findByRole("button", { name: "Abbrechen" }, { timeout: 2000 }),
      ).toBeInTheDocument();
      // Exactly one native <dialog> is ever in the DOM: DexOverrideModal's own
      // ModalShell is not merely hidden while the details editor is open, it
      // is unmounted by the conditional return in the component body.
      expect(screen.getAllByRole("dialog")).toHaveLength(1);

      await userEvent.setup().type(screen.getByLabelText("Fundort"), "Route 1");
      fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

      await waitFor(() =>
        expect(setOverride).toHaveBeenCalledWith({
          speciesId: 906,
          formCanonical: "",
          gender: "",
          game: "",
          caught: true,
          seen: true,
          meta: { location: "Route 1" },
        }),
      );

      // Saving closes the details editor and swaps back to this modal's own
      // caught/seen editor, still on the same scope.
      expect(
        await screen.findByRole("button", { name: "Als gefangen markieren" }, { timeout: 2000 }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    });

    it("cancelling the details editor discards typed input and returns to the caught/seen editor", async () => {
      renderModal([
        { id: 1, speciesId: 906, formCanonical: "", gender: "", game: "", caught: true, seen: true },
      ]);

      fireEvent.click(await screen.findByRole("button", { name: "Details bearbeiten" }));
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText("Fundort", {}, { timeout: 2000 }), "Route 1");
      fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

      expect(
        await screen.findByRole("button", { name: "Als gefangen markieren" }, { timeout: 2000 }),
      ).toBeInTheDocument();
    });
  });
});
