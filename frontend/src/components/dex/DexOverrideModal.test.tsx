import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, userEvent } from "../../test-utils";
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
      forms: [
        { canonical: "sprigatito-female", sprite_id: 9061, gender: "female" },
      ],
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
          body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {},
        });
      }
      if (url.includes("/api/pokedex/overrides")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url.includes("/api/games")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([
          { key: "pokemon-scarlet", names: { de: "Karmesin", en: "Scarlet" }, generation: 9, platform: "switch" },
        ]) });
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

    // A caught entry is a hunt row now; the override only keeps "seen".
    await waitFor(() => expect(apiRoutes()).toContain("POST /api/pokemon"));
    expect(setOverride).toHaveBeenCalledWith(expect.objectContaining({
      speciesId: 906,
      caught: false,
      seen: true,
    }));
  });

  it("saves a hand-entered catch as a hunt entry", async () => {
    const posted: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && String(url).endsWith("/api/pokemon")) {
        posted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "created" }) });
      }
      if (String(url).includes("/api/games")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([
          { key: "pokemon-scarlet", names: { de: "Karmesin", en: "Scarlet" }, generation: 9, platform: "switch" },
        ]) });
      }
      if (String(url).includes("/api/pokedex")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(pokedexResponse()) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }));

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
    fireEvent.change(await screen.findByLabelText("Spiel"), { target: { value: "pokemon-scarlet" } });
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
      [{ id: 1, speciesId: 906, formCanonical: "", gender: "female", game: "", caught: true, seen: true, meta: { location: "Route 1" } }],
      undefined,
      { formCanonical: "", gender: "female" },
    );

    expect(await screen.findByRole("combobox", { name: "Geschlecht" })).toHaveValue("female");
    expect(screen.getByRole("button", { name: "Als gefangen markieren" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Als gesehen markieren" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Route 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Speichern" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Entfernen" })).toBeInTheDocument();
  });

  it("disables the seen toggle once caught is on, since caught implies seen", async () => {
    renderModal([
      { id: 1, speciesId: 906, formCanonical: "", gender: "", game: "", caught: true, seen: true },
    ]);

    const seenToggle = await screen.findByRole("button", { name: "Als gesehen markieren" });
    expect(seenToggle).toBeDisabled();
    expect(seenToggle).toHaveAttribute("aria-pressed", "true");
  });

  it("removes the current scope's override after confirming, when opened pre-scoped to it", async () => {
    const { setOverride } = renderModal(
      [{ id: 1, speciesId: 906, formCanonical: "sprigatito-female", gender: "female", game: "", caught: true, seen: true }],
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

  describe("details editor", () => {
    it("hides the edit-details entry point when the scope has no override row yet", () => {
      renderModal();
      expect(screen.queryByRole("button", { name: "Details bearbeiten" })).not.toBeInTheDocument();
    });

    it("shows the edit-details entry point once the scope has an override row", async () => {
      renderModal([
        { id: 1, speciesId: 906, formCanonical: "", gender: "", game: "", caught: true, seen: true },
      ]);
      expect(await screen.findByRole("button", { name: "Details bearbeiten" })).toBeInTheDocument();
    });

    it("keeps edited details pending until the main save", async () => {
      const { setOverride } = renderModal([
        { id: 1, speciesId: 906, formCanonical: "", gender: "", game: "", caught: true, seen: true },
      ]);

      fireEvent.click(await screen.findByRole("button", { name: "Details bearbeiten" }));

      // The close transition plays out (or falls back to its safety timeout)
      // before the details editor's own dialog takes over; only then is its
      // cancel button (edit mode, not "skip") reachable.
      expect(
        await screen.findByRole("button", { name: "Abbrechen" }, { timeout: 2000 }),
      ).toBeInTheDocument();
      // Exactly one native <dialog> is ever in the DOM: DexOverrideModal's own
      // ModalShell is not merely hidden while the details editor is open, it
      // is unmounted by the conditional return in the component body.
      expect(screen.getAllByRole("dialog")).toHaveLength(1);

      const user = userEvent.setup();
      await user.type(screen.getByLabelText("Spitzname (optional)"), "Sparky");
      await user.type(screen.getByLabelText("Fundort"), "Route 1");
      fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

      // Saving closes the details editor and swaps back to this modal's own
      // caught/seen editor, still on the same scope.
      expect(
        await screen.findByRole("button", { name: "Als gefangen markieren" }, { timeout: 2000 }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(setOverride).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
      // The metadata travels with the hunt entry now, the override only
      // records that the species was seen.
      await waitFor(() => expect(apiCalls.some((call) =>
        call.method === "POST" && String(call.body.name) !== "" &&
        (call.body.catch as Record<string, unknown> | undefined)?.nickname === "Sparky")).toBe(true));
      expect(setOverride).toHaveBeenCalledWith(expect.objectContaining({ id: 1, caught: false, seen: true }));
    });

    it("cancelling the details editor discards typed input and returns to the caught/seen editor", async () => {
      renderModal([
        { id: 1, speciesId: 906, formCanonical: "", gender: "", game: "", caught: true, seen: true },
      ]);

      fireEvent.click(await screen.findByRole("button", { name: "Details bearbeiten" }));
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText("Fundort", {}, { timeout: 2000 }), "Route 1");
      fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

      expect(
        await screen.findByRole("button", { name: "Als gefangen markieren" }, { timeout: 2000 }),
      ).toBeInTheDocument();
    });
  });
  describe("phases of a hand-entered hunt", () => {
    const PARENT = {
      id: "e7",
      name: "Sprigatito",
      canonical_name: "sprigatito",
      sprite_url: "",
      sprite_type: "shiny" as const,
      encounters: 100,
      is_active: false,
      created_at: "2020-01-01T00:00:00Z",
      completed_at: "2020-01-02T00:00:00Z",
      language: "de",
      game: "pokemon-scarlet",
      overlay_mode: "default",
      hunt_type: "encounter",
      entry_source: "manual",
      timer_accumulated_ms: 0,
    };

    function renderWithEntries(entries: unknown[] = [PARENT]) {
      const setOverride = vi.fn().mockResolvedValue(undefined);
      render(
        <DexOverrideModal
          speciesId={906}
          canonical="sprigatito"
          name="Sprigatito"
          generation={9}
          caught={false}
          overrides={[]}
          setOverride={setOverride}
          entries={entries as never}
          initialEntryId={PARENT.id}
          onClose={vi.fn()}
        />,
      );
      return { setOverride };
    }

    it("shows the phase section only while the entry is marked as caught", async () => {
      renderWithEntries();

      expect(await screen.findByText("Noch keine Phasen erfasst")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Als gefangen markieren" }));
      expect(screen.queryByText("Noch keine Phasen erfasst")).toBeNull();
    });

    it("opens the phase editor without asking for game or method again", async () => {
      renderWithEntries();

      fireEvent.click(await screen.findByRole("button", { name: "Phase hinzufügen" }));

      expect(await screen.findByRole("dialog", {}, { timeout: 2000 })).toHaveTextContent("Phase 1 bearbeiten");
      expect(screen.queryByLabelText("Spiel")).toBeNull();
      expect(screen.queryByLabelText("Hunt-Methode")).toBeNull();
      expect(screen.getByLabelText("Encounter")).toBeInTheDocument();
    });

    it("saves a phase as an entry of its own carrying the parent link", async () => {
      renderWithEntries();
      const user = userEvent.setup();

      fireEvent.click(await screen.findByRole("button", { name: "Phase hinzufügen" }));
      await user.type(await screen.findByLabelText("Spezies suchen", {}, { timeout: 2000 }), "Sprigatito");
      fireEvent.click(await screen.findByText("Sprigatito", {}, { timeout: 2000 }));
      fireEvent.change(screen.getByLabelText("Encounter"), { target: { value: "300" } });
      fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

      fireEvent.click(await screen.findByRole("button", { name: "Speichern" }, { timeout: 2000 }));

      await waitFor(() => expect(apiCalls.some((call) =>
        call.method === "POST" && call.body.phase_of === "e7" && call.body.phase_number === 1)).toBe(true));
      const phaseCall = apiCalls.find((call) => call.body.phase_of === "e7")!;
      // Game and method are inherited from the main target, never asked twice.
      expect(phaseCall.body).toMatchObject({
        entry_source: "manual",
        game: "pokemon-scarlet",
        hunt_type: "encounter",
        encounters: 300,
      });
    });

    it("deletes a removed phase only once the hunt is saved", async () => {
      const phase = { ...PARENT, id: "e8", encounters: 42, phase_of: "e7", phase_number: 1 };
      renderWithEntries([PARENT, phase]);

      fireEvent.click(await screen.findByRole("button", { name: "Phase 1 entfernen" }));
      expect(apiRoutes().some((route) => route.startsWith("DELETE"))).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
      await waitFor(() => expect(apiRoutes()).toContain("DELETE /api/pokemon/e8"));
    });
  });
});
