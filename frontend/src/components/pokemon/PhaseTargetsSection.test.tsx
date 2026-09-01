import { describe, it, expect, vi } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import { PhaseTargetsSection } from "./PhaseTargetsSection";
import type { PokemonData } from "./pokemonPicker";

/** Zigzagoon has a form strip, Rattata does not. */
const POKEDEX: PokemonData[] = [
  {
    id: 19,
    canonical: "rattata",
    names: { de: "Rattfratz", en: "Rattata" },
    forms: [],
  },
  {
    id: 263,
    canonical: "zigzagoon",
    names: { de: "Zigzachs", en: "Zigzagoon" },
    forms: [
      {
        canonical: "zigzagoon-galar",
        names: { de: "Galar Zigzachs", en: "Galarian Zigzagoon" },
        form_names: { de: "Galar-Form", en: "Galarian Form" },
        sprite_id: 10174,
      },
    ],
  },
];

/** Renders the section with an empty selection and a spy on the change handler. */
function renderSection() {
  const onChange = vi.fn();
  render(
    <PhaseTargetsSection
      targets={[]}
      onChange={onChange}
      allPokemon={POKEDEX}
      games={[]}
      selectedGame=""
      language="de"
      spriteStyle="box"
    />,
  );
  return onChange;
}

describe("PhaseTargetsSection", () => {
  it("does not add a species whose form strip has yet to be answered", async () => {
    // Picking the base is also what reveals the strip, so adding on that pick
    // would put Zigzagoon in the list of everyone who was after its Galar form.
    const onChange = renderSection();
    const user = userEvent.setup();

    await user.type(screen.getByRole("textbox"), "zigzachs");
    await user.click(await screen.findByRole("button", { name: /#263/ }));
    expect(onChange).not.toHaveBeenCalled();

    await user.click(await screen.findByRole("button", { name: /galar-form/i }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ canonical_name: "zigzagoon-galar" }),
    ]);
  });

  it("adds the base species straight from the strip", async () => {
    const onChange = renderSection();
    const user = userEvent.setup();

    await user.type(screen.getByRole("textbox"), "zigzachs");
    await user.click(await screen.findByRole("button", { name: /#263/ }));
    // The strip leads with the base, so the plain species stays one click away.
    const strip = await screen.findByRole("button", { name: /^zigzachs$/i });
    await user.click(strip);
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ canonical_name: "zigzagoon" }),
    ]);
  });

  it("adds a species without forms on the pick itself", async () => {
    const onChange = renderSection();
    const user = userEvent.setup();

    await user.type(screen.getByRole("textbox"), "rattfratz");
    await user.click(await screen.findByRole("button", { name: /#19/ }));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ canonical_name: "rattata" })]);
  });
});
