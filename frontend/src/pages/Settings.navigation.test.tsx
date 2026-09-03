/**
 * Settings.navigation.test.tsx: search field, section filtering and the tab bar.
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

  it("renders search input field", async () => {
    render(<Settings />);

    // Search input should be present (look for textbox role)
    const textboxes = screen.getAllByRole("textbox");
    expect(textboxes.length).toBeGreaterThan(0);
  });

  it("renders the section headings owned by each tab", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    // Appearance tab is active by default and owns the display section.
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBe(1);

    // Data tab owns the data and backup sections.
    await openTab(user, /Daten/);
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBe(2);

    await openTab(user, /OBS/);
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBe(1);

    await openTab(user, "Über");
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBe(1);
  });

  it("filters sections via the search input", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    // Search input has a German aria-label; find it by placeholder text pattern
    const searchInput = screen.getByPlaceholderText(/durchsuchen|search/i);
    expect(searchInput).toBeInTheDocument();

    // Type a search term that matches only the backup section keyword
    await user.type(searchInput, "backup");

    // Only one section heading should remain visible
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.length).toBe(1);
  });

  it("shows no-results message when search matches nothing", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const searchInput = screen.getByPlaceholderText(/durchsuchen|search/i);
    await user.type(searchInput, "xyznonexistent");

    // No section headings should be visible
    const headings = screen.queryAllByRole("heading", { level: 2 });
    expect(headings.length).toBe(0);
  });

  it("clears search when the clear button is clicked", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const searchInput = screen.getByPlaceholderText(/durchsuchen|search/i);
    await user.type(searchInput, "backup");

    // Clear button should appear
    const clearBtn = screen.getByText("Esc").closest("button")!;
    expect(clearBtn).toBeInTheDocument();

    await user.click(clearBtn);

    // Search should be cleared and the tab view restored
    expect(searchInput).toHaveValue("");
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBeGreaterThanOrEqual(1);
  });

  it("renders no-results message when search matches nothing via different query", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const searchInput = screen.getByPlaceholderText(/durchsuchen|search/i);
    await user.type(searchInput, "zzzznoexist");

    // No section headings visible
    const headings = screen.queryAllByRole("heading", { level: 2 });
    expect(headings.length).toBe(0);
  });

  it("switches tabs via click and updates aria-selected", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    // Non-macOS platforms show four tabs (no System tab).
    expect(screen.getAllByRole("tab").length).toBe(4);

    const appearanceTab = screen.getByRole("tab", { name: "Darstellung" });
    const dataTab = screen.getByRole("tab", { name: /Daten/ });
    expect(appearanceTab).toHaveAttribute("aria-selected", "true");

    await user.click(dataTab);

    expect(dataTab).toHaveAttribute("aria-selected", "true");
    expect(appearanceTab).toHaveAttribute("aria-selected", "false");
    // The panel is labeled by the active tab and shows data-tab content.
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "settings-tab-data");
    expect(screen.getByRole("button", { name: /Daten synchronisieren/i })).toBeInTheDocument();
    // Appearance-only content (accent radiogroup) is no longer rendered.
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("moves between tabs with arrow keys, Home and End", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const appearanceTab = screen.getByRole("tab", { name: "Darstellung" });
    const dataTab = screen.getByRole("tab", { name: /Daten/ });
    const aboutTab = screen.getByRole("tab", { name: "Über" });

    appearanceTab.focus();

    await user.keyboard("{ArrowRight}");
    expect(dataTab).toHaveFocus();
    expect(dataTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowLeft}");
    expect(appearanceTab).toHaveFocus();
    expect(appearanceTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{End}");
    expect(aboutTab).toHaveFocus();
    expect(aboutTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Home}");
    expect(appearanceTab).toHaveFocus();
    expect(appearanceTab).toHaveAttribute("aria-selected", "true");
  });

  it("search shows matching sections across tabs and Escape restores the tab view", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const searchInput = screen.getByPlaceholderText(/durchsuchen|search/i);
    // "api" matches the data section (data tab) and the about section
    // (about tab), so both render although the appearance tab is active.
    await user.type(searchInput, "api");

    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.length).toBe(2);
    expect(screen.getByText("Datenbank & Sync")).toBeInTheDocument();
    expect(screen.getByText("Über Encounty")).toBeInTheDocument();
    // The tab bar is hidden while searching.
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();

    // Escape clears the search and returns to the tab view.
    await user.keyboard("{Escape}");
    expect(searchInput).toHaveValue("");
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });
});
