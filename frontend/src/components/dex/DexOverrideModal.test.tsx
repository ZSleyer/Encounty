/**
 * DexOverrideModal.test.tsx: the caught/seen editor itself, meaning its
 * header, its scope pickers, the toggles and what one save writes.
 *
 * The fetch stub and render helpers below are per file: every split suite of
 * this modal carries the ones its own cases rely on.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "../../test-utils";
import { DexOverrideModal } from "./DexOverrideModal";
import type { DexOverride } from "../../utils/dex";
import type { PokemonData } from "../pokemon/pokemonPicker";

/** Pokedex response used by usePokedex() inside the modal. */
function pokedexResponse(): PokemonData[] {
  return [
    {
      id: 906,
      canonical: "sprigatito",
      gender_rate: 4,
      names: { en: "Sprigatito" },
      forms: [{ canonical: "sprigatito-female", sprite_id: 9061, gender: "female" }],
    },
  ];
}

/** Every request the modal issued, so the write sequence can be asserted. */
let apiCalls: { url: string; method: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  apiCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        apiCalls.push({
          url: String(url),
          method,
          body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
        });
      }
      if (url.includes("/api/pokedex/overrides")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url.includes("/api/games")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                key: "pokemon-scarlet",
                names: { de: "Karmesin", en: "Scarlet" },
                generation: 9,
                platform: "switch",
              },
            ]),
        });
      }
      if (url.includes("/api/pokedex")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(pokedexResponse()) });
      }
      if (url.includes("/api/pokemon")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "created" }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }),
  );
});

/** Requests to one endpoint, as "METHOD /api/..." strings. */
function apiRoutes(): string[] {
  return apiCalls.map((call) => `${call.method} ${call.url.replace(/^.*\/api/, "/api")}`);
}

function renderModal(
  overrides: DexOverride[] = [],
  setOverride = vi.fn().mockResolvedValue(undefined),
  scope?: { formCanonical: string; gender: string },
) {
  const onClose = vi.fn();
  render(
    <DexOverrideModal
      speciesId={906}
      canonical="sprigatito"
      name="Sprigatito"
      generation={9}
      caught={false}
      overrides={overrides}
      setOverride={setOverride}
      onClose={onClose}
      initialFormCanonical={scope?.formCanonical}
      initialGender={scope?.gender}
    />,
  );
  return { onClose, setOverride };
}

describe("DexOverrideModal", () => {
  it("renders the species header inside the dialog", () => {
    renderModal();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Sprigatito");
    expect(dialog).toHaveTextContent("#0906");
  });

  it("shows the gender selector once the species data loads", async () => {
    renderModal();

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Geschlecht" })).toBeInTheDocument(),
    );
  });

  it("keeps caught changes pending until save", async () => {
    const { setOverride } = renderModal();

    const toggle = await screen.findByRole("button", { name: "Als gefangen markieren" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(setOverride).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    // A caught entry is a hunt row now; no redundant override is needed.
    await waitFor(() => expect(apiRoutes()).toContain("POST /api/pokemon"));
    expect(setOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        speciesId: 906,
        caught: false,
        seen: false,
      }),
    );
  });

  it("allows caught and seen to be selected independently", async () => {
    const { setOverride } = renderModal();

    const caughtToggle = await screen.findByRole("button", { name: "Als gefangen markieren" });
    const seenToggle = screen.getByRole("button", { name: "Als gesehen markieren" });
    fireEvent.click(caughtToggle);
    expect(seenToggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(seenToggle);
    expect(caughtToggle).toHaveAttribute("aria-pressed", "true");
    expect(seenToggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(setOverride).toHaveBeenCalledWith(
        expect.objectContaining({ caught: false, seen: true }),
      ),
    );
  });

  it("shows zero-valued hunt facts as placeholders", async () => {
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: "Als gefangen markieren" }));

    for (const label of ["Encounter", "Stunden", "Minuten", "Sekunden"]) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveValue(null);
      expect(input).toHaveAttribute("placeholder", "0");
    }
  });

  it("saves a hand-entered catch as a hunt entry", async () => {
    const posted: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === "POST" && String(url).endsWith("/api/pokemon")) {
          posted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "created" }) });
        }
        if (String(url).includes("/api/games")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  key: "pokemon-scarlet",
                  names: { de: "Karmesin", en: "Scarlet" },
                  generation: 9,
                  platform: "switch",
                },
              ]),
          });
        }
        if (String(url).includes("/api/pokedex")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(pokedexResponse()) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }),
    );

    render(
      <DexOverrideModal
        speciesId={906}
        canonical="sprigatito"
        name="Sprigatito"
        generation={9}
        caught={false}
        overrides={[]}
        setOverride={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Als gefangen markieren" }));
    fireEvent.change(screen.getByLabelText("Gefangen am"), { target: { value: "2020-01-02" } });
    fireEvent.change(await screen.findByLabelText("Spiel"), {
      target: { value: "pokemon-scarlet" },
    });
    fireEvent.change(screen.getByLabelText("Encounter"), { target: { value: "8192" } });
    fireEvent.change(screen.getByLabelText("Stunden"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Uhrzeit"), { target: { value: "14:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      entry_source: "manual",
      canonical_name: "sprigatito",
      game: "pokemon-scarlet",
      hunt_type: "encounter",
      encounters: 8192,
      timer_accumulated_ms: 3_600_000,
    });
    expect(String(posted[0].completed_at)).toBe(new Date(2020, 0, 2, 14, 30).toISOString());
  });

  it("prefills every option when editing an existing override", async () => {
    renderModal(
      [
        {
          id: 1,
          speciesId: 906,
          formCanonical: "",
          gender: "female",
          game: "",
          caught: true,
          seen: true,
          meta: { location: "Route 1" },
        },
      ],
      undefined,
      { formCanonical: "", gender: "female" },
    );

    expect(await screen.findByRole("combobox", { name: "Geschlecht" })).toHaveValue("female");
    expect(screen.getByRole("button", { name: "Als gefangen markieren" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Als gesehen markieren" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Route 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Speichern" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Entfernen" })).toBeInTheDocument();
  });

  it("keeps the seen toggle actionable when caught is on", async () => {
    renderModal([
      { id: 1, speciesId: 906, formCanonical: "", gender: "", game: "", caught: true, seen: true },
    ]);

    const seenToggle = await screen.findByRole("button", { name: "Als gesehen markieren" });
    expect(seenToggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(seenToggle);
    expect(seenToggle).toHaveAttribute("aria-pressed", "false");
  });

  it("removes the current scope's override after confirming, when opened pre-scoped to it", async () => {
    const { setOverride } = renderModal(
      [
        {
          id: 1,
          speciesId: 906,
          formCanonical: "sprigatito-female",
          gender: "female",
          game: "",
          caught: true,
          seen: true,
        },
      ],
      undefined,
      { formCanonical: "sprigatito-female", gender: "female" },
    );

    const removeButton = await screen.findByRole("button", { name: "Entfernen" });
    fireEvent.click(removeButton);

    const confirmButton = await screen.findByRole("button", { name: "Bestätigen" });
    fireEvent.click(confirmButton);

    await waitFor(() =>
      expect(setOverride).toHaveBeenCalledWith({
        id: 1,
        speciesId: 906,
        formCanonical: "sprigatito-female",
        gender: "female",
        game: "",
        caught: false,
        seen: false,
      }),
    );
  });

  describe("form strip", () => {
    it("does not expose gender pseudo-forms as real forms", async () => {
      renderModal();
      await screen.findByRole("combobox", { name: "Geschlecht" });
      expect(screen.queryByRole("button", { name: "Weiblich" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Standardform" })).not.toBeInTheDocument();
    });
  });
});
