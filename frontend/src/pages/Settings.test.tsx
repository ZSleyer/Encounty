/**
 * Settings.test.tsx: page shell, meaning the initial render and the loading state.
 *
 * Split by feature area; the mocks and setup below are per file, so every
 * split file carries the ones its cases rely on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, makeAppState } from "../test-utils";
import { Settings } from "./Settings";
import { useCounterStore } from "../hooks/useCounterState";

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

  it("renders without crashing when state is available", () => {
    render(<Settings />);
    // Should show settings sections once loaded
    const { container } = render(<Settings />);
    expect(container).toBeTruthy();
  });

  it("shows loading spinner when no app state", () => {
    useCounterStore.setState({ appState: null });
    const { container } = render(<Settings />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });
});
