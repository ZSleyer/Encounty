import { describe, it, expect, vi } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import { AddPokemonModal } from "./AddPokemonModal";

vi.mock("./PokemonFormModal", () => ({
  PokemonFormModal: vi.fn(
    ({
      mode,
      onSubmit,
      onClose,
    }: {
      mode: string;
      onSubmit: (data: { name: string }) => void;
      onClose: () => void;
    }) => (
      <div data-testid="form-modal" data-mode={mode}>
        <button onClick={() => onSubmit({ name: "Test" })}>submit</button>
        <button onClick={onClose}>close</button>
      </div>
    ),
  ),
}));

describe("AddPokemonModal", () => {
  it("renders PokemonFormModal in add mode", () => {
    render(<AddPokemonModal onAdd={vi.fn()} onClose={vi.fn()} />);
    const modal = screen.getByTestId("form-modal");
    expect(modal).toHaveAttribute("data-mode", "add");
  });

  it("calls onAdd when form submitted", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<AddPokemonModal onAdd={onAdd} onClose={vi.fn()} />);
    await user.click(screen.getByText("submit"));
    expect(onAdd).toHaveBeenCalledWith({ name: "Test" });
  });

  it("calls onClose when closed", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AddPokemonModal onAdd={vi.fn()} onClose={onClose} />);
    await user.click(screen.getByText("close"));
    expect(onClose).toHaveBeenCalled();
  });
});
