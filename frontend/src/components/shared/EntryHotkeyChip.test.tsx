import { describe, it, expect } from "vitest";
import { render, screen } from "../../test-utils";
import { EntryHotkeyChip } from "./EntryHotkeyChip";

describe("EntryHotkeyChip", () => {
  it("renders nothing while the entry has no own binding", () => {
    render(<EntryHotkeyChip hotkeys={{ increment: "", reset: "  " }} />);
    expect(screen.queryByTestId("entry-hotkey-chip")).not.toBeInTheDocument();
  });

  it("draws the +1 key and lists every bound action for tooltip and screen reader", () => {
    render(<EntryHotkeyChip hotkeys={{ increment: "F6", decrement: "Shift+F2" }} />);

    const chip = screen.getByTestId("entry-hotkey-chip");
    const summary = "Feste Hotkeys: +1 Encounter F6, -1 Encounter Shift+F2";
    expect(chip).toHaveAttribute("title", summary);
    expect(screen.getByText(summary)).toHaveClass("sr-only");
    // Only the +1 key is drawn, and it is hidden from assistive technology
    // because the summary already reads it out with its action.
    const kbd = screen.getByText("F6");
    expect(kbd.tagName).toBe("KBD");
    expect(kbd.closest("[aria-hidden='true']")).not.toBeNull();
    expect(screen.queryByText("F2")).not.toBeInTheDocument();
  });

  it("draws the pin alone when only other actions are bound", () => {
    render(<EntryHotkeyChip hotkeys={{ reset: "Ctrl+F8" }} />);

    const chip = screen.getByTestId("entry-hotkey-chip");
    expect(screen.getByText("Feste Hotkeys: Reset Ctrl+F8")).toBeInTheDocument();
    expect(chip.querySelector("kbd")).toBeNull();
    expect(chip.querySelector("svg.lucide-pin")).not.toBeNull();
  });

  it("draws the pin alone in compact mode but still names the key", () => {
    render(<EntryHotkeyChip hotkeys={{ increment: "Ctrl+F8" }} compact />);

    const chip = screen.getByTestId("entry-hotkey-chip");
    expect(chip.querySelector("kbd")).toBeNull();
    expect(chip.querySelector("svg.lucide-pin")).not.toBeNull();
    const summary = "Feste Hotkeys: +1 Encounter Ctrl+F8";
    expect(chip).toHaveAttribute("title", summary);
    expect(screen.getByText(summary)).toHaveClass("sr-only");
  });

  it("marks the drawn key with the pin icon of the pinned kind", () => {
    render(<EntryHotkeyChip hotkeys={{ increment: "F6" }} />);
    const chip = screen.getByTestId("entry-hotkey-chip");
    expect(chip.querySelector("svg.lucide-pin")).not.toBeNull();
    expect(chip.querySelector("svg.lucide-globe")).toBeNull();
  });
});
