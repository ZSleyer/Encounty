import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, userEvent } from "../../test-utils";
import { PokedexSettingsModal } from "./PokedexSettingsModal";
import type { UserPokedex } from "../../utils/userPokedex";

const pokedex: UserPokedex = {
  id: "custom",
  name: "Kanto",
  show_forms: true,
  living_dex: false,
  name_language: "",
  generations: [1],
  target_games: ["red"],
  catch_games: [],
  form_categories: ["regional"],
  include_species: [25],
  exclude_species: [],
};
const games = [
  { key: "red", generation: 1, names: { de: "Rot" } },
  { key: "blue", generation: 1, names: { de: "Blau" } },
] as never[];

function setup(onSave = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(
    <PokedexSettingsModal pokedex={pokedex} games={games} onSave={onSave} onClose={onClose} />,
  );
  return { onSave, onClose };
}

describe("PokedexSettingsModal", () => {
  it("edits, normalizes, and saves every selector", async () => {
    const user = userEvent.setup();
    const { onSave, onClose } = setup();
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Living Dex");
    await user.click(screen.getByRole("checkbox", { name: "Gen 2" }));
    await user.selectOptions(screen.getAllByRole("combobox")[0], "blue");
    await user.click(screen.getByRole("button", { name: /Rot/ }));
    await user.click(screen.getByRole("checkbox", { name: /Mega/ }));
    fireEvent.change(screen.getByLabelText(/zusätzlich einschließen/), {
      target: { value: "25, 25, 151, nope, -1" },
    });
    fireEvent.change(screen.getByLabelText(/ausschließen/), { target: { value: "150" } });
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({
      name: "Living Dex",
      generations: [1, 2],
      target_games: ["blue"],
      include_species: [25, 151],
      exclude_species: [150],
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("saves the living dex flag", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    await user.click(screen.getByRole("checkbox", { name: /Entwicklungsstufe/ }));
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ living_dex: true });
  });

  it("saves a picked name language override", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    const trigger = screen.getByRole("button", { name: "Namenssprache" });
    expect(trigger).toHaveTextContent("UI-Sprache");
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Deutsch" }));
    expect(trigger).toHaveTextContent("Deutsch");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ name_language: "de" });
  });

  it("round-trips the auto (UI language) pseudo-option back to an empty override", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    const trigger = screen.getByRole("button", { name: "Namenssprache" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Deutsch" }));
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "UI-Sprache" }));
    expect(trigger).toHaveTextContent("UI-Sprache");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ name_language: "" });
  });

  it("guards dirty cancellation and reports save conflicts", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error("conflict"));
    const { onClose } = setup(onSave);
    await user.type(screen.getByLabelText("Name"), "!");
    await user.click(screen.getAllByRole("button", { name: "Abbrechen" }).slice(-1)[0]);
    expect(screen.getByText("Ausstehende Änderungen")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Abbrechen" }).slice(-1)[0]);
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
