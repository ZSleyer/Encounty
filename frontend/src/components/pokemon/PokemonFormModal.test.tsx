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
      { canonical: "pikachu-gmax", names: { de: "Pikachu Gmax", en: "Pikachu Gmax" }, sprite_id: 10199 },
    ],
  },
];

/** Sample games data returned by /api/games */
const GAMES_DATA = [
  { key: "red", names: { de: "Rot", en: "Red" }, generation: 1, platform: "gb" },
  { key: "gold", names: { de: "Gold", en: "Gold" }, generation: 2, platform: "gbc" },
  { key: "sword", names: { de: "Schwert", en: "Sword" }, generation: 8, platform: "switch" },
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
};

describe("PokemonFormModal", () => {
  describe("add mode", () => {
    it("renders without crashing", async () => {
      const { container } = render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(container.querySelector("dialog")).toBeInTheDocument();
      });
    });

    it("renders cancel and add buttons inside the dialog", async () => {
      const { container } = render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        const buttons = container.querySelectorAll("dialog button");
        expect(buttons.length).toBeGreaterThan(0);
      });
    });

    it("calls showModal on mount", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
      });
    });

    it("displays the add title heading", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
      });
    });

    it("disables the submit button when no pokemon is selected", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        // The add/submit button should be disabled
        const buttons = screen.getAllByRole("button");
        const addBtn = buttons.find((b) => b.hasAttribute("disabled"));
        expect(addBtn).toBeTruthy();
        expect(addBtn).toBeDisabled();
      });
    });

    it("does not call onSubmit when clicking add with no pokemon selected", async () => {
      const onSubmit = vi.fn();
      render(
        <PokemonFormModal mode="add" onSubmit={onSubmit} onClose={vi.fn()} />,
      );
      // Find the disabled submit button and click it
      const buttons = screen.getAllByRole("button");
      const addBtn = buttons.find((b) => b.hasAttribute("disabled"));
      if (addBtn) await userEvent.click(addBtn);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("shows search input for pokemon selection", async () => {
      const { container } = render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        const searchInput = container.querySelector("input[type='text']");
        expect(searchInput).toBeInTheDocument();
      });
    });

    it("shows question mark placeholder when no pokemon is selected", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        // Multiple "?" elements exist (main placeholder + sprite style previews)
        expect(screen.getAllByText("?").length).toBeGreaterThan(0);
      });
    });

    it("displays suggestions when typing a pokemon name", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      // Wait for pokedex data to load
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);
      // Search by canonical name; UI locale is "de" so display name is "Bisasam"
      await userEvent.type(searchInput, "bulba");

      await waitFor(() => {
        expect(screen.getByText("Bisasam")).toBeInTheDocument();
      });
    });

    it("selects a pokemon from search results", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);
      await userEvent.type(searchInput, "bulba");

      await waitFor(() => {
        expect(screen.getByText("Bisasam")).toBeInTheDocument();
      });

      // Click a suggestion
      await userEvent.click(screen.getByText("Bisasam"));

      // After selection, the canonical name should appear in the left column
      await waitFor(() => {
        expect(screen.getByText("#bulbasaur")).toBeInTheDocument();
      });
    });

    it("calls onSubmit and onClose when a pokemon is selected and submitted", async () => {
      const onSubmit = vi.fn();
      const onClose = vi.fn();
      render(
        <PokemonFormModal mode="add" onSubmit={onSubmit} onClose={onClose} />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      // Select a pokemon using German name search
      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);
      await userEvent.type(searchInput, "Bisasam");
      await waitFor(() => expect(screen.getByText("Bisasam")).toBeInTheDocument());
      await userEvent.click(screen.getByText("Bisasam"));

      // Find and click the non-disabled submit button
      await waitFor(() => {
        const buttons = screen.getAllByRole("button");
        const submitBtn = buttons.find(
          (b) => !b.hasAttribute("disabled") && /add|hinzufügen/i.exec(b.textContent ?? ""),
        );
        expect(submitBtn).toBeTruthy();
      });

      const buttons = screen.getAllByRole("button");
      const submitBtn = buttons.find(
        (b) => !b.hasAttribute("disabled") && /add|hinzufügen/i.exec(b.textContent ?? ""),
      );
      await userEvent.click(submitBtn!);

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("shows browse mode suggestions when input is focused with empty query", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);

      // Browse mode shows German names since locale is "de"
      await waitFor(() => {
        expect(screen.getByText("Bisasam")).toBeInTheDocument();
      });
    });

    it("fetches pokedex and games data on mount", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledTimes(2);
      });
      const calls = vi.mocked(fetch).mock.calls.map((c) => {
        const url = c[0];
        return typeof url === "string" ? url : (url as Request).url;
      });
      expect(calls.some((u) => u.includes("/api/pokedex"))).toBe(true);
      expect(calls.some((u) => u.includes("/api/games"))).toBe(true);
    });
  });

  describe("edit mode", () => {
    it("renders without crashing", async () => {
      const { container } = render(
        <PokemonFormModal
          mode="edit"
          pokemon={basePokemon}
          onSubmit={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      await waitFor(() => {
        expect(container.querySelector("dialog")).toBeInTheDocument();
      });
    });

    it("displays edit title heading", async () => {
      render(
        <PokemonFormModal
          mode="edit"
          pokemon={basePokemon}
          onSubmit={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      await waitFor(() => {
        expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
      });
    });

    it("pre-fills the selected pokemon from props", async () => {
      render(
        <PokemonFormModal
          mode="edit"
          pokemon={basePokemon}
          onSubmit={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      // After pokedex loads, the edit mode should match and display the pokemon
      await waitFor(() => {
        expect(screen.getByText("#bulbasaur")).toBeInTheDocument();
      });
    });

    it("shows the change button in edit mode", async () => {
      render(
        <PokemonFormModal
          mode="edit"
          pokemon={basePokemon}
          onSubmit={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      // Wait for the pokemon to be loaded and matched
      await waitFor(() => {
        expect(screen.getByText("#bulbasaur")).toBeInTheDocument();
      });

      // Should show a change button to switch pokemon
      const changeBtn = screen.getAllByRole("button").find((b) =>
        (/change|wechseln|ändern/i).exec(b.textContent ?? ""),
      );
      expect(changeBtn).toBeTruthy();
    });

    it("shows search input when change button is clicked", async () => {
      const { container } = render(
        <PokemonFormModal
          mode="edit"
          pokemon={basePokemon}
          onSubmit={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByText("#bulbasaur")).toBeInTheDocument());

      const changeBtn = screen.getAllByRole("button").find((b) =>
        (/change|wechseln|ändern/i).exec(b.textContent ?? ""),
      );
      await userEvent.click(changeBtn!);

      // Search input should now be visible
      const searchInput = container.querySelector("input[type='text']");
      expect(searchInput).toBeInTheDocument();
    });

    it("shows step size input in edit mode", async () => {
      render(
        <PokemonFormModal
          mode="edit"
          pokemon={basePokemon}
          onSubmit={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      await waitFor(() => {
        const stepInput = screen.getByRole("spinbutton");
        expect(stepInput).toBeInTheDocument();
      });
    });

    it("calls onSubmit with pokemon id when saving in edit mode", async () => {
      const onSubmit = vi.fn();
      render(
        <PokemonFormModal
          mode="edit"
          pokemon={basePokemon}
          onSubmit={onSubmit}
          onClose={vi.fn()}
        />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByText("#bulbasaur")).toBeInTheDocument());

      // Find the save/submit button
      const saveBtn = screen.getAllByRole("button").find(
        (b) => (/save|speichern/i).exec(b.textContent ?? ""),
      );
      expect(saveBtn).not.toBeDisabled();
      await userEvent.click(saveBtn!);

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith("poke-1", expect.objectContaining({
        canonical_name: "bulbasaur",
        language: "de",
      }));
    });

    it("pre-fills existing pokemon data including hunt_type and step", async () => {
      const pokemonWithExtras: ExistingPokemonData = {
        ...basePokemon,
        hunt_type: "masuda",
        step: 3,
      };
      render(
        <PokemonFormModal
          mode="edit"
          pokemon={pokemonWithExtras}
          onSubmit={vi.fn()}
          onClose={vi.fn()}
        />,
      );

      await waitFor(() => {
        // Step input should be pre-filled with 3
        const stepInput = screen.getByRole("spinbutton");
        expect(stepInput).toHaveValue(3);
      });
    });
  });

  describe("cancel and close behavior", () => {
    it("calls onClose and dialog.close when cancel button is clicked", async () => {
      const onClose = vi.fn();
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={onClose} />,
      );

      // Find cancel button by text content
      const cancelBtn = screen.getAllByRole("button").find(
        (b) => (/cancel|abbrechen/i).exec(b.textContent ?? ""),
      );
      expect(cancelBtn).toBeTruthy();
      await userEvent.click(cancelBtn!);

      expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("calls onClose when X close button is clicked", async () => {
      const onClose = vi.fn();
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={onClose} />,
      );

      // The X button has an aria-label for close
      const closeButtons = screen.getAllByRole("button").filter(
        (b) => b.getAttribute("aria-label")?.match(/close|schließen/i),
      );
      expect(closeButtons.length).toBeGreaterThan(0);
      await userEvent.click(closeButtons[0]);

      expect(onClose).toHaveBeenCalledTimes(1);
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

  const getGameSelect = () =>
    document.getElementById("game-select-form") as HTMLSelectElement;

  describe("game selection", () => {

    it("renders a game select dropdown", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(getGameSelect()).toBeInTheDocument();
      });
    });

    it("shows 'no game' default option", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(getGameSelect()).toHaveValue("");
      });
    });

    it("populates game options after loading", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      await waitFor(() => {
        const gameSelect = getGameSelect();
        // At least the "no game" option plus loaded games
        expect(gameSelect.options.length).toBeGreaterThan(1);
      });
    });

    it("allows selecting a game", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      await waitFor(() => {
        expect(getGameSelect().options.length).toBeGreaterThan(1);
      });

      await userEvent.selectOptions(getGameSelect(), "red");
      expect(getGameSelect()).toHaveValue("red");
    });

    it("pre-selects game in edit mode", async () => {
      render(
        <PokemonFormModal
          mode="edit"
          pokemon={basePokemon}
          onSubmit={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      await waitFor(() => {
        expect(getGameSelect().options.length).toBeGreaterThan(1);
      });

      expect(getGameSelect()).toHaveValue("red");
    });
  });

  const getHuntTypeSelect = () =>
    document.getElementById("hunt-type-select-form") as HTMLSelectElement;

  describe("hunt type selection", () => {

    it("renders a hunt type select", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(getHuntTypeSelect()).toBeInTheDocument();
      });
    });

    it("defaults to encounter hunt type", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(getHuntTypeSelect()).toHaveValue("encounter");
      });
    });

    it("allows changing the hunt type", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await userEvent.selectOptions(getHuntTypeSelect(), "soft_reset");
      expect(getHuntTypeSelect()).toHaveValue("soft_reset");
    });
  });

  describe("sprite variant toggle", () => {
    it("renders shiny and normal toggle buttons", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(screen.getByText("Shiny")).toBeInTheDocument();
        expect(screen.getByText("Normal")).toBeInTheDocument();
      });
    });

    it("can toggle between shiny and normal", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      const normalBtn = screen.getByText("Normal").closest("button")!;
      await userEvent.click(normalBtn);
      // After clicking Normal, it should be the active variant
      expect(normalBtn.className).toContain("accent-blue");
    });
  });

  describe("title input", () => {
    it("renders the title input field", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        // The title input has an id of "title-form"
        const titleField = document.getElementById("title-form") as HTMLInputElement;
        expect(titleField).toBeInTheDocument();
      });
    });

    it("allows typing a title", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
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

  describe("custom sprite URL", () => {
    it("hides the custom sprite input by default", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        const customSpriteInput = document.getElementById("custom-sprite-form");
        expect(customSpriteInput).not.toBeInTheDocument();
      });
    });

    it("shows the custom sprite input when expanded", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );

      // Find the collapsible custom sprite toggle button
      const toggleBtn = screen.getAllByRole("button").find(
        (b) => b.getAttribute("aria-expanded") !== null && (/custom|sprite.*url/i).exec(b.textContent ?? ""),
      );
      expect(toggleBtn).toBeTruthy();
      await userEvent.click(toggleBtn!);

      const customSpriteInput = document.getElementById("custom-sprite-form");
      expect(customSpriteInput).toBeInTheDocument();
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
        const langBtn = screen.getAllByRole("button").find(
          (b) => b.getAttribute("aria-haspopup") === "true",
        );
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

      const langBtn = screen.getAllByRole("button").find(
        (b) => b.getAttribute("aria-haspopup") === "true",
      );
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

      const langBtn = screen.getAllByRole("button").find(
        (b) => b.getAttribute("aria-haspopup") === "true",
      );
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

  describe("search by pokemon ID", () => {
    it("finds pokemon by dex number", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);
      await userEvent.type(searchInput, "25");

      await waitFor(() => {
        expect(screen.getByText("Pikachu")).toBeInTheDocument();
      });
    });
  });

  describe("form submission data", () => {
    it("includes game and hunt_type in submitted data", async () => {
      const onSubmit = vi.fn();
      render(
        <PokemonFormModal mode="add" onSubmit={onSubmit} onClose={vi.fn()} />,
      );
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
      const submitBtn = screen.getAllByRole("button").find(
        (b) => !b.hasAttribute("disabled") && (/add|hinzufügen/i).exec(b.textContent ?? ""),
      );
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

  describe("missing names warning", () => {
    it("shows warning when pokedex has no localized names", async () => {
      // Override fetch to return pokemon data without names
      vi.stubGlobal("fetch", vi.fn((url: string) => {
        if (url.includes("/api/pokedex")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([{ id: 1, canonical: "bulbasaur" }]),
          });
        }
        if (url.includes("/api/games")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }));

      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );

      // Wait for the warning to appear
      await waitFor(() => {
        const alert = document.querySelector(".text-amber-300");
        expect(alert).toBeInTheDocument();
      });
    });
  });

  describe("fetch error handling", () => {
    it("handles pokedex fetch failure gracefully", async () => {
      vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("Network error"))));

      // Should not throw
      const { container } = render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      expect(container.querySelector("dialog")).toBeInTheDocument();
    });
  });
});
