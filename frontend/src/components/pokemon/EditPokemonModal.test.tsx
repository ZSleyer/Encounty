import { describe, it, expect, vi } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import { EditPokemonModal } from "./EditPokemonModal";

vi.mock("./PokemonFormModal", () => ({
  PokemonFormModal: vi.fn(
    ({
      mode,
      pokemon,
      onSubmit,
      onClose,
    }: {
      mode: string;
      pokemon?: { id: string; name: string };
      onSubmit: (id: string, data: { name: string }) => void;
      onClose: () => void;
    }) => (
      <div data-testid="form-modal" data-mode={mode} data-pokemon-name={pokemon?.name}>
        <button onClick={() => onSubmit(pokemon?.id ?? "", { name: "Updated" })}>submit</button>
        <button onClick={onClose}>close</button>
      </div>
    ),
  ),
}));

const pokemonFixture = {
  id: "poke-edit-1",
  name: "Glumanda",
  canonical_name: "charmander",
  sprite_url: "https://example.com/charmander.png",
  sprite_type: "normal" as const,
  language: "de",
  game: "red",
};

describe("EditPokemonModal", () => {
  it("renders PokemonFormModal in edit mode with pokemon data", () => {
    render(
      <EditPokemonModal pokemon={pokemonFixture} onSave={vi.fn()} onClose={vi.fn()} />,
    );
    const modal = screen.getByTestId("form-modal");
    expect(modal).toHaveAttribute("data-mode", "edit");
    expect(modal).toHaveAttribute("data-pokemon-name", "Glumanda");
  });

  it("calls onSave with pokemon id when form submitted", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <EditPokemonModal pokemon={pokemonFixture} onSave={onSave} onClose={vi.fn()} />,
    );
    await user.click(screen.getByText("submit"));
    expect(onSave).toHaveBeenCalledWith("poke-edit-1", { name: "Updated" });
  });

  it("calls onClose when closed", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <EditPokemonModal pokemon={pokemonFixture} onSave={vi.fn()} onClose={onClose} />,
    );
    await user.click(screen.getByText("close"));
    expect(onClose).toHaveBeenCalled();
  });
});
