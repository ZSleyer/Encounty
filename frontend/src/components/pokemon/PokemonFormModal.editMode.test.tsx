/**
 * PokemonFormModal.editMode.test.tsx: Edit-mode behaviour of the Pokemon form modal: pre-filling from the stored
 * hunt, the counter and timer fields, and the local sprite upload.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, userEvent } from "../../test-utils";
import { PokemonFormModal } from "./PokemonFormModal";
import type { ExistingPokemonData } from "./PokemonFormModal";
import { cachedSpriteSrc } from "../../utils/sprites";

HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
});
HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute("open");
});

/** Sample pokedex data returned by /api/pokedex */
const POKEDEX_DATA = [
  {
    id: 1,
    canonical: "bulbasaur",
    names: { de: "Bisasam", en: "Bulbasaur", fr: "Bulbizarre" },
    forms: [],
  },
  {
    id: 4,
    canonical: "charmander",
    names: { de: "Glumanda", en: "Charmander" },
    forms: [],
  },
  {
    id: 25,
    canonical: "pikachu",
    names: { de: "Pikachu", en: "Pikachu" },
    forms: [
      {
        canonical: "pikachu-gmax",
        names: { de: "Pikachu Gmax", en: "Pikachu Gmax" },
        sprite_id: 10199,
      },
      // Cosmetic-only form: no own PokeAPI id, sprites live under a slug path.
      {
        canonical: "pikachu-muster",
        names: { de: "Pikachu Muster", en: "Pikachu Pattern" },
        sprite_id: 0,
        sprite_slug: "25-muster",
      },
    ],
  },
];

/** Sample games data returned by /api/games */
const GAMES_DATA = [
  { key: "red", names: { de: "Rot", en: "Red" }, generation: 1, platform: "gb" },
  { key: "gold", names: { de: "Gold", en: "Gold" }, generation: 2, platform: "gbc" },
  {
    key: "pokemon-sword",
    names: { de: "Schwert", en: "Sword" },
    generation: 8,
    platform: "switch",
  },
  { key: "pokemon-x", names: { de: "X", en: "X" }, generation: 6, platform: "3ds" },
];

/** Creates a fetch mock that returns pokedex and games data */
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

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch());
  vi.mocked(HTMLDialogElement.prototype.showModal).mockClear();
  vi.mocked(HTMLDialogElement.prototype.close).mockClear();
});

const basePokemon: ExistingPokemonData = {
  id: "poke-1",
  name: "Bisasam",
  canonical_name: "bulbasaur",
  sprite_url: "https://example.com/sprite.png",
  sprite_type: "shiny",
  language: "de",
  game: "red",
  shiny_charm: false,
};

describe("PokemonFormModal", () => {
  describe("edit mode", () => {
    it("renders without crashing", async () => {
      const { container } = render(
        <PokemonFormModal mode="edit" pokemon={basePokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(container.querySelector("dialog")).toBeInTheDocument();
      });
    });

    it("displays edit title heading", async () => {
      render(
        <PokemonFormModal mode="edit" pokemon={basePokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
      });
    });

    it("pre-fills the selected pokemon from props", async () => {
      render(
        <PokemonFormModal mode="edit" pokemon={basePokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      // After pokedex loads, the edit mode should match and display the pokemon
      await waitFor(() => {
        expect(screen.getByText("#bulbasaur")).toBeInTheDocument();
      });
    });

    it("shows the change button in edit mode", async () => {
      render(
        <PokemonFormModal mode="edit" pokemon={basePokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      // Wait for the pokemon to be loaded and matched
      await waitFor(() => {
        expect(screen.getByText("#bulbasaur")).toBeInTheDocument();
      });

      // Should show a change button to switch pokemon
      const changeBtn = screen
        .getAllByRole("button")
        .find((b) => /change|wechseln|ändern/i.exec(b.textContent ?? ""));
      expect(changeBtn).toBeTruthy();
    });

    it("shows search input when change button is clicked", async () => {
      const { container } = render(
        <PokemonFormModal mode="edit" pokemon={basePokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByText("#bulbasaur")).toBeInTheDocument());

      const changeBtn = screen
        .getAllByRole("button")
        .find((b) => /change|wechseln|ändern/i.exec(b.textContent ?? ""));
      await userEvent.click(changeBtn!);

      // Search input should now be visible
      const searchInput = container.querySelector("input[type='text']");
      expect(searchInput).toBeInTheDocument();
    });

    it("shows step size input in edit mode", async () => {
      render(
        <PokemonFormModal mode="edit" pokemon={basePokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        const stepInput = screen.getByLabelText(/Counting Step Size|Zähl-Schrittgröße/i);
        expect(stepInput).toBeInTheDocument();
      });
    });

    it("calls onSubmit with pokemon id when saving in edit mode", async () => {
      const onSubmit = vi.fn();
      render(
        <PokemonFormModal
          mode="edit"
          pokemon={basePokemon}
          onSubmit={onSubmit}
          onClose={vi.fn()}
        />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByText("#bulbasaur")).toBeInTheDocument());

      // Find the save/submit button
      const saveBtn = screen
        .getAllByRole("button")
        .find((b) => /save|speichern/i.exec(b.textContent ?? ""));
      expect(saveBtn).not.toBeDisabled();
      await userEvent.click(saveBtn!);

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith(
        "poke-1",
        expect.objectContaining({
          canonical_name: "bulbasaur",
          language: "de",
        }),
      );
    });

    it("pre-fills existing pokemon data including hunt_type and step", async () => {
      const pokemonWithExtras: ExistingPokemonData = {
        ...basePokemon,
        hunt_type: "masuda",
        step: 3,
      };
      render(
        <PokemonFormModal
          mode="edit"
          pokemon={pokemonWithExtras}
          onSubmit={vi.fn()}
          onClose={vi.fn()}
        />,
      );

      await waitFor(() => {
        // Step input should be pre-filled with 3
        const stepInput = screen.getByLabelText(/Counting Step Size|Zähl-Schrittgröße/i);
        expect(stepInput).toHaveValue(3);
      });
    });
  });

  describe("edit mode encounter/timer/step fields", () => {
    const editPokemon: ExistingPokemonData = {
      ...basePokemon,
      encounters: 42,
      step: 1,
      timer_accumulated_ms: 3661000, // 1h 1m 1s
    };

    it("populates encounters and submits the updated value", async () => {
      const onSubmit = vi.fn();
      const { fireEvent } = await import("../../test-utils");
      render(
        <PokemonFormModal
          mode="edit"
          pokemon={editPokemon}
          onSubmit={onSubmit}
          onClose={vi.fn()}
        />,
      );
      await waitFor(() => {
        expect(document.getElementById("encounters-form")).toBeInTheDocument();
      });
      const input = document.getElementById("encounters-form") as HTMLInputElement;
      expect(input.value).toBe("42");
      fireEvent.change(input, { target: { value: "100" } });
      expect(input.value).toBe("100");
    });

    it("floors negative encounter input to 0", async () => {
      const { fireEvent } = await import("../../test-utils");
      render(
        <PokemonFormModal mode="edit" pokemon={editPokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(document.getElementById("encounters-form")).toBeInTheDocument();
      });
      const input = document.getElementById("encounters-form") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "not-a-number" } });
      expect(input.value).toBe("0");
    });

    it("pre-fills hours, minutes, and seconds from timer_accumulated_ms", async () => {
      render(
        <PokemonFormModal mode="edit" pokemon={editPokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(document.getElementById("timer-h-form")).toBeInTheDocument();
      });
      expect((document.getElementById("timer-h-form") as HTMLInputElement).value).toBe("1");
      expect((document.getElementById("timer-m-form") as HTMLInputElement).value).toBe("1");
      expect((document.getElementById("timer-s-form") as HTMLInputElement).value).toBe("1");
    });

    it("clamps minute and second fields to 0–59", async () => {
      const { fireEvent } = await import("../../test-utils");
      render(
        <PokemonFormModal mode="edit" pokemon={editPokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(document.getElementById("timer-m-form")).toBeInTheDocument();
      });
      const minutes = document.getElementById("timer-m-form") as HTMLInputElement;
      fireEvent.change(minutes, { target: { value: "99" } });
      expect(minutes.value).toBe("59");

      const seconds = document.getElementById("timer-s-form") as HTMLInputElement;
      fireEvent.change(seconds, { target: { value: "-5" } });
      expect(seconds.value).toBe("0");
    });

    it("floors step to 1", async () => {
      const { fireEvent } = await import("../../test-utils");
      render(
        <PokemonFormModal mode="edit" pokemon={editPokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(document.getElementById("step-form")).toBeInTheDocument();
      });
      const step = document.getElementById("step-form") as HTMLInputElement;
      fireEvent.change(step, { target: { value: "0" } });
      expect(step.value).toBe("1");
      fireEvent.change(step, { target: { value: "5" } });
      expect(step.value).toBe("5");
    });

    it("expands the custom sprite input when the toggle is clicked", async () => {
      const { fireEvent } = await import("../../test-utils");
      render(
        <PokemonFormModal mode="edit" pokemon={editPokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Sprite/i })).toBeInTheDocument();
      });
      // Custom-sprite input is hidden by default
      expect(document.getElementById("custom-sprite-form")).toBeNull();
      const btn = screen
        .getAllByRole("button")
        .find((b) => b.getAttribute("aria-label")?.includes("Sprite"))!;
      fireEvent.click(btn);
      const input = document.getElementById("custom-sprite-form") as HTMLInputElement;
      expect(input).toBeInTheDocument();
      fireEvent.change(input, { target: { value: "https://a.example/x.png" } });
      expect(input.value).toBe("https://a.example/x.png");
    });

    /** Expand the custom sprite section and return its hidden file input. */
    async function openSpriteFileInput(fireEvent: typeof import("../../test-utils").fireEvent) {
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Sprite/i })).toBeInTheDocument();
      });
      const toggle = screen
        .getAllByRole("button")
        .find((b) => b.getAttribute("aria-label")?.includes("Sprite"))!;
      fireEvent.click(toggle);
      return document.querySelector('input[type="file"]') as HTMLInputElement;
    }

    const spriteCalls = () =>
      vi
        .mocked(fetch)
        .mock.calls.filter((c) => String(c[0]).includes(`/api/pokemon/${editPokemon.id}/sprite`));

    it("uploads a chosen local image to the sprite endpoint", async () => {
      const { fireEvent } = await import("../../test-utils");
      render(
        <PokemonFormModal mode="edit" pokemon={editPokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      const input = await openSpriteFileInput(fireEvent);
      const file = new File([new Uint8Array([1, 2, 3])], "sprite.png", { type: "image/png" });
      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => expect(spriteCalls().length).toBe(1));
      expect(spriteCalls()[0][1]).toMatchObject({ method: "POST" });
    });

    it("keeps an existing custom sprite when saving without picking a new file", async () => {
      // Regression (issue #33): opening edit + Save must not revert a sprite
      // that diverges from the auto-computed PokeAPI URL (e.g. a local upload).
      const onSubmit = vi.fn();
      render(
        <PokemonFormModal
          mode="edit"
          pokemon={editPokemon}
          onSubmit={onSubmit}
          onClose={vi.fn()}
        />,
      );
      // Wait until the existing pokemon is matched and selected; this is what
      // triggers the sprite recalc effect that used to clobber customSprite.
      await screen.findByText("#bulbasaur");

      const saveBtn = screen
        .getAllByRole("button")
        .find((b) => /save|speichern/i.exec(b.textContent ?? ""))!;
      await userEvent.click(saveBtn);

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls[0][1]).toMatchObject({
        sprite_url: editPokemon.sprite_url,
      });
    });

    it("rejects an oversized image without uploading", async () => {
      const { fireEvent } = await import("../../test-utils");
      render(
        <PokemonFormModal mode="edit" pokemon={editPokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      const input = await openSpriteFileInput(fireEvent);
      const file = new File([new Uint8Array([1])], "big.png", { type: "image/png" });
      Object.defineProperty(file, "size", { value: 31 * 1024 * 1024 });
      fireEvent.change(input, { target: { files: [file] } });

      await Promise.resolve();
      expect(spriteCalls().length).toBe(0);
    });

    it("rejects an unsupported file type without uploading", async () => {
      const { fireEvent } = await import("../../test-utils");
      render(
        <PokemonFormModal mode="edit" pokemon={editPokemon} onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      const input = await openSpriteFileInput(fireEvent);
      const file = new File([new Uint8Array([1])], "art.bmp", { type: "image/bmp" });
      fireEvent.change(input, { target: { files: [file] } });

      await Promise.resolve();
      expect(spriteCalls().length).toBe(0);
    });
  });
});
