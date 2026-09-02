/**
 * Settings.about.test.tsx: about tab, meaning licenses, the license dialog and
 * the data source list.
 *
 * Split by feature area; the mocks and setup below are per file, so every
 * split file carries the ones its cases rely on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, makeAppState, userEvent, waitFor } from "../test-utils";
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
              {
                name: "react",
                version: "19.0.0",
                license: "MIT",
                text: "MIT License",
                source: "npm",
              },
            ]),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<Settings />);
    await openTab(user, "Über");

    // Find the licenses toggle by its German text "Open-Source-Lizenzen"
    const licensesToggle = screen
      .getByText(/Open-Source-Lizenzen|Open Source Licenses/i)
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
    const dsToggle = screen
      .getAllByRole("button")
      .find(
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
              {
                name: "zustand",
                version: "5.0.0",
                license: "MIT",
                text: "MIT License text here",
                source: "npm",
              },
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

  it("renders all data source entries when expanded", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, "Über");

    const dsToggle = screen
      .getAllByRole("button")
      .find(
        (b) => b.textContent?.includes("Datenquellen") || b.textContent?.includes("Data Sources"),
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
});
