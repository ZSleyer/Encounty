import { describe, it, expect, vi } from "vitest";
import { render } from "../test-utils";
import { EditPokemonModal } from "./EditPokemonModal";

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

describe("EditPokemonModal", () => {
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
      <EditPokemonModal
        pokemon={pokemon}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelector("dialog")).toBeInTheDocument();
  });
});
