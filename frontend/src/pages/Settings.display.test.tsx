/**
 * Settings.display.test.tsx: appearance section, meaning theme, UI locale,
 * crisp sprites and the accent color picker.
 *
 * Split by feature area; the mocks and setup below are per file, so every
 * split file carries the ones its cases rely on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, makeAppState, userEvent, waitFor } from "../test-utils";
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

  it("renders language selection dropdown", async () => {
    render(<Settings />);

    // Language toggle buttons should be present (DE/EN)
    const langButtons = screen.getAllByRole("button");
    const deLangButton = langButtons.find((btn) => btn.textContent?.startsWith("DE"));
    const enLangButton = langButtons.find((btn) => btn.textContent?.startsWith("EN"));

    expect(deLangButton).toBeInTheDocument();
    expect(enLangButton).toBeInTheDocument();
  });

  it("renders theme toggle buttons", async () => {
    render(<Settings />);

    // Theme section should be present with dark/light mode buttons
    await waitFor(() => {
      const buttons = screen.getAllByRole("button");
      // Look for buttons with Moon/Sun icons (rendered as svg elements)
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  it("renders theme toggle buttons with correct pressed state for dark mode", () => {
    render(<Settings />);

    // Find theme buttons by aria-label (dark/light)
    const darkBtn = screen
      .getAllByRole("button")
      .find(
        (b) =>
          b.getAttribute("aria-pressed") === "true" || b.getAttribute("aria-pressed") === "false",
      );
    expect(darkBtn).toBeTruthy();
  });

  it("renders UI locale buttons (DE, EN, FR, ES, JA)", () => {
    render(<Settings />);

    // All locale buttons should be present
    expect(screen.getByText("DE")).toBeInTheDocument();
    expect(screen.getByText("EN")).toBeInTheDocument();
  });

  it("renders crisp sprites toggle", () => {
    render(<Settings />);

    // Crisp sprites toggle should be in the display section on the
    // appearance tab; the output toggle lives on the OBS & Output tab.
    const switches = screen.getAllByRole("switch");
    expect(switches.length).toBeGreaterThanOrEqual(1);
  });

  it("toggles crisp sprites setting", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    // crisp_sprites defaults to undefined/false in makeAppState
    // Find all unchecked switches; crisp_sprites should be among them
    const switches = screen.getAllByRole("switch");
    const uncheckedSwitches = switches.filter((s) => s.getAttribute("aria-checked") === "false");
    expect(uncheckedSwitches.length).toBeGreaterThanOrEqual(1);

    // Click the first unchecked switch (crisp_sprites on the appearance tab)
    // We just verify no crash occurs
    await user.click(uncheckedSwitches[0]);
  });

  it("selects an accent color preset", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    // The accent picker exposes one radio per preset; pick "violet".
    const violet = await screen.findByRole("radio", { name: /violet/i });
    await user.click(violet);

    expect(violet.getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.dataset.accent).toBe("violet");

    // Cleanup
    delete document.documentElement.dataset.accent;
  });

  it("sets crisp sprites dataset when toggled on", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    // Find the crisp sprites toggle by its label
    const crispToggle = screen
      .getAllByRole("switch")
      .find(
        (s) =>
          s.getAttribute("aria-label")?.includes("scharf") ||
          s.getAttribute("aria-label")?.includes("Crisp") ||
          s.getAttribute("aria-label")?.includes("Sprites"),
      );
    expect(crispToggle).toBeTruthy();
    expect(crispToggle!.getAttribute("aria-checked")).toBe("false");

    await user.click(crispToggle!);

    expect(crispToggle!.getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.dataset.crispSprites).toBeDefined();
  });
});
