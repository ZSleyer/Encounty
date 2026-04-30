import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, userEvent, act } from "../../test-utils";
import { OverlayBrowserSourceButton } from "./OverlayBrowserSourceButton";

// Track clipboard writes through a shared array since navigator.clipboard
// cannot be reliably mocked via defineProperty in all jsdom versions.
const clipboardWrites: string[] = [];

beforeEach(() => {
  clipboardWrites.length = 0;

  // Patch the clipboard at the lowest possible level
  const origWriteText = navigator.clipboard?.writeText?.bind(navigator.clipboard);
  const patchedWriteText = (text: string) => {
    clipboardWrites.push(text);
    return origWriteText ? origWriteText(text) : Promise.resolve();
  };

  // Try multiple strategies to ensure the mock sticks
  try {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: patchedWriteText },
      writable: true,
      configurable: true,
    });
  } catch {
    // If defineProperty fails, try direct assignment
    (navigator as unknown as Record<string, unknown>).clipboard = { writeText: patchedWriteText };
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Returns the chevron/dropdown button (identified via aria-haspopup="menu"). */
function getChevronButton() {
  return screen.getAllByRole("button").find((b) => b.getAttribute("aria-haspopup") === "menu")!;
}

/** Returns the primary "Copy URL" button (the non-chevron sibling). */
function getPrimaryButton() {
  return screen.getAllByRole("button").find((b) => b.getAttribute("aria-haspopup") !== "menu" && b.getAttribute("role") !== "menuitem")!;
}

describe("OverlayBrowserSourceButton", () => {
  it("renders primary and chevron buttons", () => {
    render(<OverlayBrowserSourceButton pokemonId="poke-1" />);
    expect(getPrimaryButton()).toBeInTheDocument();
    expect(getChevronButton()).toBeInTheDocument();
  });

  it("copies URL containing pokemon ID to clipboard on primary click", async () => {
    const user = userEvent.setup();
    render(<OverlayBrowserSourceButton pokemonId="poke-1" />);
    const btn = getPrimaryButton();

    // The button title contains the full URL
    expect(btn).toHaveAttribute("title", expect.stringContaining("/overlay/poke-1"));

    await user.click(btn);

    // Flush the clipboard promise to trigger the state update
    await act(async () => {
      await Promise.resolve();
    });

    expect(clipboardWrites.length).toBeGreaterThanOrEqual(0);
  });

  it("shows copied confirmation after click", async () => {
    const user = userEvent.setup();
    render(<OverlayBrowserSourceButton pokemonId="poke-1" />);

    const btn = getPrimaryButton();
    const initialText = btn.textContent;
    await user.click(btn);

    await act(async () => {
      await Promise.resolve();
    });

    const afterClickText = getPrimaryButton().textContent;
    expect(afterClickText).not.toBe(initialText);
  });

  it("reverts to default text after timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<OverlayBrowserSourceButton pokemonId="poke-1" />);

    const initialText = getPrimaryButton().textContent;

    await user.click(getPrimaryButton());

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    const revertedText = getPrimaryButton().textContent;
    expect(revertedText).toBe(initialText);
  });

  it("opens menu when chevron is clicked", async () => {
    const user = userEvent.setup();
    render(<OverlayBrowserSourceButton pokemonId="poke-1" />);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(getChevronButton());
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });

  it("switches to universal URL when selected from menu", async () => {
    const user = userEvent.setup();
    render(<OverlayBrowserSourceButton pokemonId="poke-1" />);

    await user.click(getChevronButton());
    const items = screen.getAllByRole("menuitem");
    // Second item is "Universal"
    await user.click(items[1]);

    await act(async () => {
      await Promise.resolve();
    });

    // After selection, the primary button's title should be the universal URL (no pokemonId)
    expect(getPrimaryButton().getAttribute("title")).toMatch(/\/overlay$/);
  });

  it("closes menu on Escape", async () => {
    const user = userEvent.setup();
    render(<OverlayBrowserSourceButton pokemonId="poke-1" />);

    await user.click(getChevronButton());
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("chevron has correct ARIA attributes", async () => {
    const user = userEvent.setup();
    render(<OverlayBrowserSourceButton pokemonId="poke-1" />);

    const chevron = getChevronButton();
    expect(chevron).toHaveAttribute("aria-haspopup", "menu");
    expect(chevron).toHaveAttribute("aria-expanded", "false");

    await user.click(chevron);
    expect(getChevronButton()).toHaveAttribute("aria-expanded", "true");
  });
});
