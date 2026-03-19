import { describe, it, expect, vi } from "vitest";
import { render, screen, makePokemon } from "../../test-utils";
import { EditPokemonPanel } from "./EditPokemonPanel";

vi.stubGlobal(
  "fetch",
  vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve([]),
    }),
  ),
);

describe("EditPokemonPanel", () => {
  it("renders without crashing", () => {
    render(
      <EditPokemonPanel
        pokemon={makePokemon()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Speichern")).toBeInTheDocument();
    expect(screen.getByText("Abbrechen")).toBeInTheDocument();
  });

  it("displays the pokemon name", () => {
    render(
      <EditPokemonPanel
        pokemon={makePokemon({ name: "Glumanda" })}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Glumanda")).toBeInTheDocument();
  });

  it("calls onCancel when cancel is clicked", async () => {
    const onCancel = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <EditPokemonPanel
        pokemon={makePokemon()}
        onSave={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByText("Abbrechen"));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
