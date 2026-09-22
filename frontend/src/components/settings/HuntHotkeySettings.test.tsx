import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, makePokemon } from "../../test-utils";
import { HuntHotkeySettings } from "./HuntHotkeySettings";
import type { Group, Pokemon } from "../../types";

/** Running hunt, finished hunt, failed hunt and a frozen phase entry. */
const pokemon: Pokemon[] = [
  makePokemon({ id: "poke-1", name: "Bisasam" }),
  makePokemon({ id: "poke-2", name: "Glumanda", hotkeys: { increment: "F8", reset: "F9" } }),
  makePokemon({ id: "poke-3", name: "Schiggy", completed_at: "2024-02-01T00:00:00Z" }),
  makePokemon({ id: "poke-4", name: "Raupy", failed: true }),
  makePokemon({ id: "poke-5", name: "Hornliu", phase_of: "poke-1", phase_number: 1 }),
];

const groups: Group[] = [
  { id: "grp-2", name: "Johto", color: "#ff0000", sort_order: 1, collapsed: false },
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

  it("gives every entry an increment, a decrement and a reset slot", () => {
    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);

    const entry = screen.getByRole("group", { name: "Bisasam" });
    expect(entry).toHaveTextContent("+1 Encounter");
    expect(entry).toHaveTextContent("-1 Encounter");
    expect(entry).toHaveTextContent("Reset");
  });

  it("shows the stored combo of each slot", () => {
    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);
    expect(screen.getByText("F8")).toBeInTheDocument();
    expect(screen.getByText("F9")).toBeInTheDocument();
  });

  it("renders an empty hint when there is nothing to bind", () => {
    render(<HuntHotkeySettings pokemon={[]} groups={[]} />);
    expect(
      screen.getByText("Noch keine laufenden Hunts und keine Gruppen vorhanden."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("names the entry and the action in every button label", () => {
    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);

    expect(
      screen.getByRole("button", { name: "Aufzeichnen: Bisasam, +1 Encounter" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Aufzeichnen: Bisasam, -1 Encounter" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aufzeichnen: Bisasam, Reset" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hotkey löschen: Glumanda, +1 Encounter" }),
    ).toBeInTheDocument();
  });

  it("writes a recorded key to the action endpoint of the pokemon", async () => {
    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);

    await act(async () => {
      screen.getByRole("button", { name: "Aufzeichnen: Bisasam, -1 Encounter" }).click();
    });
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
      expect(screen.getByText("F5")).toBeInTheDocument();
    });
  });

  it("writes a recorded key to the action endpoint of the group", async () => {
    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);

    await act(async () => {
      screen.getByRole("button", { name: "Aufzeichnen: Kanto, Reset" }).click();
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

  it("clears one slot, keeps the other bindings and keeps focus on the slot", async () => {
    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);

    await act(async () => {
      screen.getByRole("button", { name: "Hotkey löschen: Glumanda, +1 Encounter" }).click();
    });

    await waitFor(() => {
      expect(screen.queryByText("F8")).not.toBeInTheDocument();
    });
    // The reset slot of the same hunt is untouched.
    expect(screen.getByText("F9")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hotkey löschen: Glumanda, Reset" }),
    ).toBeInTheDocument();

    const [url, init] = writeCalls()[0];
    expect(url).toContain("/api/hotkeys/pokemon/poke-2/increment");
    expect(init?.body).toBe(JSON.stringify({ key: "" }));

    expect(
      screen.queryByRole("button", { name: "Hotkey löschen: Glumanda, +1 Encounter" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Aufzeichnen: Glumanda, +1 Encounter" }),
    ).toHaveFocus();
  });

  it("shows the conflicting holder on the slot that was refused", async () => {
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
      screen.getByRole("button", { name: "Aufzeichnen: Bisasam, -1 Encounter" }).click();
    });
    await act(async () => {
      fireEvent.keyDown(globalThis as unknown as Window, { key: "F5" });
    });

    const message = await screen.findByRole("status");
    expect(message).toHaveTextContent('Taste bereits belegt von „Kanto"');
    expect(message).toHaveAttribute("aria-live", "polite");
    // The message sits inside the refused slot, not on a sibling one.
    expect(message.parentElement).toContainElement(
      screen.getByRole("button", { name: "Aufzeichnen: Bisasam, -1 Encounter" }),
    );
    expect(message.parentElement).not.toContainElement(
      screen.getByRole("button", { name: "Aufzeichnen: Bisasam, +1 Encounter" }),
    );
  });

  it("reports any other refusal as an alert", async () => {
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
      screen.getByRole("button", { name: "Aufzeichnen: Bisasam, +1 Encounter" }).click();
    });
    await act(async () => {
      fireEvent.keyDown(globalThis as unknown as Window, { key: "F13" });
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Key not supported");
  });

  it("keeps the hotkeys paused while the capture moves to another slot", async () => {
    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);

    await act(async () => {
      screen.getByRole("button", { name: "Aufzeichnen: Bisasam, +1 Encounter" }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "Aufzeichnen: Kanto, +1 Encounter" }).click();
    });

    // Resuming in between would re-arm the combo that is being recorded.
    expect(callsTo("/api/hotkeys/pause")).toBe(1);
    expect(callsTo("/api/hotkeys/resume")).toBe(0);
    expect(
      screen.getByRole("button", { name: "Abbrechen: Kanto, +1 Encounter" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Abbrechen: Bisasam, +1 Encounter" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(globalThis as unknown as Window, { key: "Escape" });
    });

    expect(callsTo("/api/hotkeys/resume")).toBe(1);
  });

  it("cancels a recording on Escape without writing", async () => {
    render(<HuntHotkeySettings pokemon={pokemon} groups={groups} />);

    await act(async () => {
      screen.getByRole("button", { name: "Aufzeichnen: Bisasam, Reset" }).click();
    });
    expect(screen.getByRole("button", { name: "Abbrechen: Bisasam, Reset" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(globalThis as unknown as Window, { key: "Escape" });
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Abbrechen: Bisasam, Reset" }),
      ).not.toBeInTheDocument();
    });
    expect(writeCalls().length).toBe(0);
  });
});
