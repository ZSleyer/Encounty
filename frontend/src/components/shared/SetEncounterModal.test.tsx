import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, makePokemon } from "../../test-utils";
import { SetEncounterModal } from "./SetEncounterModal";

// HTMLDialogElement.showModal is not implemented in jsdom
HTMLDialogElement.prototype.showModal = vi.fn();
HTMLDialogElement.prototype.close = vi.fn();

/** Helper to find the encounter count input by its id attribute. */
function getInput(): HTMLInputElement {
  return document.getElementById("encounter-count") as HTMLInputElement;
}

describe("SetEncounterModal", () => {
  const defaultPokemon = makePokemon({ name: "Pikachu", encounters: 42 });

  it("renders with current encounter count in the input", () => {
    render(
      <SetEncounterModal
        pokemon={defaultPokemon}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(getInput().value).toBe("42");
  });

  it("renders the pokemon name", () => {
    render(
      <SetEncounterModal
        pokemon={defaultPokemon}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Pikachu")).toBeInTheDocument();
  });

  it("allows the user to change the input value", async () => {
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <SetEncounterModal
        pokemon={defaultPokemon}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const input = getInput();
    await user.clear(input);
    await user.type(input, "100");
    expect(input.value).toBe("100");
  });

  it("calls onSave with the new value when save button is clicked", async () => {
    const onSave = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    const { container } = render(
      <SetEncounterModal
        pokemon={defaultPokemon}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    const input = getInput();
    await user.clear(input);
    await user.type(input, "100");

    // Dialog content is hidden to accessibility in jsdom, so query buttons via DOM
    const buttons = container.querySelectorAll("dialog button");
    // [0] = X close, [1] = cancel, [2] = save
    await user.click(buttons[2]);

    expect(onSave).toHaveBeenCalledWith(100);
  });

  it("calls onClose when cancel button is clicked", async () => {
    const onClose = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    const { container } = render(
      <SetEncounterModal
        pokemon={defaultPokemon}
        onSave={vi.fn()}
        onClose={onClose}
      />,
    );
    const buttons = container.querySelectorAll("dialog button");
    await user.click(buttons[1]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when the X close button is clicked", async () => {
    const onClose = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    const { container } = render(
      <SetEncounterModal
        pokemon={defaultPokemon}
        onSave={vi.fn()}
        onClose={onClose}
      />,
    );
    const buttons = container.querySelectorAll("dialog button");
    await user.click(buttons[0]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("submits on Enter key press", () => {
    const onSave = vi.fn();
    render(
      <SetEncounterModal
        pokemon={defaultPokemon}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    fireEvent.keyDown(getInput(), { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith(42);
  });

  it("clamps negative values to zero on save", () => {
    const onSave = vi.fn();
    const pokemon = makePokemon({ encounters: -5 });
    render(
      <SetEncounterModal
        pokemon={pokemon}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    fireEvent.keyDown(getInput(), { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith(0);
  });

  it("treats empty input as zero", async () => {
    const onSave = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <SetEncounterModal
        pokemon={defaultPokemon}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    await user.clear(getInput());
    fireEvent.keyDown(getInput(), { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith(0);
  });

  it("renders the dialog element", () => {
    const { container } = render(
      <SetEncounterModal
        pokemon={defaultPokemon}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelector("dialog")).toBeInTheDocument();
  });
});
