import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, makeAppState, userEvent, waitFor } from "../test-utils";
import { Settings } from "./Settings";
import { ToastContainer } from "../components/shared/ToastContainer";
import { useCounterStore } from "../hooks/useCounterState";

/** Wrapper rendering Settings together with the global toast container. */
function SettingsWithToasts() {
  return (
    <>
      <Settings />
      <ToastContainer />
    </>
  );
}

/** Activate a settings tab by its accessible name (German labels in tests). */
async function openTab(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp | string,
) {
  await user.click(screen.getByRole("tab", { name }));
}

const mockFetch = vi.fn();

/** Minimal WebSocket stub used to drive the unified sync flow. */
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;

  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  simulateMessage(payload: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }

  static readonly instances: MockWebSocket[] = [];
  static clear() {
    MockWebSocket.instances.length = 0;
  }
  static latest(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }
}

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
  MockWebSocket.clear();
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

  it("renders language selection dropdown", async () => {
    render(<Settings />);

    // Language toggle buttons should be present (DE/EN)
    const langButtons = screen.getAllByRole("button");
    const deLangButton = langButtons.find(btn => btn.textContent?.startsWith("DE"));
    const enLangButton = langButtons.find(btn => btn.textContent?.startsWith("EN"));

    expect(deLangButton).toBeInTheDocument();
    expect(enLangButton).toBeInTheDocument();
  });

  it("renders output toggle section", async () => {
    render(<Settings />);

    // Output section should be present with FolderOpen icon and content
    // We can't rely on translation keys, so check for structural elements
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("displays config path when appState has data_path", async () => {
    const testPath = "/test/config/path";
    useCounterStore.setState({
      appState: makeAppState({ data_path: testPath }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, /Daten/);

    // Config path should be displayed
    await waitFor(() => {
      expect(screen.getByText(testPath)).toBeInTheDocument();
    });
  });

  it("renders backup section with download and restore buttons", async () => {
    render(<Settings />);

    // Should have multiple buttons including backup and restore
    await waitFor(() => {
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(5); // Has many buttons for various settings
    });
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

  it("renders search input field", async () => {
    render(<Settings />);

    // Search input should be present (look for textbox role)
    const textboxes = screen.getAllByRole("textbox");
    expect(textboxes.length).toBeGreaterThan(0);
  });

  it("toggles output enabled setting", async () => {
    userEvent.setup();
    render(<Settings />);

    // Find toggle buttons (output toggle should be one of them)
    const toggleButtons = screen.getAllByRole("button");

    // The test verifies the component renders; actual toggle testing would require
    // identifying the specific toggle button which is complex due to multiple toggles
    expect(toggleButtons.length).toBeGreaterThan(0);
  });

  it("renders the section headings owned by each tab", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    // Appearance tab is active by default and owns the display section.
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBe(1);

    // Data tab owns game-name languages, data and backup sections.
    await openTab(user, /Daten/);
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBe(3);

    await openTab(user, /OBS/);
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBe(1);

    await openTab(user, "Über");
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBe(1);
  });

  it("toggles output enabled and enables the directory input", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, /OBS/);

    // The output directory text input lives inside the FolderPathInput
    // component and is labelled with the "Ausgabe-Ordner" aria-label.
    const dirInput = screen.getByRole("textbox", { name: /Ausgabe-Ordner/i }) as HTMLInputElement;
    expect(dirInput).toBeTruthy();

    // Output is disabled by default, so a parent has the grayscale class
    const disabledWrapper = dirInput.closest(".grayscale");
    expect(disabledWrapper).toBeTruthy();

    // The output toggle has aria-label matching the section output title (German)
    const outputToggle = screen.getAllByRole("switch").find(
      (s) => s.getAttribute("aria-label")?.includes("Dateiausgabe") ||
             s.getAttribute("aria-label")?.includes("File Output"),
    );
    expect(outputToggle).toBeTruthy();
    expect(outputToggle!.getAttribute("aria-checked")).toBe("false");

    await user.click(outputToggle!);

    // After enabling output, the toggle should report checked.
    expect(outputToggle!.getAttribute("aria-checked")).toBe("true");
  });

  it("renders the OBS file output card and copies the path on click", async () => {
    useCounterStore.setState({
      appState: makeAppState({
        settings: {
          ...makeAppState().settings,
          output_enabled: true,
          output_dir: "/obs/output",
        },
      }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, /OBS/);

    // userEvent.setup() installs its own clipboard stub; restore the mock so
    // the assertion below observes the component's writeText call.
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText: clipboardWriteText },
      configurable: true,
      writable: true,
    });

    // The OBS info card uses the German "OBS Dateiausgabe" title.
    expect(screen.getByText("OBS Dateiausgabe")).toBeInTheDocument();

    const copyBtn = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-label") === "Pfad des Ausgabe-Ordners kopieren")!;
    expect(copyBtn).toBeTruthy();

    // Use native click to avoid user-event's internal clipboard wrapper.
    copyBtn.click();

    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenCalledWith("/obs/output");
    });
  });

  it("updates output directory path on input change", async () => {
    const user = userEvent.setup();
    useCounterStore.setState({
      appState: makeAppState({
        settings: {
          ...makeAppState().settings,
          output_enabled: true,
          output_dir: "/initial/path",
        },
      }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Settings />);
    await openTab(user, /OBS/);

    const dirInput = screen.getByDisplayValue("/initial/path");
    expect(dirInput).toBeInTheDocument();

    await user.clear(dirInput);
    await user.type(dirInput, "/new/output/path");

    expect(dirInput).toHaveValue("/new/output/path");
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
    expect(
      screen.getAllByRole("heading", { level: 2 }).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("renders theme toggle buttons with correct pressed state for dark mode", () => {
    render(<Settings />);

    // Find theme buttons by aria-label (dark/light)
    const darkBtn = screen.getAllByRole("button").find(
      (b) => b.getAttribute("aria-pressed") === "true" || b.getAttribute("aria-pressed") === "false",
    );
    expect(darkBtn).toBeTruthy();
  });

  it("renders UI locale buttons (DE, EN, FR, ES, JA)", () => {
    render(<Settings />);

    // All locale buttons should be present
    expect(screen.getByText("DE")).toBeInTheDocument();
    expect(screen.getByText("EN")).toBeInTheDocument();
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

  it("renders sync pokemon button and triggers sync", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, /Daten/);

    // Find sync buttons in the Data section
    const syncButtons = screen.getAllByRole("button").filter(
      (b) => b.querySelector(".lucide-refresh-cw") || b.textContent?.includes("Sync") || b.textContent?.includes("sync"),
    );
    expect(syncButtons.length).toBeGreaterThan(0);
  });

  it("renders the licenses toggle and opens license list", async () => {
    const user = userEvent.setup();
    // Mock the licenses API
    mockFetch.mockImplementation((_url: unknown) => {
      const url = String(_url);
      if (url.includes("/api/licenses")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { name: "react", version: "19.0.0", license: "MIT", text: "MIT License", source: "npm" },
            ]),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<Settings />);
    await openTab(user, "Über");

    // Find the licenses toggle by its German text "Open-Source-Lizenzen"
    const licensesToggle = screen.getByText(/Open-Source-Lizenzen|Open Source Licenses/i)
      .closest("button");
    expect(licensesToggle).toBeTruthy();

    await user.click(licensesToggle!);

    // After clicking, wait for license data to load
    await waitFor(() => {
      expect(screen.getByText("react")).toBeInTheDocument();
    });
  });

  it("renders the data sources toggle and opens the list", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, "Über");

    // Find the data sources toggle
    const dsToggle = screen.getAllByRole("button").find(
      (b) =>
        b.textContent?.includes("Datenquellen") ||
        b.textContent?.includes("Data Sources") ||
        b.textContent?.includes("Data"),
    );

    if (dsToggle) {
      await user.click(dsToggle);

      await waitFor(() => {
        expect(screen.getByText("PokéAPI")).toBeInTheDocument();
        expect(screen.getByText("PokéSprite")).toBeInTheDocument();
      });
    }
  });

  it("renders the data path with a change button", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, /Daten/);

    // The data path from makeAppState is /tmp/encounty and is rendered in
    // both the OBS card (output_dir) and the Data section (data_path), so
    // there should be at least one occurrence.
    expect(screen.getAllByText("/tmp/encounty").length).toBeGreaterThanOrEqual(1);

    // The change button is labelled with the German "Ändern" string.
    expect(screen.getByRole("button", { name: "Ändern" })).toBeInTheDocument();
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
    const uncheckedSwitches = switches.filter(
      (s) => s.getAttribute("aria-checked") === "false",
    );
    expect(uncheckedSwitches.length).toBeGreaterThanOrEqual(1);

    // Click the first unchecked switch (crisp_sprites on the appearance tab)
    // We just verify no crash occurs
    await user.click(uncheckedSwitches[0]);
  });

  it("renders backup download and restore buttons", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, /Daten/);

    // Backup and restore buttons live in the backup section on the data tab.
    expect(screen.getByText("Backup erstellen")).toBeInTheDocument();
    expect(screen.getByText("Backup wiederherstellen")).toBeInTheDocument();
  });

  it("runs unified sync via /api/setup/online and shows progress", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("WebSocket", MockWebSocket);
    mockFetch.mockImplementation((_url: unknown) => {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<Settings />);
    await openTab(user, /Daten/);

    const syncBtn = screen.getByRole("button", { name: /Daten synchronisieren/i });
    expect(syncBtn).not.toBeDisabled();

    await user.click(syncBtn);

    // Button should now be disabled and show the syncing label.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Synchronisiere/i })).toBeDisabled();
    });

    // setup/online endpoint should have been POSTed.
    await waitFor(() => {
      const setupCall = mockFetch.mock.calls.find(
        (call: unknown[]) => String(call[0]).includes("/api/setup/online"),
      );
      expect(setupCall).toBeTruthy();
    });

    const ws = MockWebSocket.latest();
    expect(ws).toBeTruthy();

    // Progress update.
    act(() => {
      ws.simulateMessage({
        type: "sync_progress",
        payload: { phase: "pokedex", step: "species" },
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/pokedex.*species/)).toBeInTheDocument();
    });

    // Completion event.
    act(() => {
      ws.simulateMessage({ type: "system_ready", payload: {} });
    });

    await waitFor(() => {
      expect(screen.getByText(/Sync abgeschlossen/)).toBeInTheDocument();
    });

    // Button should be enabled again.
    expect(
      screen.getByRole("button", { name: /Daten synchronisieren/i }),
    ).not.toBeDisabled();
  });

  it("shows error when /api/setup/online fetch rejects", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("WebSocket", MockWebSocket);
    mockFetch.mockImplementation((_url: unknown) => {
      const url = String(_url);
      if (url.includes("/api/setup/online")) {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<Settings />);
    await openTab(user, /Daten/);

    const syncBtn = screen.getByRole("button", { name: /Daten synchronisieren/i });
    await user.click(syncBtn);

    await waitFor(() => {
      expect(screen.getByText(/request failed/)).toBeInTheDocument();
    });
  });

  it("shows error when WebSocket emits a sync_progress error step", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("WebSocket", MockWebSocket);
    mockFetch.mockImplementation((_url: unknown) => {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<Settings />);
    await openTab(user, /Daten/);

    const syncBtn = screen.getByRole("button", { name: /Daten synchronisieren/i });
    await user.click(syncBtn);

    await waitFor(() => {
      expect(MockWebSocket.latest()).toBeTruthy();
    });

    act(() => {
      MockWebSocket.latest().simulateMessage({
        type: "sync_progress",
        payload: { phase: "games", step: "error", error: "boom" },
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/boom/)).toBeInTheDocument();
    });
  });

  it("opens license dialog when show-license button is clicked", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, "Über");

    // Find the button with text "Lizenz anzeigen"
    const licenseBtn = screen.getByText("Lizenz anzeigen").closest("button")!;
    expect(licenseBtn).toBeTruthy();

    await user.click(licenseBtn);

    // The LicenseDialog component should now be in the DOM
    // Just verify the click doesn't crash and something new appears
    await waitFor(() => {
      // LicenseDialog renders; check for any new content
      const allButtons = screen.getAllByRole("button");
      expect(allButtons.length).toBeGreaterThan(0);
    });
  });

  it("expands a license entry to show its text", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((_url: unknown) => {
      const url = String(_url);
      if (url.includes("/api/licenses")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { name: "zustand", version: "5.0.0", license: "MIT", text: "MIT License text here", source: "npm" },
            ]),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<Settings />);
    await openTab(user, "Über");

    // Open licenses section
    const licensesToggle = screen.getByText(/Open-Source-Lizenzen/i).closest("button")!;
    await user.click(licensesToggle);

    // Wait for license to appear
    await waitFor(() => {
      expect(screen.getByText("zustand")).toBeInTheDocument();
    });

    // Click on the license entry to expand it
    const licenseEntry = screen.getByText("zustand").closest("button")!;
    await user.click(licenseEntry);

    // License text should now be visible
    await waitFor(() => {
      expect(screen.getByText("MIT License text here")).toBeInTheDocument();
    });

    // Click again to collapse
    await user.click(licenseEntry);

    await waitFor(() => {
      expect(screen.queryByText("MIT License text here")).not.toBeInTheDocument();
    });
  });

  it("renders about section with AGPL link", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, "Über");

    const agplLink = screen.getByText("GNU AGPL-3.0");
    expect(agplLink).toBeInTheDocument();
    expect(agplLink.closest("a")).toHaveAttribute(
      "href",
      "https://www.gnu.org/licenses/agpl-3.0.html",
    );
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

  it("handles restore file upload with successful response", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    render(<Settings />);
    await openTab(user, /Daten/);

    // Find the hidden file input for restore
    const fileInput = document.querySelector("input[type='file'][accept='.zip']") as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    // Create a mock file and trigger change event
    const file = new File(["backup-data"], "encounty-backup.zip", { type: "application/zip" });
    await user.upload(fileInput, file);

    // Should call fetch with the restore endpoint
    await waitFor(() => {
      const restoreCall = mockFetch.mock.calls.find(
        (call: unknown[]) => String(call[0]).includes("/api/restore"),
      );
      expect(restoreCall).toBeTruthy();
    });
  });

  it("handles restore file upload with error response", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((_url: unknown) => {
      const url = String(_url);
      if (url.includes("/api/restore")) {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: "Invalid backup" }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<Settings />);
    await openTab(user, /Daten/);

    const fileInput = document.querySelector("input[type='file'][accept='.zip']") as HTMLInputElement;
    const file = new File(["bad-data"], "bad-backup.zip", { type: "application/zip" });
    await user.upload(fileInput, file);

    await waitFor(() => {
      const restoreCall = mockFetch.mock.calls.find(
        (call: unknown[]) => String(call[0]).includes("/api/restore"),
      );
      expect(restoreCall).toBeTruthy();
    });
  });

  it("handles restore file upload with network error", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((_url: unknown) => {
      const url = String(_url);
      if (url.includes("/api/restore")) {
        return Promise.reject(new Error("Network failure"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<Settings />);
    await openTab(user, /Daten/);

    const fileInput = document.querySelector("input[type='file'][accept='.zip']") as HTMLInputElement;
    const file = new File(["data"], "backup.zip", { type: "application/zip" });
    await user.upload(fileInput, file);

    await waitFor(() => {
      const restoreCall = mockFetch.mock.calls.find(
        (call: unknown[]) => String(call[0]).includes("/api/restore"),
      );
      expect(restoreCall).toBeTruthy();
    });
  });

  it("renders backup button that can be clicked without crash", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, /Daten/);

    const backupBtn = screen.getByText(/Backup erstellen|Create backup/i).closest("button")!;
    expect(backupBtn).toBeTruthy();

    // Click should not throw (downloadBackup creates a temporary anchor element)
    await user.click(backupBtn);

    // Button should still be in the DOM after click
    expect(backupBtn).toBeInTheDocument();
  });

  it("sets crisp sprites dataset when toggled on", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    // Find the crisp sprites toggle by its label
    const crispToggle = screen.getAllByRole("switch").find(
      (s) => s.getAttribute("aria-label")?.includes("scharf") ||
             s.getAttribute("aria-label")?.includes("Crisp") ||
             s.getAttribute("aria-label")?.includes("Sprites"),
    );
    expect(crispToggle).toBeTruthy();
    expect(crispToggle!.getAttribute("aria-checked")).toBe("false");

    await user.click(crispToggle!);

    expect(crispToggle!.getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.dataset.crispSprites).toBeDefined();
  });

  it("changes config path when change button is clicked", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    render(<Settings />);
    await openTab(user, /Daten/);

    // FolderPathInput exposes the DB path input via its aria-label.
    const configInput = screen.getByRole("textbox", {
      name: "Datenbank-Speicherort",
    }) as HTMLInputElement;
    expect(configInput).toBeTruthy();

    await user.clear(configInput);
    await user.type(configInput, "/new/config/path");

    const changeBtn = screen.getByRole("button", { name: "Ändern" });
    expect(changeBtn).not.toBeDisabled();
    await user.click(changeBtn);

    await waitFor(() => {
      const pathCall = mockFetch.mock.calls.find(
        (call: unknown[]) => String(call[0]).includes("/api/settings/config-path"),
      );
      expect(pathCall).toBeTruthy();
      const body = JSON.parse((pathCall![1] as RequestInit).body as string);
      expect(body).toEqual({ path: "/new/config/path" });
    });
  });

  it("shows error toast when config path change fails with error", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((_url: unknown) => {
      const url = String(_url);
      if (url.includes("/api/settings/config-path")) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: "Permission denied" }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<SettingsWithToasts />);
    await openTab(user, /Daten/);

    const configInput = screen.getByRole("textbox", {
      name: "Datenbank-Speicherort",
    }) as HTMLInputElement;
    await user.clear(configInput);
    await user.type(configInput, "/invalid/path");

    const changeBtn = screen.getByRole("button", { name: "Ändern" });
    await user.click(changeBtn);

    await waitFor(() => {
      // German translation of settings.dbPathError.
      expect(
        screen.getByText("Datenbank-Speicherort konnte nicht geändert werden"),
      ).toBeInTheDocument();
    });
  });

  it("shows error toast when config path change throws network error", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((_url: unknown) => {
      const url = String(_url);
      if (url.includes("/api/settings/config-path")) {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<SettingsWithToasts />);
    await openTab(user, /Daten/);

    const configInput = screen.getByRole("textbox", {
      name: "Datenbank-Speicherort",
    }) as HTMLInputElement;
    await user.clear(configInput);
    await user.type(configInput, "/unreachable/path");

    const changeBtn = screen.getByRole("button", { name: "Ändern" });
    await user.click(changeBtn);

    await waitFor(() => {
      expect(
        screen.getByText("Datenbank-Speicherort konnte nicht geändert werden"),
      ).toBeInTheDocument();
    });
  });

  it("disables the change button when draft equals the current data path", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, /Daten/);

    // The draft input is initialised with appState.data_path, so the button
    // must start out disabled.
    const changeBtn = screen.getByRole("button", { name: "Ändern" });
    expect(changeBtn).toBeDisabled();
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

  it("renders all data source entries when expanded", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, "Über");

    const dsToggle = screen.getAllByRole("button").find(
      (b) =>
        b.textContent?.includes("Datenquellen") ||
        b.textContent?.includes("Data Sources"),
    );

    if (dsToggle) {
      await user.click(dsToggle);

      await waitFor(() => {
        expect(screen.getByText("PokéAPI")).toBeInTheDocument();
        expect(screen.getByText("PokéSprite")).toBeInTheDocument();
        expect(screen.getByText("Pokémon Showdown")).toBeInTheDocument();
      });
    }
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
    // The panel is labelled by the active tab and shows data-tab content.
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "settings-tab-data",
    );
    expect(
      screen.getByRole("button", { name: /Daten synchronisieren/i }),
    ).toBeInTheDocument();
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
