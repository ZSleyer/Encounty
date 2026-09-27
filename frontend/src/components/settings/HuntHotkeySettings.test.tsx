import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within, makePokemon } from "../../test-utils";
import { HuntHotkeySettings } from "./HuntHotkeySettings";
import type { Group, Pokemon } from "../../types";

/** Running hunt, finished hunt, failed hunt and a frozen phase entry. */
const pokemon: Pokemon[] = [
  makePokemon({ id: "poke-1", name: "Bisasam", group_id: "grp-1" }),
  makePokemon({ id: "poke-2", name: "Glumanda", hotkeys: { increment: "F8", reset: "F9" } }),
  makePokemon({ id: "poke-3", name: "Schiggy", completed_at: "2024-02-01T00:00:00Z" }),
  makePokemon({ id: "poke-4", name: "Raupy", failed: true }),
  makePokemon({ id: "poke-5", name: "Hornliu", phase_of: "poke-1", phase_number: 1 }),
];

const groups: Group[] = [
  {
    id: "grp-2",
    name: "Johto",
    color: "#ff0000",
    sort_order: 1,
    collapsed: false,
    hotkeys: { decrement: "Ctrl+F8" },
  },
  { id: "grp-1", name: "Kanto", color: "#00ff00", sort_order: 0, collapsed: false },
];

/** Every request answers 200 unless a test overrides it. */
function stubFetch(impl?: (url: string, init?: RequestInit) => Promise<unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) =>
      impl
        ? impl(url, init)
        : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
    ),
  );
}

/** The PUT requests the component issued, in order. */
function writeCalls() {
  return vi
    .mocked(fetch)
    .mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "PUT");
}

/** How often the given hotkey endpoint was hit. */
function callsTo(path: string) {
  return vi.mocked(fetch).mock.calls.filter((c) => String(c[0]).includes(path)).length;
}

describe("HuntHotkeySettings", () => {
  beforeEach(() => {
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists running hunts and groups and skips finished, failed and phase entries", () => {
    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);

    expect(screen.getByText("Bisasam")).toBeInTheDocument();
    expect(screen.getByText("Glumanda")).toBeInTheDocument();
    expect(screen.getByText("Kanto")).toBeInTheDocument();
    expect(screen.getByText("Johto")).toBeInTheDocument();

    expect(screen.queryByText("Schiggy")).not.toBeInTheDocument();
    expect(screen.queryByText("Raupy")).not.toBeInTheDocument();
    expect(screen.queryByText("Hornliu")).not.toBeInTheDocument();
  });

  it("renders the column header once per matrix and one row per entry", () => {
    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);

    const hunts = screen.getByRole("list", { name: "Hunts" });
    expect(within(hunts).getAllByRole("listitem")).toHaveLength(2);
    const groupList = screen.getByRole("list", { name: "Gruppen" });
    expect(within(groupList).getAllByRole("listitem")).toHaveLength(2);
    // One column header per matrix plus the stacked-card label of each of the
    // four rows; CSS picks which of them shows, jsdom renders both.
    expect(screen.getAllByText("+1 Encounter")).toHaveLength(6);
    expect(screen.queryByRole("button", { name: /Aufzeichnen/ })).not.toBeInTheDocument();
  });

  it("gives every entry an increment, a decrement and a reset cell", () => {
    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);

    expect(
      screen.getByRole("button", { name: "+1 Encounter für Bisasam: Keine Taste zugewiesen" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "-1 Encounter für Bisasam: Keine Taste zugewiesen" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reset für Bisasam: Keine Taste zugewiesen" }),
    ).toBeInTheDocument();
  });

  it("shows the game and the group member count on the secondary line", () => {
    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);

    const bisasamRow = screen.getByText("Bisasam").closest("li") as HTMLElement;
    expect(bisasamRow).toHaveTextContent("SCARLET");
    const kantoRow = screen.getByText("Kanto").closest("li") as HTMLElement;
    expect(kantoRow).toHaveTextContent("1 Pokémon");
  });

  it("shows the stored combo of each cell", () => {
    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);

    expect(
      screen.getByRole("button", { name: "+1 Encounter für Glumanda: F8" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset für Glumanda: F9" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "-1 Encounter für Johto: Ctrl+F8" }),
    ).toBeInTheDocument();
  });

  it("renders an empty hint when there is nothing to bind", () => {
    render(<HuntHotkeySettings pokemon={[]} groups={[]} />);
    expect(
      screen.getByText("Noch keine laufenden Hunts und keine Gruppen vorhanden."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("names the entry and the action on every clear button", () => {
    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);

    expect(
      screen.getByRole("button", { name: "Hotkey löschen: +1 Encounter für Glumanda" }),
    ).toBeInTheDocument();
    // Unbound cells have nothing to clear.
    expect(
      screen.queryByRole("button", { name: "Hotkey löschen: +1 Encounter für Bisasam" }),
    ).not.toBeInTheDocument();
  });

  it("records a key into the clicked cell and writes it to the pokemon endpoint", async () => {
    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);

    await act(async () => {
      screen
        .getByRole("button", { name: "-1 Encounter für Bisasam: Keine Taste zugewiesen" })
        .click();
    });
    expect(
      screen.getByRole("button", { name: "-1 Encounter für Bisasam: Taste drücken…" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("-1 Encounter für Bisasam");

    await act(async () => {
      fireEvent.keyDown(globalThis as unknown as Window, { key: "F5" });
    });

    await waitFor(() => {
      expect(writeCalls().length).toBe(1);
    });
    const [url, init] = writeCalls()[0];
    expect(url).toContain("/api/hotkeys/pokemon/poke-1/decrement");
    expect(init?.body).toBe(JSON.stringify({ key: "F5" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "-1 Encounter für Bisasam: F5" }),
      ).toBeInTheDocument();
    });
  });

  it("writes a recorded key to the action endpoint of the group", async () => {
    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);

    await act(async () => {
      screen.getByRole("button", { name: "Reset für Kanto: Keine Taste zugewiesen" }).click();
    });
    await act(async () => {
      fireEvent.keyDown(globalThis as unknown as Window, {
        key: "a",
        ctrlKey: true,
        shiftKey: true,
      });
    });

    await waitFor(() => {
      expect(writeCalls().length).toBe(1);
    });
    const [url, init] = writeCalls()[0];
    expect(url).toContain("/api/hotkeys/group/grp-1/reset");
    expect(init?.body).toBe(JSON.stringify({ key: "Ctrl+Shift+A" }));
  });

  it("clears one cell, keeps the other bindings and keeps focus on the cell", async () => {
    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);

    await act(async () => {
      screen.getByRole("button", { name: "Hotkey löschen: +1 Encounter für Glumanda" }).click();
    });

    const cell = await screen.findByRole("button", {
      name: "+1 Encounter für Glumanda: Keine Taste zugewiesen",
    });
    expect(cell).toHaveFocus();
    // The reset cell of the same hunt is untouched.
    expect(screen.getByRole("button", { name: "Reset für Glumanda: F9" })).toBeInTheDocument();

    const [url, init] = writeCalls()[0];
    expect(url).toContain("/api/hotkeys/pokemon/poke-2/increment");
    expect(init?.body).toBe(JSON.stringify({ key: "" }));
  });

  it("clears a focused bound cell on Delete", async () => {
    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);

    const cell = screen.getByRole("button", { name: "Reset für Glumanda: F9" });
    await act(async () => {
      cell.focus();
      fireEvent.keyDown(cell, { key: "Delete" });
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Reset für Glumanda: Keine Taste zugewiesen" }),
      ).toHaveFocus();
    });
    expect(writeCalls()[0][0]).toContain("/api/hotkeys/pokemon/poke-2/reset");
  });

  it("shows the conflicting holder below the row that was refused", async () => {
    stubFetch((_url, init) => {
      if (init?.method !== "PUT") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({
        ok: false,
        status: 409,
        json: () =>
          Promise.resolve({
            error: "key already bound",
            owner: { kind: "group", id: "grp-1", label: "Kanto" },
          }),
      });
    });

    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);

    await act(async () => {
      screen
        .getByRole("button", { name: "-1 Encounter für Bisasam: Keine Taste zugewiesen" })
        .click();
    });
    await act(async () => {
      fireEvent.keyDown(globalThis as unknown as Window, { key: "F5" });
    });

    const message = await screen.findByRole("alert");
    expect(message).toHaveTextContent('-1 Encounter: Taste bereits belegt von „Kanto"');
    // The message sits in the refused hunt's row and describes the refused cell.
    const bisasamRow = screen.getByText("Bisasam").closest("li") as HTMLElement;
    expect(bisasamRow).toContainElement(message);
    const cell = screen.getByRole("button", {
      name: "-1 Encounter für Bisasam: Keine Taste zugewiesen",
    });
    expect(cell).toHaveAttribute("aria-describedby", message.id);
    expect(
      screen.getByRole("button", { name: "+1 Encounter für Bisasam: Keine Taste zugewiesen" }),
    ).not.toHaveAttribute("aria-describedby");
  });

  it("reports any other refusal with a localized alert", async () => {
    stubFetch((_url, init) => {
      if (init?.method !== "PUT") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "Key not supported" }),
      });
    });

    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);

    await act(async () => {
      screen
        .getByRole("button", { name: "+1 Encounter für Bisasam: Keine Taste zugewiesen" })
        .click();
    });
    await act(async () => {
      fireEvent.keyDown(globalThis as unknown as Window, { key: "F13" });
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Unbekannte Taste");
  });

  it("keeps the hotkeys paused while the capture moves to another cell", async () => {
    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);

    await act(async () => {
      screen
        .getByRole("button", { name: "+1 Encounter für Bisasam: Keine Taste zugewiesen" })
        .click();
    });
    await act(async () => {
      screen
        .getByRole("button", { name: "+1 Encounter für Kanto: Keine Taste zugewiesen" })
        .click();
    });

    // Resuming in between would re-arm the combo that is being recorded.
    expect(callsTo("/api/hotkeys/pause")).toBe(1);
    expect(callsTo("/api/hotkeys/resume")).toBe(0);
    expect(screen.getAllByRole("button", { name: /Taste drücken…$/ })).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "+1 Encounter für Kanto: Taste drücken…" }),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(globalThis as unknown as Window, { key: "Escape" });
    });

    expect(callsTo("/api/hotkeys/resume")).toBe(1);
  });

  it("cancels a recording on Escape without writing", async () => {
    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);

    await act(async () => {
      screen.getByRole("button", { name: "Reset für Bisasam: Keine Taste zugewiesen" }).click();
    });
    expect(
      screen.getByRole("button", { name: "Reset für Bisasam: Taste drücken…" }),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(globalThis as unknown as Window, { key: "Escape" });
    });

    expect(
      screen.getByRole("button", { name: "Reset für Bisasam: Keine Taste zugewiesen" }),
    ).toBeInTheDocument();
    expect(writeCalls().length).toBe(0);
  });
});
