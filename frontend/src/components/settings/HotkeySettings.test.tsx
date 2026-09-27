import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "../../test-utils";
import { HotkeySettings } from "./HotkeySettings";
import type { HotkeyMap } from "../../types";

/** Answers the status probe and every write with the given PUT response. */
function stubFetch(put?: { ok: boolean; status: number; body?: unknown }) {
  vi.mocked(fetch).mockImplementation((url: any, init?: any) => {
    if (typeof url === "string" && url.includes("/hotkeys/status")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ available: true }),
      } as Response);
    }
    if (init?.method === "PUT" && put) {
      return Promise.resolve({
        ok: put.ok,
        status: put.status,
        json: () => Promise.resolve(put.body ?? {}),
      } as Response);
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response);
  });
}

/** The PUT requests the component issued, in order. */
function writeCalls() {
  return vi
    .mocked(fetch)
    .mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "PUT");
}

/** Clicks a key cell to start (or cancel) a capture. */
async function clickCell(name: string | RegExp) {
  await act(async () => {
    screen.getByRole("button", { name }).click();
  });
}

/** Presses a key while a capture listens on the window. */
async function pressKey(init: KeyboardEventInit) {
  await act(async () => {
    fireEvent.keyDown(globalThis as unknown as Window, init);
  });
}

describe("HotkeySettings", () => {
  const hotkeys: HotkeyMap = {
    increment: "Ctrl+Up",
    decrement: "",
    reset: "",
    next_pokemon: "",
    hunt_toggle: "",
  };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ available: true }),
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders all hotkey action labels", async () => {
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("+1 Encounter")).toBeInTheDocument();
    });
    expect(screen.getByText("-1 Encounter")).toBeInTheDocument();
    expect(screen.getByText("Reset")).toBeInTheDocument();
  });

  it("shows the current binding as keycaps inside one named cell", async () => {
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);
    const cell = await screen.findByRole("button", { name: "+1 Encounter: Ctrl+Up" });
    const keys = within(cell).getAllByText(/^(Ctrl|Up)$/);
    expect(keys.map((k) => k.tagName)).toEqual(["KBD", "KBD"]);
  });

  it("names unbound cells as unassigned and renders no record buttons", async () => {
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /: Keine Taste zugewiesen$/ })).toHaveLength(4);
    });
    expect(screen.queryByRole("button", { name: /Aufzeichnen/ })).not.toBeInTheDocument();
  });

  it("offers a clear button only for bound cells", async () => {
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /^Hotkey löschen/ })).toHaveLength(1);
    });
    expect(screen.getByRole("button", { name: "Hotkey löschen: +1 Encounter" })).toHaveAttribute(
      "title",
      "Hotkey löschen",
    );
  });

  it("enters recording mode when a cell is clicked and announces it", async () => {
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);

    await clickCell("+1 Encounter: Ctrl+Up");

    const cell = screen.getByRole("button", { name: "+1 Encounter: Taste drücken…" });
    expect(cell).toHaveTextContent("Taste drücken…");
    // The clear button hides while the cell captures.
    expect(screen.queryByRole("button", { name: /^Hotkey löschen/ })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      'Drücke eine Taste für „+1 Encounter". ESC zum Abbrechen',
    );
  });

  it("cancels recording on Escape without writing", async () => {
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);

    await clickCell("-1 Encounter: Keine Taste zugewiesen");
    await pressKey({ key: "Escape" });

    expect(
      screen.getByRole("button", { name: "-1 Encounter: Keine Taste zugewiesen" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(writeCalls()).toHaveLength(0);
  });

  it("cancels recording when the capturing cell is clicked again", async () => {
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);

    await clickCell("-1 Encounter: Keine Taste zugewiesen");
    await clickCell("-1 Encounter: Taste drücken…");

    expect(
      screen.getByRole("button", { name: "-1 Encounter: Keine Taste zugewiesen" }),
    ).toBeInTheDocument();
  });

  it("shows live modifier keys during recording", async () => {
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);

    await clickCell("+1 Encounter: Ctrl+Up");
    await pressKey({ key: "Control", ctrlKey: true });

    expect(screen.getByText("Ctrl+…")).toBeInTheDocument();
  });

  it("updates live modifiers on keyup during recording", async () => {
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);

    await clickCell("+1 Encounter: Ctrl+Up");
    await pressKey({ key: "Control", ctrlKey: true });
    await act(async () => {
      fireEvent.keyUp(globalThis as unknown as Window, { key: "Control", shiftKey: true });
    });

    expect(screen.getByText("Shift+…")).toBeInTheDocument();
  });

  it("saves a recorded combo and shows it in the cell", async () => {
    stubFetch();
    const onUpdate = vi.fn();
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={onUpdate} />);

    await clickCell("-1 Encounter: Keine Taste zugewiesen");
    await pressKey({ key: "a", ctrlKey: true });

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ decrement: "Ctrl+A" }));
    });
    const [url, init] = writeCalls()[0];
    expect(url).toContain("/api/hotkeys/decrement");
    expect(init?.body).toBe(JSON.stringify({ key: "Ctrl+A" }));
    expect(screen.getByRole("button", { name: "-1 Encounter: Ctrl+A" })).toBeInTheDocument();
  });

  it("clears a binding with the clear button and keeps focus on the cell", async () => {
    stubFetch();
    const onUpdate = vi.fn();
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={onUpdate} />);

    await act(async () => {
      screen.getByRole("button", { name: "Hotkey löschen: +1 Encounter" }).click();
    });

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ increment: "" }));
    });
    const cell = screen.getByRole("button", { name: "+1 Encounter: Keine Taste zugewiesen" });
    expect(cell).toHaveFocus();
  });

  it("clears a bound cell on Delete", async () => {
    stubFetch();
    const onUpdate = vi.fn();
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={onUpdate} />);

    const cell = screen.getByRole("button", { name: "+1 Encounter: Ctrl+Up" });
    await act(async () => {
      cell.focus();
      fireEvent.keyDown(cell, { key: "Delete" });
    });

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ increment: "" }));
    });
    expect(writeCalls()[0][1]?.body).toBe(JSON.stringify({ key: "" }));
  });

  it("ignores Backspace on an unbound cell", async () => {
    stubFetch();
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);

    const cell = screen.getByRole("button", { name: "-1 Encounter: Keine Taste zugewiesen" });
    await act(async () => {
      fireEvent.keyDown(cell, { key: "Backspace" });
    });

    expect(writeCalls()).toHaveLength(0);
  });

  it("shows unavailable warning when hotkeys are not available", async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ available: false }),
      } as Response),
    );

    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Globale Hotkeys nicht verfügbar")).toBeInTheDocument();
    });
  });

  it("shows unavailable warning when status fetch fails", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.reject(new Error("network error")));

    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Globale Hotkeys nicht verfügbar")).toBeInTheDocument();
    });
  });

  it("warns when two actions share a binding", async () => {
    const conflicting: HotkeyMap = {
      increment: "Ctrl+Up",
      decrement: "Ctrl+Up",
      reset: "",
      next_pokemon: "",
    };
    render(<HotkeySettings hotkeys={conflicting} onUpdate={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByText(/Gleiche Taste wie/).length).toBeGreaterThan(0);
    });
  });

  it("shows a localized message instead of the raw backend error", async () => {
    stubFetch({ ok: false, status: 400, body: { error: "Key not supported" } });
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);

    await clickCell("-1 Encounter: Keine Taste zugewiesen");
    await pressKey({ key: "F13" });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unbekannte Taste");
    expect(screen.queryByText("Key not supported")).not.toBeInTheDocument();
    // The refused cell points at its message.
    const cell = screen.getByRole("button", { name: "-1 Encounter: Keine Taste zugewiesen" });
    expect(cell).toHaveAttribute("aria-describedby", alert.id);
  });

  it("reports a failed save with the generic message", async () => {
    stubFetch({ ok: false, status: 500, body: { error: "boom" } });
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);

    await clickCell("-1 Encounter: Keine Taste zugewiesen");
    await pressKey({ key: "F5" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Hotkey konnte nicht gespeichert werden",
    );
  });

  it("names the other holder when the backend answers 409", async () => {
    stubFetch({
      ok: false,
      status: 409,
      body: {
        error: "key already bound",
        owner: { kind: "pokemon", id: "poke-1", label: "Bisasam" },
      },
    });
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);

    await clickCell("-1 Encounter: Keine Taste zugewiesen");
    await pressKey({ key: "F5" });

    const message = await screen.findByRole("alert");
    expect(message).toHaveTextContent('Taste bereits belegt von „Bisasam"');
  });

  it("renders the hunt toggle row and records a binding for it", async () => {
    stubFetch();
    const onUpdate = vi.fn();
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={onUpdate} />);

    expect(screen.getByText("Hunt Start/Pause")).toBeInTheDocument();
    await clickCell("Hunt Start/Pause: Keine Taste zugewiesen");
    await pressKey({ key: "h", ctrlKey: true });

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ hunt_toggle: "Ctrl+H" }));
    });
  });
});
