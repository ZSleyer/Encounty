import { describe, expect, it, vi } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import { PokedexAssignmentModal } from "./PokedexAssignmentModal";
import { pokemonInPokedex } from "../../utils/userPokedex";

vi.mock("../pokemon/pokemonPicker", () => ({ usePokedex: () => ({ allPokemon: [], games: [] }) }));
vi.mock("../../hooks/useUserPokedexes", () => ({
  useUserPokedexes: () => ({ pokedexes: [{ id: "one", name: "Kanto" }] }),
}));
vi.mock("../../utils/userPokedex", async (load) => ({
  ...(await load<typeof import("../../utils/userPokedex")>()),
  pokemonInPokedex: vi.fn(),
}));

describe("PokedexAssignmentModal", () => {
  it("requires and saves an eligible selection", async () => {
    vi.mocked(pokemonInPokedex).mockReturnValue(true);
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PokedexAssignmentModal pokemon={{} as never} onSave={onSave} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Bestätigen" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Kanto" }));
    await user.click(screen.getByRole("button", { name: "Bestätigen" }));
    expect(onSave).toHaveBeenCalledWith(["one"]);
  });

  it("explains when no pokedex is eligible", () => {
    vi.mocked(pokemonInPokedex).mockReturnValue(false);
    render(<PokedexAssignmentModal pokemon={{} as never} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/kein Pokédex/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bestätigen" })).toBeEnabled();
  });
});
