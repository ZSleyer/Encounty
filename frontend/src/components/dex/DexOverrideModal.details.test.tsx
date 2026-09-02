/**
 * DexOverrideModal.details.test.tsx: the catch-metadata sub-view of the
 * override modal, meaning the body swap into it and back out again.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, userEvent } from "../../test-utils";
import { DexOverrideModal } from "./DexOverrideModal";
import type { DexOverride } from "../../utils/dex";
import type { PokemonData } from "../pokemon/pokemonPicker";

/** Pokedex response used by usePokedex() inside the modal. */
function pokedexResponse(): PokemonData[] {
  return [
    {
      id: 906,
      canonical: "sprigatito",
      gender_rate: 4,
      names: { en: "Sprigatito" },
      forms: [{ canonical: "sprigatito-female", sprite_id: 9061, gender: "female" }],
    },
  ];
}

/** Every request the modal issued, so the write sequence can be asserted. */
let apiCalls: { url: string; method: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  apiCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        apiCalls.push({
          url: String(url),
          method,
          body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
        });
      }
      if (url.includes("/api/pokedex/overrides")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url.includes("/api/games")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                key: "pokemon-scarlet",
                names: { de: "Karmesin", en: "Scarlet" },
                generation: 9,
                platform: "switch",
              },
            ]),
        });
      }
      if (url.includes("/api/pokedex")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(pokedexResponse()) });
      }
      if (url.includes("/api/pokemon")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "created" }) });
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
  describe("details editor", () => {
    it("hides the edit-details entry point when the scope has no override row yet", () => {
      renderModal();
      expect(screen.queryByRole("button", { name: "Details bearbeiten" })).not.toBeInTheDocument();
    });

    it("shows the edit-details entry point once the scope has an override row", async () => {
      renderModal([
        {
          id: 1,
          speciesId: 906,
          formCanonical: "",
          gender: "",
          game: "",
          caught: true,
          seen: true,
        },
      ]);
      expect(await screen.findByRole("button", { name: "Details bearbeiten" })).toBeInTheDocument();
    });

    it("keeps edited details pending until the main save", async () => {
      const { setOverride } = renderModal([
        {
          id: 1,
          speciesId: 906,
          formCanonical: "",
          gender: "",
          game: "",
          caught: true,
          seen: true,
        },
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

      const user = userEvent.setup();
      await user.type(screen.getByLabelText("Spitzname (optional)"), "Sparky");
      await user.type(screen.getByLabelText("Fundort"), "Route 1");
      fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

      // Saving closes the details editor and swaps back to this modal's own
      // caught/seen editor, still on the same scope.
      expect(
        await screen.findByRole("button", { name: "Als gefangen markieren" }, { timeout: 2000 }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(setOverride).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
      // The metadata travels with the hunt entry now, the override only
      // records that the species was seen.
      await waitFor(() =>
        expect(
          apiCalls.some(
            (call) =>
              call.method === "POST" &&
              String(call.body.name) !== "" &&
              (call.body.catch as Record<string, unknown> | undefined)?.nickname === "Sparky",
          ),
        ).toBe(true),
      );
      expect(setOverride).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, caught: false, seen: true }),
      );
    });

    it("cancelling the details editor discards typed input and returns to the caught/seen editor", async () => {
      renderModal([
        {
          id: 1,
          speciesId: 906,
          formCanonical: "",
          gender: "",
          game: "",
          caught: true,
          seen: true,
        },
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
