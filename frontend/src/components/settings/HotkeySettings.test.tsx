import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "../../test-utils";
import { HotkeySettings } from "./HotkeySettings";
import type { HotkeyMap } from "../../types";

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

  it("displays the current key binding", async () => {
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Ctrl+Up")).toBeInTheDocument();
    });
  });

  it("shows empty dash for unbound hotkeys", async () => {
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);
    // Wait for the async status fetch to settle
    await waitFor(() => {
      // decrement, reset, next_pokemon are unbound — shown as em dash
      const dashes = screen.getAllByText("\u2014");
      expect(dashes.length).toBe(4);
    });
  });

  it("enters recording mode when Aufzeichnen is clicked", async () => {
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);

    // Click the first "Aufzeichnen" button (increment)
    const recordButtons = screen.getAllByText("Aufzeichnen");
    await act(async () => {
      recordButtons[0].click();
    });

    // Should show recording UI
    expect(screen.getByText("Abbrechen")).toBeInTheDocument();
    // Should show the recording prompt
    expect(screen.getByText(/Drücke eine Taste/)).toBeInTheDocument();
  });

  it("cancels recording on Escape key", async () => {
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);

    const recordButtons = screen.getAllByText("Aufzeichnen");
    await act(async () => {
      recordButtons[0].click();
    });

    expect(screen.getByText("Abbrechen")).toBeInTheDocument();

    // Press Escape
    await act(async () => {
      fireEvent.keyDown(globalThis as unknown as Window, { key: "Escape" });
    });

    // Should return to non-recording state
    await waitFor(() => {
      expect(screen.queryByText("Abbrechen")).not.toBeInTheDocument();
    });
  });

  it("cancels recording when Abbrechen button is clicked", async () => {
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);

    const recordButtons = screen.getAllByText("Aufzeichnen");
    await act(async () => {
      recordButtons[0].click();
    });

    await act(async () => {
      screen.getByText("Abbrechen").click();
    });

    await waitFor(() => {
      expect(screen.queryByText("Abbrechen")).not.toBeInTheDocument();
    });
  });

  it("shows live modifier keys during recording", async () => {
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);

    const recordButtons = screen.getAllByText("Aufzeichnen");
    await act(async () => {
      recordButtons[0].click();
    });

    // Press Ctrl (modifier only)
    await act(async () => {
      fireEvent.keyDown(globalThis as unknown as Window, { key: "Control", ctrlKey: true });
    });

    // The modifier text appears in both the kbd and the prompt span
    const matches = screen.getAllByText("Ctrl+\u2026");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("commits a key binding on non-modifier key press", async () => {
    const onUpdate = vi.fn();
    vi.mocked(fetch).mockImplementation((url: any) => {
      if (typeof url === "string" && url.includes("/hotkeys/status")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ available: true }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    });

    render(<HotkeySettings hotkeys={hotkeys} onUpdate={onUpdate} />);

    // Start recording for decrement (second Aufzeichnen)
    const recordButtons = screen.getAllByText("Aufzeichnen");
    await act(async () => {
      recordButtons[1].click();
    });

    // Press Ctrl+A
    await act(async () => {
      fireEvent.keyDown(globalThis as unknown as Window, { key: "a", ctrlKey: true });
    });

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ decrement: "Ctrl+A" }),
      );
    });
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
    vi.mocked(fetch).mockImplementation(() =>
      Promise.reject(new Error("network error")),
    );

    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Globale Hotkeys nicht verfügbar")).toBeInTheDocument();
    });
  });

  it("shows delete button for bound hotkeys", async () => {
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);
    // Increment has a binding, so it should show a delete button
    await waitFor(() => {
      const deleteButton = screen.getByTitle("Hotkey löschen");
      expect(deleteButton).toBeInTheDocument();
    });
  });

  it("deletes a key binding when delete button is clicked", async () => {
    const onUpdate = vi.fn();
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={onUpdate} />);

    const deleteButton = await screen.findByTitle("Hotkey löschen");
    await act(async () => {
      deleteButton.click();
    });

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ increment: "" }),
      );
    });
  });

  it("shows conflict warning when two actions have the same binding", async () => {
    const conflicting: HotkeyMap = {
      increment: "Ctrl+Up",
      decrement: "Ctrl+Up",
      reset: "",
      next_pokemon: "",
    };
    render(<HotkeySettings hotkeys={conflicting} onUpdate={vi.fn()} />);
    // Wait for the async status fetch to settle
    await waitFor(() => {
      const warnings = screen.getAllByText(/Gleiche Taste wie/);
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  it("shows error when PUT request fails", async () => {
    vi.mocked(fetch).mockImplementation((url: any) => {
      if (typeof url === "string" && url.includes("/hotkeys/status")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ available: true }),
        } as Response);
      }
      if (typeof url === "string" && url.includes("/hotkeys/resume")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
      }
      // PUT fails
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: "Key not supported" }),
      } as Response);
    });

    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);

    const recordButtons = screen.getAllByText("Aufzeichnen");
    await act(async () => {
      recordButtons[1].click();
    });

    await act(async () => {
      fireEvent.keyDown(globalThis as unknown as Window, { key: "F13" });
    });

    await waitFor(() => {
      expect(screen.getByText("Key not supported")).toBeInTheDocument();
    });
  });

  it("updates live modifiers on keyup during recording", async () => {
    render(<HotkeySettings hotkeys={hotkeys} onUpdate={vi.fn()} />);

    const recordButtons = screen.getAllByText("Aufzeichnen");
    await act(async () => {
      recordButtons[0].click();
    });

    // Press Ctrl+Shift down
    await act(async () => {
      fireEvent.keyDown(globalThis as unknown as Window, { key: "Control", ctrlKey: true });
    });

    // Release Ctrl but keep Shift
    await act(async () => {
      fireEvent.keyUp(globalThis as unknown as Window, { key: "Control", shiftKey: true });
    });

    const matches = screen.getAllByText("Shift+\u2026");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("renders the hunt toggle row and records a binding for it", async () => {
    const onUpdate = vi.fn();
    vi.mocked(fetch).mockImplementation((url: any) => {
      if (typeof url === "string" && url.includes("/hotkeys/status")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ available: true }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    });

    render(<HotkeySettings hotkeys={hotkeys} onUpdate={onUpdate} />);

    // Label is rendered from i18n (de: "Hunt Start/Pause")
    await waitFor(() => {
      expect(screen.getByText("Hunt Start/Pause")).toBeInTheDocument();
    });

    // hunt_toggle is the fifth row after increment, decrement, reset, next_pokemon.
    const recordButtons = screen.getAllByText("Aufzeichnen");
    expect(recordButtons.length).toBe(5);

    await act(async () => {
      recordButtons[4].click();
    });

    await act(async () => {
      fireEvent.keyDown(globalThis as unknown as Window, { key: "h", ctrlKey: true });
    });

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ hunt_toggle: "Ctrl+H" }),
      );
    });
  });
});
