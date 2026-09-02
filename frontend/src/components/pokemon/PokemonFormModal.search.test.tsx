/**
 * PokemonFormModal.search.test.tsx: Species lookup in the Pokemon form modal: searching by name, form term or dex
 * number, and how the field copes with missing or unreachable pokedex data.
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
  describe("base species name in the search field", () => {
    it("keeps the base name after reaching a form through a form-term search", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      // A form-term search lists the owning base species; the form itself is
      // then picked from the strip.
      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);
      await userEvent.type(searchInput, "gmax");
      await waitFor(() => expect(screen.getByText("Pikachu")).toBeInTheDocument());
      await userEvent.click(screen.getByText("Pikachu"));

      await waitFor(() => expect(screen.getByText("Pikachu Gmax")).toBeInTheDocument());
      await userEvent.click(screen.getByText("Pikachu Gmax"));

      // The form is selected, but the search field shows the base name.
      await waitFor(() => expect(screen.getByText("#pikachu-gmax")).toBeInTheDocument());
      expect(searchInput).toHaveValue("Pikachu");
    });

    it("keeps the base name after switching to a form via the form strip", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
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
        <PokemonFormModal mode="edit" pokemon={gmaxPokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
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
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);
      await userEvent.type(searchInput, "25");

      await waitFor(() => {
        expect(screen.getByText("Pikachu")).toBeInTheDocument();
      });
    });
  });

  describe("missing names warning", () => {
    it("shows warning when pokedex has no localized names", async () => {
      // Override fetch to return pokemon data without names
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) => {
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
        }),
      );

      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);

      // Wait for the warning to appear
      await waitFor(() => {
        const alert = document.querySelector(".text-accent-yellow");
        expect(alert).toBeInTheDocument();
      });
    });
  });

  describe("fetch error handling", () => {
    it("handles pokedex fetch failure gracefully", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.reject(new Error("Network error"))),
      );

      // Should not throw
      const { container } = render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      expect(container.querySelector("dialog")).toBeInTheDocument();
    });
  });
});
