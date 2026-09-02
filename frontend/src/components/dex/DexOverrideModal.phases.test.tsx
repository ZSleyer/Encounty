/**
 * DexOverrideModal.phases.test.tsx: the phase drafts of a hand-entered hunt,
 * meaning their editor, their failed flag and what saving writes for them.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, userEvent } from "../../test-utils";
import { DexOverrideModal } from "./DexOverrideModal";
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

describe("DexOverrideModal", () => {
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

      expect(await screen.findByRole("dialog", {}, { timeout: 2000 })).toHaveTextContent(
        "Phase 1 bearbeiten",
      );
      expect(screen.queryByLabelText("Spiel")).toBeNull();
      expect(screen.queryByLabelText("Hunt-Methode")).toBeNull();
      expect(screen.getByLabelText("Encounter")).toBeInTheDocument();
    });

    it("saves a phase as an entry of its own carrying the parent link", async () => {
      renderWithEntries();
      const user = userEvent.setup();

      fireEvent.click(await screen.findByRole("button", { name: "Phase hinzufügen" }));
      await user.type(
        await screen.findByLabelText("Spezies suchen", {}, { timeout: 2000 }),
        "Sprigatito",
      );
      fireEvent.click(await screen.findByText("Sprigatito", {}, { timeout: 2000 }));
      fireEvent.change(screen.getByLabelText("Encounter"), { target: { value: "300" } });
      fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

      fireEvent.click(await screen.findByRole("button", { name: "Speichern" }, { timeout: 2000 }));

      await waitFor(() =>
        expect(
          apiCalls.some(
            (call) =>
              call.method === "POST" && call.body.phase_of === "e7" && call.body.phase_number === 1,
          ),
        ).toBe(true),
      );
      const phaseCall = apiCalls.find((call) => call.body.phase_of === "e7")!;
      // Game and method are inherited from the main target, never asked twice.
      expect(phaseCall.body).toMatchObject({
        entry_source: "manual",
        game: "pokemon-scarlet",
        hunt_type: "encounter",
        encounters: 300,
      });
    });

    it("offers the full hunt editor for an existing entry", async () => {
      renderWithEntries();

      const full = await screen.findByRole("button", { name: "Alle Felder bearbeiten" });
      fireEvent.click(full);

      // The body swap replaces this dialog, it never stacks a second one.
      await waitFor(() => expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(1), {
        timeout: 2000,
      });
      expect(
        await screen.findByLabelText("Titel (optional)", {}, { timeout: 2000 }),
      ).toBeInTheDocument();
    });

    it("keeps the recorded date of an existing phase", async () => {
      const phase = { ...PARENT, id: "e8", encounters: 42, phase_of: "e7", phase_number: 1 };
      renderWithEntries([PARENT, phase]);

      fireEvent.click(await screen.findByRole("button", { name: "Phase 1 bearbeiten" }));
      fireEvent.click(await screen.findByRole("button", { name: "Speichern" }, { timeout: 2000 }));
      fireEvent.click(await screen.findByRole("button", { name: "Speichern" }, { timeout: 2000 }));

      await waitFor(() => expect(apiRoutes()).toContain("PUT /api/pokemon/e8/completed_at"));
      const sent = apiCalls.find((call) => call.url.endsWith("/api/pokemon/e8/completed_at"))!.body;
      // Same instant, not necessarily the same spelling: the editor splits the
      // timestamp into date and time and composes it again.
      expect(new Date(String(sent.completed_at)).getTime()).toBe(
        new Date(PARENT.completed_at).getTime(),
      );
    });

    it("records a phase that got away as failed", async () => {
      renderWithEntries();
      const user = userEvent.setup();

      fireEvent.click(await screen.findByRole("button", { name: "Phase hinzufügen" }));
      await user.type(
        await screen.findByLabelText("Spezies suchen", {}, { timeout: 2000 }),
        "Sprigatito",
      );
      fireEvent.click(await screen.findByText("Sprigatito", {}, { timeout: 2000 }));
      fireEvent.click(screen.getByLabelText("Phase als fehlgeschlagen markieren"));
      // The date field renames itself, so the dialog never claims a catch date.
      expect(screen.getByLabelText("Fehlgeschlagen am")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

      expect(await screen.findByText("Fehlgeschlagen", {}, { timeout: 2000 })).toBeInTheDocument();
      fireEvent.click(await screen.findByRole("button", { name: "Speichern" }, { timeout: 2000 }));

      await waitFor(() => expect(apiCalls.some((call) => call.body.phase_of === "e7")).toBe(true));
      expect(apiCalls.find((call) => call.body.phase_of === "e7")!.body).toMatchObject({
        failed: true,
      });
    });

    it("takes the failed flag back off an existing phase", async () => {
      const phase = {
        ...PARENT,
        id: "e8",
        encounters: 42,
        phase_of: "e7",
        phase_number: 1,
        failed: true,
      };
      renderWithEntries([PARENT, phase]);

      fireEvent.click(await screen.findByRole("button", { name: "Phase 1 bearbeiten" }));
      const checkbox = await screen.findByLabelText(
        "Phase als fehlgeschlagen markieren",
        {},
        { timeout: 2000 },
      );
      expect(checkbox).toBeChecked();
      fireEvent.click(checkbox);
      fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

      await waitFor(() => expect(screen.queryByText("Fehlgeschlagen")).toBeNull(), {
        timeout: 2000,
      });
      fireEvent.click(await screen.findByRole("button", { name: "Speichern" }, { timeout: 2000 }));

      // Sent explicitly as false: the update body carries the stored entry, so
      // an omitted field would keep the phase failed forever.
      await waitFor(() =>
        expect(
          apiCalls.some(
            (call) => call.url.endsWith("/api/pokemon/e8") && call.body.failed === false,
          ),
        ).toBe(true),
      );
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
