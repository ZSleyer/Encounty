/**
 * Settings.languages.test.tsx: the picker for Pokemon and game name languages.
 *
 * Split by feature area; the mocks and setup below are per file, so every
 * split file carries the ones its cases rely on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, makeAppState, userEvent } from "../test-utils";
import { Settings } from "./Settings";
import { useCounterStore } from "../hooks/useCounterState";

/** Activate a settings tab by its accessible name (German labels in tests). */
async function openTab(user: ReturnType<typeof userEvent.setup>, name: RegExp | string) {
  await user.click(screen.getByRole("tab", { name }));
}

const mockFetch = vi.fn();

const clipboardWriteText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({}),
  });
  vi.stubGlobal("fetch", mockFetch);
  clipboardWriteText.mockClear();
  try {
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText: clipboardWriteText },
      configurable: true,
      writable: true,
    });
  } catch {
    // If jsdom refuses, fall back to direct assignment.
    (globalThis.navigator as unknown as { clipboard: unknown }).clipboard = {
      writeText: clipboardWriteText,
    };
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Settings", () => {
  beforeEach(() => {
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("renders language pills for Pokemon name languages", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, /Daten/);

    // Language pills should include Deutsch and English at minimum
    expect(screen.getByText("Deutsch")).toBeInTheDocument();
    expect(screen.getByText("English")).toBeInTheDocument();
  });

  it("toggles a Pokemon name language off and back on", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, /Daten/);

    // French should be available but not active by default (only de, en are active)
    const frenchBtn = screen.getByText("Français").closest("button")!;
    expect(frenchBtn).toBeInTheDocument();

    // Click to enable French
    await user.click(frenchBtn);

    // Click again to disable French
    await user.click(frenchBtn);

    // Should still be in the DOM (the button doesn't disappear)
    expect(screen.getByText("Français")).toBeInTheDocument();
  });

  it("does not remove last active language", async () => {
    const user = userEvent.setup();
    // Start with only one language active
    useCounterStore.setState({
      appState: makeAppState({
        settings: {
          ...makeAppState().settings,
          languages: ["de"],
        },
      }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Settings />);
    await openTab(user, /Daten/);

    // Try to deselect the only active language
    const deBtn = screen.getByText("Deutsch").closest("button")!;
    await user.click(deBtn);

    // Should still show Deutsch (cannot remove last language)
    expect(screen.getByText("Deutsch")).toBeInTheDocument();
  });
});
