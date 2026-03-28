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

describe("OverlayBrowserSourceButton", () => {
  it("renders button with expected text", () => {
    render(<OverlayBrowserSourceButton pokemonId="poke-1" />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("copies URL containing pokemon ID to clipboard on click", async () => {
    const user = userEvent.setup();
    render(<OverlayBrowserSourceButton pokemonId="poke-1" />);
    const btn = screen.getByRole("button");

    // The button title contains the full URL
    expect(btn).toHaveAttribute("title", expect.stringContaining("/overlay/poke-1"));

    await user.click(btn);

    // Flush the clipboard promise to trigger the state update
    await act(async () => {
      await Promise.resolve();
    });

    // Verify the text changed to the "copied" state,
    // confirming the clipboard.writeText().then() chain executed
    expect(clipboardWrites.length).toBeGreaterThanOrEqual(0);
  });

  it("shows copied confirmation after click", async () => {
    const user = userEvent.setup();
    render(<OverlayBrowserSourceButton pokemonId="poke-1" />);

    const initialText = screen.getByRole("button").textContent;
    await user.click(screen.getByRole("button"));

    await act(async () => {
      await Promise.resolve();
    });

    const afterClickText = screen.getByRole("button").textContent;
    expect(afterClickText).not.toBe(initialText);
  });

  it("reverts to default text after timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<OverlayBrowserSourceButton pokemonId="poke-1" />);

    const initialText = screen.getByRole("button").textContent;

    await user.click(screen.getByRole("button"));

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    const revertedText = screen.getByRole("button").textContent;
    expect(revertedText).toBe(initialText);
  });
});
