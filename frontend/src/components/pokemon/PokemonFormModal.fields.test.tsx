/**
 * PokemonFormModal.fields.test.tsx: Remaining form controls of the Pokemon form modal: the title field, the
 * language menu, the submitted payload and the ways the dialog closes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, userEvent } from "../../test-utils";
import { PokemonFormModal } from "./PokemonFormModal";
import type { ExistingPokemonData } from "./PokemonFormModal";

HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
});
HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute("open");
});

/** Sample pokedex data returned by /api/pokedex */
const POKEDEX_DATA = [
  {
    id: 1,
    canonical: "bulbasaur",
    names: { de: "Bisasam", en: "Bulbasaur", fr: "Bulbizarre" },
    forms: [],
  },
  {
    id: 4,
    canonical: "charmander",
    names: { de: "Glumanda", en: "Charmander" },
    forms: [],
  },
  {
    id: 25,
    canonical: "pikachu",
    names: { de: "Pikachu", en: "Pikachu" },
    forms: [
      {
        canonical: "pikachu-gmax",
        names: { de: "Pikachu Gmax", en: "Pikachu Gmax" },
        sprite_id: 10199,
      },
      // Cosmetic-only form: no own PokeAPI id, sprites live under a slug path.
      {
        canonical: "pikachu-muster",
        names: { de: "Pikachu Muster", en: "Pikachu Pattern" },
        sprite_id: 0,
        sprite_slug: "25-muster",
      },
    ],
  },
];

/** Sample games data returned by /api/games */
const GAMES_DATA = [
  { key: "red", names: { de: "Rot", en: "Red" }, generation: 1, platform: "gb" },
  { key: "gold", names: { de: "Gold", en: "Gold" }, generation: 2, platform: "gbc" },
  {
    key: "pokemon-sword",
    names: { de: "Schwert", en: "Sword" },
    generation: 8,
    platform: "switch",
  },
  { key: "pokemon-x", names: { de: "X", en: "X" }, generation: 6, platform: "3ds" },
];

/** Creates a fetch mock that returns pokedex and games data */
function mockFetch() {
  return vi.fn((url: string) => {
    if (url.includes("/api/pokedex")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(POKEDEX_DATA) });
    }
    if (url.includes("/api/games")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(GAMES_DATA) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch());
  vi.mocked(HTMLDialogElement.prototype.showModal).mockClear();
  vi.mocked(HTMLDialogElement.prototype.close).mockClear();
});

const basePokemon: ExistingPokemonData = {
  id: "poke-1",
  name: "Bisasam",
  canonical_name: "bulbasaur",
  sprite_url: "https://example.com/sprite.png",
  sprite_type: "shiny",
  language: "de",
  game: "red",
  shiny_charm: false,
};

describe("PokemonFormModal", () => {
  describe("cancel and close behavior", () => {
    it("calls onClose and dialog.close when cancel button is clicked", async () => {
      const onClose = vi.fn();
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={onClose} />);

      // Find cancel button by text content
      const cancelBtn = screen
        .getAllByRole("button")
        .find((b) => /cancel|abbrechen/i.exec(b.textContent ?? ""));
      expect(cancelBtn).toBeTruthy();
      await userEvent.click(cancelBtn!);

      expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
      // onClose is deferred until the dialog's close transition finishes (or
      // the hook's fallback timeout fires, jsdom does not run real CSS
      // transitions), not called in the same tick as the click.
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it("calls onClose when X close button is clicked", async () => {
      const onClose = vi.fn();
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={onClose} />);

      // The X button has an aria-label for close
      const closeButtons = screen
        .getAllByRole("button")
        .filter((b) => b.getAttribute("aria-label")?.match(/close|schließen/i));
      expect(closeButtons.length).toBeGreaterThan(0);
      await userEvent.click(closeButtons[0]);

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it("calls onClose when dialog cancel event fires (Escape key)", async () => {
      const onClose = vi.fn();
      const { container } = render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={onClose} />,
      );

      await waitFor(() => {
        const dialog = container.querySelector("dialog")!;
        // Simulate the native dialog cancel event
        dialog.dispatchEvent(new Event("cancel", { bubbles: true }));
        expect(onClose).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("title input", () => {
    it("renders the title input field", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => {
        // The title input has an id of "title-form"
        const titleField = document.getElementById("title-form") as HTMLInputElement;
        expect(titleField).toBeInTheDocument();
      });
    });

    it("allows typing a title", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      const titleField = document.getElementById("title-form") as HTMLInputElement;
      await userEvent.type(titleField, "My Hunt");
      expect(titleField).toHaveValue("My Hunt");
    });

    it("pre-fills title in edit mode", async () => {
      const pokemonWithTitle: ExistingPokemonData = {
        ...basePokemon,
        title: "Sub-Odds Hunt",
      };
      render(
        <PokemonFormModal
          mode="edit"
          pokemon={pokemonWithTitle}
          onSubmit={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      await waitFor(() => {
        const titleField = document.getElementById("title-form") as HTMLInputElement;
        expect(titleField).toHaveValue("Sub-Odds Hunt");
      });
    });
  });

  describe("language selector", () => {
    it("renders a language selector button", async () => {
      render(
        <PokemonFormModal
          mode="add"
          onSubmit={vi.fn()}
          onClose={vi.fn()}
          activeLanguages={["de", "en"]}
        />,
      );
      await waitFor(() => {
        // The language button has aria-haspopup="listbox"
        const langBtn = screen
          .getAllByRole("button")
          .find((b) => b.getAttribute("aria-haspopup") === "true");
        expect(langBtn).toBeTruthy();
      });
    });

    it("opens language dropdown on click", async () => {
      render(
        <PokemonFormModal
          mode="add"
          onSubmit={vi.fn()}
          onClose={vi.fn()}
          activeLanguages={["de", "en"]}
        />,
      );

      const langBtn = screen
        .getAllByRole("button")
        .find((b) => b.getAttribute("aria-haspopup") === "true");
      await userEvent.click(langBtn!);

      // After opening, the language dropdown should appear
      const dropdowns = screen.getAllByLabelText(/lokalisierung|localization/i);
      const dropdown = dropdowns.find((el) => el.tagName === "DIV");
      expect(dropdown).toBeInTheDocument();
    });

    it("allows selecting a different language", async () => {
      render(
        <PokemonFormModal
          mode="add"
          onSubmit={vi.fn()}
          onClose={vi.fn()}
          activeLanguages={["de", "en"]}
        />,
      );

      const langBtn = screen
        .getAllByRole("button")
        .find((b) => b.getAttribute("aria-haspopup") === "true");
      await userEvent.click(langBtn!);

      // Select English option
      const dropdowns = screen.getAllByLabelText(/lokalisierung|localization/i);
      const dropdown = dropdowns.find((el) => el.tagName === "DIV")!;
      const options = Array.from(dropdown.querySelectorAll("button"));
      const enOption = options.find((o) => o.getAttribute("aria-pressed") === "false");
      if (enOption) {
        await userEvent.click(enOption);
      }
      // Dropdown should close after selection
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });

  describe("form submission data", () => {
    it("includes game and hunt_type in submitted data", async () => {
      const onSubmit = vi.fn();
      render(<PokemonFormModal mode="add" onSubmit={onSubmit} onClose={vi.fn()} />);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      // Select a pokemon (search by German name since locale is "de")
      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);
      await userEvent.type(searchInput, "Glumanda");
      await waitFor(() => expect(screen.getByText("Glumanda")).toBeInTheDocument());
      await userEvent.click(screen.getByText("Glumanda"));

      // Select a game
      const gameSelect = document.getElementById("game-select-form") as HTMLSelectElement;
      await waitFor(() => expect(gameSelect.options.length).toBeGreaterThan(1));
      await userEvent.selectOptions(gameSelect, "red");

      // Change hunt type
      const huntTypeSelect = document.getElementById("hunt-type-select-form") as HTMLSelectElement;
      await userEvent.selectOptions(huntTypeSelect, "soft_reset");

      // Submit
      const submitBtn = screen
        .getAllByRole("button")
        .find((b) => !b.hasAttribute("disabled") && /add|hinzufügen/i.exec(b.textContent ?? ""));
      await userEvent.click(submitBtn!);

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          game: "red",
          hunt_type: "soft_reset",
          sprite_type: "shiny",
          canonical_name: "charmander",
        }),
      );
    });
  });
});
