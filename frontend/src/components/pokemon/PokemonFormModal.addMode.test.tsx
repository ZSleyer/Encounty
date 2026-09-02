/**
 * PokemonFormModal.addMode.test.tsx: Add-mode behavior of the Pokemon form modal: the empty initial state, the
 * species search and what a fresh hunt submits.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, userEvent } from "../../test-utils";
import { PokemonFormModal } from "./PokemonFormModal";

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

describe("PokemonFormModal", () => {
  describe("add mode", () => {
    it("renders without crashing", async () => {
      const { container } = render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(container.querySelector("dialog")).toBeInTheDocument();
      });
    });

    it("renders cancel and add buttons inside the dialog", async () => {
      const { container } = render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        const buttons = container.querySelectorAll("dialog button");
        expect(buttons.length).toBeGreaterThan(0);
      });
    });

    it("calls showModal on mount", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => {
        expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
      });
    });

    it("displays the add title heading", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => {
        expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
      });
    });

    it("disables the submit button when no pokemon is selected", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => {
        // The add/submit button should be disabled
        const buttons = screen.getAllByRole("button");
        const addBtn = buttons.find((b) => b.hasAttribute("disabled"));
        expect(addBtn).toBeTruthy();
        expect(addBtn).toBeDisabled();
      });
    });

    it("does not call onSubmit when clicking add with no pokemon selected", async () => {
      const onSubmit = vi.fn();
      render(<PokemonFormModal mode="add" onSubmit={onSubmit} onClose={vi.fn()} />);
      // Find the disabled submit button and click it
      const buttons = screen.getAllByRole("button");
      const addBtn = buttons.find((b) => b.hasAttribute("disabled"));
      if (addBtn) await userEvent.click(addBtn);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("shows search input for pokemon selection", async () => {
      const { container } = render(
        <PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />,
      );
      await waitFor(() => {
        const searchInput = container.querySelector("input[type='text']");
        expect(searchInput).toBeInTheDocument();
      });
    });

    it("shows question mark placeholder when no pokemon is selected", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => {
        // Multiple "?" elements exist (main placeholder + sprite style previews)
        expect(screen.getAllByText("?").length).toBeGreaterThan(0);
      });
    });

    it("displays suggestions when typing a pokemon name", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      // Wait for pokedex data to load
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);
      // Search by canonical name; UI locale is "de" so display name is "Bisasam"
      await userEvent.type(searchInput, "bulba");

      await waitFor(() => {
        expect(screen.getByText("Bisasam")).toBeInTheDocument();
      });
    });

    it("selects a pokemon from search results", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);
      await userEvent.type(searchInput, "bulba");

      await waitFor(() => {
        expect(screen.getByText("Bisasam")).toBeInTheDocument();
      });

      // Click a suggestion
      await userEvent.click(screen.getByText("Bisasam"));

      // After selection, the canonical name should appear in the left column
      await waitFor(() => {
        expect(screen.getByText("#bulbasaur")).toBeInTheDocument();
      });
    });

    it("calls onSubmit and onClose when a pokemon is selected and submitted", async () => {
      const onSubmit = vi.fn();
      const onClose = vi.fn();
      render(<PokemonFormModal mode="add" onSubmit={onSubmit} onClose={onClose} />);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      // Select a pokemon using German name search
      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);
      await userEvent.type(searchInput, "Bisasam");
      await waitFor(() => expect(screen.getByText("Bisasam")).toBeInTheDocument());
      await userEvent.click(screen.getByText("Bisasam"));

      // Find and click the non-disabled submit button
      await waitFor(() => {
        const buttons = screen.getAllByRole("button");
        const submitBtn = buttons.find(
          (b) => !b.hasAttribute("disabled") && /add|hinzufügen/i.exec(b.textContent ?? ""),
        );
        expect(submitBtn).toBeTruthy();
      });

      const buttons = screen.getAllByRole("button");
      const submitBtn = buttons.find(
        (b) => !b.hasAttribute("disabled") && /add|hinzufügen/i.exec(b.textContent ?? ""),
      );
      await userEvent.click(submitBtn!);

      expect(onSubmit).toHaveBeenCalledTimes(1);
      // onClose is deferred until the dialog's close transition finishes (or
      // the hook's fallback timeout fires, jsdom does not run real CSS
      // transitions), not called in the same tick as the click.
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it("shows browse mode suggestions when input is focused with empty query", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);

      // Browse mode shows German names since locale is "de"
      await waitFor(() => {
        expect(screen.getByText("Bisasam")).toBeInTheDocument();
      });
    });

    it("lists only the base species on a base-name match (forms move to the strip)", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);
      await userEvent.type(searchInput, "pikachu");

      await waitFor(() => expect(screen.getByText("Pikachu")).toBeInTheDocument());
      // The gmax form must not be dumped into the base-name results.
      expect(screen.queryByText("Pikachu Gmax")).not.toBeInTheDocument();
    });

    it("lists the base species when only a form-specific term matches", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);
      await userEvent.type(searchInput, "gmax");

      // "gmax" does not match the base name, but the owning species is listed
      // so the form stays reachable via the strip. The form itself never
      // appears as a search row.
      await waitFor(() => expect(screen.getByText("Pikachu")).toBeInTheDocument());
      expect(screen.queryByText("Pikachu Gmax")).not.toBeInTheDocument();
    });

    it("reveals the form strip with a base entry after selecting a species with forms", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

      const searchInput = screen.getByPlaceholderText(/pok.mon/i);
      await userEvent.click(searchInput);
      await userEvent.type(searchInput, "pikachu");
      await waitFor(() => expect(screen.getByText("Pikachu")).toBeInTheDocument());

      await userEvent.click(screen.getByText("Pikachu"));

      // The strip lets the user switch between the form and the base.
      await waitFor(() => expect(screen.getByText("Pikachu Gmax")).toBeInTheDocument());
      // A base entry ("Pikachu") remains listed so the base is reachable again.
      expect(screen.getAllByText("Pikachu").length).toBeGreaterThan(0);
    });

    it("fetches pokedex and games data on mount", async () => {
      render(<PokemonFormModal mode="add" onSubmit={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledTimes(2);
      });
      const calls = vi.mocked(fetch).mock.calls.map((c) => {
        const url = c[0];
        return typeof url === "string" ? url : (url as Request).url;
      });
      expect(calls.some((u) => u.includes("/api/pokedex"))).toBe(true);
      expect(calls.some((u) => u.includes("/api/games"))).toBe(true);
    });
  });
});
