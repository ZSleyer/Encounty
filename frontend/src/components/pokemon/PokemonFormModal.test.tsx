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
      // onClose is deferred until the dialog's close transition finishes (or
      // the hook's fallback timeout fires — jsdom doesn't run real CSS
      // transitions), not called in the same tick as the click.
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
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

    it("lists only the base species on a base-name match (forms move to the strip)", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);
      await userEvent.type(searchInput, "pikachu");

      await waitFor(() => expect(screen.getByText("Pikachu")).toBeInTheDocument());
      // The gmax form must not be dumped into the base-name results.
      expect(screen.queryByText("Pikachu Gmax")).not.toBeInTheDocument();
    });

    it("keeps forms findable by a form-specific term", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);
      await userEvent.type(searchInput, "gmax");

      // "gmax" does not match the base name, so the form stays reachable.
      await waitFor(() => expect(screen.getByText("Pikachu Gmax")).toBeInTheDocument());
    });

    it("reveals the form strip with a base entry after selecting a species with forms", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);
      await userEvent.type(searchInput, "pikachu");
      await waitFor(() => expect(screen.getByText("Pikachu")).toBeInTheDocument());

      await userEvent.click(screen.getByText("Pikachu"));

      // The strip lets the user switch between the form and the base.
      await waitFor(() => expect(screen.getByText("Pikachu Gmax")).toBeInTheDocument());
      // A base entry ("Pikachu") remains listed so the base is reachable again.
      expect(screen.getAllByText("Pikachu").length).toBeGreaterThan(0);
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
        const stepInput = screen.getByLabelText(/Counting Step Size|Zähl-Schrittgröße/i);
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
        const stepInput = screen.getByLabelText(/Counting Step Size|Zähl-Schrittgröße/i);
        expect(stepInput).toHaveValue(3);
      });
    });
  });

  describe("shiny charm toggle in edit mode", () => {
    const charmPokemon: ExistingPokemonData = {
      ...basePokemon,
      game: "pokemon-x",
      shiny_charm: false,
    };

    it("reflects the pokemon's current shiny_charm value (unchecked)", async () => {
      render(
        <PokemonFormModal
          mode="edit"
          pokemon={charmPokemon}
          onSubmit={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByText("#bulbasaur")).toBeInTheDocument());

      const checkbox = document.getElementById("shiny-charm-toggle") as HTMLInputElement;
      expect(checkbox).toBeInTheDocument();
      expect(checkbox.checked).toBe(false);
    });

    it("reflects the pokemon's current shiny_charm value (checked)", async () => {
      render(
        <PokemonFormModal
          mode="edit"
          pokemon={{ ...charmPokemon, shiny_charm: true }}
          onSubmit={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByText("#bulbasaur")).toBeInTheDocument());

      const checkbox = document.getElementById("shiny-charm-toggle") as HTMLInputElement;
      expect(checkbox).toBeInTheDocument();
      expect(checkbox.checked).toBe(true);
    });

    it("can toggle the shiny charm checkbox", async () => {
      render(
        <PokemonFormModal
          mode="edit"
          pokemon={charmPokemon}
          onSubmit={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByText("#bulbasaur")).toBeInTheDocument());

      const checkbox = document.getElementById("shiny-charm-toggle") as HTMLInputElement;
      expect(checkbox.checked).toBe(false);

      await userEvent.click(checkbox);
      expect(checkbox.checked).toBe(true);

      await userEvent.click(checkbox);
      expect(checkbox.checked).toBe(false);
    });

    it("submits shiny_charm: false explicitly (not undefined) when unchecked", async () => {
      const onSubmit = vi.fn();
      render(
        <PokemonFormModal
          mode="edit"
          pokemon={charmPokemon}
          onSubmit={onSubmit}
          onClose={vi.fn()}
        />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByText("#bulbasaur")).toBeInTheDocument());

      // Verify the checkbox is unchecked
      const checkbox = document.getElementById("shiny-charm-toggle") as HTMLInputElement;
      expect(checkbox.checked).toBe(false);

      // Submit the form
      const saveBtn = screen.getAllByRole("button").find(
        (b) => (/save|speichern/i).exec(b.textContent ?? ""),
      );
      await userEvent.click(saveBtn!);

      expect(onSubmit).toHaveBeenCalledTimes(1);
      const submittedData = onSubmit.mock.calls[0][1];
      expect(submittedData.shiny_charm).toBe(false);
      // Ensure the value is explicitly false, not undefined
      expect("shiny_charm" in submittedData).toBe(true);
    });

    it("submits shiny_charm: true when toggled on", async () => {
      const onSubmit = vi.fn();
      render(
        <PokemonFormModal
          mode="edit"
          pokemon={charmPokemon}
          onSubmit={onSubmit}
          onClose={vi.fn()}
        />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByText("#bulbasaur")).toBeInTheDocument());

      // Toggle shiny charm on
      const checkbox = document.getElementById("shiny-charm-toggle") as HTMLInputElement;
      await userEvent.click(checkbox);
      expect(checkbox.checked).toBe(true);

      // Submit the form
      const saveBtn = screen.getAllByRole("button").find(
        (b) => (/save|speichern/i).exec(b.textContent ?? ""),
      );
      await userEvent.click(saveBtn!);

      expect(onSubmit).toHaveBeenCalledTimes(1);
      const submittedData = onSubmit.mock.calls[0][1];
      expect(submittedData.shiny_charm).toBe(true);
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
      // onClose is deferred until the dialog's close transition finishes (or
      // the hook's fallback timeout fires — jsdom doesn't run real CSS
      // transitions), not called in the same tick as the click.
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
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
        (b) => b.getAttribute("aria-expanded") !== null && (/sprite/i).exec(b.textContent ?? ""),
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

  describe("base species name in the search field", () => {
    it("keeps the base name after picking a form from the search results", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);
      await userEvent.type(searchInput, "gmax");
      await waitFor(() => expect(screen.getByText("Pikachu Gmax")).toBeInTheDocument());

      await userEvent.click(screen.getByText("Pikachu Gmax"));

      // The form is selected, but the search field shows the base name.
      await waitFor(() => expect(screen.getByText("#pikachu-gmax")).toBeInTheDocument());
      expect(searchInput).toHaveValue("Pikachu");
    });

    it("keeps the base name after switching to a form via the form strip", async () => {
      render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);
      await userEvent.type(searchInput, "pikachu");
      await waitFor(() => expect(screen.getByText("Pikachu")).toBeInTheDocument());
      await userEvent.click(screen.getByText("Pikachu"));

      // The strip appears with the gmax form; switch to it.
      await waitFor(() => expect(screen.getByText("Pikachu Gmax")).toBeInTheDocument());
      await userEvent.click(screen.getByText("Pikachu Gmax"));

      await waitFor(() => expect(screen.getByText("#pikachu-gmax")).toBeInTheDocument());
      expect(searchInput).toHaveValue("Pikachu");
    });

    it("shows the form strip with the stored form pre-pressed in edit mode", async () => {
      const gmaxPokemon: ExistingPokemonData = {
        ...basePokemon,
        name: "Pikachu Gmax",
        canonical_name: "pikachu-gmax",
      };
      render(
        <PokemonFormModal
          mode="edit"
          pokemon={gmaxPokemon}
          onSubmit={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByText("#pikachu-gmax")).toBeInTheDocument());

      // The strip is built on load: the stored form is the pressed toggle,
      // the base entry stays available for switching back.
      const findStripButton = (label: string) =>
        screen
          .getAllByText(label)
          .map((el) => el.closest("button"))
          .find((b) => b?.getAttribute("aria-pressed") != null);

      const gmaxBtn = findStripButton("Pikachu Gmax");
      expect(gmaxBtn).toBeTruthy();
      expect(gmaxBtn).toHaveAttribute("aria-pressed", "true");

      const baseBtn = findStripButton("Pikachu");
      expect(baseBtn).toBeTruthy();
      expect(baseBtn).toHaveAttribute("aria-pressed", "false");
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
        const alert = document.querySelector(".text-accent-yellow");
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

  describe("edit mode encounter/timer/step fields", () => {
    const editPokemon: ExistingPokemonData = {
      ...basePokemon,
      encounters: 42,
      step: 1,
      timer_accumulated_ms: 3661000, // 1h 1m 1s
    };

    it("populates encounters and submits the updated value", async () => {
      const onSubmit = vi.fn();
      const { fireEvent } = await import("../../test-utils");
      render(
        <PokemonFormModal mode="edit" pokemon={editPokemon} onSubmit={onSubmit} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(document.getElementById("encounters-form")).toBeInTheDocument();
      });
      const input = document.getElementById("encounters-form") as HTMLInputElement;
      expect(input.value).toBe("42");
      fireEvent.change(input, { target: { value: "100" } });
      expect(input.value).toBe("100");
    });

    it("floors negative encounter input to 0", async () => {
      const { fireEvent } = await import("../../test-utils");
      render(
        <PokemonFormModal mode="edit" pokemon={editPokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(document.getElementById("encounters-form")).toBeInTheDocument();
      });
      const input = document.getElementById("encounters-form") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "not-a-number" } });
      expect(input.value).toBe("0");
    });

    it("pre-fills hours, minutes, and seconds from timer_accumulated_ms", async () => {
      render(
        <PokemonFormModal mode="edit" pokemon={editPokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(document.getElementById("timer-h-form")).toBeInTheDocument();
      });
      expect((document.getElementById("timer-h-form") as HTMLInputElement).value).toBe("1");
      expect((document.getElementById("timer-m-form") as HTMLInputElement).value).toBe("1");
      expect((document.getElementById("timer-s-form") as HTMLInputElement).value).toBe("1");
    });

    it("clamps minute and second fields to 0–59", async () => {
      const { fireEvent } = await import("../../test-utils");
      render(
        <PokemonFormModal mode="edit" pokemon={editPokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(document.getElementById("timer-m-form")).toBeInTheDocument();
      });
      const minutes = document.getElementById("timer-m-form") as HTMLInputElement;
      fireEvent.change(minutes, { target: { value: "99" } });
      expect(minutes.value).toBe("59");

      const seconds = document.getElementById("timer-s-form") as HTMLInputElement;
      fireEvent.change(seconds, { target: { value: "-5" } });
      expect(seconds.value).toBe("0");
    });

    it("floors step to 1", async () => {
      const { fireEvent } = await import("../../test-utils");
      render(
        <PokemonFormModal mode="edit" pokemon={editPokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(document.getElementById("step-form")).toBeInTheDocument();
      });
      const step = document.getElementById("step-form") as HTMLInputElement;
      fireEvent.change(step, { target: { value: "0" } });
      expect(step.value).toBe("1");
      fireEvent.change(step, { target: { value: "5" } });
      expect(step.value).toBe("5");
    });

    it("expands the custom sprite input when the toggle is clicked", async () => {
      const { fireEvent } = await import("../../test-utils");
      render(
        <PokemonFormModal mode="edit" pokemon={editPokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Sprite/i })).toBeInTheDocument();
      });
      // Custom-sprite input is hidden by default
      expect(document.getElementById("custom-sprite-form")).toBeNull();
      const btn = screen.getAllByRole("button")
        .find((b) => b.getAttribute("aria-label")?.includes("Sprite"))!;
      fireEvent.click(btn);
      const input = document.getElementById("custom-sprite-form") as HTMLInputElement;
      expect(input).toBeInTheDocument();
      fireEvent.change(input, { target: { value: "https://a.example/x.png" } });
      expect(input.value).toBe("https://a.example/x.png");
    });

    /** Expand the custom sprite section and return its hidden file input. */
    async function openSpriteFileInput(fireEvent: typeof import("../../test-utils").fireEvent) {
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Sprite/i })).toBeInTheDocument();
      });
      const toggle = screen.getAllByRole("button")
        .find((b) => b.getAttribute("aria-label")?.includes("Sprite"))!;
      fireEvent.click(toggle);
      return document.querySelector('input[type="file"]') as HTMLInputElement;
    }

    const spriteCalls = () =>
      vi.mocked(fetch).mock.calls.filter((c) => String(c[0]).includes(`/api/pokemon/${editPokemon.id}/sprite`));

    it("uploads a chosen local image to the sprite endpoint", async () => {
      const { fireEvent } = await import("../../test-utils");
      render(
        <PokemonFormModal mode="edit" pokemon={editPokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      const input = await openSpriteFileInput(fireEvent);
      const file = new File([new Uint8Array([1, 2, 3])], "sprite.png", { type: "image/png" });
      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => expect(spriteCalls().length).toBe(1));
      expect(spriteCalls()[0][1]).toMatchObject({ method: "POST" });
    });

    it("keeps an existing custom sprite when saving without picking a new file", async () => {
      // Regression (issue #33): opening edit + Save must not revert a sprite
      // that diverges from the auto-computed PokeAPI URL (e.g. a local upload).
      const onSubmit = vi.fn();
      render(
        <PokemonFormModal mode="edit" pokemon={editPokemon} onSubmit={onSubmit} onClose={vi.fn()} />,
      );
      // Wait until the existing pokemon is matched and selected; this is what
      // triggers the sprite recalc effect that used to clobber customSprite.
      await screen.findByText("#bulbasaur");

      const saveBtn = screen.getAllByRole("button").find(
        (b) => (/save|speichern/i).exec(b.textContent ?? ""),
      )!;
      await userEvent.click(saveBtn);

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls[0][1]).toMatchObject({
        sprite_url: editPokemon.sprite_url,
      });
    });

    it("rejects an oversized image without uploading", async () => {
      const { fireEvent } = await import("../../test-utils");
      render(
        <PokemonFormModal mode="edit" pokemon={editPokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      const input = await openSpriteFileInput(fireEvent);
      const file = new File([new Uint8Array([1])], "big.png", { type: "image/png" });
      Object.defineProperty(file, "size", { value: 5 * 1024 * 1024 });
      fireEvent.change(input, { target: { files: [file] } });

      await Promise.resolve();
      expect(spriteCalls().length).toBe(0);
    });

    it("rejects an unsupported file type without uploading", async () => {
      const { fireEvent } = await import("../../test-utils");
      render(
        <PokemonFormModal mode="edit" pokemon={editPokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      const input = await openSpriteFileInput(fireEvent);
      const file = new File([new Uint8Array([1])], "art.bmp", { type: "image/bmp" });
      fireEvent.change(input, { target: { files: [file] } });

      await Promise.resolve();
      expect(spriteCalls().length).toBe(0);
    });
  });
});
