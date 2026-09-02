/**
 * PokemonFormModal.sprites.test.tsx: Sprite side of the Pokemon form modal: the shiny/normal toggle, the custom
 * sprite URL field and the thumbnail fallback chain.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, userEvent } from "../../test-utils";
import { PokemonFormModal } from "./PokemonFormModal";
import { cachedSpriteSrc } from "../../utils/sprites";

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

describe("PokemonFormModal", () => {
  describe("sprite variant toggle", () => {
    it("renders shiny and normal toggle buttons", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => {
        expect(screen.getByText("Shiny")).toBeInTheDocument();
        expect(screen.getByText("Normal")).toBeInTheDocument();
      });
    });

    it("can toggle between shiny and normal", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      const normalBtn = screen.getByText("Normal").closest("button")!;
      await userEvent.click(normalBtn);
      // After clicking Normal, it should be the active variant
      expect(normalBtn.className).toContain("accent-blue");
    });
  });

  describe("custom sprite URL", () => {
    it("hides the custom sprite input by default", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => {
        const customSpriteInput = document.getElementById("custom-sprite-form");
        expect(customSpriteInput).not.toBeInTheDocument();
      });
    });

    it("shows the custom sprite input when expanded", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);

      // Find the collapsible custom sprite toggle button
      const toggleBtn = screen
        .getAllByRole("button")
        .find(
          (b) => b.getAttribute("aria-expanded") !== null && /sprite/i.exec(b.textContent ?? ""),
        );
      expect(toggleBtn).toBeTruthy();
      await userEvent.click(toggleBtn!);

      const customSpriteInput = document.getElementById("custom-sprite-form");
      expect(customSpriteInput).toBeInTheDocument();
    });
  });

  describe("PokemonThumb fallback chain", () => {
    it("walks default sprite, Home 3D, box sprite, then the placeholder", async () => {
      const { fireEvent } = await import("../../test-utils");
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);
      await userEvent.type(searchInput, "bulba");
      await waitFor(() => expect(screen.getByText("Bisasam")).toBeInTheDocument());

      const img = screen.getByAltText("Bisasam") as HTMLImageElement;
      expect(img).toHaveAttribute(
        "src",
        cachedSpriteSrc(
          "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/1.png",
        ),
      );

      fireEvent.error(img);
      expect(img).toHaveAttribute(
        "src",
        cachedSpriteSrc(
          "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/shiny/1.png",
        ),
      );

      fireEvent.error(img);
      expect(img).toHaveAttribute(
        "src",
        cachedSpriteSrc(
          "https://raw.githubusercontent.com/msikma/pokesprite/master/pokemon-gen8/shiny/bulbasaur.png",
        ),
      );

      fireEvent.error(img);
      expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);

      // Terminal candidate: further errors keep the placeholder.
      fireEvent.error(img);
      expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    });

    it("starts cosmetic forms at the slug sprite and skips the Home 3D render", async () => {
      const { fireEvent } = await import("../../test-utils");
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      // Reach the cosmetic form via the strip; forms have no search rows.
      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);
      await userEvent.type(searchInput, "pikachu");
      await waitFor(() => expect(screen.getByText("Pikachu")).toBeInTheDocument());
      await userEvent.click(screen.getByText("Pikachu"));
      await waitFor(() => expect(screen.getByText("Pikachu Muster")).toBeInTheDocument());

      const img = screen
        .getByText("Pikachu Muster")
        .closest("button")!
        .querySelector("img") as HTMLImageElement;
      expect(img).toHaveAttribute(
        "src",
        cachedSpriteSrc(
          "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25-muster.png",
        ),
      );

      fireEvent.error(img);
      expect(img).toHaveAttribute(
        "src",
        cachedSpriteSrc(
          "https://raw.githubusercontent.com/msikma/pokesprite/master/pokemon-gen8/shiny/pikachu-muster.png",
        ),
      );

      fireEvent.error(img);
      expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    });
  });
});
