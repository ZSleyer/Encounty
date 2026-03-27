import { describe, it, expect, vi } from "vitest";
import { render } from "../../test-utils";
import { PokemonFormModal } from "./PokemonFormModal";

HTMLDialogElement.prototype.showModal = vi.fn();
HTMLDialogElement.prototype.close = vi.fn();

vi.stubGlobal(
  "fetch",
  vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve([]),
    }),
  ),
);

describe("PokemonFormModal", () => {
  describe("add mode", () => {
    it("renders without crashing", () => {
      const { container } = render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      expect(container.querySelector("dialog")).toBeInTheDocument();
    });

    it("renders cancel and add buttons inside the dialog", () => {
      const { container } = render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      const buttons = container.querySelectorAll("dialog button");
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  describe("edit mode", () => {
    const pokemon = {
      id: "poke-1",
      name: "Bisasam",
      canonical_name: "bulbasaur",
      sprite_url: "https://example.com/sprite.png",
      sprite_type: "shiny" as const,
      language: "de",
      game: "red",
    };

    it("renders without crashing", () => {
      const { container } = render(
        <PokemonFormModal
          mode="edit"
          pokemon={pokemon}
          onSubmit={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      expect(container.querySelector("dialog")).toBeInTheDocument();
    });
  });
});
