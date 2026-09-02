/**
 * PokemonFormModal.gameSettings.test.tsx: Game-dependent fields of the Pokemon form modal: the game and hunt method
 * dropdowns and the options a game unlocks (Shiny Charm, Sparkling Power).
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
  const getGameSelect = () => document.getElementById("game-select-form") as HTMLSelectElement;

  const getHuntTypeSelect = () =>
    document.getElementById("hunt-type-select-form") as HTMLSelectElement;

  describe("game selection", () => {
    it("renders a game select dropdown", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => {
        expect(getGameSelect()).toBeInTheDocument();
      });
    });

    it("shows 'no game' default option", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => {
        expect(getGameSelect()).toHaveValue("");
      });
    });

    it("populates game options after loading", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      await waitFor(() => {
        const gameSelect = getGameSelect();
        // At least the "no game" option plus loaded games
        expect(gameSelect.options.length).toBeGreaterThan(1);
      });
    });

    it("offers the shiny variant only for Sword and Shield", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => expect(getGameSelect().options.length).toBeGreaterThan(1));
      expect(
        screen.queryByRole("radiogroup", { name: /Shiny-Variante/i, hidden: true }),
      ).toBeNull();

      await userEvent.selectOptions(getGameSelect(), "pokemon-sword");
      const group = await screen.findByRole("radiogroup", {
        name: /Shiny-Variante/i,
        hidden: true,
      });
      expect(group).toBeInTheDocument();

      // Switching to a game without the mechanic hides it again.
      await userEvent.selectOptions(getGameSelect(), "red");
      await waitFor(() => {
        expect(
          screen.queryByRole("radiogroup", { name: /Shiny-Variante/i, hidden: true }),
        ).toBeNull();
      });
    });

    it("drops a chosen shiny variant when the game changes", async () => {
      const onSubmit = vi.fn();
      render(<PokemonFormModal mode="add" onSubmit={onSubmit} onClose={vi.fn()} />);
      await waitFor(() => expect(getGameSelect().options.length).toBeGreaterThan(1));

      await userEvent.selectOptions(getGameSelect(), "pokemon-sword");
      await userEvent.click(await screen.findByRole("radio", { name: "Square", hidden: true }));
      expect(screen.getByRole("radio", { name: "Square", hidden: true })).toHaveAttribute(
        "aria-checked",
        "true",
      );

      await userEvent.selectOptions(getGameSelect(), "red");
      await userEvent.selectOptions(getGameSelect(), "pokemon-sword");
      await waitFor(() => {
        expect(screen.getByRole("radio", { name: "Egal", hidden: true })).toHaveAttribute(
          "aria-checked",
          "true",
        );
      });
    });

    it("allows selecting a game", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      await waitFor(() => {
        expect(getGameSelect().options.length).toBeGreaterThan(1);
      });

      await userEvent.selectOptions(getGameSelect(), "red");
      expect(getGameSelect()).toHaveValue("red");
    });

    it("pre-selects game in edit mode", async () => {
      render(
        <PokemonFormModal mode="edit" pokemon={basePokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      await waitFor(() => {
        expect(getGameSelect().options.length).toBeGreaterThan(1);
      });

      expect(getGameSelect()).toHaveValue("red");
    });
  });

  describe("hunt type selection", () => {
    it("renders a hunt type select", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => {
        expect(getHuntTypeSelect()).toBeInTheDocument();
      });
    });

    it("defaults to encounter hunt type", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => {
        expect(getHuntTypeSelect()).toHaveValue("encounter");
      });
    });

    it("allows changing the hunt type", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await userEvent.selectOptions(getHuntTypeSelect(), "soft_reset");
      expect(getHuntTypeSelect()).toHaveValue("soft_reset");
    });
  });

  describe("sparkling power select in edit mode", () => {
    const svPokemon: ExistingPokemonData = {
      ...basePokemon,
      game: "pokemon-scarlet",
      hunt_type: "encounter",
      sparkling_power: 2,
    };

    async function renderForm(pokemon: ExistingPokemonData, onSubmit = vi.fn()) {
      render(
        <PokemonFormModal mode="edit" pokemon={pokemon} onSubmit={onSubmit} onClose={vi.fn()} />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByText("#bulbasaur")).toBeInTheDocument());
      return onSubmit;
    }

    it("preselects the stored level", async () => {
      await renderForm(svPokemon);
      const select = document.getElementById("sparkling-power-select") as HTMLSelectElement;
      expect(select).toBeInTheDocument();
      expect(select.value).toBe("2");
    });

    it("stays hidden for a game without Sparkling Power", async () => {
      await renderForm({ ...svPokemon, game: "pokemon-sword", sparkling_power: 0 });
      expect(document.getElementById("sparkling-power-select")).toBeNull();
    });

    it("submits the selected level", async () => {
      const onSubmit = await renderForm(svPokemon);
      const select = document.getElementById("sparkling-power-select") as HTMLSelectElement;
      await userEvent.selectOptions(select, "3");

      const saveBtn = screen
        .getAllByRole("button")
        .find((b) => /save|speichern/i.exec(b.textContent ?? ""));
      await userEvent.click(saveBtn!);

      expect(onSubmit).toHaveBeenCalledTimes(1);
      const submittedData = onSubmit.mock.calls[0][1];
      expect(submittedData.sparkling_power).toBe(3);
      expect("sparkling_power" in submittedData).toBe(true);
    });

    it("drops the level when the method cannot use it", async () => {
      const onSubmit = await renderForm(svPokemon);
      await userEvent.selectOptions(
        document.getElementById("hunt-type-select-form") as HTMLSelectElement,
        "tera_raid",
      );
      expect(document.getElementById("sparkling-power-select")).toBeNull();

      const saveBtn = screen
        .getAllByRole("button")
        .find((b) => /save|speichern/i.exec(b.textContent ?? ""));
      await userEvent.click(saveBtn!);
      expect(onSubmit.mock.calls[0][1].sparkling_power).toBe(0);
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
      const saveBtn = screen
        .getAllByRole("button")
        .find((b) => /save|speichern/i.exec(b.textContent ?? ""));
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
      const saveBtn = screen
        .getAllByRole("button")
        .find((b) => /save|speichern/i.exec(b.textContent ?? ""));
      await userEvent.click(saveBtn!);

      expect(onSubmit).toHaveBeenCalledTimes(1);
      const submittedData = onSubmit.mock.calls[0][1];
      expect(submittedData.shiny_charm).toBe(true);
    });
  });
});
