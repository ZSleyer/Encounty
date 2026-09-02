import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, userEvent } from "../../test-utils";
import { EndPhaseModal } from "./EndPhaseModal";
import type { Pokemon } from "../../types";

HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
});
HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute("open");
});

/** Sample pokedex data returned by /api/pokedex. */
const POKEDEX_DATA = [
  { id: 1, canonical: "bulbasaur", names: { de: "Bisasam", en: "Bulbasaur" }, forms: [] },
  { id: 4, canonical: "charmander", names: { de: "Glumanda", en: "Charmander" }, forms: [] },
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

/** Sample games data returned by /api/games. */
const GAMES_DATA = [{ key: "red", names: { de: "Rot", en: "Red" }, generation: 1, platform: "gb" }];

/** Fetch mock serving the pokedex and the game list. */
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

const parent: Pokemon = {
  id: "hunt-1",
  name: "Bisasam",
  canonical_name: "bulbasaur",
  sprite_url: "https://example.com/bulbasaur.png",
  sprite_type: "shiny",
  sprite_style: "box",
  encounters: 1234,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  language: "de",
  game: "red",
  overlay_mode: "default",
  hunt_type: "encounter",
  phase_targets: [
    { canonical_name: "pidgey", name: "Taubsi", sprite_url: "https://example.com/pidgey.png" },
    { canonical_name: "rattata", name: "Rattfratz", sprite_url: "https://example.com/rattata.png" },
  ],
};

/** Renders the modal with the shared parent fixture and optional overrides. */
function renderModal(overrides?: {
  parent?: Partial<Pokemon>;
  onSubmit?: (data: unknown) => Promise<void> | void;
  onClose?: () => void;
}) {
  return render(
    <EndPhaseModal
      parent={{ ...parent, ...overrides?.parent }}
      phaseNumber={3}
      encounters={1234}
      timerMs={1234000}
      onSubmit={overrides?.onSubmit ?? vi.fn()}
      onClose={overrides?.onClose ?? vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch());
  vi.mocked(HTMLDialogElement.prototype.showModal).mockClear();
  vi.mocked(HTMLDialogElement.prototype.close).mockClear();
});

describe("EndPhaseModal", () => {
  it("shows the phase summary with number, encounters and duration", () => {
    renderModal();
    expect(screen.getByText(/Phase 3/)).toBeInTheDocument();
    expect(screen.getByText(/1234/)).toBeInTheDocument();
    expect(screen.getByText(/00:20:34/)).toBeInTheDocument();
  });

  it("renders a chip per phase target of the parent", () => {
    renderModal();
    const chips = [
      screen.getByRole("button", { name: /taubsi/i }),
      screen.getByRole("button", { name: /rattfratz/i }),
    ];
    for (const chip of chips) {
      expect(chip).toHaveAttribute("aria-pressed", "false");
      // Decorative sprite: the button label already carries the name.
      expect(chip.querySelector("img")).toHaveAttribute("alt", "");
    }
    expect(chips[0].querySelector("img")).toHaveAttribute("src", "https://example.com/pidgey.png");
  });

  it("focuses the first chip when targets exist", async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /taubsi/i })).toHaveFocus();
    });
  });

  it("focuses the search field when the parent has no targets", async () => {
    renderModal({ parent: { phase_targets: [] } });
    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveFocus();
    });
  });

  it("submits the picked chip as the phase catch", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderModal({ onSubmit });

    const chip = screen.getByRole("button", { name: /taubsi/i });
    await user.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: /abschließen|complete/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      canonical_name: "pidgey",
      name: "Taubsi",
      sprite_url: "https://example.com/pidgey.png",
    });
  });

  it("recovers the form labels of a picked chip from the pokedex", async () => {
    // A phase target stores only canonical, name and sprite URL, so the labels
    // the phase archive keeps have to come back out of the pokedex. Without
    // them a phase ended from a chip loses which form it was.
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderModal({
      onSubmit,
      parent: {
        phase_targets: [
          {
            canonical_name: "zigzagoon-galar",
            name: "Galar Zigzachs",
            sprite_url: "https://example.com/zigzagoon-galar.png",
          },
        ],
      },
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole("button", { name: /galar zigzachs/i }));
    await user.click(screen.getByRole("button", { name: /abschließen|complete/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      canonical_name: "zigzagoon-galar",
      name: "Galar Zigzachs",
      base_name: "Zigzachs",
      form_name: "Galar-Form",
      sprite_url: "https://example.com/zigzagoon-galar.png",
    });
  });

  it("submits a species picked through the search", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderModal({ onSubmit });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    await user.type(screen.getByRole("textbox"), "charmander");
    await user.click(await screen.findByRole("button", { name: /glumanda/i }));
    await user.click(screen.getByRole("button", { name: /abschließen|complete/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      canonical_name: "charmander",
      name: "Glumanda",
      base_name: undefined,
      form_name: undefined,
      sprite_url:
        "https://raw.githubusercontent.com/msikma/pokesprite/master/pokemon-gen8/shiny/charmander.png",
    });
  });

  it("keeps the suggestion list reachable with the Tab key", async () => {
    // The search is the only way to a species that is not a phase target, so
    // the list must survive the focus move out of the input (WCAG 2.1.1).
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderModal({ onSubmit });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole("textbox"));
    await user.keyboard("charmander");
    const suggestion = await screen.findByRole("button", { name: /glumanda/i });

    await user.tab();
    expect(suggestion).toHaveFocus();
    expect(screen.getByRole("button", { name: /glumanda/i })).toBeInTheDocument();

    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: /abschließen|complete/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ canonical_name: "charmander" }),
    );
  });

  it("closes the suggestion list on Escape without closing the modal", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderModal({ onClose });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    const input = screen.getByRole("textbox");
    await user.click(input);
    await user.keyboard("charmander");
    const suggestion = await screen.findByRole("button", { name: /glumanda/i });
    await user.tab();
    expect(suggestion).toHaveFocus();

    // Escape must not travel further up: the browser would read it as a close
    // request for the surrounding <dialog>.
    const escapeOutside = vi.fn();
    document.addEventListener("keydown", escapeOutside);
    try {
      await user.keyboard("{Escape}");

      expect(screen.queryByRole("button", { name: /glumanda/i })).not.toBeInTheDocument();
      expect(input).toHaveFocus();
      expect(escapeOutside).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", escapeOutside);
    }
  });

  it("keeps confirm disabled until a species is picked", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderModal({ onSubmit });

    const confirm = screen.getByRole("button", { name: /abschließen|complete/i });
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("closes without submitting when canceled", async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderModal({ onSubmit, onClose });

    await user.click(screen.getByRole("button", { name: /abbrechen|cancel/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
